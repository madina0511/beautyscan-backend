import {
  groundDescription,
  hasMeaningfulDescription,
} from './description-grounding';
import { supportedDescription } from './description-evidence';

describe('Meaningful output gate (synthetic packaging evidence)', () => {
  it('accepts a supported introduction without requiring a duplicate benefits list', () => {
    const source =
      'Product name: Example Mask\nBenefits: Helps retain moisture.';
    const text = '# Example Mask\n\nHelps retain moisture.';
    const supported = supportedDescription(
      JSON.stringify({
        description: text,
        evidence: [
          {
            text: 'Helps retain moisture.',
            quotes: ['Helps retain moisture.'],
          },
        ],
      }),
      source,
    );
    expect(
      hasMeaningfulDescription(
        groundDescription(supported, source, 'en'),
        source,
      ),
    ).toBe(true);
  });
  it('accepts cited benefit bullets without requiring an ingredient list or invented introduction', () => {
    const source =
      'Product name: Example Mask\nBenefits: Helps retain moisture.';
    const text = '# Example Mask\n\n## Key benefits\n- Helps retain moisture.';
    const supported = supportedDescription(
      JSON.stringify({
        description: text,
        evidence: [
          {
            text: '- Helps retain moisture.',
            quotes: ['Helps retain moisture.'],
          },
        ],
      }),
      source,
    );
    expect(
      hasMeaningfulDescription(
        groundDescription(supported, source, 'en'),
        source,
      ),
    ).toBe(true);
  });
  it.each(['uz', 'en', 'ko', 'ru'] as const)(
    'rejects metadata-only results in %s',
    (language) => {
      for (const source of [
        '30 mL/1.01 fl. oz.',
        'Product name: Example Cream\nVolume: 30 mL',
        'Manufacturer: Example Lab\nVolume: 30 mL',
        'Unclear text',
      ]) {
        expect(
          hasMeaningfulDescription(
            groundDescription('', source, language),
            source,
          ),
        ).toBe(false);
      }
    },
  );

  it.each(['uz', 'en', 'ko', 'ru'] as const)(
    'preserves verified identity and ingredients despite rejected model prose in %s',
    (language) => {
      const source =
        '제품명\nExample\nCream\n전성분\n글리세린, 판테놀\nVolume: 30 mL';
      const supported = supportedDescription(
        JSON.stringify({
          description: '# Example Cream\nGuaranteed whitening',
          evidence: [],
        }),
        source,
      );
      const result = groundDescription(supported, source, language);
      expect(result).toContain('# Example Cream');
      expect(result).toContain('글리세린');
      expect(result).toContain('판테놀');
      expect(result).not.toContain('whitening');
      expect(hasMeaningfulDescription(result, source)).toBe(true);
    },
  );

  it('retains translated supported benefits and original concentrations without inventing other facts', () => {
    const source =
      'Product name: Example Cream\nIngredients: Panthenol 2%\nBenefits: Helps retain moisture.';
    const line = 'Namlikni saqlashga yordam beradi.';
    const cited = supportedDescription(
      JSON.stringify({
        description: `# Example Cream\n\n${line}`,
        evidence: [{ text: line, quotes: ['Helps retain moisture.'] }],
      }),
      source,
    );
    const result = groundDescription(cited, source, 'uz');
    expect(result).toContain(line);
    expect(result).toContain('Panthenol: 2%');
    expect(hasMeaningfulDescription(result, source)).toBe(true);
    expect(result).not.toMatch(/Korea|Made in|daily use|10%/);
  });
});
