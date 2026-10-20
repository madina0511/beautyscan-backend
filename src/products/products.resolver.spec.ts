import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule, GraphQLSchemaHost } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { graphql, GraphQLSchema } from 'graphql';
import { Types } from 'mongoose';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { MembersService } from '../members/members.service';
import { MemberStatus } from '../members/schemas/member.schema';
import { ProductsResolver } from './products.resolver';
import { ProductsService } from './products.service';

describe('Products GraphQL authentication and ownership', () => {
  let app: INestApplication;
  let schema: GraphQLSchema;
  const secret = randomBytes(32).toString('hex');
  const jwt = new JwtService({ secret });
  const memberA = new Types.ObjectId();
  const memberB = new Types.ObjectId();
  const blockedMember = new Types.ObjectId();
  const productsService = {
    create: jest.fn(),
    findByOwner: jest.fn(),
  };
  const membersService = {
    findById: jest.fn(async (id: string) => ({
      _id: new Types.ObjectId(id),
      status:
        id === blockedMember.toHexString()
          ? MemberStatus.BLOCKED
          : MemberStatus.ACTIVE,
    })),
  };

  function execute(source: string, memberId?: Types.ObjectId) {
    const headers = memberId
      ? {
          authorization: `Bearer ${jwt.sign(
            { sub: memberId.toHexString() },
            { expiresIn: '5m' },
          )}`,
        }
      : {};
    return graphql({
      schema,
      source,
      contextValue: { req: { headers }, res: {} },
    });
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          autoSchemaFile: true,
        }),
      ],
      providers: [
        ProductsResolver,
        JwtStrategy,
        { provide: ProductsService, useValue: productsService },
        { provide: MembersService, useValue: membersService },
        {
          provide: ConfigService,
          useValue: {
            get: (name: string): string | undefined =>
              name === 'JWT_ACCESS_SECRET' ? secret : undefined,
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    schema = app.get(GraphQLSchemaHost).schema;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    productsService.create.mockImplementation(
      async (name: string, ownerId: string) => ({
        _id: new Types.ObjectId(),
        name,
        ownerId,
      }),
    );
    productsService.findByOwner.mockImplementation(async (ownerId: string) => [
      { _id: new Types.ObjectId(), name: 'Owned product', ownerId },
    ]);
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    'mutation { createProduct(name: "Test") { ownerId } }',
    'query { myProducts { ownerId } }',
  ])('rejects anonymous requests: %s', async (source) => {
    const result = await execute(source);
    expect(result.errors?.[0].originalError).toBeInstanceOf(
      UnauthorizedException,
    );
    expect(productsService.create).not.toHaveBeenCalled();
    expect(productsService.findByOwner).not.toHaveBeenCalled();
  });

  it.each([memberA, memberB])(
    'creates products under the authenticated member ID: %s',
    async (memberId) => {
      const result = await execute(
        'mutation { createProduct(name: "Test") { ownerId } }',
        memberId,
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.createProduct).toEqual({
        ownerId: memberId.toHexString(),
      });
      expect(productsService.create).toHaveBeenCalledWith(
        'Test',
        memberId.toHexString(),
      );
    },
  );

  it.each([memberA, memberB])(
    'lists products using only the authenticated member ID: %s',
    async (memberId) => {
      const result = await execute(
        'query { myProducts { ownerId } }',
        memberId,
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.myProducts).toEqual([
        { ownerId: memberId.toHexString() },
      ]);
      expect(productsService.findByOwner).toHaveBeenCalledWith(
        memberId.toHexString(),
      );
    },
  );

  it.each([
    'mutation { createProduct(name: "Test", ownerId: "other") { ownerId } }',
    'query { myProducts(ownerId: "other") { ownerId } }',
  ])('rejects client-supplied ownerId: %s', async (source) => {
    const result = await execute(source, memberA);
    expect(result.errors?.[0].message).toContain('Unknown argument "ownerId"');
    expect(productsService.create).not.toHaveBeenCalled();
    expect(productsService.findByOwner).not.toHaveBeenCalled();
  });

  it('preserves rejection of blocked members', async () => {
    const result = await execute(
      'query { myProducts { ownerId } }',
      blockedMember,
    );
    expect(result.errors?.[0].originalError).toBeInstanceOf(
      UnauthorizedException,
    );
    expect(productsService.findByOwner).not.toHaveBeenCalled();
  });
});
