import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { ImageAnnotatorClient } from '@google-cloud/vision';

@Injectable()
export class OcrService {
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
        throw new BadRequestException('No text could be detected in the image');
      }

      return text;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      console.error('Google Vision OCR error:', error);

      throw new InternalServerErrorException(
        'Failed to extract text from image',
      );
    }
  }
}
