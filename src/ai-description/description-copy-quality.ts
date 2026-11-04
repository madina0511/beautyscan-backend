import { descriptionSentences } from './description-evidence';
import {
  extractPackagingFacts,
  hasMeaningfulDescription,
} from './description-grounding';
import { extractPackagingIngredients } from './packaging-ingredients';
import { packagingPurposes } from './packaging-copy-evidence';
import type { VerifiedCitation } from './description-evidence';

// Numeric/enum diagnostics only. Minimum saveability and editorial richness are
// separate: an honest short description must never be padded or rejected just
// because a language uses fewer words than English.
export function descriptionCopyQuality(
  description: string,
  source: string,
  citations: VerifiedCitation[] = [],
) {
  const facts = extractPackagingFacts(source);
  const title = /^#\s+(.+)$/m.exec(description)?.[1];
  const inventory = extractPackagingIngredients(source, title);
  const sourcePurposeCount = packagingPurposes(
    `${title ?? ''}\n${facts.benefits ?? ''}`,
  ).length;
  const meaningful = hasMeaningfulDescription(description, source, citations);
  let inIntroduction = true;
  let introductionSentences = 0;
  let bodySentences = 0;
  let proseLines = 0;
  for (const raw of description.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^##\s/u.test(line)) inIntroduction = false;
    if (!line || /^#/u.test(line) || /^[-*•]\s/u.test(line)) continue;
    const sentences = descriptionSentences(line).length;
    bodySentences += sentences;
    proseLines++;
    if (inIntroduction) introductionSentences += sentences;
  }
  const evidenceSupportsIntroduction = Boolean(
    title && (sourcePurposeCount || facts.directions) && inventory.length,
  );
  const level = !meaningful
    ? 'insufficient'
    : !proseLines
      ? 'facts_only'
      : introductionSentences >= 2
        ? 'developed'
        : 'concise';
  return {
    level,
    introductionSentences,
    bodySentences,
    proseLines,
    groundedCharacters: description.length,
    sourcePurposeCount,
    sourceIngredientCount: inventory.length,
    evidenceSupportsIntroduction,
    underdeveloped:
      meaningful && evidenceSupportsIntroduction && introductionSentences < 2,
  };
}
