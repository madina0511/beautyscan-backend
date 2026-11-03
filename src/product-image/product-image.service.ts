import {
  ImageNormalizationService,
  NormalizedImage,
} from './image-normalization.service';
import { finished } from 'stream/promises';
import { randomUUID } from 'crypto';
import { cleanupUpload } from './upload-cleanup.util';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { ProcessImageInput } from './dto/process-image.input';
import { ProcessImageOutput } from './dto/process-image.output';
import { ProductsService } from '../products/products.service';
import { HttpService } from '@nestjs/axios';
import {
  ProviderAdmissionService,
  PROVIDER_TIMEOUT_MS,
} from './provider-admission.service';
import { MAX_NORMALIZED_BYTES } from './image-upload.config';
import FormData from 'form-data';
import * as path from 'path';
import * as fs from 'fs';
import { isAxiosError } from 'axios';

export const MAX_PROVIDER_RESPONSE_BYTES = 20_000_000;

@Injectable()
export class ProductImageService {
  constructor(
    private readonly productsService: ProductsService,
    private readonly httpService: HttpService,
    private readonly admission: ProviderAdmissionService,
    private readonly normalization: ImageNormalizationService,
  ) {}

  async getSavedImage(
    productId: string,
    memberId: string,
    kind: string,
  ): Promise<{ path: string; type: string; size: number }> {
    if (kind !== 'original' && kind !== 'processed') {
      throw new BadRequestException('Image kind must be original or processed');
    }
    const product = await this.productsService.requireOwnedProduct(
      productId,
      memberId,
    );
    const reference =
      kind === 'original' ? product.originalImage : product.finalEditedImage;
    if (!reference) throw new NotFoundException('Saved image is not available');
    try {
      const directory = await fs.promises.realpath(
        path.join(
          'uploads',
          'products',
          kind === 'original' ? 'original' : 'final',
        ),
      );
      const file = await fs.promises.realpath(path.resolve(reference));
      const relative = path.relative(directory, file);
      if (
        !relative ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        throw new NotFoundException('Saved image is not available');
      }
      const extension = path.extname(file).toLowerCase();
      if (!['.png', '.jpg', '.jpeg'].includes(extension))
        throw new NotFoundException('Saved image is not available');
      const stat = await fs.promises.stat(file);
      if (!stat.isFile())
        throw new NotFoundException('Saved image is not available');
      return {
        path: file,
        type: extension === '.png' ? 'image/png' : 'image/jpeg',
        size: stat.size,
      };
    } catch {
      throw new NotFoundException('Saved image is not available');
    }
  }

  async removeBackground(
    input: ProcessImageInput,
    memberId: string,
  ): Promise<ProcessImageOutput> {
    const { productId, image } = input;

    await this.productsService.updateOriginalImage(productId, memberId, image);

    return {
      image,
      message: 'Image received and saved to product successfully',
    };
  }

  async createFinalEditedImage(
    imagePath: string,
    guest = false,
  ): Promise<Buffer> {
    const reservation = await this.admission.reserve(guest);
    let imageStream: fs.ReadStream | undefined;
    const controller = new AbortController();
    // An absolute deadline complements Axios's socket/inactivity timeout.
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const form = new FormData();
      imageStream = fs.createReadStream(imagePath);
      form.append('imageFile', imageStream);
      form.append('removeBackground', 'true');
      form.append(
        'background.prompt',
        'elegant minimal luxury skincare product photography, warm ivory and soft beige studio background, clean cosmetic advertising style, subtle pedestal, soft natural lighting, premium beauty brand aesthetic',
      );
      form.append('padding', '0.15');
      form.append('shadow.mode', 'ai.soft');
      const response = await this.httpService.axiosRef.post(
        'https://image-api.photoroom.com/v2/edit',
        form,
        {
          headers: {
            ...form.getHeaders(),
            'x-api-key': reservation.apiKey,
            'pr-ai-background-model-version':
              'background-studio-beta-2025-03-17',
          },
          responseType: 'arraybuffer',
          timeout: PROVIDER_TIMEOUT_MS,
          signal: controller.signal,
          maxContentLength: MAX_PROVIDER_RESPONSE_BYTES,
          maxBodyLength: MAX_NORMALIZED_BYTES + 65_536,
          // Do not forward credentials or repeat paid POSTs through redirects.
          maxRedirects: 0,
        },
      );

      if (
        !Buffer.isBuffer(response.data) ||
        !response.data.length ||
        response.data.length > MAX_PROVIDER_RESPONSE_BYTES
      ) {
        throw new HttpException(
          {
            code: 'PHOTOROOM_UNAVAILABLE',
            message: 'Invalid image service response.',
          },
          502,
        );
      }
      return Buffer.from(response.data);
    } catch (error: unknown) {
      if (!isAxiosError(error)) throw error;
      const providerStatus = error.response?.status;
      const configuration =
        providerStatus !== undefined &&
        [401, 402, 403].includes(providerStatus);
      throw new HttpException(
        {
          code: configuration
            ? 'PHOTOROOM_CONFIGURATION'
            : providerStatus === 400 || providerStatus === 422
              ? 'PHOTOROOM_REJECTED'
              : 'PHOTOROOM_UNAVAILABLE',
          message: configuration
            ? 'Image service configuration requires attention.'
            : 'Image service request failed.',
          ...(providerStatus !== undefined ? { providerStatus } : {}),
        },
        configuration ? 503 : 502,
      );
    } finally {
      clearTimeout(timer);
      try {
        if (imageStream) {
          imageStream.destroy();
          await finished(imageStream).catch(() => undefined);
        }
      } finally {
        // Release only concurrency; attempted calls remain charged to the day.
        await this.admission.release(reservation.id);
      }
    }
  }

  async processUpload(
    productId: string,
    memberId: string,
    uploadPath: string,
    autoCreate = false,
  ): Promise<{ originalImage: string; finalEditedImage: string }> {
    if (!autoCreate)
      await this.productsService.requireOwnedProduct(productId, memberId);
    let normalized: NormalizedImage | undefined;
    let originalPath: string | undefined;
    let finalPath: string | undefined;
    let saved = false;
    try {
      normalized = await this.normalization.normalize(uploadPath, 'product');
      const imageBuffer = await this.createFinalEditedImage(normalized.path);
      const originalDir = path.join('uploads', 'products', 'original');
      const finalDir = path.join('uploads', 'products', 'final');
      await Promise.all([
        fs.promises.mkdir(originalDir, { recursive: true }),
        fs.promises.mkdir(finalDir, { recursive: true }),
      ]);
      originalPath = path.join(
        originalDir,
        `${randomUUID()}.${normalized.format === 'jpeg' ? 'jpg' : 'png'}`,
      );
      finalPath = path.join(finalDir, `${randomUUID()}.png`);
      await fs.promises.copyFile(normalized.path, originalPath);
      await fs.promises.writeFile(finalPath, imageBuffer);
      if (autoCreate) {
        await this.productsService.createClaimedProduct(
          productId,
          memberId,
          originalPath,
          finalPath,
        );
      } else {
        await this.productsService.updateProcessedImages(
          productId,
          memberId,
          originalPath,
          finalPath,
        );
      }
      saved = true;
      return { originalImage: originalPath, finalEditedImage: finalPath };
    } finally {
      if (normalized) await cleanupUpload(normalized.path);
      if (!saved) {
        if (originalPath) await cleanupUpload(originalPath);
        if (finalPath) await cleanupUpload(finalPath);
      }
    }
  }
}
