import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ProviderAdmission, ProviderAdmissionSchema } from './provider-admission.schema';
import { ProviderAdmissionService } from './provider-admission.service';

@Module({
  imports: [ConfigModule, MongooseModule.forFeature([{ name: ProviderAdmission.name, schema: ProviderAdmissionSchema }])],
  providers: [ProviderAdmissionService],
  exports: [ProviderAdmissionService],
})
export class ProviderAdmissionModule {}
