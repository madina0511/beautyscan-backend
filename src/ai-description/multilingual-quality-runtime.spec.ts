import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiDescriptionService } from './ai-description.service';
import { productName } from './fixtures/anua-regressions';
import {
  retailCopies,
  retailResponse,
  retailSource,
} from './fixtures/multilingual-retail-copy';

const mockCreate = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

describe('Runtime multilingual copy quality diagnostics', () => {
  let log: jest.SpyInstance;
  let service: AiDescriptionService;
  beforeEach(() => {
    mockCreate.mockReset();
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    service = new AiDescriptionService(
      new ConfigService({ OPENROUTER_API_KEY: 'test-only' }),
    );
  });
  afterEach(() => log.mockRestore());

  it.each(['uz', 'en', 'ko', 'ru'] as const)(
    'retains developed %s copy through the provider/evidence/grounding pipeline',
    async (language) => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: retailResponse(language, true) },
          },
        ],
      });
      const result = await service.generateDescription(retailSource, language);
      expect(result).toContain(retailCopies[language].intro.join(' '));
      expect(result).toContain(retailCopies[language].role);
      expect(result).not.toContain(retailCopies[language].unsupported);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const summary = log.mock.calls[0][0];
      expect(summary).toMatchObject({
        meaningful: true,
        quality: {
          level: 'developed',
          introductionSentences: 2,
          underdeveloped: false,
        },
        filtering: { unsupportedBenefit: 1 },
      });
      expect(JSON.stringify(summary)).not.toContain(productName);
      expect(JSON.stringify(summary)).not.toContain(
        retailCopies[language].role,
      );
      expect(JSON.stringify(summary)).not.toContain('test-only');
      expect(JSON.stringify(summary)).not.toContain('Ingredients:');
    },
  );

  it('keeps minimum meaningful status separate from a facts-only quality warning', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              description: `# ${productName}`,
              evidence: [],
            }),
          },
        },
      ],
    });
    await expect(
      service.generateDescription(retailSource, 'uz'),
    ).resolves.toContain(productName);
    expect(log.mock.calls[0][0]).toMatchObject({
      meaningful: true,
      quality: {
        level: 'facts_only',
        introductionSentences: 0,
        underdeveloped: true,
      },
    });
  });

  it('records presentation-equivalent quotes separately from invalid source quotes', async () => {
    const payload = JSON.parse(retailResponse('uz')) as {
      description: string;
      evidence: { text: string; quotes: string[] }[];
    };
    payload.evidence[1].quotes = ['NIACINAMIDE, TRANEXAMIC ACID'];
    payload.evidence[2].quotes = ['not in this packaging'];
    mockCreate.mockResolvedValue({
      choices: [
        {
          finish_reason: 'stop',
          message: { content: JSON.stringify(payload) },
        },
      ],
    });
    await service.generateDescription(retailSource, 'uz');
    expect(log.mock.calls[0][0]).toMatchObject({
      evidence: { presentationMatches: 1, invalidQuotes: 1 },
    });
    expect(JSON.stringify(log.mock.calls[0][0])).not.toContain(
      'not in this packaging',
    );
  });
});
