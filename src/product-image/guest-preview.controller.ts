import {
  BadRequestException,
  CallHandler,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Header,
  Injectable,
  NestInterceptor,
  Param,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { createReadStream } from 'fs';
import { catchError, concatMap, from, Observable } from 'rxjs';
import { GuestPreviewService, guestContexts } from './guest-preview.service';
import { ProductImageErrorFilter } from './product-image-error.filter';
import { IMAGE_UPLOAD_LIMITS } from './image-upload.config';
import {
  temporaryImageStorage,
  UploadFailureCleanupInterceptor,
} from './upload-storage';

@Injectable()
export class GuestUploadGuard implements CanActivate {
  constructor(private readonly guests: GuestPreviewService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.guests.begin(
      context.switchToHttp().getRequest<Request>(),
      context.switchToHttp().getResponse<Response>(),
    );
    return true;
  }
}

@Injectable()
export class GuestUploadLifecycle implements NestInterceptor {
  constructor(private readonly guests: GuestPreviewService) {}
  intercept(
    execution: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const context = guestContexts.get(
      execution.switchToHttp().getRequest<Request>(),
    );
    if (!context) throw new BadRequestException();
    return next.handle().pipe(
      concatMap(async (value: unknown) => {
        await this.guests.finish(context, false);
        return value;
      }),
      catchError((error: unknown) =>
        from(
          (async () => {
            await this.guests.finish(context, true);
            throw error;
          })(),
        ),
      ),
    );
  }
}

@Controller('product-image/guest')
@UseFilters(ProductImageErrorFilter)
export class GuestPreviewController {
  constructor(private readonly guests: GuestPreviewService) {}

  @Post('enhance')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(GuestUploadGuard)
  @UseInterceptors(
    GuestUploadLifecycle,
    UploadFailureCleanupInterceptor,
    FileInterceptor('image', {
      limits: { ...IMAGE_UPLOAD_LIMITS, fields: 0, parts: 2 },
      storage: temporaryImageStorage((request, _file, callback) => {
        const context = guestContexts.get(request);
        if (!context)
          return callback(new Error('Guest session unavailable'), '');
        callback(null, context.directory);
      }),
    }),
  )
  async enhance(
    @Req() request: Request,
    @UploadedFile() file?: { path: string },
  ) {
    const context = guestContexts.get(request);
    if (!file || !context)
      throw new BadRequestException('Image file is required');
    return this.guests.enhance(context, file.path);
  }

  @Get(':previewId/preview')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie, Origin')
  @Header('X-Content-Type-Options', 'nosniff')
  async preview(
    @Req() request: Request,
    @Param('previewId') id: string,
  ): Promise<StreamableFile> {
    const file = await this.guests.preview(request, id);
    return new StreamableFile(createReadStream(file), {
      type: 'image/jpeg',
      disposition: 'inline; filename="beautyscan-preview.jpg"',
    });
  }
}
