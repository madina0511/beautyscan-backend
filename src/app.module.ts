import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppResolver } from './app.resolver';
import { AppService } from './app.service';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductImageModule } from './product-image/product-image.module';
import { ProductsModule } from './products/products.module';
import { OcrModule } from './ocr/ocr.module';
import { AiDescriptionModule } from './ai-description/ai-description.module';
import { AuthModule } from './auth/auth.module';
import { EmailService } from './email/email.service';
import { EmailModule } from './email/email.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 60,
      },
    ]),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
    }),

    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,

      introspection: process.env.NODE_ENV !== 'production',

      debug: process.env.NODE_ENV !== 'production',

      context: ({ req, res }) => ({
        req,
        res,
      }),

      formatError: (formattedError) => {
        if (process.env.NODE_ENV !== 'production') {
          return formattedError;
        }

        const code = formattedError.extensions?.code;

        const allowedCodes = [
          'BAD_USER_INPUT',
          'BAD_REQUEST',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'TOO_MANY_REQUESTS',
        ];

        if (typeof code === 'string' && allowedCodes.includes(code)) {
          return {
            message: formattedError.message,
            extensions: { code },
          };
        }

        return {
          message: 'Internal server error',
          extensions: {
            code: 'INTERNAL_SERVER_ERROR',
          },
        };
      },
    }),

    ProductImageModule,

    ProductsModule,

    OcrModule,

    AiDescriptionModule,

    AuthModule,

    EmailModule,
  ],

  providers: [AppService, AppResolver, EmailService],
})
export class AppModule {}
