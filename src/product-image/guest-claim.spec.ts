import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { JwtService } from '@nestjs/jwt';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Types } from 'mongoose';
import { Server } from 'http';
import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'fs/promises';
import { join, relative, resolve } from 'path';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import sharp from 'sharp';
import { GuestClaimController } from './guest-claim.controller';
import { GuestClaimService } from './guest-claim.service';
import { GuestPreviewService } from './guest-preview.service';
import { GuestPreviewStorage, GUEST_TTL_MS } from './guest-preview.storage';
import { GuestPreview, GuestRequestLimit } from './guest-preview.schema';
import { ProductImageController } from './product-image.controller';
import { ProductImageService } from './product-image.service';
import { ImageNormalizationService } from './image-normalization.service';
import { ProviderAdmissionService } from './provider-admission.service';
import { ProductsService } from '../products/products.service';
import { ProductsResolver } from '../products/products.resolver';
import { Product } from '../products/product.schema';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { MembersService } from '../members/members.service';
import { MemberStatus } from '../members/schemas/member.schema';

interface Query<T> {
  exec(): Promise<T>;
  lean(): Query<T>;
  limit(count: number): Query<T>;
  sort(order: unknown): Query<T>;
}
function query<T>(run: () => T | Promise<T>): Query<T> {
  return {
    exec: async () => await run(),
    lean() {
      return this;
    },
    limit() {
      return this;
    },
    sort() {
      return this;
    },
  };
}
type Filter = Record<string, unknown>;
type Update = {
  $set?: Partial<GuestPreview>;
  $unset?: Record<string, unknown>;
};
type SavedProduct = Product & { _id: string; createdAt: Date; updatedAt: Date };
function matches(record: object, filter: Filter): boolean {
  const data = record as Record<string, unknown>;
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$expr') {
      // This mock's server clock is read at execution time, like Mongo $$NOW.
      return (
        data.expiresAt instanceof Date && data.expiresAt.getTime() > Date.now()
      );
    }
    const value = data[key];
    if (
      typeof expected !== 'object' ||
      expected === null ||
      expected instanceof Date
    )
      return value === expected;
    const rule = expected as Record<string, unknown>;
    if ('$exists' in rule && (value !== undefined) !== rule.$exists)
      return false;
    if (
      '$in' in rule &&
      (!Array.isArray(rule.$in) || !rule.$in.includes(value))
    )
      return false;
    if (
      '$gt' in rule &&
      (!(value instanceof Date) ||
        !(rule.$gt instanceof Date) ||
        value <= rule.$gt)
    )
      return false;
    if (
      '$lte' in rule &&
      (!(value instanceof Date) ||
        !(rule.$lte instanceof Date) ||
        value > rule.$lte)
    )
      return false;
    return true;
  });
}
function barrier() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('Guest claim HTTP/recovery (real JWT, Sharp, files; mocked MongoDB)', () => {
  let app: INestApplication;
  let server: Server;
  let claims: GuestClaimService;
  let guests: GuestPreviewService;
  let products: ProductsService;
  let root: string;
  let fixture: Buffer;
  const owner = new Types.ObjectId();
  const other = new Types.ObjectId();
  const secret = randomBytes(32).toString('hex');
  const jwt = new JwtService({ secret });
  const origin = 'http://localhost:3001';
  const config: Record<string, string> = {};
  const rows = new Map<string, GuestPreview>();
  const saved = new Map<string, SavedProduct>();
  const ownedProductIds = new Set<string>();
  const storage = new GuestPreviewStorage();
  const restorers: (() => void)[] = [];
  const records = {
    init: jest.fn(async () => undefined),
    find: jest.fn((filter: Filter) =>
      query(() =>
        [...rows.values()]
          .filter((row) => matches(row, filter))
          .map((row) => ({ ...row })),
      ),
    ),
    findOne: jest.fn((filter: Filter) =>
      query(() => {
        const row = [...rows.values()].find((row) => matches(row, filter));
        return row ? { ...row } : null;
      }),
    ),
    findOneAndUpdate: jest.fn((filter: Filter, update: Update) =>
      query(() => {
        const row = [...rows.values()].find((row) => matches(row, filter));
        if (!row) return null;
        Object.assign(row, update.$set);
        for (const key of Object.keys(update.$unset ?? {}))
          delete (row as unknown as Record<string, unknown>)[key];
        if (row.claimProductId) ownedProductIds.add(row.claimProductId);
        return { ...row };
      }),
    ),
    updateOne: jest.fn((filter: Filter, update: Update) =>
      query(() => {
        const row = [...rows.values()].find((row) => matches(row, filter));
        if (!row) return { modifiedCount: 0 };
        Object.assign(row, update.$set);
        for (const key of Object.keys(update.$unset ?? {}))
          delete (row as unknown as Record<string, unknown>)[key];
        return { modifiedCount: 1 };
      }),
    ),
    deleteOne: jest.fn((filter: Filter) =>
      query(() => {
        const row = [...rows.values()].find((row) => matches(row, filter));
        return { deletedCount: row && rows.delete(row._id) ? 1 : 0 };
      }),
    ),
  };
  const model = {
    findOne: jest.fn((filter: Filter) =>
      query(
        () => [...saved.values()].find((row) => matches(row, filter)) ?? null,
      ),
    ),
    find: jest.fn((filter: Filter) =>
      query(() => [...saved.values()].filter((row) => matches(row, filter))),
    ),
    findOneAndUpdate: jest.fn(
      (
        filter: { _id: string; ownerId: string },
        update: { $setOnInsert: Product },
      ) =>
        query(() => {
          const existing = saved.get(filter._id);
          if (existing) {
            if (existing.ownerId !== filter.ownerId)
              throw new Error('Conflicting product owner');
            return existing;
          }
          const product: SavedProduct = {
            ...update.$setOnInsert,
            _id: filter._id,
            createdAt: new Date(),
            updatedAt: new Date(),
            descriptions: {},
          };
          saved.set(filter._id, product);
          return product;
        }),
    ),
  };
  const limits = { init: jest.fn(async () => undefined) };
  const provider = {
    reserve: jest.fn(),
    release: jest.fn(),
    assertConfigured: jest.fn(),
  };
  const post = jest.fn();

  function access(member = owner, expiresIn = '5m'): string {
    return jwt.sign({ sub: member.toHexString() }, { expiresIn });
  }
  async function seed(format: 'png' | 'jpg' = 'png') {
    const previewId = randomUUID();
    const token = randomBytes(32).toString('hex');
    const sessionHash = createHash('sha256').update(token).digest('hex');
    const directory = await storage.prepare(previewId);
    const original =
      format === 'jpg' ? await sharp(fixture).jpeg().toBuffer() : fixture;
    await writeFile(join(directory, `original.${format}`), original);
    await storage.render(previewId, fixture);
    rows.set(sessionHash, {
      _id: sessionHash,
      previewId,
      state: 'ready',
      expiresAt: new Date(Date.now() + GUEST_TTL_MS),
    });
    return {
      previewId,
      sessionHash,
      directory,
      cookie: `beautyscan-guest=${token}`,
      original,
    };
  }
  type Preview = Awaited<ReturnType<typeof seed>>;
  function claim(
    preview: Preview,
    token: string | null = access(),
    session: string | null = preview.cookie,
    requestOrigin: string | null = origin,
  ) {
    const result = request(server).post(
      `/product-image/guest/${preview.previewId}/claim`,
    );
    if (token !== null) result.set('Authorization', `Bearer ${token}`);
    if (session !== null) result.set('Cookie', session);
    if (requestOrigin !== null) result.set('Origin', requestOrigin);
    return result;
  }
  async function removeFixtures(): Promise<void> {
    for (const row of rows.values())
      if (row.claimProductId) ownedProductIds.add(row.claimProductId);
    for (const name of await readdir(root)) await storage.remove(name);
    for (const directory of [storage.originalRoot, storage.finalRoot]) {
      await mkdir(directory, { recursive: true });
      for (const entry of await readdir(directory)) {
        const match = /^guest-claim-([a-f0-9]{24})[.]/.exec(entry);
        if (match && ownedProductIds.has(match[1]))
          await unlink(join(directory, entry));
      }
    }
  }

  beforeAll(async () => {
    await mkdir('uploads', { recursive: true });
    root = await mkdtemp(join(resolve('uploads'), 'claim-test-'));
    Object.defineProperty(storage, 'root', { value: root });
    jest.spyOn(storage, 'cleanupClaimTemps').mockResolvedValue(undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fixture = await sharp({
      create: { width: 900, height: 1200, channels: 3, background: '#557799' },
    })
      .png()
      .toBuffer();
    const module = await Test.createTestingModule({
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          autoSchemaFile: true,
          context: ({ req, res }) => ({ req, res }),
        }),
      ],
      controllers: [GuestClaimController, ProductImageController],
      providers: [
        GuestClaimService,
        GuestPreviewService,
        ProductImageService,
        ProductsService,
        ProductsResolver,
        JwtStrategy,
        ImageNormalizationService,
        { provide: getModelToken(GuestPreview.name), useValue: records },
        { provide: getModelToken(GuestRequestLimit.name), useValue: limits },
        { provide: getModelToken(Product.name), useValue: model },
        { provide: GuestPreviewStorage, useValue: storage },
        { provide: ProviderAdmissionService, useValue: provider },
        { provide: HttpService, useValue: { axiosRef: { post } } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'JWT_ACCESS_SECRET' ? secret : config[key],
          },
        },
        {
          provide: MembersService,
          useValue: {
            findById: async (id: string) =>
              [owner.toHexString(), other.toHexString()].includes(id)
                ? { _id: new Types.ObjectId(id), status: MemberStatus.ACTIVE }
                : null,
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.useLogger(false);
    await app.init();
    server = app.getHttpServer() as Server;
    claims = app.get(GuestClaimService);
    guests = app.get(GuestPreviewService);
    products = app.get(ProductsService);
  });
  beforeEach(async () => {
    await removeFixtures();
    rows.clear();
    saved.clear();
    ownedProductIds.clear();
    for (const key of Object.keys(config)) delete config[key];
    config.NODE_ENV = 'test';
    config.FRONTEND_URL = origin;
    jest.clearAllMocks();
  });
  afterEach(() => {
    for (const restore of restorers.splice(0)) restore();
  });
  afterAll(async () => {
    await app?.close();
    await removeFixtures();
    jest.restoreAllMocks();
    const within = relative(resolve('uploads'), root);
    if (!within || within.startsWith('..'))
      throw new Error('Unsafe claim fixture cleanup');
    await rm(root, { recursive: true, force: true });
  });

  it.each(['png', 'jpg'] as const)(
    'saves an owned product with its original %s and full processed image, without provider calls',
    async (format) => {
      const preview = await seed(format);
      const response = await claim(preview)
        .send({
          ownerId: other.toHexString(),
          name: '<script>client name</script>',
        })
        .expect(200);
      expect(Object.keys(response.body).sort()).toEqual([
        'originalMediaUrl',
        'processedMediaUrl',
        'productId',
      ]);
      const product = saved.get(response.body.productId as string);
      expect(product?.ownerId).toBe(owner.toHexString());
      expect(product?.name).toMatch(/^Enhanced Product [A-F0-9]{6}$/);
      expect(rows.get(preview.sessionHash)?.state).toBe('claimed');
      await expect(stat(preview.directory)).rejects.toMatchObject({
        code: 'ENOENT',
      });
      const original = await request(server)
        .get(response.body.originalMediaUrl as string)
        .set('Authorization', `Bearer ${access()}`)
        .expect(200);
      expect((original.body as Buffer).equals(preview.original)).toBe(true);
      const processed = await request(server)
        .get(response.body.processedMediaUrl as string)
        .set('Authorization', `Bearer ${access()}`)
        .expect(200);
      expect((await sharp(processed.body as Buffer).metadata()).height).toBe(
        1200,
      );
      expect(processed.headers['cache-control']).toBe('private, no-store');
      const history = await request(server)
        .post('/graphql')
        .set('Authorization', `Bearer ${access()}`)
        .send({
          query: '{ myProducts { _id name originalImage finalEditedImage } }',
        })
        .expect(200);
      expect(history.body.errors).toBeUndefined();
      expect(
        history.body.data.myProducts.map((item: { _id: string }) => item._id),
      ).toEqual([response.body.productId]);
      const otherHistory = await request(server)
        .post('/graphql')
        .set('Authorization', `Bearer ${access(other)}`)
        .send({ query: '{ myProducts { _id } }' })
        .expect(200);
      expect(otherHistory.body.data.myProducts).toEqual([]);
      expect(post).not.toHaveBeenCalled();
      expect(provider.reserve).not.toHaveBeenCalled();
      expect(provider.assertConfigured).not.toHaveBeenCalled();
    },
  );

  it('requires JWT and rejects invalid or expired access tokens before changing state', async () => {
    const preview = await seed();
    for (const token of [null, 'invalid', access(owner, '-1s')])
      await claim(preview, token).expect(401);
    expect(rows.get(preview.sessionHash)?.state).toBe('ready');
    expect(saved.size).toBe(0);
  });

  it('requires the matching cookie and allowed Origin, independently of JWT', async () => {
    const preview = await seed();
    const wrong = await seed();
    await claim(preview, access(), null).expect(404);
    await claim(preview, access(), wrong.cookie).expect(404);
    await claim(preview, access(), 'beautyscan-guest=malformed').expect(401);
    await claim(preview, access(), preview.cookie, null).expect(403);
    await claim(
      preview,
      access(),
      preview.cookie,
      'https://attacker.invalid',
    ).expect(403);
    expect(saved.size).toBe(0);
  });

  it.each([
    'expired',
    'processing',
    'failed',
    'uploading',
    'deleting',
  ] as const)(
    'rejects %s previews without transferring files',
    async (state) => {
      const preview = await seed();
      const row = rows.get(preview.sessionHash);
      if (!row) throw new Error('Missing fixture');
      if (state === 'expired') row.expiresAt = new Date(Date.now() - 1);
      else row.state = state;
      const copy = jest.spyOn(storage, 'attachClaim');
      restorers.push(() => copy.mockRestore());
      await claim(preview).expect(404);
      expect(copy).not.toHaveBeenCalled();
      expect(saved.size).toBe(0);
    },
  );

  it('rejects expiry at atomic reservation time even if the earlier read was unexpired', async () => {
    const preview = await seed();
    const original = records.findOneAndUpdate.getMockImplementation();
    if (!original) throw new Error('Missing fixture');
    records.findOneAndUpdate.mockImplementationOnce((filter, update) =>
      query(async () => {
        const row = rows.get(preview.sessionHash);
        if (!row) throw new Error('Missing row');
        const clock = jest
          .spyOn(Date, 'now')
          .mockReturnValue(row.expiresAt.getTime() + 1);
        try {
          return await original(filter, update).exec();
        } finally {
          clock.mockRestore();
        }
      }),
    );
    await claim(preview).expect(409);
    expect(saved.size).toBe(0);
    expect(rows.get(preview.sessionHash)?.state).toBe('ready');
  });

  it('returns the same product for a same-account retry and denies account switching and anonymous media', async () => {
    const preview = await seed();
    const first = await claim(preview).expect(200);
    const again = await claim(preview).expect(200);
    expect(again.body).toEqual(first.body);
    expect(saved.size).toBe(1);
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    await claim(preview, access(other)).expect(404);
    await request(server)
      .get(first.body.processedMediaUrl as string)
      .expect(401);
    await request(server)
      .get(first.body.processedMediaUrl as string)
      .set('Authorization', `Bearer ${access(other)}`)
      .expect(404);
    const row = rows.get(preview.sessionHash);
    if (row) row.expiresAt = new Date(Date.now() - 1);
    await claim(preview).expect(404);
    await request(server)
      .get(first.body.processedMediaUrl as string)
      .set('Authorization', `Bearer ${access()}`)
      .expect(200);
  });

  it('serializes concurrent same-account claims and never publishes duplicate products', async () => {
    const preview = await seed();
    const entered = barrier();
    const proceed = barrier();
    const original = storage.attachClaim.bind(storage);
    const copy = jest
      .spyOn(storage, 'attachClaim')
      .mockImplementationOnce(async (...args) => {
        entered.release();
        await proceed.promise;
        return original(...args);
      });
    restorers.push(() => copy.mockRestore());
    const first = claim(preview).then((result) => result);
    try {
      await entered.promise;
      const denied = await claim(preview).expect(409);
      expect(denied.body.code).toBe('GUEST_CLAIM_IN_PROGRESS');
      expect(saved.size).toBe(0);
    } finally {
      proceed.release();
    }
    expect((await first).status).toBe(200);
    expect(saved.size).toBe(1);
  });

  it('binds the winning account atomically during competing claims', async () => {
    const preview = await seed();
    const results = await Promise.all([
      claim(preview),
      claim(preview, access(other)),
    ]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect([404, 409]).toContain(
      results.find((result) => result.status !== 200)?.status,
    );
    expect(saved.size).toBe(1);
    const product = [...saved.values()][0];
    expect(rows.get(preview.sessionHash)?.claimOwnerId).toBe(product.ownerId);
  });

  it('retries a partial file transfer with the same account and product ID', async () => {
    const preview = await seed();
    const finalRoot = storage.finalRoot;
    const blocker = join(preview.directory, 'blocked-directory');
    await writeFile(blocker, 'not a directory');
    Object.defineProperty(storage, 'finalRoot', {
      value: blocker,
      configurable: true,
    });
    try {
      await claim(preview).expect(503);
    } finally {
      Object.defineProperty(storage, 'finalRoot', {
        value: finalRoot,
        configurable: true,
      });
    }
    const reservedId = rows.get(preview.sessionHash)?.claimProductId;
    expect(rows.get(preview.sessionHash)?.state).toBe('claiming');
    expect(saved.size).toBe(0);
    await claim(preview, access(other)).expect(404);
    const retry = await claim(preview).expect(200);
    expect(retry.body.productId).toBe(reservedId);
    expect(saved.size).toBe(1);
  });

  it.each([false, true])(
    'recovers product-write errors, including ambiguous commit=%s, without deleting files or inserting twice',
    async (committed) => {
      const preview = await seed();
      const original = model.findOneAndUpdate.getMockImplementation();
      if (!original) throw new Error('Missing fixture implementation');
      model.findOneAndUpdate.mockImplementationOnce((filter, update) =>
        query(async () => {
          if (committed) await original(filter, update).exec();
          throw new Error('private database details');
        }),
      );
      const failure = await claim(preview).expect(503);
      expect(failure.body.code).toBe('GUEST_CLAIM_UNAVAILABLE');
      expect(JSON.stringify(failure.body)).not.toContain('private database');
      expect(await stat(preview.directory)).toBeDefined();
      const reservedId = rows.get(preview.sessionHash)?.claimProductId;
      if (committed) {
        const product = saved.get(reservedId ?? '');
        expect(product?.finalEditedImage).toBeDefined();
        expect(await stat(product?.finalEditedImage ?? '')).toBeDefined();
      }
      const retry = await claim(preview).expect(200);
      expect(retry.body.productId).toBe(reservedId);
      expect(saved.size).toBe(1);
      expect(model.findOneAndUpdate).toHaveBeenCalledTimes(committed ? 1 : 2);
    },
  );

  it('keeps the account binding after an ambiguous initial claim reservation', async () => {
    const preview = await seed();
    const original = records.findOneAndUpdate.getMockImplementation();
    if (!original) throw new Error('Missing fixture implementation');
    records.findOneAndUpdate.mockImplementationOnce((filter, update) =>
      query(async () => {
        await original(filter, update).exec();
        throw new Error('uncertain reservation response');
      }),
    );
    await claim(preview).expect(503);
    const row = rows.get(preview.sessionHash);
    if (!row) throw new Error('Missing fixture');
    expect(row.claimOwnerId).toBe(owner.toHexString());
    await claim(preview, access(other)).expect(404);
    await claim(preview).expect(409);
    row.claimLeaseUntil = new Date(0);
    await claims.recover();
    expect(saved.size).toBe(1);
    expect([...saved.values()][0].ownerId).toBe(owner.toHexString());
  });

  it.each([false, true])(
    'reconciles guest finalization errors, including committed=%s',
    async (committed) => {
      const preview = await seed();
      const original = records.updateOne.getMockImplementation();
      if (!original) throw new Error('Missing fixture implementation');
      records.updateOne.mockImplementationOnce((filter, update) =>
        query(async () => {
          if (committed) await original(filter, update).exec();
          throw new Error('private guest commit error');
        }),
      );
      await claim(preview).expect(503);
      expect(saved.size).toBe(1);
      const retry = await claim(preview).expect(200);
      expect(retry.body.productId).toBe([...saved.keys()][0]);
      expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    },
  );

  it('recovers an interrupted accepted claim after expiry while rejecting a new expired claim', async () => {
    const preview = await seed();
    const copy = jest
      .spyOn(storage, 'attachClaim')
      .mockRejectedValueOnce(new Error('interrupted transfer'));
    restorers.push(() => copy.mockRestore());
    await claim(preview).expect(503);
    const row = rows.get(preview.sessionHash);
    if (!row) throw new Error('Missing fixture');
    row.expiresAt = new Date(Date.now() - 1);
    await guests.cleanup();
    expect(await stat(preview.directory)).toBeDefined();
    expect(rows.has(preview.sessionHash)).toBe(true);
    await claim(preview).expect(404);
    await claims.recover();
    expect(saved.size).toBe(1);
    expect(rows.get(preview.sessionHash)?.state).toBe('claimed');
    await guests.cleanup();
    expect(rows.has(preview.sessionHash)).toBe(false);
    const product = [...saved.values()][0];
    expect(await stat(product.finalEditedImage ?? '')).toBeDefined();
  });

  it('defers missing-source recovery without discarding claim metadata or published copies', async () => {
    const preview = await seed();
    await unlink(join(preview.directory, 'original.png'));
    await claim(preview).expect(503);
    const reservedId = rows.get(preview.sessionHash)?.claimProductId;
    const row = rows.get(preview.sessionHash);
    if (!row) throw new Error('Missing fixture');
    row.expiresAt = new Date(Date.now() - 1);
    await guests.cleanup();
    await claims.recover();
    expect(row.state).toBe('claiming');
    expect(saved.size).toBe(0);
    await writeFile(join(preview.directory, 'original.png'), preview.original);
    await claims.recover();
    expect(saved.has(reservedId ?? '')).toBe(true);
  });

  it('fences cleanup when a claim wins after its expired-record scan', async () => {
    const preview = await seed();
    const scanned = barrier();
    const continueScan = barrier();
    const copying = barrier();
    const continueCopy = barrier();
    const originalFind = records.find.getMockImplementation();
    if (!originalFind) throw new Error('Missing fixture');
    records.find.mockImplementationOnce((filter) =>
      query(async () => {
        const snapshot = await originalFind(filter).exec();
        scanned.release();
        await continueScan.promise;
        return snapshot;
      }),
    );
    const originalCopy = storage.attachClaim.bind(storage);
    const copy = jest
      .spyOn(storage, 'attachClaim')
      .mockImplementationOnce(async (...args) => {
        copying.release();
        await continueCopy.promise;
        return originalCopy(...args);
      });
    restorers.push(() => copy.mockRestore());
    const cleanup = guests.cleanup(new Date(Date.now() + GUEST_TTL_MS + 1000));
    await scanned.promise;
    const pending = claim(preview).then((result) => result);
    try {
      await copying.promise;
      continueScan.release();
      await cleanup;
      expect(rows.get(preview.sessionHash)?.state).toBe('claiming');
      expect(await stat(preview.directory)).toBeDefined();
    } finally {
      continueScan.release();
      continueCopy.release();
    }
    expect((await pending).status).toBe(200);
  });

  it('prevents a claim when cleanup wins the state transition first', async () => {
    const preview = await seed();
    const removing = barrier();
    const proceed = barrier();
    const original = storage.remove.bind(storage);
    const remove = jest
      .spyOn(storage, 'remove')
      .mockImplementationOnce(async (id) => {
        removing.release();
        await proceed.promise;
        return original(id);
      });
    restorers.push(() => remove.mockRestore());
    const cleanup = guests.cleanup(new Date(Date.now() + GUEST_TTL_MS + 1000));
    try {
      await removing.promise;
      expect(rows.get(preview.sessionHash)?.state).toBe('deleting');
      await claim(preview).expect(404);
      expect(saved.size).toBe(0);
    } finally {
      proceed.release();
    }
    await cleanup;
  });

  it('allows a recovered worker and an old worker to finish with the same immutable product', async () => {
    const preview = await seed();
    const publishing = barrier();
    const proceed = barrier();
    const original = products.createClaimedProduct.bind(products);
    const insert = jest
      .spyOn(products, 'createClaimedProduct')
      .mockImplementationOnce(async (...args) => {
        publishing.release();
        await proceed.promise;
        return original(...args);
      });
    restorers.push(() => insert.mockRestore());
    const first = claim(preview).then((result) => result);
    await publishing.promise;
    const row = rows.get(preview.sessionHash);
    if (!row) throw new Error('Missing fixture');
    row.claimLeaseUntil = new Date(0);
    let secondId: string;
    try {
      const second = await claim(preview).expect(200);
      secondId = second.body.productId as string;
    } finally {
      proceed.release();
    }
    const finished = await first;
    expect(finished.status).toBe(200);
    expect(finished.body.productId).toBe(secondId);
    expect(saved.size).toBe(1);
    expect(
      await stat([...saved.values()][0].finalEditedImage ?? ''),
    ).toBeDefined();
  });

  it('removes only stale claim temp files, preserving saved media and recent temp files', async () => {
    const isolated = new GuestPreviewStorage();
    const preview = await seed();
    const originalRoot = join(preview.directory, 'original');
    const finalRoot = join(preview.directory, 'final');
    Object.defineProperty(isolated, 'originalRoot', { value: originalRoot });
    Object.defineProperty(isolated, 'finalRoot', { value: finalRoot });
    await mkdir(originalRoot);
    await mkdir(finalRoot);
    const id = new Types.ObjectId().toHexString();
    const stale = join(
      originalRoot,
      `guest-claim-${id}.png.${randomUUID()}.tmp`,
    );
    const recent = join(finalRoot, `guest-claim-${id}.png.${randomUUID()}.tmp`);
    const published = join(finalRoot, `guest-claim-${id}.png`);
    for (const file of [stale, recent, published])
      await writeFile(file, fixture);
    const old = new Date(Date.now() - GUEST_TTL_MS - 1000);
    await utimes(stale, old, old);
    await isolated.cleanupClaimTemps();
    await expect(stat(stale)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await stat(recent)).toBeDefined();
    expect(await stat(published)).toBeDefined();
  });
});
