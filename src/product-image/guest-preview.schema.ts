import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export type GuestPreviewState =
  | 'new'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'claiming'
  | 'claimed'
  | 'deleting';

@Schema({ collection: 'guest_previews', versionKey: false })
export class GuestPreview {
  @Prop({ type: String })
  _id: string;

  @Prop({ required: true, unique: true })
  previewId: string;

  @Prop({
    required: true,
    enum: [
      'new',
      'uploading',
      'processing',
      'ready',
      'failed',
      'claiming',
      'claimed',
      'deleting',
    ],
  })
  state: GuestPreviewState;

  // Not a TTL index: cleanup must remove private files BEFORE deleting this row.
  @Prop({ required: true, index: true })
  expiresAt: Date;

  @Prop()
  claimOwnerId?: string;

  @Prop()
  claimProductId?: string;

  @Prop()
  claimToken?: string;

  @Prop({ type: Date })
  claimLeaseUntil?: Date;
}

export const GuestPreviewSchema = SchemaFactory.createForClass(GuestPreview);
GuestPreviewSchema.index({ state: 1, claimLeaseUntil: 1 });

@Schema({ collection: 'guest_request_limits', versionKey: false })
export class GuestRequestLimit {
  @Prop({ type: String })
  _id: string;

  @Prop({ default: 0 })
  hits: number;

  @Prop({ type: [{ _id: false, id: String, expiresAt: Date }], default: [] })
  leases: { id: string; expiresAt: Date }[];

  @Prop({ type: Date })
  expiresAt?: Date;
}

export const GuestRequestLimitSchema =
  SchemaFactory.createForClass(GuestRequestLimit);
GuestRequestLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
