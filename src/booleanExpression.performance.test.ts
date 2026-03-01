import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { allAssignments, compile, evalRPN } from './booleanExpression';

type Timing = {
  name: string;
  variables: number;
  evaluations: number;
  elapsedMs: number;
};

function measureSingleEvaluation(name: string, expression: string): Timing {
  const compileStart = performance.now();
  const { rpn, vars } = compile(expression);
  const compileMs = performance.now() - compileStart;

  const env: Record<string, boolean> = {};
  for (let i = 0; i < vars.length; i++) {
    env[vars[i]] = i % 2 === 0;
  }

  const evalStart = performance.now();
  evalRPN(rpn, env);
  const evalMs = performance.now() - evalStart;

  console.info('[perf] single-eval', {
    name,
    variables: vars.length,
    compileMs: Number(compileMs.toFixed(3)),
    evalMs: Number(evalMs.toFixed(3)),
  });

  return { name, variables: vars.length, evaluations: 1, elapsedMs: evalMs };
}

function measureFullTruthTable(name: string, expression: string): Timing {
  const { rpn, vars } = compile(expression);
  const rows = allAssignments(vars);

  const start = performance.now();
  let trueCount = 0;
  for (const env of rows) {
    if (evalRPN(rpn, env)) trueCount++;
  }
  const elapsedMs = performance.now() - start;

  console.info('[perf] full-truth-table', {
    name,
    variables: vars.length,
    evaluations: rows.length,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    perEvaluationUs: Number(((elapsedMs * 1000) / rows.length).toFixed(4)),
    trueCount,
  });

  return {
    name,
    variables: vars.length,
    evaluations: rows.length,
    elapsedMs,
  };
}

describe('boolean expression performance measurements', () => {
  it('measures realistic expression timings (no runtime threshold assertions)', () => {
    const exprSimple = "(A+B')*(C+D)+E^F";

    const exprMedium = [
      "((a1 + b2')*(c3 + !d4))",
      "((e5^f6) + (g7*h8'))",
      "((i9 + j10)*(k11 + l12))",
    ].join('^');

    // 25-variable qwertz-style input as requested.
    const exprComplex25 = [
      "(q1+w2'+e3)",
      "((r4*t5)+!z6)",
      "(u7^i8^o9)",
      "((p10+a11)*(s12+d13))",
      "(f14+g15*h16)",
      "((j17+k18')^l19)",
      "((y20+x21)*(c22+v23))",
      "(b24+n25')",
    ].join('*');

    const simple = measureFullTruthTable('simple-exhaustive', exprSimple);
    const medium = measureFullTruthTable('medium-exhaustive', exprMedium);
    const complex25 = measureSingleEvaluation('complex25-single-eval', exprComplex25);

    console.table([
      {
        name: simple.name,
        variables: simple.variables,
        evaluations: simple.evaluations,
        elapsedMs: Number(simple.elapsedMs.toFixed(3)),
      },
      {
        name: medium.name,
        variables: medium.variables,
        evaluations: medium.evaluations,
        elapsedMs: Number(medium.elapsedMs.toFixed(3)),
      },
      {
        name: complex25.name,
        variables: complex25.variables,
        evaluations: complex25.evaluations,
        elapsedMs: Number(complex25.elapsedMs.toFixed(3)),
      },
    ]);

    // Only sanity checks; no timing expectations.
    expect(simple.evaluations).toBe(2 ** 6);
    expect(medium.evaluations).toBe(2 ** 12);
    expect(complex25.variables).toBe(25);
  });
});
