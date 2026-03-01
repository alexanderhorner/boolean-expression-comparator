import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { compile, evalRPN } from './booleanExpression';

function buildComplicatedExpression(variableCount: number, depth: number): string {
  const vars = Array.from({ length: variableCount }, (_, idx) => `X${idx + 1}`);
  let expr = vars.map((name) => `(${name}+${name}'')`).join('*');

  for (let i = 0; i < depth; i++) {
    const a = vars[i % vars.length];
    const b = vars[(i + 3) % vars.length];
    const c = vars[(i + 7) % vars.length];
    expr = `((${expr})^(${a}+!${b})+(${c}'*${a}))`;
  }

  return expr;
}

function deterministicEnvironment(variableCount: number): Record<string, boolean> {
  const env: Record<string, boolean> = {};
  for (let i = 0; i < variableCount; i++) {
    env[`X${i + 1}`] = i % 2 === 0;
  }
  return env;
}

function runForAtLeastMs(expression: string, env: Record<string, boolean>, minMs: number): {
  elapsedMs: number;
  iterations: number;
  lastValue: boolean;
} {
  const compiled = compile(expression);
  const start = performance.now();
  let iterations = 0;
  let lastValue = false;

  while (performance.now() - start < minMs) {
    lastValue = evalRPN(compiled.rpn, env);
    iterations++;
  }

  return {
    elapsedMs: performance.now() - start,
    iterations,
    lastValue,
  };
}

describe('boolean expression performance characterization', () => {
  it('measures a deeply nested mixed-operator query for >1000ms', () => {
    const expression = buildComplicatedExpression(24, 30);
    const env = deterministicEnvironment(24);

    const result = runForAtLeastMs(expression, env, 1100);

    expect(result.elapsedMs).toBeGreaterThanOrEqual(1000);
    expect(result.iterations).toBeGreaterThan(0);
    expect(typeof result.lastValue).toBe('boolean');

    console.info('[perf] deep-nested query', {
      elapsedMs: Number(result.elapsedMs.toFixed(2)),
      iterations: result.iterations,
      avgMsPerEval: Number((result.elapsedMs / result.iterations).toFixed(4)),
    });
  });

  it('measures a wide query with many XOR/AND/OR groups for >1000ms', () => {
    const terms = Array.from({ length: 80 }, (_, i) => {
      const a = `X${(i % 20) + 1}`;
      const b = `X${((i + 5) % 20) + 1}`;
      const c = `X${((i + 11) % 20) + 1}`;
      return `((${a}*${b}')+(!${c}^${a}))`;
    });

    const expression = `(${terms.join('^')})*(X1+X2+X3+X4)' + (X5*X6*X7*X8)`;
    const env = deterministicEnvironment(20);

    const result = runForAtLeastMs(expression, env, 1200);

    expect(result.elapsedMs).toBeGreaterThanOrEqual(1000);
    expect(result.iterations).toBeGreaterThan(0);
    expect(typeof result.lastValue).toBe('boolean');

    console.info('[perf] wide-xor query', {
      elapsedMs: Number(result.elapsedMs.toFixed(2)),
      iterations: result.iterations,
      avgMsPerEval: Number((result.elapsedMs / result.iterations).toFixed(4)),
    });
  });
});
