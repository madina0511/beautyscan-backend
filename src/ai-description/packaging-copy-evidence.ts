// A small multilingual bridge for explicit packaging purposes, not benefits
// inferred from ingredient presence, brand identity, or product category.
const purposes: Record<string, RegExp> = {
  tone: /dark[ -]?spots?|uneven (?:skin )?tone|even[ -]looking (?:skin )?tone|pigment(?:ation)? (?:care|correct)|pigment dog|teri(?:ning)? rangi(?:ni)? bir tekis|пигментн\p{L}* пят|выравнив\p{L}* тон|неровн\p{L}* тон|잡티|기미|색소\s*침착|피부(?:의)?\s*톤|고른\s*톤/iu,
  moisture:
    /moisturi[sz](?:e|ing|ation|er)|hydrat(?:e|ing|ion)|\bmoisture\b|humectant|nam(?:lik|lantir)|увлажн|удержива\p{L}* влаг|수분|보습/iu,
  soothing: /soothing|soothes|tinchlantir|успокаива|진정/iu,
  cleansing:
    /cleans(?:ing|es|er)|removes (?:makeup|impurities)|tozala|очища|очищени|클렌징|세정|노폐물\s*제거/iu,
  sun: /sun protection|SPF\s*\d|quyoshdan himoya|защит\p{L}* от солнц|자외선\s*차단/iu,
  exfoliation: /exfoliat|eksfoliats|отшелуш|각질\s*제거/iu,
  wrinkles: /wrinkl|ajin|морщин|주름/iu,
  barrier: /skin barrier|teri to[‘’']sig|кожн\p{L}* барьер|장벽/iu,
  antioxidant: /antioxidant|antioksidant|антиоксидант|항산화/iu,
};
const negatedPurpose =
  /\b(?:not|no|without|never)\b|не\s+(?:увлаж|успока|очища|предназнач)|(?:namlantir|tinchlantir|tozala)\p{L}*may|아니|않|없/iu;
export function packagingPurposes(text: string): string[] {
  // Never promote a negated label claim into positive product evidence.
  const positiveStatements = text
    .split(/[\n.!?。]+/u)
    .filter((line) => !negatedPurpose.test(line));
  return Object.entries(purposes)
    .filter(([, pattern]) =>
      positiveStatements.some((line) => pattern.test(line)),
    )
    .map(([name]) => name);
}

// Topic recognition for separately qualified general ingredient text. Negative
// finished-product disclaimers must not hide the ingredient topic; this function
// is never used to establish a packaging benefit or authorize product efficacy.
export function generalIngredientTopics(text: string): string[] {
  return Object.entries(purposes)
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
const actions: Record<string, RegExp> = {
  apply: /apply|spread|нанес|surting|surtish|surtil|바르|바릅|발라|도포/iu,
  pat: /pat\b|похлоп|qoq|두드/iu,
  massage: /massag|массаж|마사지/iu,
  rinse: /rinse|wash off|смой|смыть|chay|yuvib tash|씻어|헹/iu,
  clean: /cleansed|clean skin|cleanse|очищенн|toza|tozalangan|깨끗|세안/iu,
  mix: /mix|dilut|смеш|разбав|aralashtir|suyultir|혼합|섞|희석/iu,
  leave: /leave on|остав|qoldir|그대로|방치/iu,
};
const modifiers: Record<string, RegExp> = {
  amount: /amount|количеств|miqdor|적당량|소량/iu,
  face: /\bface\b|лицо|лица|yuz|얼굴/iu,
  neck: /\bneck\b|шею|шеи|bo'yin|목/iu,
  minutes: /minutes?|минут|daqiqa|\d+\s*분/iu,
  seconds: /seconds?|секунд|soniya|\d+\s*초/iu,
  hot: /\bhot\b|горяч|issiq|뜨거/iu,
  cold: /\bcold\b|холод|sovuq|차가/iu,
  water: /\bwater\b|водой|suv|(?:^|\s)물(?:로|을|과|에|\s|$)/iu,
  few: /\bfew\b|нескольк|bir necha|몇/iu,
  drops: /\bdrops?\b|капл|tomchi|방울/iu,
  daily: /daily|every day|ежеднев|har kuni|매일|하루/iu,
  weekly: /weekly|every week|еженедел|hafta|매주/iu,
  morning: /morning|утр|ertalab|아침/iu,
  evening: /evening|night|вечер|ноч|kechqurun|kechasi|저녁|밤/iu,
  once: /\bonce\b|один раз|bir marta|한 번/iu,
  twice: /\btwice\b|два раза|ikki marta|두 번/iu,
  small: /small amount|небольш\p{L}* количеств|oz miqdor|소량/iu,
  dry: /dry skin|сухую кожу|quruq teri|마른 피부/iu,
  wet: /wet skin|влажную кожу|nam teri|젖은 피부/iu,
};
const noRinse =
  /do not rinse|не смыва|chaymang|yuvib tashlamang|씻어내지|헹구지/iu;
const avoidEyes =
  /avoid.*eyes|избега.*глаз|ko'z.*(?:saqlan|tekkizmang)|눈.*피하/iu;
export const sourceInstructionLine = (line: string) =>
  /^(?:apply|spread|pat\b|gently\s+(?:pat|massage)|massage|rinse|avoid|do not|нанес|слегка|помассируйте|смойте|избегайте|не\s|toza|surting|yengil|chaying|ko['‘’]z|적당량|깨끗|가볍게|눈가)/iu.test(
    line.trim(),
  );

// Citation matching proves provenance, not semantic equivalence. Permit a
// translation only when its recognized actions/modifiers are source-supported;
// numerals and safety restrictions are checked independently. Translations
// without a recognized action fail; this is a conservative heuristic, not a
// general semantic proof of arbitrary instructions.
export function supportedDirectionTranslation(
  line: string,
  sourceDirections: string,
  quotes: string[],
): boolean {
  const source = normalize(sourceDirections);
  const target = normalize(line).replace(/^[-*]\s*/, '');
  if (
    !quotes.length ||
    !quotes.some((quote) => {
      const text = normalize(quote);
      return source.includes(text) || text.includes(source);
    })
  )
    return false;
  const targetActions = Object.entries(actions).filter(([, pattern]) =>
    pattern.test(target),
  );
  if (
    !targetActions.length ||
    targetActions.some(([, pattern]) => !pattern.test(source))
  )
    return false;
  if (
    Object.values(modifiers).some(
      (pattern) => pattern.test(target) && !pattern.test(source),
    )
  )
    return false;
  const numbers: string[] = target.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (
    numbers.some(
      (number) =>
        !new RegExp(`(?:^|[^0-9])${number.replace('.', '\\.')}($|[^0-9])`).test(
          source,
        ),
    )
  )
    return false;
  if (noRinse.test(source) !== noRinse.test(target)) return false;
  if (avoidEyes.test(source) && !avoidEyes.test(target)) return false;
  return true;
}
