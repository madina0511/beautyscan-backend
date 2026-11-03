import {
  groundDescription,
  extractPackagingFacts,
  verifiedIngredientPercentages,
} from './description-grounding';
import {
  extractPackagingIngredients,
  ingredientPercentagesSupported,
  ingredientMentionsSupported,
} from './packaging-ingredients';
import { supportedDescription } from './description-evidence';
import { cosmeticsProducts } from './fixtures/cosmetics-products';
import { syntheticVerifiedOcr, productName } from './fixtures/anua-regressions';

describe('Universal current-product grounding (synthetic categories)', () => {
  it.each(cosmeticsProducts)(
    'independently validates $category facts and arbitrary ingredient percentages',
    (product) => {
      expect(extractPackagingFacts(product.source).name).toBe(product.name);
      expect(extractPackagingFacts(product.source).origin).toBe(product.origin);
      const amounts = verifiedIngredientPercentages(product.source).map(
        (item) => item.percentage,
      );
      expect(amounts).toEqual([...product.percentages]);
      const result = groundDescription(
        '# Invented name\n\n## Product information\n- Country of manufacture: Korea\n- Volume: 30 mL',
        product.source,
        product.language,
      );
      expect(result.split('\n')[0]).toBe(`# ${product.name}`);
      for (const amount of product.percentages)
        expect(result).toContain(amount);
      if (!product.origin)
        expect(extractPackagingFacts(product.source).origin).toBeUndefined();
      expect(result).not.toContain('Cosmax');
      expect(result).not.toContain('The Founders');
      expect(result).not.toContain(productName);
    },
  );
  it.each(cosmeticsProducts)(
    'cannot inherit prior product facts into $category',
    (product) => {
      // Run the prior product first: extraction must not seed a product cache.
      groundDescription(`# ${productName}`, syntheticVerifiedOcr, 'uz');
      const stale = `# ${productName}\n\nNiacinamide 10% and Tranexamic Acid 4%.\n\n## Highlighted ingredients\n- Niacinamide: pigmentation care\n- Tranexamic Acid: ingredient role\n\n## Product information\n- Manufacturer: Cosmax Inc.\n- Responsible seller: The Founders Inc.\n- Volume: 30 mL\n- Country of manufacture: Republic of Korea`;
      const result = groundDescription(stale, product.source, product.language);
      expect(result.split('\n')[0]).toBe(`# ${product.name}`);
      expect(result).not.toMatch(
        /Niacinamide|Tranexamic|10%|Cosmax|The Founders|ANUA/,
      );
      const fields = extractPackagingFacts(product.source);
      if (fields.volume) expect(result).toContain(fields.volume);
      if (fields.origin) expect(result).toContain(fields.origin);
    },
  );
  it('validates arbitrary ingredients without requiring a glossary entry', () => {
    const inventory = extractPackagingIngredients(
      'Ingredients: Bakuchiol 1%, Ectoin 0.3%, Beta Glucan 2%, Acetyl Hexapeptide-8 0.01%',
    );
    expect(inventory.map((item) => item.ingredient)).toEqual([
      'Bakuchiol',
      'Ectoin',
      'Beta Glucan',
      'Acetyl Hexapeptide-8',
    ]);
    expect(
      ingredientPercentagesSupported(
        'Bakuchiol 1% and Ectoin 0.3%.',
        inventory,
      ),
    ).toBe(true);
    expect(
      ingredientPercentagesSupported(
        'Bakuchiol 0.3% and Ectoin 1%.',
        inventory,
      ),
    ).toBe(false);
    expect(
      ingredientMentionsSupported(
        '- Unknown Peptide: a cosmetic role',
        inventory,
      ),
    ).toBe(false);
  });
  it('does not confuse SPF, marketing numbers or study results with ingredient concentrations', () => {
    const inventory = extractPackagingIngredients(
      'Product name: Example SPF 50 PA+++\nClinical study 90%\nModel: 10 4\nVolume: 50 mL\nIngredients: Zinc Oxide 15%',
    );
    expect(inventory.map((item) => item.ingredient)).toEqual(['Zinc Oxide']);
    expect(ingredientPercentagesSupported('Zinc Oxide 50%.', inventory)).toBe(
      false,
    );
    expect(ingredientPercentagesSupported('Niacinamide 10%.', inventory)).toBe(
      false,
    );
  });
  it('omits a contradictory concentration without losing the independent role and volume fields', () => {
    const source =
      'Product name: Example Cream\nIngredients: Panthenol 2%\nPanthenol 5%\nManufacturer: Example Lab\nVolume: 45 g';
    expect(verifiedIngredientPercentages(source)).toEqual([]);
    expect(extractPackagingFacts(source)).toMatchObject({
      manufacturer: 'Example Lab',
      volume: '45 g',
    });
  });
  it('requires current-source citations for every generated prose block in any language', () => {
    const source = 'Ingredients: Bakuchiol 1%';
    const staleQuote = 'Ingredients: Niacinamide 10%, Tranexamic Acid 4%';
    const payload = JSON.stringify({
      description:
        '# Title\n\nA sourced line.\n\nA stale line.\n\nAn uncited line.',
      evidence: [
        { text: 'A sourced line.', quotes: [source] },
        { text: 'A stale line.', quotes: [staleQuote] },
      ],
    });
    expect(supportedDescription(payload, source)).toBe(
      '# Title\n\nA sourced line.\n\n',
    );
  });
  it('rejects mixed current/stale evidence, empty evidence, malformed payloads and invented benefits', () => {
    const source = 'Product name: Example Mask\nIngredients: Aqua, Kaolin';
    for (const quotes of [
      [],
      ['not in this source'],
      [source, 'another product'],
    ]) {
      const result = supportedDescription(
        JSON.stringify({
          description: 'Cures acne.',
          evidence: [{ text: 'Cures acne.', quotes }],
        }),
        source,
      );
      expect(result).toBe('');
    }
    expect(() => supportedDescription('Raw model prose', source)).toThrow();
    const benefits = groundDescription(
      '## Key benefits\nCures acne.\n\n## How to use\nApply twice daily.',
      source,
      'en',
    );
    expect(benefits).not.toContain('Cures acne');
    expect(benefits).not.toContain('twice daily');
  });
  it('does not accept arbitrary old uppercase brand identifiers even with a new citation', () => {
    for (const staleBrand of ['ANUA', 'PREVIOUS-BRAND', 'UNRELATED']) {
      const result = groundDescription(
        `${staleBrand} formula.`,
        'Product name: Example Toner\nIngredients: Aqua',
        'en',
      );
      expect(result).not.toContain(staleBrand);
      expect(result).toContain('Example Toner');
    }
  });
  it('does not invent a protection rating or introduce numbers absent from cited evidence', () => {
    const product = cosmeticsProducts.find(
      (item) => item.category === 'sunscreen',
    );
    if (!product) throw new Error('Missing fixture');
    const result = groundDescription(
      'SPF 100 protection.\n\nSPF 50 protection.',
      product.source,
      'en',
    );
    expect(result).not.toContain('SPF 100');
    expect(result).toContain('SPF 50 protection.');
    const payload = JSON.stringify({
      description: 'SPF 100 protection.',
      evidence: [{ text: 'SPF 100 protection.', quotes: [product.name] }],
    });
    expect(supportedDescription(payload, product.source)).toBe('');
  });
});
