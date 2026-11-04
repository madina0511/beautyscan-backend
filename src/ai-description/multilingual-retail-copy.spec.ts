import { supportedDescription, VerifiedCitation } from './description-evidence';
import {
  groundDescription,
  hasMeaningfulDescription,
} from './description-grounding';
import { descriptionCopyQuality } from './description-copy-quality';
import { packagingPurposes } from './packaging-copy-evidence';
import {
  ingredientMentionsSupported,
  ingredientPercentagesSupported,
  extractPackagingIngredients,
} from './packaging-ingredients';
import { productName } from './fixtures/anua-regressions';
import { cosmeticsProducts } from './fixtures/cosmetics-products';
import {
  retailCopies,
  retailResponse,
  retailSource,
} from './fixtures/multilingual-retail-copy';

function processCopy(
  payload: string,
  source: string,
  language: 'uz' | 'en' | 'ko' | 'ru',
) {
  const citations: VerifiedCitation[] = [];
  const supported = supportedDescription(payload, source, undefined, citations);
  const grounded = groundDescription(supported, source, language, citations);
  return {
    grounded,
    citations,
    quality: descriptionCopyQuality(grounded, source, citations),
  };
}

describe('Multilingual retail copy retention and claim boundaries', () => {
  it.each([
    'Cures acne.',
    'It has a lightweight texture.',
    'Suitable for sensitive skin.',
    'Apply twice daily.',
    'Har kuni ikki marta surting.',
    '여드름을 치료합니다.',
    '민감한 피부에 적합합니다.',
    'Лечит акне.',
    'Подходит для чувствительной кожи.',
  ])(
    'removes unsupported efficacy, sensory, suitability and usage claims without padding (%s)',
    (bad) => {
      const source =
        'Product name: Example Moisture Cream\nBenefits: Moisture care.\nIngredients: Glycerin';
      const supported = 'A cream for moisture care.';
      const payload = JSON.stringify({
        description: `# Example Moisture Cream\n\n${supported}\n\n${bad}`,
        evidence: [
          { text: supported, quotes: ['Moisture care.'] },
          { text: bad, quotes: ['Glycerin'] },
        ],
      });
      const { grounded } = processCopy(payload, source, 'en');
      expect(grounded).toContain(supported);
      expect(grounded).not.toContain(bad);
    },
  );
  it('accepts grammatical ingredient/percentage forms only with an explicit ingredient-bound concentration', () => {
    const inventory = extractPackagingIngredients(
      'Ingredients: Niacinamide 10%, Tranexamic Acid 4%',
    );
    expect(
      ingredientPercentagesSupported(
        '나이아신아마이드가 10% 함유되어 있습니다.',
        inventory,
      ),
    ).toBe(true);
    expect(
      ingredientPercentagesSupported('Niatsinamidning 10% miqdori.', inventory),
    ).toBe(true);
    expect(
      ingredientPercentagesSupported(
        '나이아신아마이드가 4% 함유되어 있습니다.',
        inventory,
      ),
    ).toBe(false);
    expect(
      ingredientPercentagesSupported(
        '나이아신아마이드가 10% 함유되어 있습니다.',
        extractPackagingIngredients(retailSource, productName),
      ),
    ).toBe(false);
  });
  it.each(['uz', 'en', 'ko', 'ru'] as const)(
    'retains a connected ANUA example introduction and separately qualified ingredient information in %s',
    (language) => {
      const copy = retailCopies[language];
      const { grounded, quality } = processCopy(
        retailResponse(language),
        retailSource,
        language,
      );
      expect(grounded).toContain(copy.intro.join(' '));
      expect(grounded).toContain(copy.qualifier);
      expect(grounded).toContain(copy.role);
      expect(grounded).not.toMatch(/10%|4%|clinically|Cosmax|The Founders/);
      expect(quality).toMatchObject({
        level: 'developed',
        introductionSentences: 2,
        underdeveloped: false,
      });
    },
  );

  it.each(['uz', 'en', 'ko', 'ru'] as const)(
    'drops a source-unsupported hydration claim without deleting adjacent supported %s sentences',
    (language) => {
      const { grounded } = processCopy(
        retailResponse(language, true),
        retailSource,
        language,
      );
      expect(grounded).toContain(retailCopies[language].intro.join(' '));
      expect(grounded).not.toContain(retailCopies[language].unsupported);
      expect(grounded).toContain(retailCopies[language].role);
    },
  );

  it.each(['uz', 'en', 'ko', 'ru'] as const)(
    'does not turn a general ingredient role into a verified product benefit in %s',
    (language) => {
      const source =
        'Product name: Example Niacinamide Serum\nIngredients: Niacinamide';
      const copy = retailCopies[language];
      const payload = JSON.stringify({
        description: `# Example Niacinamide Serum\n\n${copy.role}`,
        evidence: [{ text: copy.role, quotes: ['Ingredients: Niacinamide'] }],
      });
      expect(processCopy(payload, source, language).grounded).not.toContain(
        copy.role,
      );
    },
  );

  it.each([
    [
      'en',
      'A cream for moisture care.',
      'Its ingredient list names glycerin.',
      'General ingredient information',
      'This is general ingredient information, not a verified effect of the product.',
      'Glycerin is commonly used as a humectant in cosmetics.',
    ],
    [
      'uz',
      'Namlikni saqlashga qaratilgan parvarish kremi.',
      'Tarkibda glitserin qayd etilgan.',
      'Moddalar haqida umumiy ma’lumot',
      'Bu moddalarning umumiy kosmetik vazifalari haqidagi izoh, mahsulotning isbotlangan ta’siri emas.',
      'Glitserin kosmetikada namlikni saqlash uchun qo‘llanadi.',
    ],
    [
      'ko',
      '수분 케어를 위한 크림입니다.',
      '성분표에는 글리세린이 기재되어 있습니다.',
      '성분 일반 정보',
      '다음은 일반적인 성분 정보이며 제품의 효능을 입증하는 설명이 아닙니다.',
      '글리세린은 화장품에서 수분을 유지하는 성분으로 사용됩니다.',
    ],
    [
      'ru',
      'Крем для увлажняющего ухода.',
      'В составе указан глицерин.',
      'Общая информация об ингредиентах',
      'Это общая информация об ингредиентах, а не доказательство эффективности продукта.',
      'Глицерин используют в косметике для удерживания влаги.',
    ],
  ] as const)(
    'preserves rich %s copy for an unrelated moisture-care cream',
    (language, first, second, heading, qualifier, role) => {
      const source =
        'Product name: Example Moisture Cream\nBenefits: Moisture care.\nIngredients: Glycerin';
      const payload = JSON.stringify({
        description: `# Example Moisture Cream\n\n${first} ${second}\n\n## ${heading}\n${qualifier}\n${role}`,
        evidence: [
          { text: first, quotes: ['Moisture care.'] },
          { text: second, quotes: ['Glycerin'] },
          { text: qualifier, quotes: ['Glycerin'] },
          { text: role, quotes: ['Glycerin'] },
        ],
      });
      const { grounded } = processCopy(payload, source, language);
      expect(grounded).toContain(`${first} ${second}`);
      expect(grounded).toContain(role);
      expect(grounded).not.toMatch(/ANUA|niatsinamid|나이아신|TXA|10%|4%/);
    },
  );

  it.each(cosmeticsProducts)(
    'does not leak ANUA role facts into an unrelated $category',
    (product) => {
      const { grounded } = processCopy(
        retailResponse('en'),
        product.source,
        product.language,
      );
      expect(grounded).not.toMatch(
        /ANUA|niacinamide|tranexamic|Niacinamide|10%/,
      );
      for (const percentage of product.percentages)
        expect(grounded).toContain(percentage);
    },
  );

  it('reports facts-only copy separately from minimum meaningful/saveable content', () => {
    const sparseSource = 'Product name: Example Cream\nIngredients: Glycerin';
    const sparse = groundDescription('', sparseSource, 'en');
    expect(hasMeaningfulDescription(sparse, sparseSource)).toBe(true);
    expect(descriptionCopyQuality(sparse, sparseSource)).toMatchObject({
      level: 'facts_only',
      evidenceSupportsIntroduction: false,
      underdeveloped: false,
    });
    const richButRejected = groundDescription(
      `# ${productName}`,
      retailSource,
      'en',
    );
    expect(descriptionCopyQuality(richButRejected, retailSource)).toMatchObject(
      {
        level: 'facts_only',
        evidenceSupportsIntroduction: true,
        underdeveloped: true,
      },
    );
  });

  it('preserves a genuinely short supported description without a length quota', () => {
    const source = 'Product name: Example Mask\nBenefits: Moisture care.';
    const line = 'A mask for moisture care.';
    const { grounded, quality } = processCopy(
      JSON.stringify({
        description: `# Example Mask\n\n${line}`,
        evidence: [{ text: line, quotes: ['Moisture care.'] }],
      }),
      source,
      'en',
    );
    expect(grounded).toContain(line);
    expect(quality).toMatchObject({
      level: 'concise',
      introductionSentences: 1,
      underdeveloped: false,
    });
    expect(
      descriptionCopyQuality(
        groundDescription('', 'Product name: Example Mask\nVolume: 20 g', 'en'),
        'Product name: Example Mask\nVolume: 20 g',
      ).level,
    ).toBe('insufficient');
  });

  it('requires the cited claim, not unrelated ingredients, to support a product benefit', () => {
    const source =
      'Product name: Example Cream\nIngredients: Glycerin\nBenefits: Moisture care.';
    const line = 'This cream moisturizes skin.';
    const { grounded } = processCopy(
      JSON.stringify({
        description: `# Example Cream\n\n${line}`,
        evidence: [{ text: line, quotes: ['Glycerin'] }],
      }),
      source,
      'en',
    );
    expect(grounded).not.toContain(line);
  });

  it('does not treat negated purposes as positive evidence', () => {
    expect(
      packagingPurposes('Not intended for dark spots. Does not moisturize.'),
    ).toEqual([]);
    expect(packagingPurposes('보습 효과가 없습니다.')).toEqual([]);
    expect(packagingPurposes('Moisture care.')).toContain('moisture');
  });

  it.each(['레티놀은 주름 케어에 쓰입니다.', 'Retinolning kosmetik vazifasi.'])(
    'detects source-absent ingredient names with grammatical suffixes (%s)',
    (line) => {
      expect(
        ingredientMentionsSupported(
          line,
          extractPackagingIngredients('Ingredients: Glycerin'),
          false,
        ),
      ).toBe(false);
    },
  );

  it.each([
    'Glycerin is used in cosmetics for wrinkle care. This is general ingredient information.',
    'This product moisturizes skin. This is general ingredient information.',
    'Glycerin is used as a humectant.',
  ])(
    'does not let a general heading authorize an unreviewed role, product effect, or unqualified explanation (%s)',
    (line) => {
      const source = 'Product name: Example Cream\nIngredients: Glycerin';
      const payload = JSON.stringify({
        description: `# Example Cream\n\n## General ingredient information\n${line}`,
        evidence: [{ text: line, quotes: ['Glycerin'] }],
      });
      expect(processCopy(payload, source, 'en').grounded).not.toContain(line);
    },
  );
});
