import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Request, Response } from 'express';
import { createHash, createHmac, randomBytes, randomUUID } from 'crypto';
import { mkdir, readdir, rename, stat } from 'fs/promises';
import { join } from 'path';
import { GuestPreview, GuestRequestLimit } from './guest-preview.schema';
import {
  GUEST_ID,
  GUEST_TTL_MS,
  GuestPreviewStorage,
} from './guest-preview.storage';
import { ProviderAdmissionService } from './provider-admission.service';
import { ImageNormalizationService } from './image-normalization.service';
import { ProductImageService } from './product-image.service';
import { cleanupUpload } from './upload-cleanup.util';

export interface GuestContext {
  sessionHash: string;
  previewId: string;
  leaseId: string;
  mode: string;
  directory: string;
  expiresAt: Date;
  uploadTimer?: ReturnType<typeof setTimeout>;
  providerAttempt?: boolean;
  finishing?: Promise<void>;
}

export const guestContexts: WeakMap<Request, GuestContext> = new WeakMap();

function deny(code: string, status = 503): HttpException {
  return new HttpException(
    { code, message: 'Guest preview is unavailable.' },
    status,
  );
}

@Injectable()
export class GuestPreviewService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GuestPreviewService.name);
  private timer?: ReturnType<typeof setInterval>;
  private cleaning = false;

  constructor(
    @InjectModel(GuestPreview.name)
    private readonly records: Model<GuestPreview>,
    @InjectModel(GuestRequestLimit.name)
    private readonly limits: Model<GuestRequestLimit>,
    private readonly config: ConfigService,
    private readonly admission: ProviderAdmissionService,
    private readonly normalization: ImageNormalizationService,
    private readonly images: ProductImageService,
    private readonly storage: GuestPreviewStorage,
  ) {}

  async onModuleInit(): Promise<void> {
    // Unique indexes must exist before admitting simultaneous first requests.
    await Promise.all([this.records.init(), this.limits.init()]);
    await mkdir(this.storage.root, { recursive: true, mode: 0o700 });
    await this.cleanup();
    this.timer = setInterval(() => {
      void this.cleanup();
    }, 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private integer(key: string, max: number): number {
    const value = this.config.get<string>(key);
    if (!value || !/^[1-9]\d*$/.test(value) || Number(value) > max)
      throw deny('PHOTOROOM_CONFIGURATION');
    return Number(value);
  }

  settings() {
    this.admission.assertConfigured(true);
    const production = this.config.get<string>('NODE_ENV') === 'production';
    const secret = this.config.get<string>('PHOTOROOM_GUEST_HASH_SECRET');
    const frontend =
      this.config.get<string>('FRONTEND_URL') ??
      (production ? '' : 'http://localhost:3001');
    let origin: string;
    try {
      const url = new URL(frontend);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        (production && url.protocol !== 'https:')
      )
        throw new Error();
      origin = url.origin;
    } catch {
      throw deny('PHOTOROOM_CONFIGURATION');
    }
    const sameSite =
      this.config.get<string>('PHOTOROOM_GUEST_COOKIE_SAMESITE') ?? 'lax';
    if (
      !secret ||
      Buffer.byteLength(secret) < 32 ||
      !['lax', 'none'].includes(sameSite) ||
      (sameSite === 'none' && !production)
    )
      throw deny('PHOTOROOM_CONFIGURATION');
    return {
      production,
      secret,
      origin,
      sameSite: sameSite as 'lax' | 'none',
      mode: production ? 'production' : 'sandbox',
      cookie: production ? '__Host-beautyscan-guest' : 'beautyscan-guest',
      hourly: this.integer('PHOTOROOM_GUEST_IP_HOURLY_LIMIT', 10),
      active: this.integer('PHOTOROOM_GUEST_MAX_ACTIVE', 4),
    };
  }

  private session(request: Request, cookie: string): string | undefined {
    const cookies: unknown = request.cookies;
    const value =
      typeof cookies === 'object' && cookies !== null
        ? (cookies as Record<string, unknown>)[cookie]
        : undefined;
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
      throw deny('GUEST_SESSION_INVALID', 401);
    return value;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  claimSession(request: Request): string {
    // Claiming uses no provider admission/configuration and remains possible
    // when new enhancements are disabled or the provider budget is exhausted.
    const production = this.config.get<string>('NODE_ENV') === 'production';
    const frontend =
      this.config.get<string>('FRONTEND_URL') ??
      (production ? '' : 'http://localhost:3001');
    let origin: string;
    try {
      const url = new URL(frontend);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        (production && url.protocol !== 'https:')
      )
        throw new Error();
      origin = url.origin;
    } catch {
      throw deny('PHOTOROOM_CONFIGURATION');
    }
    if (request.headers.origin !== origin)
      throw deny('GUEST_ORIGIN_DENIED', 403);
    const token = this.session(
      request,
      production ? '__Host-beautyscan-guest' : 'beautyscan-guest',
    );
    if (!token) throw new NotFoundException();
    return this.hash(token);
  }

  private async initializeLimit(id: string, expiresAt?: Date): Promise<void> {
    try {
      await this.limits
        .updateOne(
          { _id: id },
          {
            $setOnInsert: {
              hits: 0,
              leases: [],
              ...(expiresAt ? { expiresAt } : {}),
            },
          },
          { upsert: true },
        )
        .exec();
    } catch (error: unknown) {
      if (!(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      ))
        throw error;
    }
  }

  async begin(request: Request, response: Response): Promise<GuestContext> {
    const settings = this.settings();
    // CORS alone does not prevent CSRF: require an exact allowed Origin here.
    if (request.headers.origin !== settings.origin)
      throw deny('GUEST_ORIGIN_DENIED', 403);
    // Express computes req.ip using the narrowly configured trust proxy policy.
    // Never read X-Forwarded-For directly or accept a client-supplied IP field.
    if (!request.ip) throw deny('GUEST_SESSION_INVALID', 400);
    let token = this.session(request, settings.cookie);
    const leaseId = randomUUID();
    const activeId = `active:${settings.mode}`;
    let leased = false;
    let context: GuestContext | undefined;
    try {
      await this.initializeLimit(activeId);
      const live = {
        $filter: {
          input: '$leases',
          as: 'lease',
          cond: { $gt: ['$$lease.expiresAt', '$$NOW'] },
        },
      };
      const lease = await this.limits
        .findOneAndUpdate(
          { _id: activeId, $expr: { $lt: [{ $size: live }, settings.active] } },
          [
            {
              $set: {
                leases: {
                  $concatArrays: [
                    live,
                    [{ id: leaseId, expiresAt: { $add: ['$$NOW', 240_000] } }],
                  ],
                },
              },
            },
          ],
          { new: true },
        )
        .exec();
      if (!lease) throw deny('GUEST_BUSY', 429);
      leased = true;
      const now = Date.now();
      const ipHash = createHmac('sha256', settings.secret)
        .update(request.ip.replace(/^::ffff:/, ''))
        .digest('hex');
      const ipId = `ip:${settings.mode}:${Math.floor(now / GUEST_TTL_MS)}:${ipHash}`;
      await this.initializeLimit(ipId, new Date(now + 2 * GUEST_TTL_MS));
      if (
        !(await this.limits
          .findOneAndUpdate(
            { _id: ipId, hits: { $lt: settings.hourly } },
            { $inc: { hits: 1 } },
            { new: true },
          )
          .exec())
      )
        throw deny('GUEST_RATE_LIMIT', 429);
      if (!token) {
        token = randomBytes(32).toString('hex');
        await this.records.create({
          _id: this.hash(token),
          previewId: randomUUID(),
          state: 'new',
          expiresAt: new Date(now + GUEST_TTL_MS),
        });
        response.cookie(settings.cookie, token, {
          httpOnly: true,
          secure: settings.production,
          sameSite: settings.sameSite,
          path: '/',
          maxAge: GUEST_TTL_MS,
        });
      }
      const sessionHash = this.hash(token);
      // Lock the session before disk writes. Validation errors can safely reset
      // it; a provider attempt transitions to processing and is never retried.
      const record = await this.records
        .findOneAndUpdate(
          { _id: sessionHash, state: 'new', expiresAt: { $gt: new Date() } },
          { $set: { state: 'uploading' } },
          { new: true },
        )
        .lean()
        .exec();
      if (!record) throw deny('GUEST_SESSION_USED', 429);
      context = {
        sessionHash,
        previewId: record.previewId,
        expiresAt: record.expiresAt,
        leaseId,
        mode: settings.mode,
        directory: this.storage.directory(record.previewId),
      };
      await this.storage.prepare(record.previewId);
      // Bound body-upload time as well as provider work. Abort releases via the
      // lifecycle interceptor or this callback; expired leases cover hard crashes.
      context.uploadTimer = setTimeout(() => request.destroy(), 60_000);
      context.uploadTimer.unref();
      const current = context;
      request.once('end', () => clearTimeout(current.uploadTimer));
      request.once('aborted', () => {
        void this.finish(current, true);
      });
      guestContexts.set(request, context);
      return context;
    } catch (error: unknown) {
      if (context) await this.finish(context, true);
      else if (leased) await this.release(settings.mode, leaseId);
      if (error instanceof HttpException) throw error;
      throw deny('PROVIDER_ADMISSION_UNAVAILABLE');
    }
  }

  private async release(mode: string, leaseId: string): Promise<void> {
    try {
      await this.limits
        .updateOne(
          { _id: `active:${mode}` },
          { $pull: { leases: { id: leaseId } } },
        )
        .exec();
    } catch {
      this.logger.warn('Guest request lease release deferred to expiry');
    }
  }

  finish(context: GuestContext, failed: boolean): Promise<void> {
    if (context.finishing) return context.finishing;
    context.finishing = (async () => {
      clearTimeout(context.uploadTimer);
      try {
        if (failed) {
          await this.storage.remove(context.previewId);
          await this.records
            .updateOne(
              {
                _id: context.sessionHash,
                state: context.providerAttempt ? 'processing' : 'uploading',
              },
              { $set: { state: context.providerAttempt ? 'failed' : 'new' } },
            )
            .exec();
        }
      } catch {
        this.logger.warn('Guest private cleanup deferred to periodic sweep');
      } finally {
        await this.release(context.mode, context.leaseId);
      }
    })();
    return context.finishing;
  }

  async enhance(
    context: GuestContext,
    uploadPath: string,
  ): Promise<{ previewId: string; expiresAt: string }> {
    let normalizedPath: string | undefined;
    try {
      if (context.expiresAt.getTime() <= Date.now() || context.finishing)
        throw new NotFoundException();
      const normalized = await this.normalization.normalize(
        uploadPath,
        'product',
        context.directory,
      );
      normalizedPath = normalized.path;
      const original = join(
        context.directory,
        normalized.format === 'jpeg' ? 'original.jpg' : 'original.png',
      );
      await rename(normalized.path, original);
      normalizedPath = undefined;
      // Choose a single failure transition: resetting validation and then
      // separately marking processing failed could race a corrected upload.
      context.providerAttempt = true;
      const started = await this.records
        .updateOne(
          {
            _id: context.sessionHash,
            state: 'uploading',
            expiresAt: { $gt: new Date() },
          },
          { $set: { state: 'processing' } },
        )
        .exec();
      if (started.modifiedCount !== 1 || context.finishing)
        throw new NotFoundException();
      const bytes = await this.images.createFinalEditedImage(original, true);
      await this.storage.render(context.previewId, bytes);
      const saved = await this.records
        .updateOne(
          {
            _id: context.sessionHash,
            state: 'processing',
            expiresAt: { $gt: new Date() },
          },
          { $set: { state: 'ready' } },
        )
        .exec();
      if (saved.modifiedCount !== 1) throw new NotFoundException();
      return {
        previewId: context.previewId,
        expiresAt: context.expiresAt.toISOString(),
      };
    } finally {
      await cleanupUpload(uploadPath);
      if (normalizedPath) await cleanupUpload(normalizedPath);
    }
  }

  async preview(request: Request, id: string): Promise<string> {
    const settings = this.settings();
    const token = this.session(request, settings.cookie);
    if (!token || !GUEST_ID.test(id)) throw new NotFoundException();
    const record = await this.records
      .findOne({
        _id: this.hash(token),
        previewId: id,
        state: 'ready',
        expiresAt: { $gt: new Date() },
      })
      .lean()
      .exec();
    if (!record) throw new NotFoundException();
    try {
      return await this.storage.preview(id);
    } catch {
      throw new NotFoundException();
    }
  }

  async cleanup(now = new Date()): Promise<void> {
    if (this.cleaning) return;
    this.cleaning = true;
    try {
      const disposable = [
        'new',
        'uploading',
        'processing',
        'ready',
        'failed',
        'claimed',
        'deleting',
      ];
      const expired = await this.records
        .find({ expiresAt: { $lte: now }, state: { $in: disposable } })
        .limit(100)
        .lean()
        .exec();
      for (const record of expired) {
        try {
          // Fence cleanup against a claim that won after the expired-record
          // scan. Never delete assets belonging to an accepted pending claim.
          const deleting = await this.records
            .findOneAndUpdate(
              {
                _id: record._id,
                expiresAt: { $lte: now },
                state: {
                  $in: disposable,
                },
              },
              { $set: { state: 'deleting' } },
              { new: true },
            )
            .lean()
            .exec();
          if (!deleting) continue;
          await this.storage.remove(deleting.previewId);
          await this.records
            .deleteOne({
              _id: record._id,
              state: 'deleting',
              expiresAt: { $lte: now },
            })
            .exec();
        } catch {
          this.logger.warn('Expired guest cleanup deferred; continuing sweep');
        }
      }
      for (const entry of await readdir(this.storage.root, {
        withFileTypes: true,
      })) {
        if (
          !entry.isDirectory() ||
          entry.isSymbolicLink() ||
          !GUEST_ID.test(entry.name)
        )
          continue;
        if (
          (await stat(this.storage.directory(entry.name))).mtimeMs >
          now.getTime() - GUEST_TTL_MS
        )
          continue;
        // Covers abandoned raw uploads, normalized images, and crash leftovers.
        if (
          !(await this.records.findOne({ previewId: entry.name }).lean().exec())
        )
          await this.storage.remove(entry.name);
      }
    } catch {
      this.logger.warn(
        'Guest cleanup incomplete; will retry on the next sweep',
      );
    } finally {
      this.cleaning = false;
    }
  }
}
