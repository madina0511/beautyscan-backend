import { Logger } from '@nestjs/common';
import { unlink } from 'fs/promises';
import { resolve, relative, isAbsolute } from 'path';

const logger = new Logger('UploadCleanup');

export async function cleanupUpload(filePath: string): Promise<void> {
  const relativePath = relative(resolve('uploads'), resolve(filePath));
  if (
    relativePath.startsWith('..') ||
    isAbsolute(relativePath) ||
    !relativePath
  ) {
    logger.error('Refused cleanup outside the uploads directory');
    return;
  }
  try {
    await unlink(filePath);
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return;
    logger.error('Failed to remove an upload file');
  }
}
