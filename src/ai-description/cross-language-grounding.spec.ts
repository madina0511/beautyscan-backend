import {
  groundDescription,
  extractPackagingFacts,
} from './description-grounding';
import { supportedDescription } from './description-evidence';
import { extractPackagingIngredients } from './packaging-ingredients';

// SYNTHETIC OCR, not the user's private image or an actual provider response.
const source =
  '제품명\nExample Cream\n전성분\n정제수, 글리세린\n용량\n30 mL\n제조업자\nExample Lab, Seoul';

describe('Cross-language empty-grounding regression (synthetic OCR)', () => {
  it.each(['uz', 'en', 'ru', 'ko'] as const)(
    'retains independently verified facts after all model prose is rejected: %s',
    (language) => {
      const supported = supportedDescription(
        JSON.stringify({
          description:
            '# Translated invented name\n## Product information\n- Country of manufacture: Korea\n- Fast absorbing',
          evidence: [],
        }),
        source,
      );
      const result = groundDescription(supported, source, language);
      expect(result).toContain('# Example Cream');
      expect(result).toContain('30 mL');
      expect(result).toContain('글리세린');
      expect(result).toContain('Example Lab, Seoul');
      expect(result).not.toMatch(/Korea|absorbing|invented|10%|Niacinamide/);
    },
  );

  it.each([
    ['uz', '- glitserin'],
    ['en', '- Glycerin'],
    ['ru', '- глицерин'],
    ['ko', '- 글리세린'],
  ] as const)(
    'accepts a translated ingredient backed by current Korean OCR: %s',
    (language, line) => {
      const supported = supportedDescription(
        JSON.stringify({
          description: line,
          evidence: [{ text: line, quotes: ['글리세린'] }],
        }),
        source,
      );
      expect(groundDescription(supported, source, language)).toContain(line);
    },
  );

  it('accepts short complete Korean quotes and block citations without translating source evidence', () => {
    const result = supportedDescription(
      JSON.stringify({
        description: '- Water\n- Glycerin',
        evidence: [
          { text: '- Water\n- Glycerin', quotes: ['정제수', '글리세린'] },
        ],
      }),
      source,
    );
    expect(result).toBe('- Water\n- Glycerin');
    expect(
      supportedDescription(
        JSON.stringify({
          description: 'Water',
          evidence: [{ text: 'Water', quotes: ['제수'] }],
        }),
        source,
      ),
    ).toBe('');
  });

  it('normalizes Unicode presentation only, retaining exact source-word requirements', () => {
    expect(
      supportedDescription(
        JSON.stringify({
          description: '- Glycerin 2%',
          evidence: [{ text: '- Glycerin 2%', quotes: ['Glycerin 2%'] }],
        }),
        'Ingredients: Glycerin ２％',
      ),
    ).toBe('- Glycerin 2%');
    expect(
      supportedDescription(
        JSON.stringify({
          description: 'Glycerin',
          evidence: [{ text: 'Glycerin', quotes: ['Glycerin'] }],
        }),
        '전성분: 글리세린',
      ),
    ).toBe('');
  });

  it('stops ingredient extraction at metadata and never infers origin from an address', () => {
    expect(
      extractPackagingIngredients(source).map((item) => item.ingredient),
    ).toEqual(['정제수', '글리세린']);
    expect(extractPackagingFacts(source)).toEqual({
      name: 'Example Cream',
      volume: '30 mL',
      manufacturer: 'Example Lab, Seoul',
    });
    expect(
      extractPackagingFacts('Manufacturer\nDistributor\nExample Seller')
        .manufacturer,
    ).toBeUndefined();
    expect(
      extractPackagingFacts('Volume: 30 mL\nVolume\n50 mL').volume,
    ).toBeUndefined();
  });
  it('handles a different product and source language without importing ingredient or manufacturing facts', () => {
    const cleanser =
      'Состав\nГлицерин, Пантенол\nИмпортёр\nExample Import, Seoul\n50 мл';
    const result = groundDescription('', cleanser, 'uz');
    expect(result).toContain('50 мл');
    expect(result).toContain('Пантенол');
    expect(result).not.toMatch(
      /정제수|글리세린|Example Cream|Example Lab|Korea|niatsinamid|10%/,
    );
    expect(
      extractPackagingIngredients(cleanser).map((item) => item.ingredient),
    ).toEqual(['Глицерин', 'Пантенол']);
  });

  it('still fails closed with no independently verifiable facts', () => {
    expect(
      groundDescription('# Invented title', 'Unreadable fragment', 'uz'),
    ).toBe('');
    expect(groundDescription('', 'Distributor address: Seoul', 'uz')).toBe('');
  });
  it('verifies a product name across OCR line wraps without accepting a translated or embellished name', () => {
    expect(
      groundDescription(
        '# Example Beauty Cream',
        'Example Beauty\nCream',
        'uz',
      ),
    ).toBe('# Example Beauty Cream');
    expect(
      groundDescription(
        '# Example Beauty Cream 10%',
        'Example Beauty\nCream',
        'uz',
      ),
    ).toBe('');
  });
});
