import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model } from 'mongoose';
import { ProviderAdmission } from './provider-admission.schema';

// The caller must abort provider work within this deadline and must not retry.
export const PROVIDER_TIMEOUT_MS = 90_000;
const LEASE_MS = 180_000;

function unavailable(code: string): HttpException {
  return new HttpException(
    { code, message: 'Image enhancement is temporarily unavailable.' },
    503,
  );
}

@Injectable()
export class ProviderAdmissionService {
  constructor(
    @InjectModel(ProviderAdmission.name)
    private readonly state: Model<ProviderAdmission>,
    private readonly config: ConfigService,
  ) {}

  private positiveInteger(key: string, maximum: number): number {
    const raw = this.config.get<string>(key);
    if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw))
      throw unavailable('PHOTOROOM_CONFIGURATION');
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value > maximum)
      throw unavailable('PHOTOROOM_CONFIGURATION');
    return value;
  }

  assertConfigured(guest: boolean): void {
    this.configuration(guest);
  }

  private configuration(guest: boolean) {
    const production = this.config.get<string>('NODE_ENV') === 'production';
    const mode = production ? 'production' : 'sandbox';
    const credential = this.config.get<string>(
      production ? 'PHOTOROOM_PRODUCTION_API_KEY' : 'PHOTOROOM_API_KEY',
    );
    if (
      !credential?.trim() ||
      (production && credential.startsWith('sandbox_')) ||
      (guest && this.config.get<string>('PHOTOROOM_GUEST_ENABLED') !== 'true')
    )
      throw unavailable('PHOTOROOM_CONFIGURATION');
    const daily = this.positiveInteger('PHOTOROOM_DAILY_CALL_LIMIT', 100);
    const concurrency = this.positiveInteger('PHOTOROOM_MAX_CONCURRENT', 4);
    return {
      mode,
      daily,
      concurrency,
      apiKey:
        production || credential.startsWith('sandbox_')
          ? credential
          : `sandbox_${credential}`,
    };
  }

  async reserve(guest: boolean): Promise<{ id: string; apiKey: string }> {
    const { mode, daily, concurrency, apiKey } = this.configuration(guest);
    const id = randomUUID();
    try {
      // One permanent document per mode: no TTL reset can replenish today's budget.
      try {
        await this.state
          .updateOne(
            { _id: mode },
            {
              $setOnInsert: { day: '', calls: 0, leases: [] },
            },
            { upsert: true },
          )
          .exec();
      } catch (error: unknown) {
        // Concurrent first-use upserts can race on the built-in unique _id index.
        if (!(
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 11000
        ))
          throw error;
      }
      // MongoDB's clock and a single conditional document update govern both
      // counters across processes. Old-day active leases still count at midnight.
      const day = {
        $dateToString: { date: '$$NOW', format: '%Y-%m-%d', timezone: 'UTC' },
      };
      const calls = { $cond: [{ $eq: ['$day', day] }, '$calls', 0] };
      const leases = {
        $filter: {
          input: '$leases',
          as: 'lease',
          cond: { $gt: ['$$lease.expiresAt', '$$NOW'] },
        },
      };
      const reserved = await this.state
        .findOneAndUpdate(
          {
            _id: mode,
            $expr: {
              $and: [
                { $lt: [calls, daily] },
                { $lt: [{ $size: leases }, concurrency] },
              ],
            },
          },
          [
            {
              $set: {
                day,
                calls: { $add: [calls, 1] },
                leases: {
                  $concatArrays: [
                    leases,
                    [{ id, expiresAt: { $add: ['$$NOW', LEASE_MS] } }],
                  ],
                },
              },
            },
          ],
          { new: true },
        )
        .exec();
      if (!reserved) throw unavailable('DEMO_LIMIT_REACHED');
      return { id, apiKey };
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      // Database outage must never fall back to an in-memory allowance.
      throw unavailable('PROVIDER_ADMISSION_UNAVAILABLE');
    }
  }

  async release(id: string): Promise<void> {
    // Never refund calls, including failures/timeouts with uncertain billing.
    // Release only after the provider request has completed or been aborted.
    try {
      await this.state
        .updateOne({ 'leases.id': id }, { $pull: { leases: { id } } })
        .exec();
    } catch {
      // The lease expires conservatively; callers must not retry paid work.
    }
  }
}
