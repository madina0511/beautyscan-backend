import { supportedDescription, VerifiedCitation } from './description-evidence';
import {
  extractPackagingFacts,
  groundDescription,
  hasMeaningfulDescription,
} from './description-grounding';
import { supportedDirectionTranslation } from './packaging-copy-evidence';

// SYNTHETIC OCR and model copy, never the user's private photograph/transcript.
const title = 'Example NIACINAMIDE 10 TXA4 DARK SPOT CORRECTING SERUM';
const directions = 'Apply an appropriate amount to clean skin.';
const source = `Product name ${title}
Directions ${directions}
[화장품제조업자] Example Cosmetics Ltd.
화장품책임판매업자 Example Retail Co.
Made in Korea www.example.invalid
Volume 30 mL/1.01 fl. oz.`;
const copies = {
  uz: {
    intro:
      'Parvarish yo‘nalishi: pigment dog‘lari ko‘rinishiga qaratilgan zardob.',
    benefit: 'Teri rangini bir tekis ko‘rsatishga qaratilgan parvarish.',
    usage: 'Toza teriga tegishli miqdorda surting.',
    benefits: 'Asosiy afzalliklari',
    instructions: 'Qo‘llash usuli',
  },
  en: {
    intro: 'A focused serum for the appearance of uneven skin tone.',
    benefit: 'Care focused on the appearance of uneven skin tone.',
    usage: directions,
    benefits: 'Key benefits',
    instructions: 'How to use',
  },
  ko: {
    intro: '잡티와 피부 톤의 외관 관리에 초점을 맞춘 세럼입니다.',
    benefit: '피부 톤의 외관 관리에 중점을 둔 케어입니다.',
    usage: '깨끗한 피부에 적당량을 바릅니다.',
    benefits: '주요 특징',
    instructions: '사용 방법',
  },
  ru: {
    intro:
      'Уход с акцентом на внешний вид пигментных пятен: сыворотка для неровного тона кожи.',
    benefit: 'Уход для выравнивания тона кожи.',
    usage: 'Нанесите подходящее количество на очищенную кожу.',
    benefits: 'Основные преимущества',
    instructions: 'Способ применения',
  },
};

describe('Professional copy survives evidence and grounding', () => {
  it('retains an explicitly labelled instruction block across OCR wraps', () => {
    const text =
      'Directions\nApply to clean skin.\nPat gently until absorbed.\nManufacturer Example Lab';
    expect(extractPackagingFacts(text).directions).toBe(
      'Apply to clean skin. Pat gently until absorbed.',
    );
  });
  it.each([
    'Eliminates dark spots.',
    'Pigment dog‘larini butunlay yo‘qotadi.',
    'Устраняет пигментные пятна.',
    '잡티를 완전히 없애줍니다.',
  ])(
    'rejects absolute pigmentation promises even with a related packaging purpose: %s',
    (line) => {
      expect(
        groundDescription(`# ${title}\n\n${line}`, source, 'en'),
      ).not.toContain(line);
    },
  );
  it.each(['uz', 'en', 'ko', 'ru'] as const)(
    'retains useful %s prose, instructions and verified metadata',
    (language) => {
      const copy = copies[language];
      const description = `# ${title}\n\n${copy.intro}\n\n## ${copy.benefits}\n- ${copy.benefit}\n\n## ${copy.instructions}\n${copy.usage}`;
      const citations: VerifiedCitation[] = [];
      const supported = supportedDescription(
        JSON.stringify({
          description,
          evidence: [
            { text: copy.intro, quotes: [title] },
            { text: `- ${copy.benefit}`, quotes: [title] },
            { text: copy.usage, quotes: [directions] },
          ],
        }),
        source,
        undefined,
        citations,
      );
      const result = groundDescription(supported, source, language, citations);
      expect(result).toContain(copy.intro);
      expect(result).toContain(copy.benefit);
      expect(result).toContain(copy.usage);
      for (const fact of [
        'Example Cosmetics Ltd.',
        'Example Retail Co.',
        {
          uz: 'Janubiy Koreya',
          en: 'South Korea',
          ko: '대한민국',
          ru: 'Южная Корея',
        }[language],
        '30 mL/1.01 fl. oz.',
      ])
        expect(result).toContain(fact);
      expect(result).not.toMatch(/10%|4%|guaranteed|clinically proven/);
      expect(hasMeaningfulDescription(result, source)).toBe(true);
    },
  );

  it('parses explicit company labels without colons and preserves independent roles', () => {
    expect(extractPackagingFacts(source)).toMatchObject({
      manufacturer: 'Example Cosmetics Ltd.',
      responsibleSeller: 'Example Retail Co.',
      origin: 'Korea',
      directions,
    });
    expect(
      extractPackagingFacts(
        'Manufacturer Example Lab, Seoul, Korea | Distributor Example Seller, Paris, France',
      ),
    ).toEqual({
      manufacturer: 'Example Lab, Seoul, Korea',
      distributor: 'Example Seller, Paris, France',
    });
    expect(
      extractPackagingFacts('Made in Korea; Made in France').origin,
    ).toBeUndefined();
    expect(
      extractPackagingFacts('Manufacturer: Example Co.; Branch Division')
        .manufacturer,
    ).toBe('Example Co.; Branch Division');
  });

  it('accepts a complete cited paragraph with different wrapping, without fuzzy claim matching', () => {
    const text = 'A focused serum for the appearance\nof uneven skin tone.';
    const result = supportedDescription(
      JSON.stringify({
        description: `# ${title}\n\n${text}`,
        evidence: [{ text: text.replace('\n', ' '), quotes: [title] }],
      }),
      source,
    );
    expect(result).toContain(text);
    expect(
      supportedDescription(
        JSON.stringify({
          description: 'Whitening works.',
          evidence: [{ text: 'A focused serum.', quotes: [title] }],
        }),
        source,
      ),
    ).toBe('');
  });

  it.each([
    'Har kuni ikki marta toza teriga surting.',
    'Toza teriga 10 mL surting.',
    'Toza teriga oz miqdorda surting.',
    'Нанесите два раза в день на очищенную кожу.',
    '매일 깨끗한 피부에 바릅니다.',
  ])('rejects a source-unsupported instruction modifier: %s', (line) => {
    expect(supportedDirectionTranslation(line, directions, [directions])).toBe(
      false,
    );
  });

  it('does not retain translated instructions without validated directions citations', () => {
    expect(
      groundDescription(
        `# ${title}\n## Qo‘llash usuli\n${copies.uz.usage}`,
        source,
        'uz',
      ),
    ).not.toContain(copies.uz.usage);
    expect(
      supportedDirectionTranslation(copies.uz.usage, directions, [title]),
    ).toBe(false);
    expect(
      supportedDirectionTranslation(
        'Apply to skin.',
        'Apply to skin. Do not rinse.',
        ['Apply to skin. Do not rinse.'],
      ),
    ).toBe(false);
  });

  it('does not invent a product benefit from ingredient presence or borrow a claim from another product', () => {
    const sparse = 'Product name: Example Niacinamide Serum\nVolume: 30 mL';
    const result = groundDescription(
      '# Example Niacinamide Serum\n\n## Key benefits\n- Care for the appearance of dark spots.',
      sparse,
      'en',
    );
    expect(result).not.toContain('Care for the appearance of dark spots.');
    expect(
      hasMeaningfulDescription(
        groundDescription('', 'Volume: 30 mL', 'en'),
        'Volume: 30 mL',
      ),
    ).toBe(false);
  });
});
