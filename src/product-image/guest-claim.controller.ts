import {
  Controller,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { authenticatedMemberId } from '../products/product-request.util';
import { ProductImageErrorFilter } from './product-image-error.filter';
import { GuestClaimService, GuestClaimResult } from './guest-claim.service';

@Controller('product-image/guest')
@UseFilters(ProductImageErrorFilter)
export class GuestClaimController {
  constructor(private readonly claims: GuestClaimService) {}

  @Post(':previewId/claim')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie, Origin, Authorization')
  @UseGuards(JwtAuthGuard)
  claim(
    @Req() request: Request,
    @Param('previewId') previewId: string,
  ): Promise<GuestClaimResult> {
    return this.claims.claim(
      request,
      previewId,
      authenticatedMemberId(request),
    );
  }
}
