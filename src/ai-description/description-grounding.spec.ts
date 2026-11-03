import {
  extractPackagingFacts,
  groundDescription,
  verifiedIngredientPercentages,
} from './description-grounding';
import {
  actualUzbekOutput,
  actualRussianOutput,
  productName,
  syntheticMinimalOcr,
  syntheticVerifiedOcr,
  syntheticCopy,
} from './fixtures/anua-regressions';

describe('Description grounding with actual generated regressions and SYNTHETIC OCR only', () => {
  it.each([
    ['uz', actualUzbekOutput],
    ['ru', actualRussianOutput],
  ] as const)(
    'does not use the actual %s generated output as product evidence',
    (language, output) => {
      const result = groundDescription(output, syntheticMinimalOcr, language);
      expect(result.split('\n')[0]).toBe(`# ${productName}`);
      expect(result).not.toMatch(
        /10%|4%|Cosmax|The Founders|30 mL|Корея|Koreya|Tashuvchi/,
      );
      expect(result).not.toContain('Teri yuzasiga mos miqdorda surting');
      expect(result).not.toContain('Нанесите необходимое количество');
      expect(result).not.toContain('Идеальный выбор');
      expect(result).not.toContain('ежедневного использования');
      expect(result).not.toContain('tez so‘riladigan');
      expect(result).not.toContain('осветлить кожу');
      expect(extractPackagingFacts(syntheticMinimalOcr)).toEqual({
        name: productName,
      });
    },
  );
  it.each(['uz', 'ru', 'ko', 'en'] as const)(
    'preserves explicit source facts and separate information lines in %s',
    (language) => {
      const result = groundDescription(
        syntheticCopy[language],
        syntheticVerifiedOcr,
        language,
      );
      const fields = result.split('\n').filter((line) => line.startsWith('- '));
      expect(result.split('\n')[0]).toBe(`# ${productName}`);
      for (const value of [
        'ANUA',
        'Cosmax Inc.',
        'The Founders Inc.',
        'Example Import LLC',
        'Example Distribution Ltd.',
        '30 mL / 1.01 fl. oz.',
        {
          uz: 'Janubiy Koreya',
          en: 'South Korea',
          ko: '대한민국',
          ru: 'Южная Корея',
        }[language],
        '10%',
        '4%',
      ]) {
        expect(
          fields.filter((line) => line.slice(line.indexOf(': ') + 2) === value),
        ).toHaveLength(1);
      }
      expect(result).toContain(syntheticCopy[language].split('\n')[2]);
      expect(result).not.toMatch(/Tashuvchi|Ответственный продавец/);
      expect(result).not.toContain('Способ применения');
      expect(result).not.toContain('Qo‘llash usuli');
    },
  );
  it('never upgrades product-name numbers into ingredient percentages', () => {
    expect(verifiedIngredientPercentages(syntheticMinimalOcr)).toEqual([]);
    const result = groundDescription(
      '# Invented 10% title\n\nNiacinamide 10% with TXA 4%.',
      syntheticMinimalOcr,
      'en',
    );
    expect(result).not.toContain('%');
    expect(result).toContain(productName);
  });
  it('rejects swapped or invented concentrations and preserves correctly associated values', () => {
    const output =
      '# ANUA\n\nNiacinamide 4% and TXA 10%.\n\nNiacinamide 99%.\n\nNiacinamide 10% and Tranexamic Acid 4%.';
    const result = groundDescription(output, syntheticVerifiedOcr, 'en');
    expect(result).not.toContain('Niacinamide 4%');
    expect(result).not.toContain('TXA 10%');
    expect(result).not.toContain('99%');
    expect(result).toContain('Niacinamide 10% and Tranexamic Acid 4%.');
    expect(
      verifiedIngredientPercentages('Niacinamide 10%\nNiacinamide 5%'),
    ).toEqual([]);
  });
  it('distinguishes every entity role and never assigns roles from bare company names', () => {
    const facts = extractPackagingFacts(syntheticVerifiedOcr);
    expect(facts).toMatchObject({
      manufacturer: 'Cosmax Inc.',
      responsibleSeller: 'The Founders Inc.',
      distributor: 'Example Distribution Ltd.',
      importer: 'Example Import LLC',
    });
    expect(
      extractPackagingFacts('Cosmax Inc.\nThe Founders Inc.\nSeoul, Korea'),
    ).toEqual({});
  });
  it.each([
    'Brand: Korean Brand\nManufacturer: Company Korea Ltd.\nDistributor: Seoul, Korea',
    'Made in Korea\nMade in France',
    'Made in Korea\nMade in Atlantis',
    'Country of manufacture: Unknown',
  ])(
    'omits missing, conflicting and ambiguous manufacturing origin: %s',
    (source) => {
      expect(extractPackagingFacts(source).origin).toBeUndefined();
      const result = groundDescription(
        '## Product information\n- Country of manufacture: Korea',
        source,
        'en',
      );
      expect(result).not.toContain('Country of manufacture:');
    },
  );
  it('requires explicit manufacturing evidence and preserves its exact source wording', () => {
    expect(
      extractPackagingFacts('Made in France\nDistributor: Company in Korea')
        .origin,
    ).toBe('France');
    expect(
      extractPackagingFacts('Made in Republic of Korea\n제조국: 대한민국')
        .origin,
    ).toBe('Republic of Korea');
  });
  it('removes unsupported texture, daily-use, clinical and guarantee claims across languages', () => {
    for (const [language, copy] of [
      [
        'en',
        'Ideal choice.\n\nFast absorbing.\n\nSuitable for daily use.\n\nClinically proven.\n\nGuaranteed skin whitening.',
      ],
      [
        'uz',
        'Ideal tanlov.\n\nTez so‘riladigan.\n\nHar kuni ishlating.\n\nPigment dog‘larini kamaytirishni kafolatlaydi.',
      ],
      [
        'ru',
        'Идеальный выбор.\n\nБыстро впитывается.\n\nПодходит для ежедневного использования.\n\nКлинически доказано.\n\nГарантирует результат.',
      ],
      [
        'ko',
        '완벽한 선택.\n\n빠르게 흡수됩니다.\n\n매일 사용하세요.\n\n임상 효과 입증.\n\n피부를 하얗게 합니다.',
      ],
    ] as const) {
      const result = groundDescription(
        copy,
        `Product name: Verified Serum`,
        language,
      );
      expect(result).not.toContain(copy.split('\n')[0]);
      const body = result.split('\n\n')[1];
      expect(body).toMatch(/^## /);
    }
  });
  it('deduplicates repeated sentences without deleting distinct factual detail', () => {
    const result = groundDescription(
      'A serum.\n\nA serum.\n\nA different detail.',
      '',
      'en',
    );
    expect(result.match(/A serum/g)).toHaveLength(1);
    expect(result).toContain('A different detail.');
  });
  it('requires source directions before allowing a usage section', () => {
    const copy =
      '## How to use\nApply as directed.\n\n## Product information\n- Brand: Invented';
    expect(
      groundDescription(copy, 'Product name: Example Serum', 'en'),
    ).not.toContain('Apply as directed');
    expect(
      groundDescription(
        copy,
        'Product name: Example Serum\nDirections: Apply as directed.',
        'en',
      ),
    ).toContain('Apply as directed.');
  });
  it('keeps supported wording but removes the same stock claims without source evidence', () => {
    const copy =
      '## Key benefits\n- Fast absorbing.\n\n## How to use\nApply as directed.';
    const supported = groundDescription(
      copy,
      'Benefits: Fast absorbing.\nDirections: Apply as directed.',
      'en',
    );
    const unsupported = groundDescription(copy, 'Ingredients: Aqua', 'en');
    expect(supported).toContain('Fast absorbing.');
    expect(supported).toContain('Apply as directed.');
    expect(unsupported).not.toContain('Fast absorbing.');
    expect(unsupported).not.toContain('Apply as directed.');
  });
  it('omits conflicting product facts rather than resolving them using model text', () => {
    const source =
      'Product name: First Serum\nProduct name: Second Serum\nVolume: 30 mL\nVolume: 50 mL';
    expect(extractPackagingFacts(source)).toEqual({});
    expect(groundDescription('# First Serum', source, 'en')).toBe('');
  });
  it('uses the requested terminology without rewriting the official product name', () => {
    const source =
      'Product name: Niacinamide Official Serum\nIngredients: Niacinamide, Tranexamic Acid\nBenefits: Appearance of uneven skin tone.';
    const output =
      '# Rewritten title\n\n## Moddalar haqida umumiy ma’lumot\nNiacinamide va tranexamik kislota terining tonusini yaxshilash uchun kosmetikada qo‘llanadi. Bu pigment dog‘lari haqida umumiy ma’lumot.';
    const result = groundDescription(output, source, 'uz');
    expect(result.split('\n')[0]).toBe('# Niacinamide Official Serum');
    expect(result).toContain('niatsinamid');
    expect(result).toContain('traneksamik kislota');
    expect(result).toContain('teri rangini bir tekis ko‘rsatish');
  });
  it('omits contradictory concentrations and expanded usage instead of guessing', () => {
    expect(
      groundDescription(
        'Niacinamide 10%.',
        'Niacinamide 10%\nNiacinamide 5%',
        'en',
      ),
    ).not.toContain('10%');
    expect(
      groundDescription(
        '## How to use\nApply twice daily.',
        'Directions: Apply as directed.',
        'en',
      ),
    ).not.toContain('twice daily');
  });
  it('deduplicates sentences shared between a paragraph and a list', () => {
    const paragraph = groundDescription(
      'A serum. A different detail.\n\n- A serum.',
      '',
      'en',
    );
    expect(paragraph.match(/A serum/g)).toHaveLength(1);
    expect(paragraph).toContain('A different detail.');
  });
  it('does not attach an unrelated source percentage to a new ingredient', () => {
    const result = groundDescription('Vitamin C 10%.', 'Niacinamide 10%', 'en');
    expect(result).not.toContain('Vitamin C');
    expect(result).toContain('Niacinamide: 10%');
    expect(groundDescription('Vitamin C 3%.', 'Vitamin C 3%', 'en')).toContain(
      'Vitamin C 3%.',
    );
  });
});
