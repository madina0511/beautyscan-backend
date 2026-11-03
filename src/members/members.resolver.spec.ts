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
import { MembersResolver } from './members.resolver';
import { MembersService } from './members.service';
import { MemberStatus } from './schemas/member.schema';

describe('Protected me profile query', () => {
  let app: INestApplication;
  let schema: GraphQLSchema;
  const secret = randomBytes(32).toString('hex');
  const jwt = new JwtService({ secret });
  const memberId = new Types.ObjectId();
  const otherId = new Types.ObjectId();
  const membersService = { findById: jest.fn() };
  const query =
    'query { me { id name email phone isEmailVerified isPhoneVerified } }';

  function execute(source = query, token?: string) {
    return graphql({
      schema,
      source,
      contextValue: {
        req: { headers: token ? { authorization: `Bearer ${token}` } : {} },
        res: {},
      },
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
        MembersResolver,
        JwtStrategy,
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
    membersService.findById.mockImplementation(async (id: string) => ({
      _id: new Types.ObjectId(id),
      status: MemberStatus.ACTIVE,
      name: id === memberId.toHexString() ? 'Madina' : 'Another member',
      email: 'profile@example.test',
      phone: '+998901234567',
      isEmailVerified: true,
      isPhoneVerified: false,
      password: 'private-test-hash',
      passwordResetToken: 'private-test-reset-value',
      googleId: 'private-test-provider-id',
    }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects anonymous requests before looking up a member', async () => {
    const result = await execute();
    expect(result.errors?.[0].originalError).toBeInstanceOf(
      UnauthorizedException,
    );
    expect(membersService.findById).not.toHaveBeenCalled();
  });

  it.each(['expired', 'malformed', 'wrong-signature'])(
    'rejects a %s access token',
    async (kind) => {
      const token =
        kind === 'malformed'
          ? 'not-a-jwt'
          : kind === 'expired'
            ? jwt.sign({ sub: memberId.toHexString() }, { expiresIn: -1 })
            : new JwtService({ secret: randomBytes(32).toString('hex') }).sign({
                sub: memberId.toHexString(),
              });
      const result = await execute(query, token);
      expect(result.errors?.[0].originalError).toBeInstanceOf(
        UnauthorizedException,
      );
      expect(membersService.findById).not.toHaveBeenCalled();
    },
  );

  it.each([memberId, otherId])(
    'returns only the JWT member profile: %s',
    async (id) => {
      const result = await execute(query, jwt.sign({ sub: id.toHexString() }));
      expect(result.errors).toBeUndefined();
      expect(result.data?.me).toEqual({
        id: id.toHexString(),
        name: id.equals(memberId) ? 'Madina' : 'Another member',
        email: 'profile@example.test',
        phone: '+998901234567',
        isEmailVerified: true,
        isPhoneVerified: false,
      });
      expect(membersService.findById).toHaveBeenCalledTimes(1);
      expect(membersService.findById).toHaveBeenCalledWith(id.toHexString());
    },
  );

  it.each([MemberStatus.BLOCKED, MemberStatus.DELETED, 'missing'])(
    'rejects a %s member',
    async (status) => {
      membersService.findById.mockResolvedValue(
        status === 'missing' ? null : { _id: memberId, status },
      );
      const result = await execute(
        query,
        jwt.sign({ sub: memberId.toHexString() }),
      );
      expect(result.errors?.[0].originalError).toBeInstanceOf(
        UnauthorizedException,
      );
    },
  );

  it('represents optional missing email and phone as null', async () => {
    membersService.findById.mockResolvedValue({
      _id: memberId,
      status: MemberStatus.ACTIVE,
      name: 'Madina',
      isEmailVerified: false,
      isPhoneVerified: false,
    });
    const result = await execute(
      query,
      jwt.sign({ sub: memberId.toHexString() }),
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.me).toMatchObject({ email: null, phone: null });
  });

  it('does not accept a caller-selected member ID', async () => {
    const result = await execute(
      `query { me(id: "${otherId.toHexString()}") { id } }`,
      jwt.sign({ sub: memberId.toHexString() }),
    );
    expect(result.errors).toBeDefined();
    expect(membersService.findById).not.toHaveBeenCalled();
  });

  it.each(['password', 'refreshToken', 'passwordResetToken', 'googleId'])(
    'does not expose %s in the GraphQL profile type',
    async (field) => {
      const result = await execute(
        `query { me { id ${field} } }`,
        jwt.sign({ sub: memberId.toHexString() }),
      );
      expect(result.errors).toBeDefined();
      expect(result.data).toBeUndefined();
      expect(membersService.findById).not.toHaveBeenCalled();
    },
  );
});
