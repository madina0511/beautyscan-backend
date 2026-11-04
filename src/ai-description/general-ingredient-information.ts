import {
  ingredientReferenceSupported,
  mentionedPackagingIngredients,
  PackagingIngredient,
} from './packaging-ingredients';
import { generalIngredientTopics } from './packaging-copy-evidence';

// Reviewed cosmetic-role families, NOT facts about any finished product.
// Keep this deliberately small. Unknown ingredients retain their source-listed
// presence, but do not get an unreviewed explanation from model memory.
// Background: https://pubmed.ncbi.nlm.nih.gov/12100180/ (niacinamide),
// https://pubmed.ncbi.nlm.nih.gov/27135282/ (TXA), and European Commission
// https://ec.europa.eu/health/scientific_committees/opinions_layman/products-resembling-food/en/figtableboxes/5.htm (glycerin).
// No clinical results, concentrations, timelines or mechanisms are authorized.
const reviewedRoles: Record<string, string[]> = {
  niacinamide: ['tone'],
  'tranexamic acid': ['tone'],
  glycerin: ['moisture'],
  panthenol: ['moisture'],
  'sodium hyaluronate': ['moisture'],
};

export const generalInformationQualifier =
  /general (?:cosmetic|ingredient|information)|umumiy (?:kosmetik|ma[‘’']lumot)|общ\p{L}* (?:информац|косметич)|일반(?:적)?(?:인)?\s*(?:성분|화장품|정보)/iu;

const productEffect =
  /(?:this|the) (?:product|serum|cream|formula)\b[^.!?]*(?:helps|reduces|improves|hydrates|moisturizes)|(?:bu|ushbu) (?:mahsulot|zardob|krem)[^.!?]*(?:yordam beradi|kamaytir|namlantir)|(?:этот|данный) (?:продукт|крем|средство)[^.!?]*(?:помогает|уменьшает|увлажняет)|이\s*(?:제품|세럼|크림)[^.!?]*(?:도움|개선|보습)/iu;

export function supportedGeneralIngredientInformation(
  line: string,
  inventory: PackagingIngredient[],
  sectionText: string,
): boolean {
  if (!generalInformationQualifier.test(sectionText)) return false;
  const mentioned = mentionedPackagingIngredients(line, inventory);
  // A standalone qualifying sentence may introduce the subsection, but may not
  // carry positive finished-product claims into general ingredient information.
  if (!mentioned.length)
    return generalInformationQualifier.test(line) && !productEffect.test(line);
  if (productEffect.test(line)) return false;
  const roles = generalIngredientTopics(line);
  if (!roles.length) return false;
  return mentioned.every((item) => {
    const allowed = Object.entries(reviewedRoles).find(([name]) =>
      ingredientReferenceSupported(name, [item]),
    )?.[1];
    return Boolean(allowed && roles.every((role) => allowed.includes(role)));
  });
}
