import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('/graphql (POST)', () => {
    return request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ getHello }' })
      .expect(200)
      .expect({ data: { getHello: 'Hello World!' } });
  });
});
