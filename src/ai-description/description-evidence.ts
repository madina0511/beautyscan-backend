type Evidence = { text: string; quotes: string[] };
export type VerifiedCitation = { text: string; quotes: string[] };
export const matchingCitationText = (value: string) => citationText(value);
// Presentation equivalence only: no translation, spelling repair, punctuation
// deletion, stemming, or fuzzy matching of evidence from another product.
export const normalizeSourceQuote = (value: string) =>
  normalize(value)
    .toLowerCase()
    .replace(/[‘’ʻʼ]/g, "'")
    .replace(/[‐‑–]/g, '-');

export const descriptionSentences = (value: string): string[] =>
  value.split(/(?<=[.!?。])\s+(?=[^\d])/u).filter((part) => part.trim());
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/[\u200B\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
export type EvidenceDiagnostics = {
  entries: number;
  acceptedEntries: number;
  invalidQuotes: number;
  bodyLines: number;
  supportedLines: number;
  presentationMatches: number;
  invalidEntries: number;
  uncitedLines: number;
  unsupportedNumbers: number;
};
// Markdown decoration is not a claim. Compare the same visible generated text;
// source quotes still require an exact whitespace-normalized OCR match.
const citationText = (value: string) =>
  normalize(value.replace(/^\s*[-*+]\s+/, '').replace(/\*\*|__/g, ''));

export class DescriptionEvidenceError extends Error {
  constructor(public readonly reason: 'invalid_json' | 'invalid_schema') {
    super(reason);
  }
}

export function supportedDescription(
  content: string,
  source: string,
  diagnostics?: EvidenceDiagnostics,
  citations?: VerifiedCitation[],
): string {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new DescriptionEvidenceError('invalid_json');
  }
  if (
    !record(value) ||
    typeof value.description !== 'string' ||
    !Array.isArray(value.evidence) ||
    value.evidence.length > 500
  )
    throw new DescriptionEvidenceError('invalid_schema');
  const currentSource = normalizeSourceQuote(source);
  if (diagnostics)
    Object.assign(diagnostics, {
      entries: value.evidence.length,
      acceptedEntries: 0,
      invalidQuotes: 0,
      bodyLines: 0,
      supportedLines: 0,
      presentationMatches: 0,
      invalidEntries: 0,
      uncitedLines: 0,
      unsupportedNumbers: 0,
    });
  const evidence: Evidence[] = value.evidence.flatMap((item: unknown) => {
    if (
      !record(item) ||
      typeof item.text !== 'string' ||
      !Array.isArray(item.quotes) ||
      !item.quotes.length ||
      item.quotes.length > 8
    ) {
      if (diagnostics) diagnostics.invalidEntries++;
      return [];
    }
    const quotes = item.quotes.filter(
      (quote: unknown): quote is string =>
        typeof quote === 'string' &&
        normalize(quote).length >= 2 &&
        quote.length <= 500 &&
        currentSource.includes(normalizeSourceQuote(quote)) &&
        (normalize(quote).length >= 4 ||
          new RegExp(
            `(?:^|[^\\p{L}\\p{N}])${normalizeSourceQuote(quote).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}\\p{N}])`,
            'u',
          ).test(currentSource)),
    );
    // Every quote must belong to this source. Never accept a mix of current and
    // stale product citations, or treat a generated statement as source evidence.
    if (diagnostics) {
      diagnostics.invalidQuotes += item.quotes.length - quotes.length;
      diagnostics.presentationMatches += quotes.filter(
        (quote) => !normalize(source).includes(normalize(quote)),
      ).length;
      if (quotes.length === item.quotes.length) diagnostics.acceptedEntries++;
    }
    return quotes.length === item.quotes.length
      ? item.text
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map((line) => ({ text: citationText(line), quotes }))
      : [];
  });
  // A provider may wrap a paragraph differently in description and evidence.
  // Accept only the complete identical paragraph, then inherit its citations;
  // never use fuzzy matching or authorize an arbitrary substring.
  for (const block of value.description.split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/);
    if (
      lines.length < 2 ||
      lines.some((line) => /^\s*(?:#|[-*+]\s)/.test(line))
    )
      continue;
    const match = evidence.find((item) => item.text === citationText(block));
    if (match)
      evidence.push(
        ...lines.map((line) => ({
          text: citationText(line),
          quotes: match.quotes,
        })),
      );
  }
  let indivisibleSection = false;
  return value.description
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*#{1,6}\s/.test(line)) {
        indivisibleSection =
          /how to use|usage|directions|qo[‘’']llash|способ применения|применение|사용|general|umumiy|общ\p{L}*|일반/iu.test(
            line,
          );
        return line;
      }
      if (!line.trim()) return line;
      if (diagnostics) diagnostics.bodyLines++;
      const matches = evidence.filter(
        (item) => item.text === citationText(line),
      );
      // Sentence-level citations can describe a connected paragraph. Each
      // sentence must match completely; an arbitrary matching substring cannot
      // authorize adjacent prose. Partial/invalid quote sets stay rejected.
      const parts =
        matches.length || indivisibleSection || /^\s*[-*•]/u.test(line)
          ? [line]
          : descriptionSentences(line);
      const retained = parts.filter((part) => {
        const numbers: string[] =
          part.replace(/^\s*\d+[.)]\s+/, '').match(/\d+(?:[.,]\d+)?/g) ?? [];
        const candidates = evidence.filter(
          (item) => item.text === citationText(part),
        );
        const supported = evidence.some(
          (item) =>
            item.text === citationText(part) &&
            numbers.every((number) =>
              item.quotes.some((quote) =>
                new RegExp(
                  `(?:^|[^0-9])${number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^0-9])`,
                ).test(normalize(quote)),
              ),
            ),
        );
        if (diagnostics && !supported) {
          if (!candidates.length) diagnostics.uncitedLines++;
          else diagnostics.unsupportedNumbers++;
        }
        if (supported && citations)
          citations.push({
            text: part,
            quotes: evidence
              .filter((item) => item.text === citationText(part))
              .flatMap((item) => item.quotes),
          });
        return supported;
      });
      if (diagnostics && retained.length) diagnostics.supportedLines++;
      return retained.length ? retained.join(' ') : null;
    })
    .filter((line): line is string => line !== null)
    .join('\n');
}
