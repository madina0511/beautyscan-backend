import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Member, MemberSchema } from './schemas/member.schema';
import { MembersService } from './members.service';
import { MembersResolver } from './members.resolver';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Member.name,
        schema: MemberSchema,
      },
    ]),
  ],
  providers: [MembersService, MembersResolver],
  exports: [MembersService],
})
export class MembersModule {}
