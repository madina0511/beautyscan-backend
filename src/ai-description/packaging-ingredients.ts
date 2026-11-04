// A terminology bridge, never a list of ingredients assumed to be present.
// Unknown INCI names work without a lexicon entry, using their source spelling.
const terminology = [
  [
    'niacinamide',
    'niatsinamid',
    'ниацинамид',
    'ниацинамида',
    'ниацинамидом',
    'ниацинамиде',
    '나이아신아마이드',
  ],
  [
    'tranexamic acid',
    'txa',
    'tranexamik kislota',
    'traneksamik kislota',
    'транексамовая кислота',
    'транексамовой кислотой',
    'транексамовой кислоты',
    '트라넥사믹애씨드',
    '트라넥삼산',
  ],
  [
    'glycerin',
    'glycerol',
    'glitserin',
    'глицерин',
    'глицерина',
    'глицерином',
    '글리세린',
  ],
  ['panthenol', 'pantenol', 'пантенол', 'пантенола', 'пантенолом', '판테놀'],
  ['retinol', 'ретинол', 'ретинола', '레티놀'],
  [
    'salicylic acid',
    'salitsil kislota',
    'салициловая кислота',
    'салициловой кислоты',
    '살리실릭애씨드',
  ],
  ['zinc oxide', 'rux oksidi', 'оксид цинка', '징크옥사이드'],
  [
    'sodium hyaluronate',
    'natriy gialuronat',
    'гиалуронат натрия',
    '소듐하이알루로네이트',
  ],
];
const normalize = (value: string) =>
  value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const identity = (name: string) => {
  const value = normalize(name);
  const group = terminology.find((entry) => entry.includes(value));
  return group?.[0] ?? value;
};
export function ingredientDisplayName(
  name: string,
  language: 'uz' | 'en' | 'ko' | 'ru',
): string {
  const names: Record<string, { uz: string; ko: string; ru: string }> = {
    niacinamide: {
      uz: 'niatsinamid',
      ko: '나이아신아마이드',
      ru: 'ниацинамид',
    },
    'tranexamic acid': {
      uz: 'traneksamik kislota',
      ko: '트라넥사믹애씨드',
      ru: 'транексамовая кислота',
    },
    glycerin: { uz: 'glitserin', ko: '글리세린', ru: 'глицерин' },
    panthenol: { uz: 'pantenol', ko: '판테놀', ru: 'пантенол' },
    retinol: { uz: 'retinol', ko: '레티놀', ru: 'ретинол' },
  };
  const localized =
    language === 'en' ? undefined : names[identity(name)]?.[language];
  return localized && normalize(localized) !== normalize(name)
    ? `${localized} (${name})`
    : name;
}
export type PackagingIngredient = {
  ingredient: string;
  aliases: string[];
  percentage?: string;
};
export const percentageValue = (value: string) =>
  value.replace(/\s/g, '').replace(',', '.');

function splitIngredients(value: string): string[] {
  const parts: string[] = [];
  let start = 0,
    depth = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '(') depth++;
    if (character === ')') depth = Math.max(0, depth - 1);
    if (
      !depth &&
      (character === ';' ||
        character === '+' ||
        (character === ',' &&
          !(
            /\d/.test(value[index - 1] ?? '') &&
            /\d/.test(value[index + 1] ?? '')
          )))
    ) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}
function ingredientPiece(
  piece: string,
  requirePercentage: boolean,
): { name: string; percentage?: string } | null {
  const clean = piece.trim().replace(/[.]$/, '');
  const after = /^(.+?)(?:\s*[:：]\s*|\s+)(\d+(?:[.,]\d+)?\s*%)$/.exec(clean);
  const before = /^(\d+(?:[.,]\d+)?\s*%)\s+(.+)$/.exec(clean);
  const name = (after?.[1] ?? before?.[2] ?? clean)
    .trim()
    .replace(/[:：]$/, '');
  const percentage = after?.[2] ?? before?.[1];
  if (requirePercentage && !percentage) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\s()/.+\-]{0,120}$/u.test(name)) return null;
  if (percentage && Number.parseFloat(percentageValue(percentage)) > 100)
    return null;
  if (
    /\b(?:clinical|study|participants|discount|recycled|serum|cream|cleanser|toner|sunscreen|mask|spf|result|tested)\b/iu.test(
      name,
    )
  )
    return null;
  return { name, percentage };
}

export function extractPackagingIngredients(
  source: string,
  verifiedTitle?: string,
): PackagingIngredient[] {
  // All mutable state is local to this source; no product/session cache exists.
  const candidates = new Map<
    string,
    {
      ingredient: string;
      names: Set<string>;
      amounts: Set<string>;
      rawAmounts: string[];
    }
  >();
  let inIngredients = false;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const label =
      /^(?:ingredients|inci|ingredient list|전성분|성분|состав|ингредиенты|tarkib|tarkibi)(?:\s*[:：]\s*(.*)|\s*)$/iu.exec(
        line,
      );
    if (label) inIngredients = true;
    else if (
      !line ||
      /[:：]|^(?:made in|manufactured in)\b|^(?:product name|name|brand|manufacturer|manufactured by|distributor|distributed by|responsible seller|responsible cosmetics seller|importer|imported by|volume|net volume|net contents|country of manufacture|country of origin|directions|how to use|benefits|key benefits|제품명|브랜드|제조업자|화장품제조업자|제조국|내용량|용량|사용법|название продукта|производитель|дистрибьютор|импортёр|объём|mahsulot nomi|ishlab chiqaruvchi|hajmi)\s*$|^\d+(?:[.,]\d+)?\s*(?:ml|мл|g|г)\b/iu.test(
        line,
      )
    )
      inIngredients = false;
    // A standalone ingredient+percentage is also explicit evidence. A product
    // name/model number, clinical percentage or address is not.
    const pieces = label
      ? splitIngredients(label[1] ?? '')
      : inIngredients
        ? splitIngredients(line)
        : [line];
    for (const piece of pieces) {
      const parsed = ingredientPiece(piece, !label && !inIngredients);
      if (!parsed) continue;
      const id = identity(parsed.name);
      const value = candidates.get(id) ?? {
        ingredient: parsed.name,
        names: new Set<string>(),
        amounts: new Set<string>(),
        rawAmounts: [],
      };
      value.names.add(parsed.name);
      if (parsed.percentage) {
        value.amounts.add(percentageValue(parsed.percentage));
        value.rawAmounts.push(parsed.percentage);
      }
      candidates.set(id, value);
    }
  }
  const ingredients = [...candidates.entries()].map(([id, entry]) => ({
    ingredient: entry.ingredient,
    aliases: [
      ...new Set([
        ...entry.names,
        ...(terminology.find((group) => group[0] === id) ?? []),
      ]),
    ],
    ...(entry.amounts.size === 1 ? { percentage: entry.rawAmounts[0] } : {}),
  }));
  // Title mentions are not a full INCI list and title numerals never establish
  // percentages. Only inspect a caller-verified current-product identity.
  if (
    verifiedTitle &&
    source.replace(/\s+/g, ' ').includes(verifiedTitle.replace(/\s+/g, ' '))
  ) {
    for (const group of terminology) {
      const alias = group.find((name) => {
        const token = escape(name);
        const mentioned = new RegExp(
          `(?:^|[^\\p{L}\\p{N}])${token}(?=$|[^\\p{L}]|\\d)`,
          'iu',
        ).test(verifiedTitle);
        const negated = new RegExp(
          `(?:without|no|free from|без)\\s+${token}|${token}\\s*[-–]?\\s*(?:free|alternative|yo[‘’']q|무첨가|없는|불포함)`,
          'iu',
        ).test(verifiedTitle);
        return mentioned && !negated;
      });
      if (
        alias &&
        !ingredients.some((item) => identity(item.ingredient) === group[0])
      ) {
        ingredients.push({ ingredient: group[0], aliases: [...group] });
      }
    }
  }
  return ingredients;
}

function grammaticalSuffix(name: string): string {
  if (/[가-힣]/u.test(name)) return '(?:은|는|이|가|을|를|과|와|의|으로|로)?';
  if (
    /^(?:niatsinamid|glitserin|pantenol|retinol|traneksamik kislota|tranexamik kislota)$/iu.test(
      name,
    )
  )
    return '(?:ning|ni|ga|dan)?';
  return '';
}

function containsName(text: string, name: string): boolean {
  // Korean particles and Uzbek case endings do not introduce a new ingredient.
  // Recognize only complete names plus a bounded grammatical suffix, never an
  // arbitrary substring (e.g. retinol is not retinyl palmitate).
  const suffix = `${grammaticalSuffix(name)}(?=$|[^\\p{L}\\p{N}])`;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(name)}${suffix}`, 'iu').test(
    text,
  );
}
export function ingredientReferenceSupported(
  name: string,
  inventory: PackagingIngredient[],
): boolean {
  return inventory.some((item) =>
    item.aliases.some((alias) => identity(alias) === identity(name)),
  );
}
export function mentionedPackagingIngredients(
  line: string,
  inventory: PackagingIngredient[],
): PackagingIngredient[] {
  return inventory.filter((item) =>
    item.aliases.some((alias) => containsName(line, alias)),
  );
}
export function ingredientMentionsSupported(
  line: string,
  inventory: PackagingIngredient[],
  checkNamedItem = true,
): boolean {
  // Shared glossary concepts are not permission to introduce absent ingredients.
  if (
    terminology.some(
      (group) =>
        group.some((name) => containsName(line, name)) &&
        !inventory.some((item) => identity(item.ingredient) === group[0]),
    )
  )
    return false;
  const namedItem =
    /^\s*(?:[-*•]\s+)?(?:\*\*)?([^:：]+?)(?:\*\*)?\s*[:：]/u.exec(line);
  return (
    !checkNamedItem ||
    !namedItem ||
    ingredientReferenceSupported(namedItem[1].trim(), inventory)
  );
}
export function ingredientPercentagesSupported(
  line: string,
  inventory: PackagingIngredient[],
): boolean {
  return [...line.matchAll(/\d+(?:[.,]\d+)?\s*%/g)].every((match) => {
    const left = line.slice(0, match.index).replace(/\*\*/g, '');
    const right = line
      .slice((match.index ?? 0) + match[0].length)
      .replace(/\*\*/g, '');
    return inventory.some(
      (item) =>
        item.percentage &&
        percentageValue(item.percentage) === percentageValue(match[0]) &&
        item.aliases.some(
          (alias) =>
            new RegExp(
              `(?:^|[^\\p{L}\\p{N}])${escape(alias)}${grammaticalSuffix(alias)}\\s*[:：(-]?\\s*$`,
              'iu',
            ).test(left) ||
            new RegExp(
              `^\\s*[:：)-]?\\s*${escape(alias)}${grammaticalSuffix(alias)}(?:$|[^\\p{L}\\p{N}])`,
              'iu',
            ).test(right),
        ),
    );
  });
}
