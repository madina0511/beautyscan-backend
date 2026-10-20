import sharp from 'sharp';
import { stat } from 'fs/promises';
import { ImageNormalizationService } from '../product-image/image-normalization.service';
import { MAX_UPLOAD_BYTES } from '../product-image/image-upload.config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { HttpService } from '@nestjs/axios';
import { randomBytes } from 'crypto';
import { mkdir, readdir, unlink } from 'fs/promises';
import { Server } from 'http';
import { join } from 'path';
import { Types } from 'mongoose';
import request from 'supertest';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { MembersService } from '../members/members.service';
import { MemberStatus } from '../members/schemas/member.schema';
import { ProductImageController } from '../product-image/product-image.controller';
import { ProductImageResolver } from '../product-image/product-image.resolver';
import { ProductImageService } from '../product-image/product-image.service';
import { OcrController } from '../ocr/ocr.controller';
import { OcrService } from '../ocr/ocr.service';
import { AiDescriptionService } from '../ai-description/ai-description.service';
import { ProductsResolver } from './products.resolver';
import { Product } from './product.schema';
import { ProductsService } from './products.service';

describe('Product processing security (mocked providers and database)', () => {
  let app: INestApplication;
  let imageFixture: Buffer;
  let normalizer: jest.SpyInstance;
  let server: Server;
  let images: ProductImageService;
  let imageProvider: jest.SpyInstance<Promise<Buffer>, [string]>;
  const secret = randomBytes(32).toString('hex');
  const jwt = new JwtService({ secret });
  const owner = new Types.ObjectId();
  const stranger = new Types.ObjectId();
  const productId = new Types.ObjectId().toHexString();
  const document = {
    _id: productId,
    ownerId: owner.toHexString(),
    name: 'Product',
  };
  const model = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };
  const ocr = { extractText: jest.fn() };
  const ai = { generateDescription: jest.fn() };
  const directories = [
    'uploads/products',
    'uploads/products/final',
    'uploads/packages',
    'uploads/products/original',
    'uploads/packages/final',
    'uploads/temporary',
  ];
  let baseline: Map<string, Set<string>>;
  function token(member = owner): string {
    return jwt.sign({ sub: member.toHexString() }, { expiresIn: '5m' });
  }
  async function inventory(): Promise<string[]> {
    const entries = await Promise.all(
      directories.map(async (directory) =>
        (await readdir(directory)).map((name) => join(directory, name)),
      ),
    );
    return entries.flat().sort();
  }
  beforeAll(async () => {
    imageFixture = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 4,
        background: { r: 20, g: 40, b: 60, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    await Promise.all(
      directories.map((directory) => mkdir(directory, { recursive: true })),
    );
    const module = await Test.createTestingModule({
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          autoSchemaFile: true,
          context: ({ req, res }) => ({ req, res }),
        }),
      ],
      controllers: [ProductImageController, OcrController],
      providers: [
        ProductsService,
        ProductImageService,
        ImageNormalizationService,
        ProductImageResolver,
        ProductsResolver,
        JwtStrategy,
        { provide: getModelToken(Product.name), useValue: model },
        {
          provide: MembersService,
          useValue: {
            findById: async (id: string) => ({
              _id: new Types.ObjectId(id),
              status: MemberStatus.ACTIVE,
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (name: string) =>
              name === 'JWT_ACCESS_SECRET' ? secret : undefined,
          },
        },
        { provide: HttpService, useValue: {} },
        { provide: OcrService, useValue: ocr },
        { provide: AiDescriptionService, useValue: ai },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useLogger(false);
    await app.init();
    server = app.getHttpServer();
    images = app.get(ProductImageService);
    imageProvider = jest.spyOn(images, 'createFinalEditedImage');
    normalizer = jest.spyOn(app.get(ImageNormalizationService), 'normalize');
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    baseline = new Map(
      await Promise.all(
        directories.map(
          async (directory) =>
            [directory, new Set(await readdir(directory))] as const,
        ),
      ),
    );
    const query = (filter: { _id: string; ownerId: string }) => ({
      exec: async () =>
        filter._id === productId && filter.ownerId === owner.toHexString()
          ? document
          : null,
    });
    model.findOne.mockImplementation(query);
    model.findOneAndUpdate.mockImplementation(query);
    imageProvider.mockResolvedValue(imageFixture);
    ocr.extractText.mockResolvedValue('Package text');
    ai.generateDescription.mockResolvedValue('Description');
  });
  afterEach(async () => {
    // Remove only files created by this test; never remove pre-existing uploads.
    for (const directory of directories) {
      for (const name of await readdir(directory)) {
        if (
          !baseline.get(directory)?.has(name) &&
          !(directory === 'uploads/products' && name === 'final')
        )
          await unlink(join(directory, name));
      }
    }
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each(['/product-image/upload', '/ocr/upload'])(
    'rejects anonymous uploads before writing files: %s',
    async (endpoint) => {
      const before = await inventory();
      await request(server)
        .post(endpoint)
        .field('productId', productId)
        .field('language', 'en')
        .attach('image', imageFixture, 'test.png')
        .expect(401);
      expect(await inventory()).toEqual(before);
      expect(normalizer).not.toHaveBeenCalled();
      expect(model.findOne).not.toHaveBeenCalled();
      expect(imageProvider).not.toHaveBeenCalled();
      expect(ocr.extractText).not.toHaveBeenCalled();
    },
  );
  it.each(['/product-image/upload', '/ocr/upload'])(
    'rejects non-owner and missing products, cleans uploads, and skips providers: %s',
    async (endpoint) => {
      const before = await inventory();
      for (const [id, member] of [
        [productId, stranger],
        [new Types.ObjectId().toHexString(), owner],
      ] as const) {
        const response = await request(server)
          .post(endpoint)
          .set('Authorization', `Bearer ${token(member)}`)
          .field('productId', id)
          .field('language', 'en')
          .attach('image', imageFixture, 'test.png')
          .expect(404);
        expect(response.body.message).toBe('Product not found');
      }
      expect(await inventory()).toEqual(before);
      expect(imageProvider).not.toHaveBeenCalled();
      expect(ocr.extractText).not.toHaveBeenCalled();
      expect(ai.generateDescription).not.toHaveBeenCalled();
      expect(normalizer).not.toHaveBeenCalled();
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );
  it.each(['/product-image/upload', '/ocr/upload'])(
    'rejects invalid IDs and cleans uploads: %s',
    async (endpoint) => {
      const before = await inventory();
      await request(server)
        .post(endpoint)
        .set('Authorization', `Bearer ${token()}`)
        .field('productId', '../invalid')
        .field('language', 'en')
        .attach('image', imageFixture, 'test.png')
        .expect(400);
      expect(await inventory()).toEqual(before);
      expect(normalizer).not.toHaveBeenCalled();
      expect(model.findOne).not.toHaveBeenCalled();
      expect(imageProvider).not.toHaveBeenCalled();
      expect(ocr.extractText).not.toHaveBeenCalled();
    },
  );
  it.each(['/product-image/upload', '/ocr/upload'])(
    'allows owner processing with owner-scoped writes: %s',
    async (endpoint) => {
      await request(server)
        .post(endpoint)
        .set('Authorization', `Bearer ${token()}`)
        .field('productId', productId)
        .field('ownerId', stranger.toHexString())
        .field('language', 'en')
        .attach('image', imageFixture, 'test.png')
        .expect(201);
      expect(model.findOneAndUpdate.mock.calls[0][0]).toEqual({
        _id: productId,
        ownerId: owner.toHexString(),
      });
    },
  );
  it.each(['/product-image/upload', '/ocr/upload'])(
    'cleans files on provider failure: %s',
    async (endpoint) => {
      const before = await inventory();
      imageProvider.mockRejectedValue(new Error('Mock provider failure'));
      ocr.extractText.mockRejectedValue(new Error('Mock provider failure'));
      await request(server)
        .post(endpoint)
        .set('Authorization', `Bearer ${token()}`)
        .field('productId', productId)
        .field('language', 'en')
        .attach('image', imageFixture, 'test.png')
        .expect(500);
      expect(await inventory()).toEqual(before);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );
  it('cleans original and final files when the ownership-scoped final write fails', async () => {
    const before = await inventory();
    model.findOneAndUpdate.mockReturnValue({ exec: async () => null });
    await request(server)
      .post('/product-image/upload')
      .set('Authorization', `Bearer ${token()}`)
      .field('productId', productId)
      .attach('image', imageFixture, 'test.png')
      .expect(404);
    expect(await inventory()).toEqual(before);
  });

  it.each(['/product-image/upload', '/ocr/upload'])(
    'rejects files above 10,000,000 bytes with 413 and cleans partial uploads: %s',
    async (endpoint) => {
      const before = await inventory();
      await request(server)
        .post(endpoint)
        .set('Authorization', `Bearer ${token()}`)
        .field('productId', productId)
        .field('language', 'en')
        .attach('image', Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'large.png')
        .expect(413);
      expect(await inventory()).toEqual(before);
      expect(normalizer).not.toHaveBeenCalled();
      expect(imageProvider).not.toHaveBeenCalled();
      expect(ocr.extractText).not.toHaveBeenCalled();
    },
  );
  it.each(['/product-image/upload', '/ocr/upload'])(
    'accepts exactly 10,000,000 bytes and preserves only persistent output: %s',
    async (endpoint) => {
      const rawBefore = await readdir(
        endpoint === '/ocr/upload' ? 'uploads/packages' : 'uploads/products',
      );
      const temporaryBefore = await readdir('uploads/temporary');
      const padded = Buffer.concat([
        imageFixture,
        Buffer.alloc(MAX_UPLOAD_BYTES - imageFixture.length),
      ]);
      const response = await request(server)
        .post(endpoint)
        .set('Authorization', `Bearer ${token()}`)
        .field('productId', productId)
        .field('language', 'en')
        .attach('image', padded, 'boundary.png')
        .expect(201);
      expect(
        await readdir(
          endpoint === '/ocr/upload' ? 'uploads/packages' : 'uploads/products',
        ),
      ).toEqual(rawBefore);
      expect(await readdir('uploads/temporary')).toEqual(temporaryBefore);
      const resultPath: string =
        endpoint === '/ocr/upload'
          ? response.body.packageImage
          : response.body.finalEditedImage;
      expect((await stat(resultPath)).size).toBeGreaterThan(0);
    },
  );
  it.each(['/product-image/upload', '/ocr/upload'])(
    'rejects multiple files and excessive fields: %s',
    async (endpoint) => {
      const before = await inventory();
      await request(server)
        .post(endpoint)
        .set('Authorization', `Bearer ${token()}`)
        .field('productId', productId)
        .attach('image', imageFixture, 'a.png')
        .attach('image', imageFixture, 'b.png')
        .expect(400);
      await request(server)
        .post(endpoint)
        .set('Authorization', `Bearer ${token()}`)
        .field('productId', productId)
        .field('language', 'en')
        .field('a', '1')
        .field('b', '2')
        .field('c', '3')
        .attach('image', imageFixture, 'a.png')
        .expect(400);
      expect(await inventory()).toEqual(before);
      expect(normalizer).not.toHaveBeenCalled();
    },
  );
  it.each(['/product-image/upload', '/ocr/upload'])(
    'rejects fake images despite image MIME/extension, with cleanup: %s',
    async (endpoint) => {
      const before = await inventory();
      await request(server)
        .post(endpoint)
        .set('Authorization', `Bearer ${token()}`)
        .field('productId', productId)
        .field('language', 'en')
        .attach('image', Buffer.from('not an image'), {
          filename: 'fake.png',
          contentType: 'image/png',
        })
        .expect(400);
      expect(await inventory()).toEqual(before);
      expect(imageProvider).not.toHaveBeenCalled();
      expect(ocr.extractText).not.toHaveBeenCalled();
    },
  );
  it.each(['/product-image/upload', '/ocr/upload'])(
    'uses bytes instead of spoofed extensions or MIME types: %s',
    async (endpoint) => {
      await request(server)
        .post(endpoint)
        .set('Authorization', `Bearer ${token()}`)
        .field('productId', productId)
        .field('language', 'en')
        .attach('image', imageFixture, {
          filename: 'fake.heic',
          contentType: 'application/octet-stream',
        })
        .expect(201);
      const providerPath: string =
        endpoint === '/ocr/upload'
          ? ocr.extractText.mock.calls[0][0]
          : imageProvider.mock.calls[0][0];
      expect(providerPath.endsWith('.png')).toBe(true);
    },
  );
  it('sends AVIF as normalized PNG to OCR and removes its working file', async () => {
    const avif = await sharp(imageFixture).avif().toBuffer();
    let observedFormat: string | undefined;
    ocr.extractText.mockImplementationOnce(async (imagePath: string) => {
      observedFormat = (await sharp(imagePath).metadata()).format;
      return 'text';
    });
    const before = await readdir('uploads/temporary');
    await request(server)
      .post('/ocr/upload')
      .set('Authorization', `Bearer ${token()}`)
      .field('productId', productId)
      .field('language', 'en')
      .attach('image', avif, 'image.avif')
      .expect(201);
    expect(observedFormat).toBe('png');
    expect(await readdir('uploads/temporary')).toEqual(before);
  });
  it('cleans uploads and working files when AI generation fails', async () => {
    const before = await inventory();
    ai.generateDescription.mockRejectedValueOnce(new Error('mock AI failure'));
    await request(server)
      .post('/ocr/upload')
      .set('Authorization', `Bearer ${token()}`)
      .field('productId', productId)
      .field('language', 'en')
      .attach('image', imageFixture, 'image.png')
      .expect(500);
    expect(await inventory()).toEqual(before);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });
  const mutation = (id: string) =>
    `mutation { removeBackground(input: { productId: "${id}", image: "reference" }) { image } }`;
  it('rejects anonymous GraphQL image updates', async () => {
    const response = await request(server)
      .post('/graphql')
      .send({ query: mutation(productId) })
      .expect(200);
    expect(response.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('rejects cross-user, missing and invalid GraphQL product IDs', async () => {
    for (const [id, member] of [
      [productId, stranger],
      [new Types.ObjectId().toHexString(), owner],
      ['invalid', owner],
    ] as const) {
      const response = await request(server)
        .post('/graphql')
        .set('Authorization', `Bearer ${token(member)}`)
        .send({ query: mutation(id) })
        .expect(200);
      expect(response.body.errors).toHaveLength(1);
      if (id !== 'invalid')
        expect(response.body.errors[0].message).toBe('Product not found');
    }
    expect(imageProvider).not.toHaveBeenCalled();
  });
  it('allows owner GraphQL image updates with the existing input contract', async () => {
    const response = await request(server)
      .post('/graphql')
      .set('Authorization', `Bearer ${token()}`)
      .send({ query: mutation(productId) })
      .expect(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.removeBackground.image).toBe('reference');
    expect(model.findOneAndUpdate.mock.calls[0][0]).toEqual({
      _id: productId,
      ownerId: owner.toHexString(),
    });
  });
});
