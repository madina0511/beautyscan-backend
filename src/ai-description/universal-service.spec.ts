import { Logger } from '@nestjs/common';
import { extractPackagingIngredients } from './packaging-ingredients';
import { ConfigService } from '@nestjs/config';
import { AiDescriptionService } from './ai-description.service';
import { cosmeticsProducts } from './fixtures/cosmetics-products';
import { syntheticVerifiedOcr, productName } from './fixtures/anua-regressions';

const mockCreate = jest.fn();
beforeAll(() =>
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
);
afterAll(() => jest.restoreAllMocks());
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));
const completion = (description: string, source: string) => ({
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          description,
          evidence: description
            .split('\n')
            .filter((line) => line.trim() && !line.startsWith('#'))
            .map((text) => ({ text, quotes: [source.slice(0, 500)] })),
        }),
      },
    },
  ],
});

describe('Stateless description generation across products', () => {
  let service: AiDescriptionService;
  beforeEach(() => {
    mockCreate.mockReset();
    service = new AiDescriptionService(
      new ConfigService({ OPENROUTER_API_KEY: 'fixture' }),
    );
  });
  it.each(cosmeticsProducts)(
    'does not send or accept prior product evidence for the next $category',
    async (product) => {
      mockCreate.mockResolvedValueOnce(
        completion(`# ${productName}`, syntheticVerifiedOcr),
      );
      await service.generateDescription(syntheticVerifiedOcr, 'en');
      const stale = `# ${productName}\n\nANUA contains Niacinamide 10% and Tranexamic Acid 4%.\n\n## Product information\n- Manufacturer: Cosmax Inc.\n- Country of manufacture: Republic of Korea`;
      mockCreate.mockResolvedValueOnce(completion(stale, syntheticVerifiedOcr));
      if (!extractPackagingIngredients(product.source).length) {
        await expect(
          service.generateDescription(product.source, product.language),
        ).rejects.toMatchObject({
          status: 422,
          response: { code: 'PACKAGING_INFORMATION_INSUFFICIENT' },
        });
        expect(mockCreate.mock.calls[1][0].messages[1].content).toBe(
          product.source,
        );
        return;
      }
      const result = await service.generateDescription(
        product.source,
        product.language,
      );
      expect(result.split('\n')[0]).toBe(`# ${product.name}`);
      expect(result).not.toMatch(
        /ANUA|Niacinamide|Tranexamic|Cosmax|The Founders|10%/,
      );
      const request = mockCreate.mock.calls[1][0] as {
        messages: { role: string; content: string }[];
        response_format: unknown;
      };
      expect(request.messages).toHaveLength(2);
      expect(request.messages[1]).toEqual({
        role: 'user',
        content: product.source,
      });
      expect(request.messages[0].content).not.toMatch(
        /ANUA|Cosmax|The Founders|NIACINAMIDE 10 TXA4/,
      );
      expect(request.response_format).toEqual({ type: 'json_object' });
      expect(mockCreate).toHaveBeenCalledTimes(2);
    },
  );
  it('keeps concurrent products independent when provider responses finish in reverse order', async () => {
    const products = [cosmeticsProducts[0], cosmeticsProducts[4]];
    const finishers: ((value: ReturnType<typeof completion>) => void)[] = [];
    mockCreate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishers.push(resolve);
        }),
    );
    const first = service.generateDescription(
      products[0].source,
      products[0].language,
    );
    const second = service.generateDescription(
      products[1].source,
      products[1].language,
    );
    finishers[1](completion(`# ${products[1].name}`, products[1].source));
    const secondResult = await second;
    finishers[0](completion(`# ${products[0].name}`, products[0].source));
    const firstResult = await first;
    expect(firstResult).toContain('0.2%');
    expect(firstResult).not.toContain('15%');
    expect(secondResult).toContain('15%');
    expect(secondResult).not.toContain('0.2%');
    expect(firstResult.split('\n')[0]).toBe(`# ${products[0].name}`);
    expect(secondResult.split('\n')[0]).toBe(`# ${products[1].name}`);
  });
  it('uses one current-source completion and still returns the existing string API', async () => {
    const product = cosmeticsProducts[1];
    const copy = `# ${product.name}\n\nPanthenol 2% and Glycerin 5%.`;
    mockCreate.mockResolvedValueOnce(completion(copy, product.source));
    const result = await service.generateDescription(product.source, 'uz');
    expect(typeof result).toBe('string');
    expect(result).not.toContain('"evidence"');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
