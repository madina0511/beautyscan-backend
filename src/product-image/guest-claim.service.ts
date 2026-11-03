import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import { GuestPreview } from './guest-preview.schema';
import { GuestPreviewService } from './guest-preview.service';
import { GuestPreviewStorage, GUEST_ID } from './guest-preview.storage';
import { ProductsService } from '../products/products.service';

const CLAIM_LEASE_MS = 60_000;
function unavailable(
  code = 'GUEST_CLAIM_UNAVAILABLE',
  status = 503,
): HttpException {
  return new HttpException(
    { code, message: 'The guest result could not be saved yet.' },
    status,
  );
}

export interface GuestClaimResult {
  productId: string;
  originalMediaUrl: string;
  processedMediaUrl: string;
}

@Injectable()
export class GuestClaimService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GuestClaimService.name);
  private timer?: ReturnType<typeof setInterval>;
  private recovering = false;

  constructor(
    @InjectModel(GuestPreview.name)
    private readonly records: Model<GuestPreview>,
    private readonly guests: GuestPreviewService,
    private readonly storage: GuestPreviewStorage,
    private readonly products: ProductsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.records.init();
    await this.recover();
    this.timer = setInterval(() => {
      void this.recover();
    }, 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private result(productId: string): GuestClaimResult {
    return {
      productId,
      originalMediaUrl: `/product-image/${productId}/media/original`,
      processedMediaUrl: `/product-image/${productId}/media/processed`,
    };
  }

  async claim(
    request: Request,
    previewId: string,
    memberId: string,
  ): Promise<GuestClaimResult> {
    const sessionHash = this.guests.claimSession(request);
    if (!GUEST_ID.test(previewId) || !/^[a-f0-9]{24}$/.test(memberId))
      throw new NotFoundException();
    try {
      const existing = await this.records
        .findOne({ _id: sessionHash, previewId })
        .lean()
        .exec();
      if (!existing || existing.expiresAt.getTime() <= Date.now())
        throw new NotFoundException();
      if (existing.claimOwnerId && existing.claimOwnerId !== memberId)
        throw new NotFoundException();
      if (existing.state === 'claimed' && existing.claimProductId) {
        await this.products.requireOwnedProduct(
          existing.claimProductId,
          memberId,
        );
        return this.result(existing.claimProductId);
      }
      let record: GuestPreview | null = null;
      const token = randomUUID();
      const lease = new Date(Date.now() + CLAIM_LEASE_MS);
      if (existing.state === 'ready' && !existing.claimOwnerId) {
        // This CAS permanently binds both account and product ID. A different
        // account can never take over, including after failures or lease expiry.
        record = await this.records
          .findOneAndUpdate(
            {
              _id: sessionHash,
              previewId,
              state: 'ready',
              claimOwnerId: { $exists: false },
              expiresAt: { $gt: new Date() },
              $expr: { $gt: ['$expiresAt', '$$NOW'] },
            },
            {
              $set: {
                state: 'claiming',
                claimOwnerId: memberId,
                claimProductId: new Types.ObjectId().toHexString(),
                claimToken: token,
                claimLeaseUntil: lease,
              },
            },
            { new: true },
          )
          .lean()
          .exec();
      } else if (
        existing.state === 'claiming' &&
        existing.claimOwnerId === memberId
      ) {
        record = await this.lock(existing);
      } else throw new NotFoundException();
      if (!record) throw unavailable('GUEST_CLAIM_IN_PROGRESS', 409);
      return await this.save(record);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      throw unavailable();
    }
  }

  private async lock(record: GuestPreview): Promise<GuestPreview | null> {
    return this.records
      .findOneAndUpdate(
        {
          _id: record._id,
          state: 'claiming',
          claimOwnerId: record.claimOwnerId,
          claimProductId: record.claimProductId,
          claimToken: record.claimToken,
          claimLeaseUntil: { $lte: new Date() },
        },
        {
          $set: {
            claimToken: randomUUID(),
            claimLeaseUntil: new Date(Date.now() + CLAIM_LEASE_MS),
          },
        },
        { new: true },
      )
      .lean()
      .exec();
  }

  private async save(record: GuestPreview): Promise<GuestClaimResult> {
    const { claimOwnerId, claimProductId, claimToken } = record;
    if (!claimOwnerId || !claimProductId || !claimToken) throw unavailable();
    try {
      // A previous DB write may have committed before the client saw an error.
      // Reconcile first; never replace its media or create a new ID on retry.
      const existing = await this.products.findClaimedProduct(
        claimProductId,
        claimOwnerId,
      );
      if (!existing) {
        const files = await this.storage.attachClaim(
          record.previewId,
          claimProductId,
        );
        await this.products.createClaimedProduct(
          claimProductId,
          claimOwnerId,
          files.originalImage,
          files.finalEditedImage,
        );
      }
      const marked = await this.records
        .updateOne(
          {
            _id: record._id,
            state: 'claiming',
            claimOwnerId,
            claimProductId,
            claimToken,
          },
          {
            $set: { state: 'claimed' },
            $unset: { claimToken: '', claimLeaseUntil: '' },
          },
        )
        .exec();
      if (marked.modifiedCount !== 1) {
        const current = await this.records
          .findOne({
            _id: record._id,
            state: 'claimed',
            claimOwnerId,
            claimProductId,
          })
          .lean()
          .exec();
        if (!current) throw unavailable('GUEST_CLAIM_IN_PROGRESS', 409);
      }
      // Only temporary guest copies are removed, after a durable owned product.
      // Published product media is never rolled back after an uncertain DB call.
      try {
        await this.storage.remove(record.previewId);
      } catch {
        this.logger.warn('Claimed guest temporary files await cleanup');
      }
      return this.result(claimProductId);
    } catch (error: unknown) {
      try {
        await this.records
          .updateOne(
            {
              _id: record._id,
              state: 'claiming',
              claimOwnerId,
              claimProductId,
              claimToken,
            },
            { $set: { claimLeaseUntil: new Date() } },
          )
          .exec();
      } catch {
        this.logger.warn('Claim recovery deferred until lease expiry');
      }
      if (error instanceof HttpException) throw error;
      throw unavailable();
    }
  }

  async recover(): Promise<void> {
    if (this.recovering) return;
    this.recovering = true;
    try {
      // Claim acceptance occurred before expiry with valid JWT+cookie. Accepted
      // jobs may finish afterward; expired cookies cannot initiate new claims.
      const pending = await this.records
        .find({
          state: 'claiming',
          claimLeaseUntil: { $lte: new Date() },
        })
        .sort({ claimLeaseUntil: 1 })
        .limit(20)
        .lean()
        .exec();
      for (const record of pending) {
        try {
          const locked = await this.lock(record);
          if (locked) await this.save(locked);
        } catch {
          this.logger.warn('Pending guest claim will be retried');
        }
      }
      await this.storage.cleanupClaimTemps();
    } catch {
      this.logger.warn('Guest claim recovery deferred');
    } finally {
      this.recovering = false;
    }
  }
}
