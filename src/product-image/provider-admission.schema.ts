import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'image_provider_admission', versionKey: false })
export class ProviderAdmission {
  @Prop({ type: String })
  _id: string;

  @Prop({ required: true })
  day: string;

  @Prop({ required: true })
  calls: number;

  @Prop({ type: [{ _id: false, id: String, expiresAt: Date }], default: [] })
  leases: { id: string; expiresAt: Date }[];
}

export const ProviderAdmissionSchema = SchemaFactory.createForClass(ProviderAdmission);
