import { productName } from './anua-regressions';

// SYNTHETIC packaging and editorial examples; not a verified transcription,
// composition or efficacy statement about the real ANUA product.
export const retailSource = `Product name: ${productName}
Ingredients: Aqua, Niacinamide, Tranexamic Acid
Volume: 30 mL`;

export const retailCopies = {
  uz: {
    intro: [
      'Pigment dog‘lari ko‘rinishiga qaratilgan parvarish uchun zardob.',
      'Tarkibida niatsinamid va traneksamik kislota qayd etilgan.',
    ],
    heading: 'Moddalar haqida umumiy ma’lumot',
    qualifier:
      'Quyidagi izohlar moddalarning umumiy kosmetik vazifalari haqida; ular bu mahsulotning isbotlangan ta’siri emas.',
    role: 'Niatsinamid kosmetikada teri rangini bir tekis ko‘rsatishga qaratilgan parvarishda qo‘llanadi.',
    unsupported: 'Mahsulot terini namlantiradi.',
  },
  en: {
    intro: [
      'A serum for care focused on the appearance of dark spots.',
      'Its listed ingredients include niacinamide and tranexamic acid.',
    ],
    heading: 'General ingredient information',
    qualifier:
      'These are general cosmetic ingredient roles, not verified effects of this product.',
    role: 'Niacinamide is used in cosmetics concerned with the appearance of uneven skin tone.',
    unsupported: 'The serum moisturizes skin.',
  },
  ko: {
    intro: [
      '잡티와 피부 톤을 고르게 가꾸는 케어를 위한 세럼입니다.',
      '성분표에는 나이아신아마이드와 트라넥사믹애씨드가 기재되어 있습니다.',
    ],
    heading: '성분 일반 정보',
    qualifier:
      '다음은 일반적인 성분 정보이며 이 제품의 효능을 입증하는 설명이 아닙니다.',
    role: '나이아신아마이드는 피부 톤을 고르게 가꾸는 화장품에 사용되는 성분입니다.',
    unsupported: '이 세럼은 보습에 도움을 줍니다.',
  },
  ru: {
    intro: [
      'Сыворотка для ухода за кожей с неровным тоном и видимыми пигментными пятнами.',
      'В составе указаны ниацинамид и транексамовая кислота.',
    ],
    heading: 'Общая информация об ингредиентах',
    qualifier:
      'Это общая информация о косметических ингредиентах, а не доказательство эффективности этого продукта.',
    role: 'Ниацинамид используют в косметическом уходе за неровным тоном кожи.',
    unsupported: 'Этот продукт увлажняет кожу.',
  },
} as const;

export function retailResponse(
  language: keyof typeof retailCopies,
  unsupported = false,
) {
  const copy = retailCopies[language];
  const introduction = [
    ...copy.intro,
    ...(unsupported ? [copy.unsupported] : []),
  ].join(' ');
  return JSON.stringify({
    description: `# ${productName}\n\n${introduction}\n\n## ${copy.heading}\n${copy.qualifier}\n${copy.role}`,
    evidence: [
      { text: copy.intro[0], quotes: [productName] },
      { text: copy.intro[1], quotes: ['Niacinamide, Tranexamic Acid'] },
      ...(unsupported
        ? [{ text: copy.unsupported, quotes: ['Niacinamide, Tranexamic Acid'] }]
        : []),
      { text: copy.qualifier, quotes: ['Niacinamide, Tranexamic Acid'] },
      { text: copy.role, quotes: ['Niacinamide'] },
    ],
  });
}
