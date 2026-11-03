import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { ProviderAdmission } from './provider-admission.schema';
import { ProviderAdmissionService } from './provider-admission.service';

describe('Provider admission (mocked MongoDB, no provider calls)', () => {
  let settings: Record<string, string>;
  const update = jest.fn();
  const reserve = jest.fn();
  let service: ProviderAdmissionService;

  beforeEach(() => {
    jest.resetAllMocks();
    settings = {
      NODE_ENV: 'test',
      PHOTOROOM_API_KEY: 'fixture',
      PHOTOROOM_DAILY_CALL_LIMIT: '10',
      PHOTOROOM_MAX_CONCURRENT: '2',
      PHOTOROOM_GUEST_ENABLED: 'true',
    };
    update.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
    reserve.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ calls: 1 }),
    });
    service = new ProviderAdmissionService(
      {
        updateOne: update,
        findOneAndUpdate: reserve,
      } as unknown as Model<ProviderAdmission>,
      { get: (key: string) => settings[key] } as ConfigService,
    );
  });

  it('forces sandbox credentials outside production', async () => {
    expect((await service.reserve(true)).apiKey).toBe('sandbox_fixture');
    settings.PHOTOROOM_API_KEY = 'sandbox_fixture';
    expect((await service.reserve(false)).apiKey).toBe('sandbox_fixture');
  });

  it.each([
    'PHOTOROOM_API_KEY',
    'PHOTOROOM_DAILY_CALL_LIMIT',
    'PHOTOROOM_MAX_CONCURRENT',
  ])('fails closed without %s', async (key) => {
    delete settings[key];
    await expect(service.reserve(true)).rejects.toMatchObject({
      response: { code: 'PHOTOROOM_CONFIGURATION' },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', '1.5', 'NaN', '101', ' 10'])(
    'rejects unsafe daily limit %s',
    async (value) => {
      settings.PHOTOROOM_DAILY_CALL_LIMIT = value;
      await expect(service.reserve(true)).rejects.toMatchObject({
        status: 503,
      });
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('requires separate production credentials and explicit guest enablement', async () => {
    settings.NODE_ENV = 'production';
    delete settings.PHOTOROOM_GUEST_ENABLED;
    await expect(service.reserve(true)).rejects.toMatchObject({ status: 503 });
    settings.PHOTOROOM_PRODUCTION_API_KEY = 'production-fixture';
    await expect(service.reserve(true)).rejects.toMatchObject({ status: 503 });
    settings.PHOTOROOM_GUEST_ENABLED = 'true';
    expect((await service.reserve(true)).apiKey).toBe('production-fixture');
    expect(reserve.mock.calls[0][0]._id).toBe('production');
    settings.PHOTOROOM_PRODUCTION_API_KEY = 'sandbox_fixture';
    await expect(service.reserve(true)).rejects.toMatchObject({ status: 503 });
  });

  it('reserves the daily call and concurrent lease in one conditional database update', async () => {
    await service.reserve(true);
    const [filter, pipeline, options] = reserve.mock.calls[0];
    expect(filter.$expr.$and).toHaveLength(2);
    expect(filter.$expr.$and[0].$lt[1]).toBe(10);
    expect(filter.$expr.$and[1].$lt[1]).toBe(2);
    expect(pipeline[0].$set.calls.$add[1]).toBe(1);
    expect(pipeline[0].$set.leases.$concatArrays[0]).toEqual(
      filter.$expr.$and[1].$lt[0].$size,
    );
    expect(JSON.stringify(pipeline)).toContain('$$NOW');
    expect(options).toEqual({ new: true });
  });

  it('denies exhausted budgets or concurrency without a credential', async () => {
    reserve.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.reserve(true)).rejects.toMatchObject({
      response: { code: 'DEMO_LIMIT_REACHED' },
    });
  });

  it('fails closed when the shared database is unavailable', async () => {
    update.mockReturnValue({
      exec: jest.fn().mockRejectedValue(new Error('private database detail')),
    });
    await expect(service.reserve(true)).rejects.toMatchObject({
      response: { code: 'PROVIDER_ADMISSION_UNAVAILABLE' },
    });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('tolerates only a duplicate-key initialization race', async () => {
    update.mockReturnValue({
      exec: jest.fn().mockRejectedValue({ code: 11000 }),
    });
    await expect(service.reserve(true)).resolves.toHaveProperty('id');
  });

  it('releases only its lease without refunding the daily call', async () => {
    const reservation = await service.reserve(true);
    await service.release(reservation.id);
    expect(update.mock.calls[1]).toEqual([
      { 'leases.id': reservation.id },
      { $pull: { leases: { id: reservation.id } } },
    ]);
  });

  it('retains a conservative lease if release storage fails', async () => {
    update.mockReturnValue({
      exec: jest.fn().mockRejectedValue(new Error('offline')),
    });
    await expect(service.release('fixture')).resolves.toBeUndefined();
  });
});
