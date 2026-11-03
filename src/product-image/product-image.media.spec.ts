import { INestApplication, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from 'fs/promises';
import { join, relative } from 'path';
import { Server } from 'http';
import { Types } from 'mongoose';
import request from 'supertest';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { MembersService } from '../members/members.service';
import { MemberStatus } from '../members/schemas/member.schema';
import { ProductsService } from '../products/products.service';
import { ImageNormalizationService } from './image-normalization.service';
import { ProductImageController } from './product-image.controller';
import { ProductImageService } from './product-image.service';
import { ProviderAdmissionService } from './provider-admission.service';

describe('Protected saved product image delivery', () => {
  let app: INestApplication;
  let server: Server;
  let originalDirectory: string;
  let finalDirectory: string;
  let original: string;
  let processed: string;
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const owner = new Types.ObjectId();
  const other = new Types.ObjectId();
  const productId = new Types.ObjectId().toHexString();
  const secret = randomBytes(32).toString('hex');
  const jwt = new JwtService({ secret });
  const products = { requireOwnedProduct: jest.fn() };
  function token(member = owner, expiresIn = '5m') {
    return jwt.sign({ sub: member.toHexString() }, { expiresIn });
  }
  function get(kind: string, accessToken = token()) {
    return request(server)
      .get(`/product-image/${productId}/media/${kind}`)
      .set('Authorization', `Bearer ${accessToken}`);
  }

  beforeAll(async () => {
    await mkdir(join('uploads', 'products', 'original'), { recursive: true });
    await mkdir(join('uploads', 'products', 'final'), { recursive: true });
    originalDirectory = await mkdtemp(
      join('uploads', 'products', 'original', 'media-test-'),
    );
    finalDirectory = await mkdtemp(
      join('uploads', 'products', 'final', 'media-test-'),
    );
    original = join(originalDirectory, 'original.png');
    processed = join(finalDirectory, 'processed.png');
    await writeFile(original, bytes);
    await writeFile(processed, bytes);
    const module = await Test.createTestingModule({
      controllers: [ProductImageController],
      providers: [
        ProductImageService,
        { provide: ProviderAdmissionService, useValue: {} },
        JwtStrategy,
        { provide: ProductsService, useValue: products },
        { provide: HttpService, useValue: {} },
        { provide: ImageNormalizationService, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            get: (name: string) =>
              name === 'JWT_ACCESS_SECRET' ? secret : undefined,
          },
        },
        {
          provide: MembersService,
          useValue: {
            findById: async (id: string) => ({
              _id: new Types.ObjectId(id),
              status: MemberStatus.ACTIVE,
            }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    products.requireOwnedProduct.mockImplementation(
      async (id: string, memberId: string) => {
        if (id !== productId || memberId !== owner.toHexString())
          throw new NotFoundException('Product not found');
        return { originalImage: original, finalEditedImage: processed };
      },
    );
  });
  afterAll(async () => {
    await app?.close();
    if (original) await unlink(original);
    if (processed) await unlink(processed);
    if (originalDirectory) await rmdir(originalDirectory);
    if (finalDirectory) await rmdir(finalDirectory);
  });

  it.each(['original', 'processed'])(
    'serves the owned %s image with private headers',
    async (kind) => {
      const result = await get(kind).expect(200);
      expect(result.headers['content-type']).toMatch(/^image\/png/);
      expect(result.headers['cache-control']).toBe('private, no-store');
      expect(result.headers['x-content-type-options']).toBe('nosniff');
      expect(result.body).toEqual(bytes);
      expect(products.requireOwnedProduct).toHaveBeenCalledWith(
        productId,
        owner.toHexString(),
      );
    },
  );
  it('rejects anonymous access before ownership lookup', async () => {
    await request(server)
      .get(`/product-image/${productId}/media/processed`)
      .expect(401);
    expect(products.requireOwnedProduct).not.toHaveBeenCalled();
  });
  it('rejects expired tokens', async () => {
    await get('processed', token(owner, '-1s')).expect(401);
    expect(products.requireOwnedProduct).not.toHaveBeenCalled();
  });
  it('does not reveal another member’s media', async () => {
    await get('processed', token(other)).expect(404);
  });
  it('rejects unsupported image kinds', async () => {
    await get('package').expect(400);
    expect(products.requireOwnedProduct).not.toHaveBeenCalled();
  });
  it('does not accept a file path from query parameters', async () => {
    const result = await get('processed').query({ path: original }).expect(200);
    expect(result.body).toEqual(bytes);
  });
  it('rejects stored references outside the designated image directory', async () => {
    products.requireOwnedProduct.mockResolvedValue({
      originalImage: original,
      finalEditedImage: original,
    });
    const result = await get('processed').expect(404);
    expect(result.text).not.toContain(
      relative(process.cwd(), originalDirectory),
    );
  });
  it('rejects a path that traverses out of the media root', async () => {
    products.requireOwnedProduct.mockResolvedValue({
      finalEditedImage: join(
        'uploads',
        'products',
        'final',
        '..',
        'original',
        relative(join('uploads', 'products', 'original'), original),
      ),
    });
    await get('processed').expect(404);
  });
  it('reports missing persisted files without leaking their path', async () => {
    products.requireOwnedProduct.mockResolvedValue({
      finalEditedImage: join(finalDirectory, 'missing.png'),
    });
    const result = await get('processed').expect(404);
    expect(result.text).not.toContain(finalDirectory);
  });
  it('reports products without a saved image', async () => {
    products.requireOwnedProduct.mockResolvedValue({});
    await get('processed').expect(404);
  });
});
