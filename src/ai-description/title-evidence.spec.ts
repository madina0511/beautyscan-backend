import { extractPackagingIngredients } from './packaging-ingredients';
import {
  groundDescription,
  hasMeaningfulDescription,
  descriptionGroundingDiagnostics,
} from './description-grounding';
import { supportedDescription } from './description-evidence';

// Synthetic OCR only. These are not transcriptions of the user's private photo.
const fixtures = [
  {
    title: 'Example NIACINAMIDE 10 TXA 4 DARK SPOT CORRECTING SERUM',
    source:
      'Example\nNIACINAMIDE 10 TXA 4\nDARK SPOT CORRECTING SERUM\nVolume: 30 mL\nMade in Korea',
    names: ['niacinamide', 'tranexamic acid'],
  },
  {
    title: 'Example RETINOL2 Cream',
    source: 'Product name: Example RETINOL2 Cream\nVolume: 45 g',
    names: ['retinol'],
  },
  {
    title: 'Example 판테놀 크림',
    source: '제품명: Example 판테놀 크림\n용량: 50 mL',
    names: ['panthenol'],
  },
  {
    title: 'Пример глицерин крем',
    source: 'Название продукта: Пример глицерин крем\nОбъём: 40 мл',
    names: ['glycerin'],
  },
];

describe('Current-product title evidence without a full INCI list', () => {
  it('verifies emphasis/case differences and OCR wraps while preserving exact source words and numerals', () => {
    const source = fixtures[0].source;
    const result = groundDescription(
      '# **Example Niacinamide 10 TXA 4 Dark Spot Correcting Serum**',
      source,
      'uz',
    );
    expect(result).toContain(`# ${fixtures[0].title}`);
    expect(hasMeaningfulDescription(result, source)).toBe(true);
    expect(
      groundDescription(
        '# Example Niacinamide 10% TXA 4% Dark Spot Correcting Serum',
        source,
        'uz',
      ),
    ).not.toContain('10%');
  });
  it.each([
    ['en', 'Example Mask', 'Helps retain moisture.'],
    ['uz', 'Namuna Niqob', 'Namlikni saqlashga yordam beradi.'],
    ['ru', 'Пример маски', 'Увлажняет кожу.'],
    ['ko', 'Example 마스크', '수분을 유지하는 데 도움을 줍니다.'],
  ] as const)(
    'recognizes a literal unlabelled claim in %s OCR',
    (language, title, claim) => {
      const source = `Product name: ${title}\n${claim}`;
      const supported = supportedDescription(
        JSON.stringify({
          description: `# ${title}\n${claim}`,
          evidence: [{ text: claim, quotes: [claim] }],
        }),
        source,
      );
      expect(
        hasMeaningfulDescription(
          groundDescription(supported, source, language),
          source,
        ),
      ).toBe(true);
    },
  );
  it.each(['uz', 'en', 'ko', 'ru'] as const)(
    'retains title aliases in %s without inventing percentages or a full ingredient list',
    (language) => {
      for (const fixture of fixtures) {
        const description = groundDescription(
          `# ${fixture.title}`,
          fixture.source,
          language,
        );
        expect(hasMeaningfulDescription(description, fixture.source)).toBe(
          true,
        );
        expect(description).toContain(`# ${fixture.title}`);
        for (const name of fixture.names)
          expect(description.toLowerCase()).toContain(name);
        expect(description).not.toMatch(/%|clinically|guarantee|Cosmax/);
        expect(extractPackagingIngredients(fixture.source)).toEqual([]);
        expect(
          descriptionGroundingDiagnostics(description, fixture.source),
        ).toMatchObject({
          recognizedProductIdentity: 1,
          listedIngredients: 0,
          recognizedIngredientAliases: fixture.names.length,
        });
      }
    },
  );

  it.each([
    [
      'en',
      'Example Cleanser',
      'Apply to wet skin.',
      'Directions',
      'How to use',
    ],
    [
      'uz',
      'Namuna Krem',
      'Toza teriga surting.',
      'Qo‘llash usuli',
      'Qo‘llash usuli',
    ],
    ['ko', 'Example 크림', '깨끗한 피부에 바릅니다.', '사용법', '사용법'],
    [
      'ru',
      'Пример крем',
      'Нанесите на чистую кожу.',
      'Способ применения',
      'Способ применения',
    ],
  ] as const)(
    'accepts product type plus cited source directions without ingredients in %s',
    (language, title, directions, label, heading) => {
      const source = `Product name: ${title}\n${label}: ${directions}`;
      const text = `# ${title}\n\n## ${heading}\n${directions}`;
      const cited = supportedDescription(
        JSON.stringify({
          description: text,
          evidence: [{ text: directions, quotes: [directions] }],
        }),
        source,
      );
      const result = groundDescription(cited, source, language);
      expect(hasMeaningfulDescription(result, source)).toBe(true);
      expect(result).toContain(directions);
    },
  );

  it('retains cited benefits without requiring an ingredient list', () => {
    const source =
      'Product name: Example Toner\nBenefits: Helps retain moisture.';
    const line = 'Namlikni saqlashga yordam beradi.';
    const cited = supportedDescription(
      JSON.stringify({
        description: `# Example Toner\n${line}`,
        evidence: [{ text: line, quotes: ['Helps retain moisture.'] }],
      }),
      source,
    );
    expect(
      hasMeaningfulDescription(groundDescription(cited, source, 'uz'), source),
    ).toBe(true);
  });
  it.each(['uz', 'en', 'ko', 'ru'] as const)(
    'recognizes an unlabelled explicit source claim for %s copy',
    (language) => {
      const source = 'Product name: Example Mask\nHelps retain moisture.';
      const copy = {
        uz: 'Namlikni saqlashga yordam beradi.',
        en: 'Helps retain moisture.',
        ko: '수분 유지에 도움을 줍니다.',
        ru: 'Помогает удерживать влагу.',
      }[language];
      const text = `# Example Mask\n${copy}`;
      const cited = supportedDescription(
        JSON.stringify({
          description: text,
          evidence: [{ text: copy, quotes: ['Helps retain moisture.'] }],
        }),
        source,
      );
      const result = groundDescription(cited, source, language);
      expect(result).toContain(copy);
      expect(hasMeaningfulDescription(result, source)).toBe(true);
      expect(
        descriptionGroundingDiagnostics(result, source).supportedClaims,
      ).toBe(1);
    },
  );

  it('rejects volume-only, type-only and identity-only copy', () => {
    for (const source of [
      '30 mL',
      'Product name: Example Serum\nVolume: 30 mL',
      'Product name: Example',
    ]) {
      expect(
        hasMeaningfulDescription(groundDescription('', source, 'uz'), source),
      ).toBe(false);
    }
  });

  it('does not promote unrelated mentions, negations or a stale title into ingredient evidence', () => {
    const source =
      'Product name: Example Cleanser\nWarning: Do not use with retinol.';
    expect(extractPackagingIngredients(source, 'Example Cleanser')).toEqual([]);
    expect(
      extractPackagingIngredients(source, 'Example Retinol Cream'),
    ).toEqual([]);
    for (const title of [
      'Example Retinol-free Cream',
      'Example without retinol Cream',
      'Пример без ретинола крем',
      'Example 레티놀 무첨가 크림',
    ]) {
      expect(
        extractPackagingIngredients(`Product name: ${title}`, title),
      ).toEqual([]);
    }
  });

  it('logs counts rather than source values, including rejected ambiguous fields', () => {
    const source =
      'Product name: Example Cream\nMade in Korea\nMade in France\nManufacturer: Private Company';
    const counts = descriptionGroundingDiagnostics('# Example Cream', source);
    expect(counts.rejectedFields).toBe(1);
    expect(
      Object.values(counts).every((value) => typeof value === 'number'),
    ).toBe(true);
    expect(JSON.stringify(counts)).not.toMatch(/Private|Korea|France/);
  });
});
