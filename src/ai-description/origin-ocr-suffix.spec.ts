import {
  extractPackagingFacts,
  groundDescription,
} from './description-grounding';

describe('Explicit manufacturing country with trailing OCR/URL noise', () => {
  it.each([
    ['en', 'Country of manufacture: South Korea'],
    ['uz', 'Ishlab chiqarilgan mamlakat: Janubiy Koreya'],
    ['ko', '제조국: 대한민국'],
    ['ru', 'Страна производства: Южная Корея'],
  ] as const)(
    'includes the reported explicit origin in %s Product Information',
    (language, expected) => {
      const source = 'Product name: Example Serum\nMade in Korea i www.anua.kr';
      expect(extractPackagingFacts(source).origin).toBe('Korea');
      expect(groundDescription('', source, language)).toContain(
        `- ${expected}`,
      );
    },
  );

  it.each([
    ['Made in France i www.example.fr', 'France'],
    ['Made in Japan | https://example.jp', 'Japan'],
    [
      'Made in United States of America © www.example.com',
      'United States of America',
    ],
    ['Made in Republic of Korea I www.example.kr', 'Republic of Korea'],
    ['Country of manufacture: Germany • https://example.de', 'Germany'],
    ['Made in Italy / www.example.it', 'Italy'],
    ['Made in Korea i [www.example.kr](https://www.example.kr/)', 'Korea'],
    ['Made in France www.example.fr', 'France'],
    ['Made in Mali i www.example.ml', 'Mali'],
  ])('retains only the explicitly stated country: %s', (source, country) => {
    expect(extractPackagingFacts(source).origin).toBe(country);
  });

  it.each([
    'Made in Kore i www.example.kr',
    'Made in Koreai www.example.kr',
    'Made in Atlantis i www.example.kr',
    'Made in Korea or France www.example.kr',
    'Made in Korea / Japan www.example.kr',
    'Made in Korea? www.example.kr',
    'Made in Korea is not confirmed www.example.kr',
    'Made in Korea www.example.kr Made in Japan',
    'Made in Korea www.example.kr Made in France www.example.fr',
    'Made in www.korea.example',
    'Distributor: Example Co., Seoul, Korea i www.example.kr',
    'Brand: Korean Brand\nwww.example.kr',
    'Made in Korea i www.example.kr\nMade in France i www.example.fr',
    'Made in Korea\nMade in www.example.jp',
  ])('does not guess or hide conflicting origin evidence: %s', (source) => {
    expect(extractPackagingFacts(source).origin).toBeUndefined();
  });
});
