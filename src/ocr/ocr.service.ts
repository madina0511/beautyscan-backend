import {
  Injectable,
  ServiceUnavailableException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ImageAnnotatorClient } from '@google-cloud/vision';

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private readonly visionClient: ImageAnnotatorClient;

  constructor() {
    this.visionClient = new ImageAnnotatorClient();
  }

  async extractText(imagePath: string): Promise<string> {
    if (!imagePath) {
      throw new BadRequestException('Image is required');
    }

    try {
      const [result] = await this.visionClient.documentTextDetection(imagePath);

      const text = result.fullTextAnnotation?.text?.trim();

      if (!text) {
        throw new BadRequestException({
          code: 'OCR_NO_TEXT',
          message: 'No text could be detected in the image',
        });
      }

      return text;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.warn('Google Vision text extraction failed');

      throw new ServiceUnavailableException({
        code: 'OCR_UNAVAILABLE',
        message: 'Failed to extract text from image',
      });
    }
  }
}
