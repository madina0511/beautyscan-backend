import { createRequire } from 'module';

type GraphqlUtilities = {
  mergeDeep: (
    sources: unknown[],
    respectPrototype?: boolean,
  ) => Record<string, unknown>;
  mergeIncrementalResult: (options: {
    executionResult: { data: Record<string, unknown> };
    incrementalResult: unknown;
  }) => unknown;
};
const graphqlUtilities = createRequire(require.resolve('@nestjs/graphql'))(
  '@graphql-tools/utils',
) as GraphqlUtilities;

describe('Patched runtime dependency contracts', () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>)
      .beautyScanDependencyPolluted;
  });

  it.each([false, true])(
    'does not merge prototype keys while preserving ordinary schema metadata (respectPrototype=%s)',
    (respectPrototype) => {
      const payload: unknown = JSON.parse(
        '{"__proto__":{"beautyScanDependencyPolluted":true},"safe":{"enabled":true}}',
      );
      const merged = graphqlUtilities.mergeDeep(
        [{}, payload],
        respectPrototype,
      );
      expect(merged.safe).toEqual({ enabled: true });
      expect(merged.beautyScanDependencyPolluted).toBeUndefined();
      expect(
        ({} as Record<string, unknown>).beautyScanDependencyPolluted,
      ).toBeUndefined();
    },
  );

  it('rejects coerced incremental path segments instead of modifying the object prototype', () => {
    expect(typeof graphqlUtilities.mergeIncrementalResult).toBe('function');
    const payload: unknown = JSON.parse(
      '{"path":[["__proto__"],"beautyScanDependencyPolluted"],"data":true}',
    );
    try {
      graphqlUtilities.mergeIncrementalResult({
        executionResult: { data: {} },
        incrementalResult: payload,
      });
    } catch {
      // Throwing or ignoring a malformed path are both safe contracts.
    }
    expect(
      ({} as Record<string, unknown>).beautyScanDependencyPolluted,
    ).toBeUndefined();
  });

  it('continues to merge legitimate incremental response data', () => {
    const executionResult = { data: { product: { name: 'Before' } } };
    graphqlUtilities.mergeIncrementalResult({
      executionResult,
      incrementalResult: { path: ['product'], data: { name: 'After' } },
    });
    expect(executionResult.data.product.name).toBe('After');
  });

  it('preserves the Apollo UUID API after the security override', () => {
    const uuid = createRequire(require.resolve('@apollo/server'))('uuid') as {
      v4: () => string;
    };
    const first = uuid.v4();
    expect(first).toMatch(
      /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/,
    );
    expect(uuid.v4()).not.toBe(first);
  });
});
