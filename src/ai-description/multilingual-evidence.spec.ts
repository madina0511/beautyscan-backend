import {
  EvidenceDiagnostics,
  supportedDescription,
} from './description-evidence';

const freshDiagnostics = (): EvidenceDiagnostics => ({
  entries: 0,
  acceptedEntries: 0,
  invalidQuotes: 0,
  bodyLines: 0,
  supportedLines: 0,
  presentationMatches: 0,
  invalidEntries: 0,
  uncitedLines: 0,
  unsupportedNumbers: 0,
});

describe('Presentation-equivalent source quotes and independently cited sentences', () => {
  it.each([
    [
      'Tarkib: Glycerin. Namlikni saqlashga ko‘maklashadi.',
      "namlikni saqlashga ko'maklashadi.",
    ],
    [
      'Ingredients: NIACINAMIDE, TRANEXAMIC ACID',
      'Niacinamide, Tranexamic Acid',
    ],
    ['Moisture‐care cream', 'Moisture-care cream'],
    ['전성분: 글리세린', '글리세린'],
  ])('accepts only presentation changes in a quote (%s)', (source, quote) => {
    const diagnostics = freshDiagnostics();
    const line = 'A source-backed statement.';
    expect(
      supportedDescription(
        JSON.stringify({
          description: line,
          evidence: [{ text: line, quotes: [quote] }],
        }),
        source,
        diagnostics,
      ),
    ).toBe(line);
    expect(diagnostics.invalidQuotes).toBe(0);
    expect(diagnostics.presentationMatches).toBe(quote === '글리세린' ? 0 : 1);
  });

  it.each([
    ['Ingredients: Niacinamide', '나이아신아마이드'],
    ['Ingredients: Glycerin', 'Glycerol'],
    ['Niacinamide 10%', 'Niacinamide 1%'],
    ['Tranexamic Acid 4%', 'Tranexamic Acid 40%'],
    ['Ingredient unknown', 'Niacinamide'],
  ])(
    'does not translate, alias, repair or invent source quotes (%s)',
    (source, quote) => {
      const diagnostics = freshDiagnostics();
      const result = supportedDescription(
        JSON.stringify({
          description: 'A statement.',
          evidence: [{ text: 'A statement.', quotes: [quote] }],
        }),
        source,
        diagnostics,
      );
      expect(result).toBe('');
      expect(diagnostics.invalidQuotes).toBe(1);
    },
  );

  it('rejects a whole mixed current/stale citation set', () => {
    expect(
      supportedDescription(
        JSON.stringify({
          description: 'A statement.',
          evidence: [{ text: 'A statement.', quotes: ['Glycerin', 'Retinol'] }],
        }),
        'Ingredients: Glycerin',
      ),
    ).toBe('');
  });

  it('retains complete individually cited sentences, not unsupported adjacent prose', () => {
    const diagnostics = freshDiagnostics();
    const result = supportedDescription(
      JSON.stringify({
        description:
          'A sourced sentence. An unsupported promise. Another sourced sentence.',
        evidence: [
          { text: 'A sourced sentence.', quotes: ['Glycerin'] },
          { text: 'Another sourced sentence.', quotes: ['Glycerin'] },
        ],
      }),
      'Ingredients: Glycerin',
      diagnostics,
    );
    expect(result).toBe('A sourced sentence. Another sourced sentence.');
    expect(diagnostics.uncitedLines).toBe(1);
  });

  it('does not rescue a partial directions or general-role paragraph by dropping its qualifier/restriction', () => {
    for (const heading of [
      'How to use',
      '사용 방법',
      'General ingredient information',
      'Moddalar haqida umumiy ma’lumot',
    ]) {
      const result = supportedDescription(
        JSON.stringify({
          description: `## ${heading}\nA sourced sentence. An uncited restriction.`,
          evidence: [{ text: 'A sourced sentence.', quotes: ['Glycerin'] }],
        }),
        'Ingredients: Glycerin',
      );
      expect(result).not.toContain('A sourced sentence.');
    }
  });

  it('distinguishes missing citations from unsupported numerals and malformed entries without content', () => {
    const diagnostics = freshDiagnostics();
    supportedDescription(
      JSON.stringify({
        description: 'Uncited.\nGlycerin 12%.',
        evidence: [null, { text: 'Glycerin 12%.', quotes: ['Glycerin'] }],
      }),
      'Ingredients: Glycerin',
      diagnostics,
    );
    expect(diagnostics).toMatchObject({
      invalidEntries: 1,
      uncitedLines: 1,
      unsupportedNumbers: 1,
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(/Glycerin|Uncited/);
  });
});
