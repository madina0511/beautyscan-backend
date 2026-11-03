import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { getModelToken } from '@nestjs/mongoose';
import { Server } from 'http';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import {
  mkdtemp,
  readdir,
  stat,
  utimes,
  writeFile,
  rm,
  mkdir,
} from 'fs/promises';
import { join, relative, resolve } from 'path';
import {
  GuestPreview,
  GuestPreviewState,
  GuestRequestLimit,
} from './guest-preview.schema';
import { GuestPreviewService } from './guest-preview.service';
import { GuestPreviewStorage, GUEST_TTL_MS } from './guest-preview.storage';
import {
  GuestPreviewController,
  GuestUploadGuard,
  GuestUploadLifecycle,
} from './guest-preview.controller';
import { ProviderAdmission } from './provider-admission.schema';
import { ProviderAdmissionService } from './provider-admission.service';
import { ProductImageService } from './product-image.service';
import { ProductsService } from '../products/products.service';
import { ImageNormalizationService } from './image-normalization.service';
import { MAX_UPLOAD_BYTES } from './image-upload.config';

interface Query<T> {
  exec(): Promise<T>;
  lean(): Query<T>;
  limit(count: number): Query<T>;
}
function query<T>(run: () => T): Query<T> {
  return {
    exec: async () => run(),
    lean() {
      return this;
    },
    limit() {
      return this;
    },
  };
}
type RecordFilter = Partial<Pick<GuestPreview, '_id' | 'previewId'>> & {
  state?: GuestPreviewState | { $in: GuestPreviewState[] };
  expiresAt?: { $gt?: Date; $lte?: Date };
};

describe('Guest preview backend (real HTTP/Sharp/files, mocked MongoDB/provider)', () => {
  let app: INestApplication;
  let server: Server;
  let service: GuestPreviewService;
  let root: string;
  let fixture: Buffer;
  let warn: jest.SpyInstance;
  const storage = new GuestPreviewStorage();
  const rows = new Map<string, GuestPreview>();
  const rates = new Map<string, GuestRequestLimit>();
  const settings: Record<string, string> = {};
  const defaults = {
    NODE_ENV: 'test',
    FRONTEND_URL: 'http://localhost:3001',
    PHOTOROOM_API_KEY: 'fixture',
    PHOTOROOM_GUEST_ENABLED: 'true',
    PHOTOROOM_DAILY_CALL_LIMIT: '10',
    PHOTOROOM_MAX_CONCURRENT: '2',
    PHOTOROOM_GUEST_IP_HOURLY_LIMIT: '3',
    PHOTOROOM_GUEST_MAX_ACTIVE: '2',
    PHOTOROOM_GUEST_HASH_SECRET: 'fixture-secret-with-at-least-32-characters',
  };
  function matches(row: GuestPreview, filter: RecordFilter): boolean {
    return (
      (!filter._id || row._id === filter._id) &&
      (!filter.previewId || row.previewId === filter.previewId) &&
      (!filter.state ||
        (typeof filter.state === 'string'
          ? row.state === filter.state
          : filter.state.$in.includes(row.state))) &&
      (!filter.expiresAt?.$gt || row.expiresAt > filter.expiresAt.$gt) &&
      (!filter.expiresAt?.$lte || row.expiresAt <= filter.expiresAt.$lte)
    );
  }
  const records = {
    init: jest.fn(async () => undefined),
    create: jest.fn(async (row: GuestPreview) => {
      if (rows.has(row._id)) throw { code: 11000 };
      rows.set(row._id, row);
      return row;
    }),
    findOneAndUpdate: jest.fn(
      (filter: RecordFilter, update: { $set: Partial<GuestPreview> }) =>
        query(() => {
          const row = [...rows.values()].find((row) => matches(row, filter));
          if (!row) return null;
          Object.assign(row, update.$set);
          return { ...row };
        }),
    ),
    updateOne: jest.fn(
      (filter: RecordFilter, update: { $set: Partial<GuestPreview> }) =>
        query(() => {
          const row = [...rows.values()].find((row) => matches(row, filter));
          if (!row) return { modifiedCount: 0 };
          Object.assign(row, update.$set);
          return { modifiedCount: 1 };
        }),
    ),
    findOne: jest.fn((filter: RecordFilter) =>
      query(
        () => [...rows.values()].find((row) => matches(row, filter)) ?? null,
      ),
    ),
    find: jest.fn((filter: RecordFilter) =>
      query(() => [...rows.values()].filter((row) => matches(row, filter))),
    ),
    deleteOne: jest.fn((filter: RecordFilter) =>
      query(() => {
        const row = [...rows.values()].find((row) => matches(row, filter));
        return { deletedCount: row && rows.delete(row._id) ? 1 : 0 };
      }),
    ),
  };
  const limits = {
    init: jest.fn(async () => undefined),
    updateOne: jest.fn(
      (
        filter: { _id: string },
        update: {
          $setOnInsert?: Partial<GuestRequestLimit>;
          $pull?: { leases: { id: string } };
        },
      ) =>
        query(() => {
          if (!rates.has(filter._id) && update.$setOnInsert)
            rates.set(filter._id, {
              _id: filter._id,
              hits: 0,
              leases: [],
              ...update.$setOnInsert,
            });
          const row = rates.get(filter._id);
          if (row && update.$pull)
            row.leases = row.leases.filter(
              (lease) => lease.id !== update.$pull?.leases.id,
            );
          return { modifiedCount: 1 };
        }),
    ),
    findOneAndUpdate: jest.fn(
      (
        filter: {
          _id: string;
          hits?: { $lt: number };
          $expr?: { $lt: [unknown, number] };
        },
        update: unknown,
      ) =>
        query(() => {
          const row = rates.get(filter._id);
          if (!row) return null;
          if (filter.hits) {
            if (row.hits >= filter.hits.$lt) return null;
            row.hits++;
          } else if (filter.$expr) {
            row.leases = row.leases.filter(
              (lease) => lease.expiresAt.getTime() > Date.now(),
            );
            if (row.leases.length >= filter.$expr.$lt[1]) return null;
            const pipeline = update as [
              {
                $set: {
                  leases: { $concatArrays: [unknown, { id: string }[]] };
                };
              },
            ];
            row.leases.push({
              id: pipeline[0].$set.leases.$concatArrays[1][0].id,
              expiresAt: new Date(Date.now() + 240_000),
            });
          }
          return row;
        }),
    ),
  };
  const providerState = { updateOne: jest.fn(), findOneAndUpdate: jest.fn() };
  const post = jest.fn();
  const products = {
    requireOwnedProduct: jest.fn(),
    updateProcessedImages: jest.fn(),
  };

  function upload(
    cookie?: string,
    bytes = fixture,
    origin = defaults.FRONTEND_URL,
  ) {
    const operation = request(server)
      .post('/product-image/guest/enhance')
      .set('Origin', origin);
    if (cookie) operation.set('Cookie', cookie);
    return operation.attach('image', bytes, 'photo.png');
  }
  function cookie(response: { headers: Record<string, unknown> }): string {
    return cookieHeader(response).split(';')[0];
  }
  function cookieHeader(response: {
    headers: Record<string, unknown>;
  }): string {
    const header: unknown = response.headers['set-cookie'];
    if (!Array.isArray(header) || typeof header[0] !== 'string')
      throw new Error('Missing guest cookie');
    return header[0];
  }
  function preview(id: string, session?: string) {
    const operation = request(server).get(`/product-image/guest/${id}/preview`);
    if (session) operation.set('Cookie', session);
    return operation;
  }

  beforeAll(async () => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    await mkdir('uploads', { recursive: true });
    root = await mkdtemp(join(resolve('uploads'), 'guest-test-'));
    Object.defineProperty(storage, 'root', { value: root });
    fixture = await sharp({
      create: { width: 1200, height: 900, channels: 3, background: '#2266aa' },
    })
      .png()
      .toBuffer();
    const module = await Test.createTestingModule({
      controllers: [GuestPreviewController],
      providers: [
        GuestPreviewService,
        GuestUploadGuard,
        GuestUploadLifecycle,
        ProductImageService,
        ProviderAdmissionService,
        ImageNormalizationService,
        { provide: GuestPreviewStorage, useValue: storage },
        { provide: getModelToken(GuestPreview.name), useValue: records },
        { provide: getModelToken(GuestRequestLimit.name), useValue: limits },
        {
          provide: getModelToken(ProviderAdmission.name),
          useValue: providerState,
        },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => settings[key] },
        },
        { provide: HttpService, useValue: { axiosRef: { post } } },
        { provide: ProductsService, useValue: products },
      ],
    }).compile();
    app = module.createNestApplication();
    // Mirrors the real policy: arbitrary internet forwarded headers are ignored.
    app.getHttpAdapter().getInstance().set('trust proxy', false);
    app.use(cookieParser());
    app.useLogger(false);
    await app.init();
    server = app.getHttpServer() as Server;
    service = app.get(GuestPreviewService);
  });

  beforeEach(async () => {
    for (const name of await readdir(root)) await storage.remove(name);
    rows.clear();
    rates.clear();
    for (const key of Object.keys(settings)) delete settings[key];
    Object.assign(settings, defaults);
    jest.clearAllMocks();
    post.mockReset().mockResolvedValue({ data: fixture });
    providerState.updateOne
      .mockReset()
      .mockImplementation(() => query(() => ({ modifiedCount: 1 })));
    providerState.findOneAndUpdate
      .mockReset()
      .mockImplementation(() => query(() => ({ calls: 1 })));
  });

  afterAll(async () => {
    await app?.close();
    warn?.mockRestore();
    const within = relative(resolve('uploads'), root);
    if (!within || within.startsWith('..'))
      throw new Error('Unsafe fixture cleanup');
    await rm(root, { recursive: true, force: true });
  });

  it('works without JWT/product and returns only opaque metadata plus a secure session cookie', async () => {
    const response = await upload().expect(201);
    expect(Object.keys(response.body).sort()).toEqual([
      'expiresAt',
      'previewId',
    ]);
    expect(response.body.previewId).toMatch(/^[a-f\d-]{36}$/);
    expect(
      new Date(response.body.expiresAt as string).getTime() - Date.now(),
    ).toBeGreaterThan(GUEST_TTL_MS - 5000);
    expect(cookieHeader(response)).toMatch(/HttpOnly/);
    expect(cookieHeader(response)).toMatch(/SameSite=Lax/);
    expect(cookie(response)).toMatch(/^beautyscan-guest=[a-f\d]{64}$/);
    expect(JSON.stringify(response.body)).not.toContain(root);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][2].headers['x-api-key']).toBe('sandbox_fixture');
    expect(products.requireOwnedProduct).not.toHaveBeenCalled();
    expect(products.updateProcessedImages).not.toHaveBeenCalled();
    expect([...rows.values()][0].state).toBe('ready');
    expect(
      [...rates.values()].find((row) => row._id.startsWith('active:'))?.leases,
    ).toHaveLength(0);
  });

  it('serves a session-owned high-quality preview without application watermark pixels', async () => {
    const response = await upload().expect(201);
    const media = await preview(
      response.body.previewId as string,
      cookie(response),
    ).expect(200);
    expect(media.headers['cache-control']).toBe('private, no-store');
    expect(media.headers['x-content-type-options']).toBe('nosniff');
    expect(media.headers.vary).toContain('Cookie');
    const bytes = media.body as Buffer;
    const info = await sharp(bytes).metadata();
    expect([info.width, info.height]).toEqual([1200, 900]);
    const raw = await sharp(bytes).raw().toBuffer();
    // The provider fixture is uniformly blue: overlays, text, or bands would
    // change pixels far beyond normal JPEG rounding.
    for (let i = 0; i < raw.length; i += 3) {
      if (
        Math.abs(raw[i] - 34) > 3 ||
        Math.abs(raw[i + 1] - 102) > 3 ||
        Math.abs(raw[i + 2] - 170) > 3
      )
        throw new Error(
          'Preview added unexpected pixels to the provider result',
        );
    }
    expect(info.isProgressive).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    expect(
      (
        await sharp(
          join(
            storage.directory(response.body.previewId as string),
            'final.png',
          ),
        ).metadata()
      ).width,
    ).toBe(1200);
  });

  it('preserves provider watermark pixels and full framing while retaining the private full-size result', async () => {
    const providerImage = await sharp({
      create: { width: 2400, height: 1800, channels: 3, background: '#2266aa' },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1800"><rect width="100" height="100" fill="red"/><rect x="2300" width="100" height="100" fill="lime"/><rect x="1800" y="1600" width="600" height="200" fill="white"/><text x="1840" y="1710" font-family="sans-serif" font-size="64" fill="black">SANDBOX</text></svg>',
          ),
        },
      ])
      .png()
      .toBuffer();
    post.mockResolvedValueOnce({ data: providerImage });
    const response = await upload().expect(201);
    const media = await preview(
      response.body.previewId as string,
      cookie(response),
    ).expect(200);
    const decoded = await sharp(media.body as Buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([decoded.info.width, decoded.info.height]).toEqual([1600, 1200]);
    const left = (20 * 1600 + 20) * 3;
    const right = (20 * 1600 + 1580) * 3;
    expect(decoded.data[left]).toBeGreaterThan(245);
    expect(decoded.data[left + 1]).toBeLessThan(10);
    expect(decoded.data[right]).toBeLessThan(10);
    expect(decoded.data[right + 1]).toBeGreaterThan(245);
    const mark = await sharp(media.body as Buffer)
      .extract({ left: 1200, top: 1067, width: 400, height: 133 })
      .raw()
      .toBuffer();
    let darkPixels = 0;
    for (let i = 0; i < mark.length; i += 3) {
      if (mark[i] < 80 && mark[i + 1] < 80 && mark[i + 2] < 80) darkPixels++;
    }
    expect(darkPixels).toBeGreaterThan(500);
    const finalPath = join(
      storage.directory(response.body.previewId as string),
      'final.png',
    );
    const full = await sharp(finalPath).metadata();
    expect([full.width, full.height]).toEqual([2400, 1800]);
    const privatePixels = await sharp(finalPath).raw().toBuffer();
    const providedPixels = await sharp(providerImage).raw().toBuffer();
    expect(privatePixels.equals(providedPixels)).toBe(true);
    await preview(response.body.previewId as string, cookie(response)).expect(
      200,
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('isolates sessions and denies missing, forged, expired, or non-ready access', async () => {
    const first = await upload().expect(201);
    const second = await upload().expect(201);
    const id = first.body.previewId as string;
    await preview(id).expect(404);
    await preview(id, cookie(second)).expect(404);
    await preview(id, `beautyscan-guest=${'a'.repeat(64)}`).expect(404);
    await preview(randomUUID(), cookie(first)).expect(404);
    const row = [...rows.values()].find((row) => row.previewId === id);
    if (!row) throw new Error('Missing test row');
    row.state = 'processing';
    await preview(id, cookie(first)).expect(404);
    row.state = 'ready';
    row.expiresAt = new Date(Date.now() - 1);
    await preview(id, cookie(first)).expect(404);
    expect(await stat(storage.directory(id))).toBeDefined();
  });

  it('does not expose private originals, finals, or paths', async () => {
    const response = await upload().expect(201);
    const id = response.body.previewId as string;
    for (const path of [
      `/uploads/guest-private/${id}/final.png`,
      `/product-image/guest/${id}/original`,
      `/product-image/guest/${id}/final`,
      `/product-image/guest/${id}/preview/final.png`,
    ]) {
      await request(server)
        .get(path)
        .set('Cookie', cookie(response))
        .expect(404);
    }
  });

  it('allows only one attempt for a guest cookie, including simultaneous requests', async () => {
    const response = await upload().expect(201);
    const results = await Promise.all([
      upload(cookie(response)),
      upload(cookie(response)),
    ]);
    expect(results.map((result) => result.status)).toEqual([429, 429]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('limits new sessions per real client IP and ignores spoofed forwarded headers', async () => {
    settings.PHOTOROOM_GUEST_IP_HOURLY_LIMIT = '1';
    await upload().expect(201);
    const response = await upload()
      .set('X-Forwarded-For', '198.51.100.22')
      .expect(429);
    expect(response.body.code).toBe('GUEST_RATE_LIMIT');
    expect(post).toHaveBeenCalledTimes(1);
    expect(rows.size).toBe(1);
  });

  it('allows correcting invalid input but atomically admits only one simultaneous valid enhancement', async () => {
    const invalid = await upload(undefined, Buffer.from('invalid')).expect(400);
    expect([...rows.values()][0].state).toBe('new');
    const results = await Promise.all([
      upload(cookie(invalid)),
      upload(cookie(invalid)),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 429]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(rows.size).toBe(1);
  });

  it('bounds active requests before files are written and releases the slot afterward', async () => {
    settings.PHOTOROOM_GUEST_MAX_ACTIVE = '1';
    let complete: (value: { data: Buffer }) => void = () => undefined;
    let started: () => void = () => undefined;
    const inProvider = new Promise<void>((resolve) => {
      started = resolve;
    });
    post.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const first = upload().then((value) => value);
    await inProvider;
    const before = await readdir(root);
    const denied = await upload().expect(429);
    expect(denied.body.code).toBe('GUEST_BUSY');
    expect(await readdir(root)).toEqual(before);
    complete({ data: fixture });
    expect((await first).status).toBe(201);
    await upload().expect(201);
  });

  it('does not mark a corrected concurrent upload failed after resetting a validation error', async () => {
    const initial = await upload(undefined, Buffer.from('invalid')).expect(400);
    let corrected: Promise<{ status: number }> | undefined;
    let complete: (value: { data: Buffer }) => void = () => undefined;
    let started: () => void = () => undefined;
    const inProvider = new Promise<void>((resolve) => {
      started = resolve;
    });
    post.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const originalUpdate = records.updateOne.getMockImplementation();
    if (!originalUpdate) throw new Error('Missing fixture implementation');
    records.updateOne.mockImplementationOnce((filter, update) => {
      const pending = originalUpdate(filter, update);
      return {
        ...pending,
        exec: async () => {
          const result = await pending.exec();
          corrected = upload(cookie(initial)).then((response) => ({
            status: response.status,
          }));
          await inProvider;
          return result;
        },
      };
    });
    await upload(cookie(initial), Buffer.from('still invalid')).expect(400);
    complete({ data: fixture });
    if (!corrected) throw new Error('Corrected upload was not started');
    expect((await corrected).status).toBe(201);
    expect([...rows.values()][0].state).toBe('ready');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 'false'])(
    'disables processing by default (%s)',
    async (value) => {
      if (value === undefined) delete settings.PHOTOROOM_GUEST_ENABLED;
      else settings.PHOTOROOM_GUEST_ENABLED = value;
      await upload().expect(503);
      expect(post).not.toHaveBeenCalled();
      expect(records.create).not.toHaveBeenCalled();
      expect(await readdir(root)).toEqual([]);
    },
  );

  it.each([
    'PHOTOROOM_DAILY_CALL_LIMIT',
    'PHOTOROOM_MAX_CONCURRENT',
    'PHOTOROOM_GUEST_HASH_SECRET',
    'PHOTOROOM_GUEST_IP_HOURLY_LIMIT',
    'PHOTOROOM_GUEST_MAX_ACTIVE',
  ])('fails closed without %s', async (key) => {
    delete settings[key];
    await upload().expect(503);
    expect(post).not.toHaveBeenCalled();
    expect(records.create).not.toHaveBeenCalled();
  });

  it.each([
    'https://attacker.invalid',
    'null',
    'http://localhost:3001.attacker.invalid',
  ])(
    'rejects a forbidden mutation origin %s before allocating storage',
    async (origin) => {
      await upload(undefined, fixture, origin).expect(403);
      expect(limits.updateOne).not.toHaveBeenCalled();
      expect(await readdir(root)).toEqual([]);
    },
  );

  it('rejects missing Origin and malformed cookies', async () => {
    await request(server)
      .post('/product-image/guest/enhance')
      .attach('image', fixture, 'photo.png')
      .expect(403);
    await upload('beautyscan-guest=malformed').expect(401);
    expect(post).not.toHaveBeenCalled();
  });

  it('requires production credentials, HTTPS origin, and uses a Secure host-only cookie', async () => {
    settings.NODE_ENV = 'production';
    settings.FRONTEND_URL = 'https://demo.example';
    await upload(undefined, fixture, settings.FRONTEND_URL).expect(503);
    settings.PHOTOROOM_PRODUCTION_API_KEY = 'production-fixture';
    const response = await upload(
      undefined,
      fixture,
      settings.FRONTEND_URL,
    ).expect(201);
    const header = cookieHeader(response);
    expect(header).toMatch(/^__Host-beautyscan-guest=/);
    expect(header).toContain('Secure');
    expect(header).toContain('HttpOnly');
    expect(header).not.toContain('Domain=');
    expect(post.mock.calls[0][2].headers['x-api-key']).toBe(
      'production-fixture',
    );
  });

  it('rejects corrupt and oversized uploads without provider calls and removes private files', async () => {
    await upload(undefined, Buffer.from('not an image')).expect(400);
    await upload(undefined, Buffer.alloc(MAX_UPLOAD_BYTES + 1)).expect(413);
    expect(post).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
    expect([...rows.values()].every((row) => row.state === 'new')).toBe(true);
  });

  it('rejects extra fields, multiple files, and missing images with cleanup', async () => {
    await upload().field('productId', 'not-allowed').expect(400);
    await upload().attach('image', fixture, 'second.png').expect(400);
    await request(server)
      .post('/product-image/guest/enhance')
      .set('Origin', defaults.FRONTEND_URL)
      .expect(400);
    expect(post).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it.each(['budget', 'database', 'provider'])(
    'handles %s failure without exposing clean media or leaving active slots',
    async (failure) => {
      if (failure === 'budget')
        providerState.findOneAndUpdate.mockImplementation(() =>
          query(() => null),
        );
      if (failure === 'database')
        providerState.updateOne.mockImplementation(() => ({
          exec: async () => {
            throw new Error('private database details');
          },
        }));
      if (failure === 'provider')
        post.mockRejectedValue({
          isAxiosError: true,
          response: { status: 503, data: 'private' },
        });
      const response = await upload().expect(
        failure === 'provider' ? 502 : 503,
      );
      expect(response.body.code).toBe(
        failure === 'budget'
          ? 'DEMO_LIMIT_REACHED'
          : failure === 'database'
            ? 'PROVIDER_ADMISSION_UNAVAILABLE'
            : 'PHOTOROOM_UNAVAILABLE',
      );
      expect(JSON.stringify(response.body)).not.toContain('private');
      if (failure !== 'provider') expect(post).not.toHaveBeenCalled();
      expect(await readdir(root)).toEqual([]);
      expect(
        [...rates.values()].find((row) => row._id.startsWith('active:'))
          ?.leases,
      ).toHaveLength(0);
      expect([...rows.values()][0].state).toBe('failed');
    },
  );

  it('fails closed when guest-limit storage is unavailable', async () => {
    const original = limits.updateOne.getMockImplementation();
    limits.updateOne.mockImplementationOnce(() => {
      throw new Error('private failure');
    });
    await upload().expect(503);
    expect(post).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
    if (original) limits.updateOne.mockImplementation(original);
  });

  it('deletes expired files before records, preserves live data, and removes abandoned uploads', async () => {
    const response = await upload().expect(201);
    const expired = [...rows.values()][0];
    expired.expiresAt = new Date(Date.now() - 1);
    const live = await upload().expect(201);
    const orphan = randomUUID();
    const orphanDirectory = await storage.prepare(orphan);
    await writeFile(join(orphanDirectory, 'abandoned.upload'), 'partial input');
    const old = new Date(Date.now() - GUEST_TTL_MS - 1000);
    await utimes(orphanDirectory, old, old);
    const originalDelete = records.deleteOne.getMockImplementation();
    records.deleteOne.mockImplementationOnce((filter) => {
      expect(rows.has(expired._id)).toBe(true);
      return query(() => {
        rows.delete(filter._id ?? '');
        return { deletedCount: 1 };
      });
    });
    await service.cleanup();
    await expect(
      stat(storage.directory(response.body.previewId as string)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(orphanDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(rows.has(expired._id)).toBe(false);
    await preview(live.body.previewId as string, cookie(live)).expect(200);
    if (originalDelete) records.deleteOne.mockImplementation(originalDelete);
  });

  it('retains expired records when file deletion fails so cleanup can retry', async () => {
    await upload().expect(201);
    const row = [...rows.values()][0];
    row.expiresAt = new Date(Date.now() - 1);
    const remove = jest
      .spyOn(storage, 'remove')
      .mockRejectedValueOnce(new Error('locked'));
    await service.cleanup();
    expect(rows.has(row._id)).toBe(true);
    expect(records.deleteOne).not.toHaveBeenCalled();
    remove.mockRestore();
    await service.cleanup();
    expect(rows.has(row._id)).toBe(false);
  });

  it('continues cleanup past a locked record', async () => {
    await upload().expect(201);
    await upload().expect(201);
    const [locked, removable] = [...rows.values()];
    locked.expiresAt = new Date(Date.now() - 1);
    removable.expiresAt = new Date(Date.now() - 1);
    const remove = jest
      .spyOn(storage, 'remove')
      .mockRejectedValueOnce(new Error('locked fixture'));
    await service.cleanup();
    expect(rows.has(locked._id)).toBe(true);
    expect(rows.has(removable._id)).toBe(false);
    remove.mockRestore();
  });

  it('cleans expired assets at startup and schedules the same cleanup periodically', async () => {
    await upload().expect(201);
    const row = [...rows.values()][0];
    row.expiresAt = new Date(Date.now() - 1);
    service.onModuleDestroy();
    const interval = jest.spyOn(global, 'setInterval');
    await service.onModuleInit();
    expect(rows.has(row._id)).toBe(false);
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 60_000);
    const cleanup = jest.spyOn(service, 'cleanup').mockResolvedValue(undefined);
    const scheduled = interval.mock.calls[0][0];
    if (typeof scheduled !== 'function')
      throw new Error('Missing cleanup task');
    scheduled();
    expect(cleanup).toHaveBeenCalledTimes(1);
    cleanup.mockRestore();
    interval.mockRestore();
  });

  it('refuses storage traversal without touching files', () => {
    expect(() => storage.directory('../final.png')).toThrow();
    expect(() => storage.directory('original')).toThrow();
  });

  it.each([
    [900, 1200, 900, 1200],
    [2400, 1800, 1600, 1200],
    [1800, 2400, 1200, 1600],
    [120, 80, 120, 80],
    [2, 2, 2, 2],
  ])(
    'preserves framing without upscaling for %s x %s inputs',
    async (width, height, expectedWidth, expectedHeight) => {
      const id = randomUUID();
      await storage.prepare(id);
      const bytes = await sharp({
        create: { width, height, channels: 3, background: 'blue' },
      })
        .png()
        .toBuffer();
      await storage.render(id, bytes);
      const image = await sharp(await storage.preview(id)).metadata();
      expect([image.width, image.height]).toEqual([
        expectedWidth,
        expectedHeight,
      ]);
    },
  );
});
