import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export type DescriptionLanguage = 'uz' | 'en' | 'ru' | 'ko';

@Injectable()
export class AiDescriptionService {
  private readonly client: OpenAI;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');

    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is missing');
    }

    this.client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
    });
  }

  async generateDescription(
    extractedText: string,
    language: DescriptionLanguage,
  ): Promise<string> {
    if (!extractedText?.trim()) {
      throw new BadRequestException('Extracted product text is required');
    }

    const languageNames: Record<DescriptionLanguage, string> = {
      uz: 'Uzbek',
      en: 'English',
      ru: 'Russian',
      ko: 'Korean',
    };

    if (!languageNames[language]) {
      throw new BadRequestException('Language must be uz, en, ru, or ko');
    }

    try {
      const response = await this.client.chat.completions.create({
        model: 'openai/gpt-4o-mini',

        messages: [
          {
            role: 'system',
            content: `
You create professional, accurate cosmetic product descriptions
for an online beauty store.

Write ONLY in ${languageNames[language]}.

IMPORTANT LANGUAGE RULE:
All section headings and descriptions must be written naturally
in the selected language.
Product names, brand names, and official ingredient names may remain
in their original form when appropriate.

Use ONLY information clearly supported by the package text.

Never invent:
- ingredients
- benefits
- medical claims
- certifications
- country of manufacture
- volume
- usage instructions
- product properties

Create a clean, attractive and easy-to-read description.

Use these sections when the information exists:

1. Product name

2. Benefits
Explain clearly what the product is used for and its supported benefits.

3. Key ingredients
List only important ingredients explicitly found in the package text.

4. How to use
Explain the usage instructions clearly and naturally.

5. Volume
Show the product size or volume.

6. Made in
Show the country of manufacture only when explicitly stated.

IMPORTANT:
Translate the section headings naturally into the selected language.

Include a section ONLY when its information is clearly supported
by the package text.

If information is missing, unclear, or cannot be verified,
OMIT the entire section.

Never write "Not specified".
Never guess missing information.
Never add unsupported marketing or medical claims.

Do not translate brand names or official product names unnecessarily.

Make the final result suitable for a cosmetics seller
to copy and use directly in an online shop or social media post.
`.trim(),
          },
          {
            role: 'user',
            content: extractedText,
          },
        ],

        temperature: 0.2,
      });

      const description = response.choices[0]?.message?.content?.trim();

      if (!description) {
        throw new Error('AI returned an empty description');
      }

      return description;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      console.error('AI description generation error:', error);

      throw new InternalServerErrorException(
        'Failed to generate product description',
      );
    }
  }
}
