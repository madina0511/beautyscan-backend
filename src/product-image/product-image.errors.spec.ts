import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from 'fs/promises';
import { join } from 'path';
import { ImageNormalizationService } from './image-normalization.service';
import { ProductsService } from '../products/products.service';
import {
  ProductImageService,
  MAX_PROVIDER_RESPONSE_BYTES,
} from './product-image.service';
import { ProductImageErrorFilter } from './product-image-error.filter';
import {
  ProviderAdmissionService,
  PROVIDER_TIMEOUT_MS,
} from './provider-admission.service';
import { AxiosRequestConfig, CanceledError } from 'axios';
import { MAX_NORMALIZED_BYTES } from './image-upload.config';

describe('Safe image provider failures', () => {
  let file: string;
  let directory: string;
  const http = new HttpService();
  let post: jest.SpyInstance;
  const admission = { reserve: jest.fn(), release: jest.fn() };
  const service = new ProductImageService(
    {} as ProductsService,
    http,
    admission as unknown as ProviderAdmissionService,
    {} as ImageNormalizationService,
  );
  beforeAll(async () => {
    await mkdir('uploads/temporary', { recursive: true });
    directory = await mkdtemp('uploads/temporary/provider-test-');
    file = join(directory, 'fixture.png');
    await writeFile(file, Buffer.from([137, 80, 78, 71]));
  });
  beforeEach(() => {
    admission.reserve.mockReset().mockResolvedValue({
      id: 'fixture',
      apiKey: 'sandbox_fixture_not_a_real_credential',
    });
    admission.release.mockReset().mockResolvedValue(undefined);
    post = jest.spyOn(http.axiosRef, 'post');
  });
  afterEach(() => {
    post.mockRestore();
  });
  afterAll(async () => {
    await unlink(file);
    await rmdir(directory);
  });

  it('reports a missing credential without sending a provider request', async () => {
    admission.reserve.mockRejectedValue(
      new HttpException({ code: 'PHOTOROOM_CONFIGURATION' }, 503),
    );
    await expect(service.createFinalEditedImage(file)).rejects.toMatchObject({
      status: 503,
      response: { code: 'PHOTOROOM_CONFIGURATION' },
    });
    expect(post).not.toHaveBeenCalled();
    expect(admission.release).not.toHaveBeenCalled();
  });
  it.each(['DEMO_LIMIT_REACHED', 'PROVIDER_ADMISSION_UNAVAILABLE'])(
    'skips provider work and release when admission rejects with %s',
    async (code) => {
      admission.reserve.mockRejectedValue(new HttpException({ code }, 503));
      await expect(service.createFinalEditedImage(file)).rejects.toMatchObject({
        response: { code },
      });
      expect(post).not.toHaveBeenCalled();
      expect(admission.release).not.toHaveBeenCalled();
    },
  );
  it('waits for authenticated admission before starting the provider and releases on success', async () => {
    let allow: (value: { id: string; apiKey: string }) => void = () =>
      undefined;
    admission.reserve.mockReturnValue(
      new Promise((resolve) => {
        allow = resolve;
      }),
    );
    post.mockResolvedValue({ data: Buffer.from('processed-image') });
    const operation = service.createFinalEditedImage(file);
    expect(admission.reserve).toHaveBeenCalledWith(false);
    expect(post).not.toHaveBeenCalled();
    allow({ id: 'allowed', apiKey: 'sandbox_fixture' });
    await expect(operation).resolves.toEqual(Buffer.from('processed-image'));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][2]).toMatchObject({
      timeout: PROVIDER_TIMEOUT_MS,
      maxContentLength: MAX_PROVIDER_RESPONSE_BYTES,
      maxBodyLength: MAX_NORMALIZED_BYTES + 65_536,
      maxRedirects: 0,
      headers: { 'x-api-key': 'sandbox_fixture' },
    });
    expect(admission.release).toHaveBeenCalledTimes(1);
    expect(admission.release).toHaveBeenCalledWith('allowed');
  });
  it('aborts at the absolute deadline, releases after cancellation, and never retries', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      post.mockImplementation(
        (_url: string, _body: unknown, options: AxiosRequestConfig) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener?.('abort', () =>
              reject(new CanceledError('private-timeout')),
            );
          }),
      );
      const operation = service.createFinalEditedImage(file);
      const outcome = expect(operation).rejects.toMatchObject({
        status: 502,
        response: { code: 'PHOTOROOM_UNAVAILABLE' },
      });
      await Promise.resolve();
      expect(post).toHaveBeenCalledTimes(1);
      expect(admission.release).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS);
      await outcome;
      expect(post.mock.calls[0][2].signal.aborted).toBe(true);
      expect(admission.release).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
  it.each([0, MAX_PROVIDER_RESPONSE_BYTES + 1])(
    'rejects response size %s and releases capacity',
    async (size) => {
      const data = Buffer.alloc(size);
      post.mockResolvedValue({ data });
      await expect(service.createFinalEditedImage(file)).rejects.toMatchObject({
        response: { code: 'PHOTOROOM_UNAVAILABLE' },
      });
      expect(admission.release).toHaveBeenCalledTimes(1);
    },
  );
  it('releases capacity on unexpected local failure as well', async () => {
    post.mockRejectedValue(new Error('local failure'));
    await expect(service.createFinalEditedImage(file)).rejects.toThrow(
      'local failure',
    );
    expect(admission.release).toHaveBeenCalledTimes(1);
  });
  it('holds capacity during an in-flight call and allows reuse after release without refund', async () => {
    let active = false;
    let calls = 0;
    let complete: (value: { data: Buffer }) => void = () => undefined;
    admission.reserve.mockImplementation(async () => {
      if (active) throw new HttpException({ code: 'DEMO_LIMIT_REACHED' }, 503);
      active = true;
      calls++;
      return { id: `call-${calls}`, apiKey: 'sandbox_fixture' };
    });
    admission.release.mockImplementation(async () => {
      active = false;
    });
    post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const first = service.createFinalEditedImage(file);
    await Promise.resolve();
    await expect(service.createFinalEditedImage(file)).rejects.toMatchObject({
      status: 503,
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(admission.release).not.toHaveBeenCalled();
    complete({ data: Buffer.from('result') });
    await first;
    expect(active).toBe(false);
    post.mockResolvedValue({ data: Buffer.from('next-result') });
    await service.createFinalEditedImage(file);
    expect(calls).toBe(2);
    expect(admission.release).toHaveBeenCalledTimes(2);
  });
  it.each([
    [401, 'PHOTOROOM_CONFIGURATION', 503],
    [402, 'PHOTOROOM_CONFIGURATION', 503],
    [403, 'PHOTOROOM_CONFIGURATION', 503],
    [400, 'PHOTOROOM_REJECTED', 502],
    [422, 'PHOTOROOM_REJECTED', 502],
    [429, 'PHOTOROOM_UNAVAILABLE', 502],
    [503, 'PHOTOROOM_UNAVAILABLE', 502],
  ])('sanitizes provider HTTP %s as %s', async (status, code, mappedStatus) => {
    post.mockRejectedValue({
      isAxiosError: true,
      response: { status, data: Buffer.from('private-provider-body') },
      config: { headers: { 'x-api-key': 'private-credential' } },
    });
    try {
      await service.createFinalEditedImage(file);
      throw new Error('Expected provider rejection');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(mappedStatus);
      expect(exception.getResponse()).toMatchObject({
        code,
        providerStatus: status,
      });
      expect(JSON.stringify(exception.getResponse())).not.toContain('private-');
      expect(admission.release).toHaveBeenCalledTimes(1);
      expect(admission.release).toHaveBeenCalledWith('fixture');
    }
  });
  it('sanitizes network failures without inventing a provider HTTP status', async () => {
    post.mockRejectedValue({
      isAxiosError: true,
      config: { headers: { 'x-api-key': 'private-credential' } },
    });
    await expect(service.createFinalEditedImage(file)).rejects.toMatchObject({
      status: 502,
      response: { code: 'PHOTOROOM_UNAVAILABLE' },
    });
  });
});

describe('Upload error response and log redaction', () => {
  const filter = new ProductImageErrorFilter();
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });
  function catchError(error: unknown) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;
    filter.catch(error, host);
    return {
      body: json.mock.calls[0][0] as Record<string, unknown>,
      status: status.mock.calls[0][0] as number,
    };
  }
  it.each([
    [
      new HttpException(
        { code: 'DEMO_LIMIT_REACHED', message: 'private-detail' },
        503,
      ),
      'DEMO_LIMIT_REACHED',
      503,
    ],
    [
      new HttpException(
        { code: 'PROVIDER_ADMISSION_UNAVAILABLE', message: 'private-detail' },
        503,
      ),
      'PROVIDER_ADMISSION_UNAVAILABLE',
      503,
    ],
    [
      new BadRequestException('Invalid or corrupt image'),
      'UPLOAD_INVALID',
      400,
    ],
    [
      new BadRequestException(
        'Image exceeds the 25 megapixel or 10,000 pixel dimension limit',
      ),
      'UPLOAD_DIMENSIONS',
      400,
    ],
    [new PayloadTooLargeException(), 'UPLOAD_TOO_LARGE', 413],
    [
      new HttpException(
        {
          code: 'PHOTOROOM_CONFIGURATION',
          providerStatus: 403,
          message: 'private-provider-body',
        },
        503,
      ),
      'PHOTOROOM_CONFIGURATION',
      503,
    ],
    [new Error('private-credential'), 'PROCESSING_FAILED', 500],
  ])(
    'returns only a safe categorized error for %s',
    (error, code, expectedStatus) => {
      const { body, status } = catchError(error);
      expect(status).toBe(expectedStatus);
      expect(body.code).toBe(code);
      expect(body.requestId).toMatch(/^[a-f\d-]{36}$/);
      expect(JSON.stringify(body)).not.toContain('private-');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private-');
    },
  );
});
