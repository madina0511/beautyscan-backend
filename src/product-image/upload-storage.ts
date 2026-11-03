import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request } from 'express';
import { diskStorage, StorageEngine } from 'multer';
import { catchError, from, Observable } from 'rxjs';
import { cleanupUpload } from './upload-cleanup.util';

interface UploadState {
  pending: Promise<void>[];
  paths: string[];
  failed: boolean;
}
const states = new WeakMap<Request, UploadState>();
function stateFor(request: Request): UploadState {
  let state = states.get(request);
  if (!state) {
    state = { pending: [], paths: [], failed: false };
    states.set(request, state);
  }
  return state;
}

export function temporaryImageStorage(
  destination: NonNullable<Parameters<typeof diskStorage>[0]>['destination'],
): StorageEngine {
  const storage = diskStorage({
    destination,
    filename: (_request, _file, callback) =>
      callback(null, `${randomUUID()}.upload`),
  });
  return {
    _handleFile(request, file, callback) {
      const state = stateFor(request);
      let complete: () => void = () => undefined;
      state.pending.push(
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
      );
      storage._handleFile(request, file, (error, info) => {
        if (typeof info?.path === 'string') state.paths.push(info.path);
        // Field/part errors may happen before the disk-storage callback finishes.
        const finish = async (): Promise<void> => {
          if (state.failed && info?.path) await cleanupUpload(info.path);
          try {
            callback(error, info);
          } finally {
            complete();
          }
        };
        void finish();
      });
    },
    _removeFile: (request, file, callback) =>
      storage._removeFile(request, file, callback),
  };
}

@Injectable()
export class UploadFailureCleanupInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    return next
      .handle()
      .pipe(
        catchError((error: unknown) =>
          from(this.cleanupAndThrow(request, error)),
        ),
      );
  }

  private async cleanupAndThrow(
    request: Request,
    error: unknown,
  ): Promise<never> {
    const state = stateFor(request);
    state.failed = true;
    await Promise.all(state.pending);
    await Promise.all(state.paths.map(cleanupUpload));
    throw error;
  }
}
