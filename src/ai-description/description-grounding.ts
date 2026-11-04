import {
  extractPackagingIngredients,
  ingredientMentionsSupported,
  ingredientPercentagesSupported,
  ingredientDisplayName,
} from './packaging-ingredients';
import {
  descriptionSentences,
  matchingCitationText,
  VerifiedCitation,
} from './description-evidence';
import { supportedGeneralIngredientInformation } from './general-ingredient-information';
import {
  packagingPurposes,
  supportedDirectionTranslation,
  sourceInstructionLine,
} from './packaging-copy-evidence';
type Language = 'uz' | 'en' | 'ru' | 'ko';
type Field =
  | 'name'
  | 'brand'
  | 'manufacturer'
  | 'distributor'
  | 'responsibleSeller'
  | 'importer'
  | 'volume'
  | 'origin'
  | 'directions'
  | 'benefits';
export type PackagingFacts = Partial<Record<Field, string>>;
export type GroundingFiltering = Partial<
  Record<
    | 'metadataRebuilt'
    | 'unsupportedUsage'
    | 'unsupportedBenefit'
    | 'unsupportedIngredient'
    | 'unsupportedGeneralRole'
    | 'unsupportedFact'
    | 'unsafeClaim'
    | 'duplicateSentences'
    | 'retainedProse',
    number
  >
>;

const fieldPatterns: Record<Field, RegExp> = {
  name: /^(?:product name|name|제품명|название продукта|наименование|mahsulot nomi)\s*[:：]\s*(.+)$/iu,
  brand: /^(?:brand|브랜드|бренд|brend)\s*[:：]\s*(.+)$/iu,
  manufacturer:
    /^(?:manufacturer|manufactured by|화장품제조업자|제조업자|제조원|изготовитель|производитель|ishlab chiqaruvchi)\s*[:：]\s*(.+)$/iu,
  distributor:
    /^(?:distributor|distributed by|유통업자|판매원|дистрибьютор|distribyutor|distributor)\s*[:：]\s*(.+)$/iu,
  responsibleSeller:
    /^(?:responsible seller|responsible cosmetics seller|화장품책임판매업자|책임판매업자|организация, ответственная за продажу|sotuv uchun mas[’‘']ul tashkilot)\s*[:：]\s*(.+)$/iu,
  importer:
    /^(?:importer|imported by|수입업자|수입원|импорт[её]р|import qiluvchi)\s*[:：]\s*(.+)$/iu,
  volume:
    /^(?:volume|net volume|net contents|용량|내용량|объ[её]м|hajmi)\s*[:：]\s*(.+)$/iu,
  origin:
    /^(?:country of manufacture|country of origin|제조국|원산지|страна производства|страна изготовления|ishlab chiqarilgan mamlakat)\s*[:：]\s*(.+)$|^(?:made in|manufactured in)\s+(.+)$|^(?:сделано|произведено|изготовлено)\s+в\s+(.+)$|^(.+?)(?:에서)?\s*제조(?:됨)?[.]?$|^(.+?)\s+ishlab\s+chiqarilgan[.]?$/iu,
  directions:
    /^(?:directions|how to use|사용 방법|사용법|способ применения|qo[’‘']llash usuli)\s*[:：]\s*(.+)$/iu,
  benefits:
    /^(?:benefits|key benefits|주요 특징|효능|основные преимущества|asosiy afzalliklari)\s*[:：]\s*(.+)$/iu,
};

// Explicit labels may be followed by a colon, whitespace, or a printed bracket.
// The role still comes from the packaging label, never the company/address.
const flexibleFieldPatterns = Object.fromEntries(
  Object.entries(fieldPatterns).map(([field, pattern]) => [
    field,
    new RegExp(
      pattern.source.replaceAll('\\s*[:：]\\s*', '(?:\\s*[:：]\\s*|\\s+)'),
      pattern.flags,
    ),
  ]),
) as Record<Field, RegExp>;
const fieldLine = (line: string) =>
  line.trim().replace(/^[\[【(]\s*([^\]】)]+?)\s*[\]】)]\s*[:：]?\s*/, '$1: ');
const matchField = (field: Field, line: string) => {
  const match = flexibleFieldPatterns[field].exec(fieldLine(line));
  const value = match?.[1] ?? match?.[2] ?? '';
  if (
    ['manufacturer', 'distributor', 'responsibleSeller', 'importer'].includes(
      field,
    ) &&
    /^(?:address|주소|адрес|manzil)(?:\s*[:：]|\s)/iu.test(value)
  )
    return null;
  return match;
};

// Conservative, intentionally finite aliases. Unrecognized/ambiguous origin is
// omitted rather than guessed. Company/address text never enters this lookup.
const originGroups = [
  [
    'korea',
    'south korea',
    'republic of korea',
    '대한민국',
    '한국',
    'корея',
    'республика корея',
    'южная корея',
    'южной корее',
    'корее',
    'республике корея',
    'koreya',
    'janubiy koreya',
  ],
  ['france', '프랑스', 'франция', 'fransiya'],
  ['japan', '일본', 'япония', 'yaponiya'],
  ['china', '중국', 'китай', 'xitoy'],
  ['germany', '독일', 'германия', 'germaniya'],
  ['usa', 'united states', 'united states of america', '미국', 'сша', 'aqsh'],
  ['italy', '이탈리아', 'италия', 'italiya'],
  ['russia', 'россия', '러시아', 'rossiya'],
  ['uzbekistan', '우즈베키스탄', 'узбекистан', 'o‘zbekiston', "o'zbekiston"],
];
const key = (value: string) =>
  value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!]$/, '')
    .toLocaleLowerCase();
// ICU region names broaden validation without any product/brand assumptions.
const standardOrigins = new Map<string, string>();
for (const locale of ['en', 'uz', 'ru', 'ko']) {
  const names = new Intl.DisplayNames([locale], {
    type: 'region',
    fallback: 'code',
  });
  for (let first = 65; first <= 90; first++)
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second);
      if (['EU', 'EZ', 'UN', 'QO', 'ZZ', 'XA', 'XB'].includes(code)) continue;
      const name = names.of(code);
      if (name && name !== code) standardOrigins.set(key(name), code);
    }
}
const originKey = (value: string): string | number => {
  const group = originGroups.findIndex((entry) => entry.includes(key(value)));
  return group >= 0 ? group : (standardOrigins.get(key(value)) ?? -1);
};

function cleanOriginSuffix(value: string): string {
  // URLs provide no origin evidence. Remove their tokens, not arbitrary text
  // after them: a second country statement must still cause rejection.
  const clean = value
    .replace(/(?:https?:\/\/|www\.)\S+/giu, '')
    .split(/\s+(?=\d+(?:[.,]\d+)?\s*(?:mL|g)\b)/iu)[0]
    .trim()
    .replace(/[.,]$/, '');
  if (originKey(clean) !== -1) return clean;
  for (let end = clean.length - 1; end > 0; end--) {
    const suffix = clean.slice(end);
    // Only separated punctuation or a few common OCR glyphs may trail a
    // known country. Never repair a misspelled country or discard prose.
    if (
      !/^[\s.,:;|/\\()[\]©®™•·–—_\-]/u.test(suffix) ||
      !/^[\s.,:;|/\\()[\]©®™•·–—_\-iIl1]{1,16}$/u.test(suffix)
    )
      continue;
    const country = clean.slice(0, end).trim();
    if (originKey(country) !== -1) return country;
  }
  return clean || value;
}

export function manufacturingCountryName(
  value: string,
  language: Language,
): string {
  // Only localize a country already validated from an explicit origin field.
  if (originKey(value) === 0)
    return {
      en: 'South Korea',
      uz: 'Janubiy Koreya',
      ko: '대한민국',
      ru: 'Южная Корея',
    }[language];
  return value;
}
const bareOriginPrefix = (value: string) =>
  /^(?:made in|manufactured in|(?:сделано|произведено|изготовлено) в)\s*[:：]?$/iu.test(
    value.trim(),
  );

export function extractPackagingFacts(
  source: string,
  diagnostics?: { rejectedFields: number },
): PackagingFacts {
  if (diagnostics) diagnostics.rejectedFields = 0;
  const candidates = new Map<Field, Set<string>>();
  const sourceLines = source
    .split(/\r?\n/)
    .flatMap((line) =>
      line
        .replace(/\s*[|;]\s*/g, (separator: string, index: number) =>
          (Object.keys(fieldPatterns) as Field[]).some((field) =>
            matchField(field, line.slice(index + separator.length)),
          )
            ? '\n'
            : separator,
        )
        .split('\n'),
    );
  const isLabel = (line: string) =>
    bareOriginPrefix(line) ||
    Object.values(fieldPatterns).some((pattern) => {
      const match = pattern.exec(
        `${fieldLine(line).replace(/[:：]$/, '')}: value`,
      );
      return (match?.[1] ?? match?.[2]) === 'value';
    });
  const lines = sourceLines.map((line, index) => {
    const next = sourceLines[index + 1]?.trim();
    return isLabel(line) &&
      next &&
      !isLabel(next) &&
      !(Object.keys(fieldPatterns) as Field[]).some((field) =>
        matchField(field, next),
      )
      ? `${line.trim().replace(/[:：]$/, '')}${bareOriginPrefix(line) ? ' ' : ': '}${next}`
      : line;
  });
  for (const [index, line] of lines.entries()) {
    const match = matchField('origin', line);
    const value = match
      ?.slice(1)
      .find((part) => part !== undefined)
      ?.trim();
    if (
      !value ||
      originKey(value) !== -1 ||
      (!isLabel(sourceLines[index]) && !bareOriginPrefix(sourceLines[index]))
    )
      continue;
    let combined = value;
    let next = index + 1;
    if (sourceLines[next]?.trim() === value) next++;
    for (; next < Math.min(sourceLines.length, index + 4); next++) {
      if (
        !sourceLines[next].trim() ||
        (Object.keys(fieldPatterns) as Field[]).some((field) =>
          matchField(field, sourceLines[next]),
        )
      )
        break;
      combined += ` ${sourceLines[next].trim()}`;
      if (originKey(combined) !== -1) {
        lines[index] = `Country of manufacture: ${combined}`;
        break;
      }
    }
  }
  for (const [index, line] of lines.entries()) {
    const match = matchField('directions', line);
    if (!match?.[1]) continue;
    const instructions = [match[1]];
    for (
      let next = index + 1;
      next < sourceLines.length && sourceInstructionLine(sourceLines[next]);
      next++
    ) {
      if (!instructions.includes(sourceLines[next].trim()))
        instructions.push(sourceLines[next].trim());
    }
    lines[index] = `Directions: ${instructions.join(' ')}`;
  }
  // An entire standalone quantity is explicit volume evidence; numbers in
  // product names, addresses and ingredient percentages are not.
  lines.push(
    ...sourceLines
      .filter((line) =>
        /^\s*\d+(?:[.,]\d+)?\s*(?:ml|мл|g|г)(?:\s*\/\s*\d+(?:[.,]\d+)?\s*fl\.\s*oz\.?)?\s*$/iu.test(
          line,
        ),
      )
      .map((line) => `Volume: ${line.trim()}`),
  );
  for (const line of lines) {
    for (const field of Object.keys(fieldPatterns) as Field[]) {
      const match = matchField(field, line);
      let value = match
        ?.slice(1)
        .find((part) => part !== undefined)
        ?.trim();
      if (
        field === 'origin' &&
        value &&
        match?.[5] &&
        originKey(value) === -1 &&
        /da$/iu.test(value) &&
        originKey(value.slice(0, -2)) !== -1
      )
        value = value.slice(0, -2);
      if (field === 'origin' && value) value = cleanOriginSuffix(value);
      if (!value || value.length > 500) {
        if (match && diagnostics) diagnostics.rejectedFields++;
        continue;
      }
      if (
        field === 'volume' &&
        !/^\d+(?:[.,]\d+)?\s*(?:ml|мл|g|г|fl\.\s*oz\.?)(?:\s*\/\s*\d+(?:[.,]\d+)?\s*(?:ml|мл|g|г|fl\.\s*oz\.?))?$/iu.test(
          value,
        )
      ) {
        if (diagnostics) diagnostics.rejectedFields++;
        continue;
      }
      const values = candidates.get(field) ?? new Set<string>();
      values.add(value);
      candidates.set(field, values);
    }
  }
  // A standalone explicit claim need not have a "Benefits:" label. Retain the
  // source statement, not a benefit inferred from an ingredient or a category.
  if (!candidates.has('benefits')) {
    const claims = sourceLines
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.length <= 500 &&
          /^(?:helps?\s+(?:retain|maintain|reduce|improve|protect)\b|moisturi[sz]es\b|hydrates\b|увлажняет(?!\p{L})|помогает\s+(?:сохранить|удерживать|уменьшить)|namlikni\s+saqlashga\s+yordam\s+beradi|수분을\s+유지하는\s+데\s+도움을)/iu.test(
            line,
          ),
      );
    if (claims.length) candidates.set('benefits', new Set([claims.join(' ')]));
  }
  const facts: PackagingFacts = {};
  for (const [field, values] of candidates) {
    const entries = [...values];
    // Conflicting values are not resolved using brand knowledge or model output.
    if (field === 'origin') {
      if (
        entries.every(
          (value) =>
            originKey(value) !== -1 &&
            originKey(value) === originKey(entries[0]),
        )
      )
        facts[field] = entries[0];
      else if (diagnostics) diagnostics.rejectedFields++;
    } else if (entries.length === 1) facts[field] = entries[0];
    else if (diagnostics) diagnostics.rejectedFields++;
  }
  return facts;
}

type InformationField = Exclude<Field, 'directions' | 'benefits'>;
const labels: Record<
  Language,
  Record<InformationField | 'information', string>
> = {
  en: {
    information: 'Product information',
    name: 'Product name',
    brand: 'Brand',
    manufacturer: 'Manufacturer',
    distributor: 'Distributor',
    responsibleSeller:
      'Organization responsible for cosmetics sales (as labeled)',
    importer: 'Importer',
    volume: 'Volume',
    origin: 'Country of manufacture',
  },
  uz: {
    information: 'Mahsulot haqida',
    name: 'Mahsulot nomi',
    brand: 'Brend',
    manufacturer: 'Ishlab chiqaruvchi',
    distributor: 'Distribyutor',
    responsibleSeller:
      'Kosmetika savdosi uchun mas’ul tashkilot (qadoqdagi rol)',
    importer: 'Import qiluvchi',
    volume: 'Hajmi',
    origin: 'Ishlab chiqarilgan mamlakat',
  },
  ru: {
    information: 'Информация о продукте',
    name: 'Название продукта',
    brand: 'Бренд',
    manufacturer: 'Производитель',
    distributor: 'Дистрибьютор',
    responsibleSeller:
      'Организация, ответственная за продажу косметики (по маркировке)',
    importer: 'Импортёр',
    volume: 'Объём',
    origin: 'Страна производства',
  },
  ko: {
    information: '제품 정보',
    name: '제품명',
    brand: '브랜드',
    manufacturer: '제조업자',
    distributor: '유통업자',
    responsibleSeller: '화장품책임판매업자 (표시 기준)',
    importer: '수입업자',
    volume: '용량',
    origin: '제조국',
  },
};

const plain = (line: string) =>
  line
    .replace(/^\s*(?:#{1,6}\s*|[-•*]\s+)/, '')
    .replace(/\*\*|__/g, '')
    .trim();

function verifiedProductTitle(
  description: string,
  source: string,
  facts: PackagingFacts,
): string | undefined {
  const heading = /^#\s+(.+)$/m.exec(description)?.[1];
  // Case, Markdown emphasis and OCR line wraps do not change identity. Match
  // literal words only and return the source spelling, never the model spelling.
  const words = heading ? plain(heading).split(/\s+/).filter(Boolean) : [];
  const literal = words
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  const matched = literal
    ? new RegExp(`(?<![\\p{L}\\p{N}])${literal}(?![\\p{L}\\p{N}])`, 'iu')
        .exec(source)?.[0]
        .replace(/\s+/g, ' ')
    : undefined;
  const conflictingNames =
    source.split(/\r?\n/).filter((line) => matchField('name', line)).length >
      1 && !facts.name;
  if (
    !conflictingNames &&
    matched &&
    (!facts.name || matched.startsWith(facts.name))
  )
    return matched;
  return facts.name;
}

const productType =
  /(?:\b(?:serum|cream|cleanser|toner|sunscreen|mask|lotion|balm|oil|gel)\b|세럼|크림|클렌저|토너|선크림|마스크|сыворотк\p{L}*|крем|тоник|маск\p{L}*|zardob|krem|niqob)/iu;
function section(
  line: string,
): 'information' | 'usage' | 'benefits' | 'general' | 'other' | null {
  const value = plain(line)
    .replace(/[:：]$/, '')
    .toLocaleLowerCase();
  if (
    /^#{1,6}\s/.test(line) &&
    /general.*(?:ingredient|cosmetic)|ingredient.*general|(?:modda|tarkib).*umumiy|umumiy.*(?:modda|tarkib)|общ\p{L}*.*(?:ингредиент|компонент)|(?:ингредиент|компонент).*общ\p{L}*|성분.*일반|일반.*성분/iu.test(
      value,
    )
  )
    return 'general';
  if (
    /^(?:product information|verified details|product details|mahsulot haqida|информация о продукте|제품 정보)$/iu.test(
      value,
    )
  )
    return 'information';
  if (
    /^(?:how to use|usage(?: instructions)?|directions|qo[’‘']llash(?: usuli| bo[’‘']yicha ko[’‘']rsatmalar)?|способ применения|применение|как использовать|사용\s*방법|사용법)$/iu.test(
      value,
    )
  )
    return 'usage';
  if (
    /^(?:key benefits|asosiy afzalliklari|основные преимущества|주요 특징)$/iu.test(
      value,
    )
  )
    return 'benefits';
  if (
    /^(?:general cosmetic roles|general ingredient information|moddalar haqida umumiy ma[’‘']lumot|общая информация об ингредиентах|성분 일반 정보)$/iu.test(
      value,
    )
  )
    return 'general';
  if (
    /^#{1,6}\s/.test(line) ||
    /^(?:key benefits|highlighted ingredients|listed ingredients|general cosmetic roles|asosiy afzalliklari|tarkibdagi muhim moddalar|основные преимущества|ключевые ингредиенты|주요 특징|주요 성분)$/iu.test(
      value,
    )
  )
    return 'other';
  return null;
}

export function verifiedIngredientPercentages(
  source: string,
): { ingredient: string; percentage: string }[] {
  return extractPackagingIngredients(source).flatMap((item) =>
    item.percentage
      ? [{ ingredient: item.ingredient, percentage: item.percentage }]
      : [],
  );
}

// Narrow high-risk stock claims, not a general semantic fact checker. Even a
// packaging claim is not a reason to promise whitening or guaranteed results.
const guaranteed =
  /guarantee\p{L}*|skin whitening|whitens? (?:the )?skin|гарантир\p{L}*|осветл\p{L}* кож\p{L}*|отбел\p{L}*|kafolat\p{L}*|terini oqartir\p{L}*|반드시|기미.*완전히|피부.*하얗게/iu;
const absoluteToneClaim =
  /(?:eliminat\p{L}*|remov\p{L}*|erase\p{L}*)[^.!?]*(?:pigment|dark.?spots)|(?:dog[’‘']|pigment)[^.!?]*(?:yo[’‘']qot|butunlay)|(?:устраня\p{L}*|избавля\p{L}*)[^.!?]*(?:пигмент|пят)|(?:잡티|기미|색소)[^.!?]*(?:완전|영구|없애)/iu;
const medicalClaim =
  /(?:cures?|treats?|heals?)\s+(?:acne|eczema|melasma|rosacea|dermatitis)|лечит\s+(?:акне|экзем|мелазм)|(?:akne|ekzema|melazma)[^.!?]*davola|(?:여드름|습진|피부염)[^.!?]*치료/iu;
const stockClaims: [RegExp, RegExp][] = [
  [
    /ideal choice|идеальн\p{L}* выбор|ideal tanlov|완벽한 선택/iu,
    /ideal choice|идеальн\p{L}* выбор|ideal tanlov|완벽한 선택/iu,
  ],
  [
    /fast.?absor\p{L}*|быстро впитыва\p{L}*|tez so[’‘']ril\p{L}*|빠르\p{L}* 흡수|빠르게 흡수/iu,
    /fast.?absor\p{L}*|быстро впитыва\p{L}*|tez so[’‘']ril\p{L}*|빠르게 흡수/iu,
  ],
  [
    /daily use|ежедневн\p{L}* использован\p{L}*|har kuni|매일 사용/iu,
    /daily use|ежедневн\p{L}* использован\p{L}*|har kuni|매일 사용/iu,
  ],
  [
    /clinically proven|клинически доказан\p{L}*|klinik.*isbot|임상.*입증/iu,
    /clinically proven|клинически доказан\p{L}*|klinik.*isbot|임상.*입증/iu,
  ],
  [
    /lightweight (?:formula|texture)|yengil (?:formula|tuzilish)|л[её]гк\p{L}* текстур|가벼운 제형/iu,
    /lightweight (?:formula|texture)|yengil (?:formula|tuzilish)|л[её]гк\p{L}* текстур|가벼운 제형/iu,
  ],
  [
    /suitable for (?:all|sensitive) skin|(?:barcha|sezgir) teri.*mos|подходит для (?:всех типов|чувствительной) кожи|모든 피부.*적합|민감\p{L}* 피부.*적합/iu,
    /suitable for (?:all|sensitive) skin|(?:barcha|sezgir) teri.*mos|подходит для (?:всех типов|чувствительной) кожи|모든 피부.*적합|민감\p{L}* 피부.*적합/iu,
  ],
];

function normalizeTerminology(line: string, language: Language): string {
  if (language === 'uz')
    return line
      .replace(/qora dog[’‘']lar(?:i)?/giu, 'pigment dog‘lari')
      .replace(
        /teri(?:ning)? tonusini yaxshilash/giu,
        'teri rangini bir tekis ko‘rsatish',
      )
      .replace(/\bNiacinamide\b/gi, 'niatsinamid')
      .replace(/tranexamik kislota|tranexamic acid/gi, 'traneksamik kislota');
  if (language === 'ru')
    return line
      .replace(/темных пятен/giu, 'пигментных пятен')
      .replace(/темные пятна/giu, 'пигментные пятна');
  return line;
}

export function groundDescription(
  description: string,
  source: string,
  language: Language,
  citations: VerifiedCitation[] = [],
  filtering?: GroundingFiltering,
): string {
  const facts = extractPackagingFacts(source);
  const recognizedTitle = verifiedProductTitle(description, source, facts);
  const inventory = extractPackagingIngredients(source, recognizedTitle);
  const sourcePurposes = packagingPurposes(
    `${recognizedTitle ?? ''}\n${facts.benefits ?? ''}`,
  );
  const hasBenefits = Boolean(facts.benefits || sourcePurposes.length);
  const count = (reason: keyof GroundingFiltering) => {
    if (filtering) filtering[reason] = (filtering[reason] ?? 0) + 1;
  };
  const lines: string[] = [];
  const seen = new Set<string>();
  let mode: ReturnType<typeof section> = null;
  let title = recognizedTitle;
  const sourceContainsTitle = (value: string) =>
    source.replace(/\s+/g, ' ').includes(value.replace(/\s+/g, ' '));
  const allowTitleFallback =
    Boolean(facts.name) ||
    source.split(/\r?\n/).filter((line) => fieldPatterns.name.test(line.trim()))
      .length <= 1;
  for (const [index, paragraph] of description.split(/\r?\n/).entries()) {
    const currentSection = section(paragraph) ?? mode;
    // Preserve connected introductions while evaluating each sentence. Usage
    // and general-role paragraphs stay indivisible so qualifiers/restrictions
    // cannot be dropped while retaining the claim they qualify.
    const parts =
      !section(paragraph) &&
      !/^\s*(?:#|[-*•])/u.test(paragraph) &&
      !sourceInstructionLine(plain(paragraph)) &&
      currentSection !== 'usage' &&
      currentSection !== 'general' &&
      currentSection !== 'information' &&
      !(Object.keys(fieldPatterns) as Field[]).some((field) =>
        matchField(field, plain(paragraph)),
      )
        ? descriptionSentences(paragraph)
        : [paragraph];
    const retained: string[] = [];
    for (const raw of parts.length ? parts : ['']) {
      const line = raw.trim();
      const heading = section(line);
      if (heading) mode = heading;
      if (
        mode === 'information' ||
        (mode === 'usage' && !facts.directions) ||
        (mode === 'benefits' && !hasBenefits)
      ) {
        count(
          mode === 'information'
            ? 'metadataRebuilt'
            : mode === 'usage'
              ? 'unsupportedUsage'
              : 'unsupportedBenefit',
        );
        continue;
      }
      if (
        /^#\s/.test(line) ||
        (index === 0 && line && sourceContainsTitle(plain(line)))
      ) {
        if (
          facts.name &&
          /^#\s/.test(line) &&
          plain(line).startsWith(`${facts.name} `) &&
          sourceContainsTitle(plain(line))
        )
          title = plain(line);
        if (!title && allowTitleFallback && sourceContainsTitle(plain(line)))
          title = plain(line);
        continue;
      }
      const instruction =
        mode === 'usage' || (!heading && sourceInstructionLine(plain(line)));
      if (instruction && !heading && line && !facts.directions) {
        count('unsupportedUsage');
        continue;
      }
      // Exact source instructions remain valid; translations additionally require
      // validated citations and source-supported action/modifier constraints.
      if (
        instruction &&
        !heading &&
        line &&
        !facts.directions?.includes(plain(line)) &&
        !supportedDirectionTranslation(
          plain(line),
          facts.directions ?? '',
          citations
            .filter(
              (item) =>
                matchingCitationText(item.text) === matchingCitationText(line),
            )
            .flatMap((item) => item.quotes),
        )
      ) {
        count('unsupportedUsage');
        continue;
      }
      // Generated metadata is never used as evidence, even outside its section.
      if (
        (Object.keys(fieldPatterns) as Field[]).some((field) =>
          matchField(field, plain(line)),
        ) ||
        /(?:made in|manufactured in|produced in|country of manufacture|страна производства|произведено в|ishlab chiqarilgan mamlakat|제조국)/iu.test(
          line,
        )
      ) {
        count('metadataRebuilt');
        continue;
      }
      // Unseen acronym-like identifiers are not facts about this product. This
      // handles arbitrary uppercase brand/model carryover, without a brand list.
      const identifiers = line.match(/\b[A-Z][A-Z0-9-]{2,}\b/g) ?? [];
      if (
        identifiers.some(
          (identifier: string) =>
            identifier !== 'INCI' &&
            !source.toUpperCase().includes(identifier) &&
            !inventory.some((item) =>
              item.aliases.some((alias) => alias.toUpperCase() === identifier),
            ),
        )
      )
        continue;
      // Model identifiers/ratings are independent source facts, not quantities or
      // concentrations inferred from the category (for example, SPF 50 vs SPF 100).
      const ratingPattern = /\b[A-Z]{2,6}\s*\d+(?:[.,]\d+)?\b|\bPA\+{1,4}/g;
      const sourceRatings = new Set(
        (source.match(ratingPattern) ?? []).map((value) =>
          value.replace(/\s/g, ''),
        ),
      );
      if (
        [...line.matchAll(ratingPattern)].some(
          (match) => !sourceRatings.has(match[0].replace(/\s/g, '')),
        )
      )
        continue;
      const claimText = line.replace(
        /does not guarantee|not guaranteed|не гарантирует|kafolatlamaydi|보장하지 않습니다/giu,
        '',
      );
      if (
        !heading &&
        !ingredientMentionsSupported(line, inventory, /^\s*[-*•]/u.test(line))
      ) {
        count('unsupportedIngredient');
        continue;
      }
      if (!heading && line && mode === 'general') {
        const allLines = description.split(/\r?\n/);
        let start = index;
        while (start > 0 && !section(allLines[start - 1])) start--;
        let end = index + 1;
        while (end < allLines.length && !section(allLines[end])) end++;
        if (
          !supportedGeneralIngredientInformation(
            line,
            inventory,
            allLines.slice(start, end).join('\n'),
          )
        ) {
          count('unsupportedGeneralRole');
          continue;
        }
      }
      if (
        !ingredientPercentagesSupported(line, inventory) ||
        guaranteed.test(claimText) ||
        absoluteToneClaim.test(claimText) ||
        medicalClaim.test(claimText)
      ) {
        count('unsafeClaim');
        continue;
      }
      const quantities: string[] =
        line.match(
          /\d+(?:[.,]\d+)?\s*(?:ml|мл|mL|fl\.\s*oz\.?|g|г)(?!\p{L})/giu,
        ) ?? [];
      const quantitySource = instruction ? facts.directions : facts.volume;
      if (
        quantities.some(
          (value) =>
            !quantitySource ||
            !quantitySource
              .replace(/\s/g, '')
              .toLowerCase()
              .includes(value.replace(/\s/g, '').toLowerCase()),
        )
      ) {
        count('unsupportedFact');
        continue;
      }
      if (
        !hasBenefits &&
        mode !== 'general' &&
        /reduce.*(?:spots|pigment)|pigment.*kamay|dog[’‘']lar.*kamay|teri(?:ning)? tonusin|уменьш\p{L}*.*(?:пят|пигмент)|осветляющ\p{L}* свойств|борьбе с пигментац|기미.*(?:줄|개선)/iu.test(
          line,
        )
      ) {
        count('unsupportedBenefit');
        continue;
      }
      if (
        !heading &&
        mode !== 'general' &&
        !instruction &&
        packagingPurposes(line).some((purpose) => {
          const quotes = citations
            .filter((item) =>
              [line, paragraph].some(
                (text) =>
                  matchingCitationText(item.text) ===
                  matchingCitationText(text),
              ),
            )
            .flatMap((item) => item.quotes);
          return (
            !sourcePurposes.includes(purpose) ||
            (quotes.length > 0 &&
              !packagingPurposes(quotes.join('\n')).includes(purpose))
          );
        })
      ) {
        count('unsupportedBenefit');
        continue;
      }
      if (
        stockClaims.some(
          ([claim, evidence], index) =>
            claim.test(line) &&
            !evidence.test(source) &&
            !(instruction && index === 2),
        )
      ) {
        count('unsafeClaim');
        continue;
      }
      if (
        line &&
        /\b(?:manufacturer|distributor|importer)\b|производител\p{L}*|дистрибьютор\p{L}*|ответственн\p{L}* продавец|tashuvchi|ishlab chiqaruvchi|제조업자|책임판매업자/iu.test(
          line,
        )
      )
        continue;
      const protectedLine = recognizedTitle
        ? line.split(recognizedTitle).join('\u0000')
        : line;
      const normalized = normalizeTerminology(protectedLine, language)
        .split('\u0000')
        .join(recognizedTitle ?? '');
      if (heading || !normalized) {
        retained.push(normalized);
        continue;
      }
      const prefix = normalized.match(/^(?:[-*•]|\d+[.)])\s+/)?.[0] ?? '';
      const sentences = normalized
        .slice(prefix.length)
        .split(/(?<=[.!?。])\s+(?=[^\d])/u)
        .filter((sentence) => {
          const signature = plain(sentence)
            .toLocaleLowerCase()
            .replace(/[\p{P}\s]+/gu, '');
          if (signature && seen.has(signature)) {
            count('duplicateSentences');
            return false;
          }
          if (signature) seen.add(signature);
          return true;
        });
      if (sentences.length) {
        retained.push(prefix + sentences.join(' '));
        count('retainedProse');
      }
    }
    if (retained.length) lines.push(retained.join(' '));
  }
  // Drop empty sections left behind by rejected claims.
  const body = lines
    .filter(
      (line, index) =>
        !section(line) ||
        Boolean(
          lines
            .slice(index + 1)
            .find((next) => next)
            ?.trim() &&
          !section(lines.slice(index + 1).find((next) => next) ?? ''),
        ),
    )
    .join('\n')
    .trim();
  const fields = (
    Object.keys(labels[language]) as (InformationField | 'information')[]
  )
    .filter(
      (field): field is InformationField =>
        field !== 'information' && Boolean(facts[field]),
    )
    .map(
      (field) =>
        `- ${labels[language][field]}: ${field === 'origin' ? manufacturingCountryName(facts[field]!, language) : facts[field]}`,
    );
  fields.push(
    ...verifiedIngredientPercentages(source).map(
      (fact) => `- ${fact.ingredient}: ${fact.percentage}`,
    ),
  );
  const ingredientHeading = {
    en: 'Ingredients named on the packaging',
    uz: 'Qadoqda nomi ko‘rsatilgan moddalar',
    ru: 'Ингредиенты, названные на упаковке',
    ko: '포장에 언급된 성분',
  }[language];
  // If model prose was rejected, retain only independently parsed source facts.
  // This is not a bypass: no model text, ingredient role, benefit or direction
  // enters this fallback, and no second provider request is needed.
  const ingredientFallback =
    inventory.length &&
    (!body ||
      inventory.some(
        (item) =>
          !item.aliases.some((alias) =>
            body.toLocaleLowerCase().includes(alias.toLocaleLowerCase()),
          ),
      ))
      ? `## ${ingredientHeading}\n${inventory.map((item) => `- ${ingredientDisplayName(item.ingredient, language)}`).join('\n')}`
      : '';
  return [
    title ? `# ${title}` : '',
    body,
    ingredientFallback,
    fields.length
      ? `## ${labels[language].information}\n${fields.join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

// Metadata alone (including a name plus volume) is not a product description.
// Require a source-verified identity and independently verified ingredients or
// an explicit packaging benefit retained in cited copy. Never pad to a length.
export function hasMeaningfulDescription(
  description: string,
  source: string,
  citations: VerifiedCitation[] = [],
): boolean {
  const title = /^#\s+(.+)$/m.exec(description)?.[1];
  if (!title) return false;
  const facts = extractPackagingFacts(source);
  const inventory = extractPackagingIngredients(
    source,
    verifiedProductTitle(description, source, facts),
  );
  if (
    title !== facts.name &&
    !source.replace(/\s+/g, ' ').includes(title.replace(/\s+/g, ' '))
  )
    return false;
  const content = description.replace(/^#\s+.+$/m, '');
  const ingredientContent = inventory.some((item) =>
    item.aliases.some((alias) =>
      content.toLocaleLowerCase().includes(alias.toLocaleLowerCase()),
    ),
  );
  let mode: ReturnType<typeof section> = null;
  const benefitContent = description.split(/\r?\n/).some((line) => {
    const heading = section(line);
    if (heading) mode = heading;
    return Boolean(
      line.trim() &&
      !heading &&
      !/^#\s/.test(line) &&
      (mode === 'benefits' || mode === 'other' || mode === null),
    );
  });
  const directionContent = retainedDirections(
    description,
    facts.directions,
    citations,
  );
  return (
    ingredientContent ||
    Boolean(
      (facts.benefits || packagingPurposes(title).length) && benefitContent,
    ) ||
    Boolean(productType.test(title) && directionContent)
  );
}

export function descriptionGroundingDiagnostics(
  description: string,
  source: string,
  citations: VerifiedCitation[] = [],
) {
  const diagnostics = { rejectedFields: 0 };
  const facts = extractPackagingFacts(source, diagnostics);
  const title = verifiedProductTitle(description, source, facts);
  const listed = extractPackagingIngredients(source);
  const inventory = extractPackagingIngredients(source, title);
  return {
    recognizedProductIdentity: title ? 1 : 0,
    recognizedProductType: title && productType.test(title) ? 1 : 0,
    listedIngredients: listed.length,
    recognizedIngredientAliases: inventory.length - listed.length,
    supportedClaims:
      (facts.benefits || packagingPurposes(title ?? '').length) &&
      hasMeaningfulDescription(description, source, citations)
        ? 1
        : 0,
    supportedDirections: retainedDirections(
      description,
      facts.directions,
      citations,
    )
      ? 1
      : 0,
    rejectedFields: diagnostics.rejectedFields,
  };
}

function retainedDirections(
  description: string,
  directions: string | undefined,
  citations: VerifiedCitation[],
): boolean {
  if (!directions) return false;
  return (
    description.includes(directions) ||
    description.split(/\r?\n/).some((line) =>
      supportedDirectionTranslation(
        plain(line),
        directions,
        citations
          .filter(
            (item) =>
              matchingCitationText(item.text) === matchingCitationText(line),
          )
          .flatMap((item) => item.quotes),
      ),
    )
  );
}
