type Evidence = { text: string; quotes: string[] };
export type VerifiedCitation = { text: string; quotes: string[] };
export const matchingCitationText = (value: string) => citationText(value);
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
  const currentSource = normalize(source);
  if (diagnostics)
    Object.assign(diagnostics, {
      entries: value.evidence.length,
      acceptedEntries: 0,
      invalidQuotes: 0,
      bodyLines: 0,
      supportedLines: 0,
    });
  const evidence: Evidence[] = value.evidence.flatMap((item: unknown) => {
    if (
      !record(item) ||
      typeof item.text !== 'string' ||
      !Array.isArray(item.quotes) ||
      !item.quotes.length ||
      item.quotes.length > 8
    )
      return [];
    const quotes = item.quotes.filter(
      (quote: unknown): quote is string =>
        typeof quote === 'string' &&
        normalize(quote).length >= 2 &&
        quote.length <= 500 &&
        currentSource.includes(normalize(quote)) &&
        (normalize(quote).length >= 4 ||
          new RegExp(
            `(?:^|[^\\p{L}\\p{N}])${normalize(quote).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}\\p{N}])`,
            'u',
          ).test(currentSource)),
    );
    // Every quote must belong to this source. Never accept a mix of current and
    // stale product citations, or treat a generated statement as source evidence.
    if (diagnostics) {
      diagnostics.invalidQuotes += item.quotes.length - quotes.length;
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
  return value.description
    .split(/\r?\n/)
    .filter((line) => {
      if (!line.trim() || /^\s*#{1,6}\s/.test(line)) return true;
      if (diagnostics) diagnostics.bodyLines++;
      const numbers: string[] =
        line.replace(/^\s*\d+[.)]\s+/, '').match(/\d+(?:[.,]\d+)?/g) ?? [];
      const supported = evidence.some(
        (item) =>
          item.text === citationText(line) &&
          numbers.every((number) =>
            item.quotes.some((quote) =>
              new RegExp(
                `(?:^|[^0-9])${number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^0-9])`,
              ).test(normalize(quote)),
            ),
          ),
      );
      if (diagnostics && supported) diagnostics.supportedLines++;
      if (supported && citations)
        citations.push({
          text: line,
          quotes: evidence
            .filter((item) => item.text === citationText(line))
            .flatMap((item) => item.quotes),
        });
      return supported;
    })
    .join('\n');
}
