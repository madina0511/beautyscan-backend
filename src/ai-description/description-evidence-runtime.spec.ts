import {
  DescriptionEvidenceError,
  supportedDescription,
} from './description-evidence';

describe('Provider evidence response compatibility', () => {
  it('accepts identical cited text with different Markdown decoration', () => {
    const result = supportedDescription(
      JSON.stringify({
        description: '# Cream\n- **Glycerin**',
        evidence: [{ text: 'Glycerin', quotes: ['Ingredients: Glycerin'] }],
      }),
      'Cream\nIngredients: Glycerin',
    );
    expect(result).toContain('- **Glycerin**');
  });

  it('still rejects stale quotes and uncited numbers despite formatting differences', () => {
    const result = supportedDescription(
      JSON.stringify({
        description: '- **Glycerin 10%**\n- Panthenol',
        evidence: [
          { text: 'Glycerin 10%', quotes: ['Ingredients: Glycerin'] },
          { text: 'Panthenol', quotes: ['Ingredients: Panthenol'] },
        ],
      }),
      'Ingredients: Glycerin',
    );
    expect(result.trim()).toBe('');
  });

  it.each([
    ['not JSON', 'invalid_json'],
    [JSON.stringify({ description: '# Cream' }), 'invalid_schema'],
    [JSON.stringify({ description: 'Cream', evidence: {} }), 'invalid_schema'],
  ])(
    'classifies invalid responses without including their contents',
    (content, reason) => {
      try {
        supportedDescription(content, 'Cream');
        throw new Error('Expected validation failure');
      } catch (error) {
        expect(error).toBeInstanceOf(DescriptionEvidenceError);
        expect(error).toMatchObject({ reason, message: reason });
      }
    },
  );
});
