import {
  extractPackagingFacts,
  groundDescription,
  hasMeaningfulDescription,
} from './description-grounding';
import { supportedDescription, VerifiedCitation } from './description-evidence';

const countryLines = {
  uz: 'Ishlab chiqarilgan mamlakat: Janubiy Koreya',
  en: 'Country of manufacture: South Korea',
  ko: '제조국: 대한민국',
  ru: 'Страна производства: Южная Корея',
};
// All source text and provider copy in this suite are SYNTHETIC.
const title = 'Example Hydrating Toner';
const source = `Product name: ${title}
Benefits: Helps retain moisture and leaves skin feeling comfortable.
Ingredients: Glycerin, Panthenol
Directions: Apply an appropriate amount to clean skin.
Manufacturer: Example Lab
Responsible cosmetics seller: Example Retail
Distributor: Example Distribution, Seoul, Korea
Importer: Example Import
Volume: 100 mL
한국 제조`;
const copy = {
  uz: {
    intro:
      'Bu toner namlikni saqlashga qaratilgan parvarish uchun mo‘ljallangan. Formulada qadoqda ko‘rsatilgan glitserin va pantenol bor.',
    benefits: 'Asosiy afzalliklari',
    benefit: 'Namlikni saqlashga yordam beradigan parvarish.',
    usageHeading: 'Qo‘llash usuli',
    usage: 'Toza teriga tegishli miqdorda surting.',
  },
  en: {
    intro:
      'This toner focuses on moisture care and a comfortable skin feel, as described on the packaging. Glycerin and panthenol are named ingredients in its formula.',
    benefits: 'Key benefits',
    benefit: 'Care that helps retain moisture.',
    usageHeading: 'How to use',
    usage: 'Apply an appropriate amount to clean skin.',
  },
  ko: {
    intro:
      '보습 관리에 초점을 맞춘 토너입니다. 포장에 표시된 글리세린과 판테놀을 담았으며, 피부의 편안한 느낌을 돕는 제품으로 소개되어 있습니다.',
    benefits: '주요 특징',
    benefit: '수분 유지에 도움을 주는 케어입니다.',
    usageHeading: '사용 방법',
    usage: '깨끗한 피부에 적당량을 바릅니다.',
  },
  ru: {
    intro:
      'Тоник для ухода, направленного на сохранение влаги и ощущение комфорта кожи, заявленное на упаковке. В его составе указаны глицерин и пантенол.',
    benefits: 'Основные преимущества',
    benefit: 'Уход, помогающий удерживать влагу.',
    usageHeading: 'Способ применения',
    usage: 'Нанесите подходящее количество на очищенную кожу.',
  },
};

describe('Rich multilingual copy and independently verified manufacturing origin', () => {
  it.each(Object.keys(countryLines) as (keyof typeof countryLines)[])(
    'retains connected %s prose, instructions, localized origin and independent company roles',
    (language) => {
      const c = copy[language];
      const text = `# ${title}\n\n${c.intro}\n\n## ${c.benefits}\n- ${c.benefit}\n\n## ${c.usageHeading}\n${c.usage}`;
      const citations: VerifiedCitation[] = [];
      const supported = supportedDescription(
        JSON.stringify({
          description: text,
          evidence: [
            {
              text: c.intro,
              quotes: [
                'Helps retain moisture and leaves skin feeling comfortable.',
                'Glycerin, Panthenol',
              ],
            },
            {
              text: `- ${c.benefit}`,
              quotes: [
                'Helps retain moisture and leaves skin feeling comfortable.',
              ],
            },
            {
              text: c.usage,
              quotes: ['Apply an appropriate amount to clean skin.'],
            },
          ],
        }),
        source,
        undefined,
        citations,
      );
      const result = groundDescription(supported, source, language, citations);
      expect(result).toContain(c.intro);
      expect(result).toContain(c.benefit);
      expect(result).toContain(c.usage);
      expect(result).toContain(`- ${countryLines[language]}`);
      expect(
        result.split('\n').filter((line) => line.endsWith(': Example Lab')),
      ).toHaveLength(1);
      expect(
        result.split('\n').filter((line) => line.endsWith(': Example Retail')),
      ).toHaveLength(1);
      expect(result).toContain('Example Distribution, Seoul, Korea');
      expect(result).toContain('Example Import');
      expect(result).toContain('100 mL');
      expect(result).not.toMatch(/10%|clinically proven|fast absorbing/);
      expect(hasMeaningfulDescription(result, source, citations)).toBe(true);
    },
  );

  it.each([
    'Made in Korea',
    'Made in Republic of Korea',
    '제조국: 대한민국',
    '한국 제조',
    '대한민국에서 제조',
    'Произведено в Южной Корее',
    'Janubiy Koreyada ishlab chiqarilgan',
    'Made in\nRepublic of\nKorea',
  ])(
    'requires and recognizes an explicit manufacturing statement: %s',
    (statement) => {
      for (const language of Object.keys(
        countryLines,
      ) as (keyof typeof countryLines)[]) {
        const result = groundDescription(
          '',
          `Product name: Example Cream\n${statement}`,
          language,
        );
        expect(result).toContain(countryLines[language]);
      }
    },
  );

  it.each([
    'Brand: Korean Beauty\nDistributor: Example Co., Seoul, Korea',
    'Manufacturer: Korea Cosmetics Ltd.\nImporter: Example, 대한민국',
    'Designed in Korea\nKorean formula',
    'Not made in Korea',
    '한국 브랜드\n한국 제조업자: Example Lab',
    'Made in Korea\nMade in Japan',
    'Made in Korea\nMade in Atlantis',
  ])(
    'does not promote unrelated or conflicting country evidence: %s',
    (statement) => {
      expect(extractPackagingFacts(statement).origin).toBeUndefined();
      expect(
        groundDescription(
          '',
          `Product name: Example Cream\n${statement}`,
          'en',
        ),
      ).not.toContain('Country of manufacture:');
    },
  );

  it.each([
    [
      'uz',
      'Tarkibiy moddalar haqida umumiy ma’lumot',
      'Niatsinamidning teri rangini bir tekis ko‘rsatishdagi umumiy kosmetik vazifasi mahsulotning isbotlangan ta’siri degani emas.',
    ],
    [
      'en',
      'General cosmetic ingredient roles',
      'Niacinamide is commonly used in care for uneven skin tone; this is general ingredient information rather than a proven effect of this product.',
    ],
    [
      'ko',
      '성분의 일반적인 화장품 역할',
      '나이아신아마이드의 피부 톤 관련 설명은 일반적인 성분 정보이며 이 제품의 입증된 효능을 의미하지 않습니다.',
    ],
    [
      'ru',
      'Общие косметические роли ингредиентов',
      'Общая информация о ниацинамиде и выравнивании тона кожи не является доказательством эффективности этого продукта.',
    ],
  ] as const)(
    'retains qualified general ingredient explanations in %s without promoting them to product efficacy',
    (language, heading, paragraph) => {
      const evidence =
        'Product name: Example Niacinamide Cream\nIngredients: Niacinamide';
      const citations: VerifiedCitation[] = [];
      const supported = supportedDescription(
        JSON.stringify({
          description: `# Example Niacinamide Cream\n\n## ${heading}\n${paragraph}`,
          evidence: [{ text: paragraph, quotes: ['Ingredients: Niacinamide'] }],
        }),
        evidence,
        undefined,
        citations,
      );
      expect(
        groundDescription(supported, evidence, language, citations),
      ).toContain(paragraph);
      const unsupported = groundDescription(
        '# Example Niacinamide Cream\n\n## Key benefits\n- Eliminates dark spots.',
        evidence,
        language,
      );
      expect(unsupported).not.toContain('Eliminates dark spots.');
    },
  );

  it('still rejects trivial metadata and prevents a previous product country carrying into another product', () => {
    const old = groundDescription('', source, 'uz');
    expect(old).toContain(countryLines.uz);
    const next = 'Product name: Example Mask\nVolume: 30 mL';
    const result = groundDescription(old, next, 'uz');
    expect(result).not.toContain(countryLines.uz);
    expect(hasMeaningfulDescription(result, next)).toBe(false);
  });
});
