import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { compile, evalRPN } from './booleanExpression';

function buildHeavyExpression(variableCount: number): string {
  const vars = Array.from({ length: variableCount }, (_, idx) => `X${idx + 1}`);
  const terms = vars.map((name, i) => {
    const a = name;
    const b = vars[(i + 3) % vars.length];
    const c = vars[(i + 7) % vars.length];
    const d = vars[(i + 11) % vars.length];
    return `((${a}^${b})*(!${c}+${d}'))`;
  });

  return `(${terms.join('+')})*(${terms.join('^')})`;
}

function evaluateBatch(expression: string, evaluations: number): {
  elapsedMs: number;
  evaluations: number;
  onesCount: number;
} {
  const { rpn, vars } = compile(expression);
  const varCount = vars.length;
  const env: Record<string, boolean> = {};

  for (const v of vars) env[v] = false;

  const start = performance.now();
  let onesCount = 0;

  for (let mask = 0; mask < evaluations; mask++) {
    for (let i = 0; i < varCount; i++) {
      env[vars[i]] = !!((mask >> (varCount - 1 - i)) & 1);
    }

    if (evalRPN(rpn, env)) {
      onesCount++;
    }
  }

  return {
    elapsedMs: performance.now() - start,
    evaluations,
    onesCount,
  };
}

describe('boolean expression performance characterization', () => {
  it('runs a single heavy ~25-variable expression calculation around 1000ms+', () => {
    const expression = buildHeavyExpression(25);
    const result = evaluateBatch(expression, 300_000);

    // No artificial sleeping/spinning: this timing is real parser/evaluator work.
    expect(result.elapsedMs).toBeGreaterThanOrEqual(1000);
    expect(result.evaluations).toBe(300_000);

    console.info('[perf] single heavy calculation', {
      elapsedMs: Number(result.elapsedMs.toFixed(2)),
      evaluations: result.evaluations,
      perEvaluationUs: Number(((result.elapsedMs * 1000) / result.evaluations).toFixed(4)),
      onesCount: result.onesCount,
    });
  }, 120000);
});
