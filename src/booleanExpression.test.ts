import { describe, expect, it } from 'vitest';
import { bitAt, compile, evalRPN, evalRPNBatchBits } from './booleanExpression';

function evaluateExpression(expression: string, env: Record<string, boolean>): boolean {
  return evalRPN(compile(expression).rpn, env);
}


describe('boolean expression evaluation regression coverage', () => {
  it('evaluates core operator behavior across mixed expressions', () => {
    const cases: Array<{ expression: string; env: Record<string, boolean>; expected: boolean }> = [
      { expression: 'A+B', env: { A: false, B: false }, expected: false },
      { expression: 'A+B', env: { A: true, B: false }, expected: true },
      { expression: 'A*B', env: { A: true, B: false }, expected: false },
      { expression: 'A*B', env: { A: true, B: true }, expected: true },
      { expression: 'A^B', env: { A: false, B: false }, expected: false },
      { expression: 'A^B', env: { A: true, B: false }, expected: true },
      { expression: 'A^B', env: { A: true, B: true }, expected: false },
      { expression: "A'", env: { A: true }, expected: false },
      { expression: "A'", env: { A: false }, expected: true },
      { expression: '!A', env: { A: true }, expected: false },
      { expression: '!A', env: { A: false }, expected: true },
      { expression: "!!A", env: { A: true }, expected: true },
      { expression: "!!A", env: { A: false }, expected: false },
      { expression: "A''", env: { A: true }, expected: true },
      { expression: "A''", env: { A: false }, expected: false },
      { expression: '(A+B)*C', env: { A: false, B: true, C: true }, expected: true },
      { expression: '(A+B)*C', env: { A: false, B: true, C: false }, expected: false },
      { expression: 'A+B*C^D', env: { A: false, B: true, C: true, D: false }, expected: true },
      { expression: 'A+B*C^D', env: { A: false, B: true, C: true, D: true }, expected: false },
      { expression: 'A(B+C)', env: { A: true, B: false, C: true }, expected: true },
      { expression: 'A(B+C)', env: { A: false, B: true, C: true }, expected: false },
      { expression: 'A!B', env: { A: true, B: false }, expected: true },
      { expression: 'A!B', env: { A: true, B: true }, expected: false },
      { expression: 'A_1 + B2*0', env: { A_1: false, B2: true }, expected: false },
      { expression: 'A_1 + B2*1', env: { A_1: false, B2: true }, expected: true },
      { expression: '~A + B', env: { A: true, B: false }, expected: false },
      { expression: '~A + B', env: { A: false, B: false }, expected: true },
      { expression: 'A|B', env: { A: false, B: true }, expected: true },
      { expression: 'A.B', env: { A: true, B: true }, expected: true },
      { expression: 'A·B', env: { A: true, B: false }, expected: false },
    ];

    for (const testCase of cases) {
      expect(evaluateExpression(testCase.expression, testCase.env)).toBe(testCase.expected);
    }
  });


  it('keeps XOR parity correct for longer XOR chains', () => {
    expect(evaluateExpression('A^B^C^D', { A: false, B: false, C: false, D: false })).toBe(false);
    expect(evaluateExpression('A^B^C^D', { A: true, B: false, C: false, D: false })).toBe(true);
    expect(evaluateExpression('A^B^C^D', { A: true, B: true, C: false, D: false })).toBe(false);
    expect(evaluateExpression('A^B^C^D', { A: true, B: true, C: true, D: false })).toBe(true);
    expect(evaluateExpression('A^B^C^D', { A: true, B: true, C: true, D: true })).toBe(false);
  });

  it('matches scalar and batch evaluation across full truth table', () => {
    const expression = "((A+B')*(C+!D))^(E*F)+(G'*H)";
    const { rpn, vars } = compile(expression);
    const { bits } = evalRPNBatchBits(rpn, vars);

    const rowCount = Math.max(1, 1 << vars.length);
    const env: Record<string, boolean> = {};

    for (let row = 0; row < rowCount; row++) {
      for (let i = 0; i < vars.length; i++) {
        env[vars[i]] = !!((row >> (vars.length - 1 - i)) & 1);
      }
      expect(bitAt(bits, row)).toBe(evalRPN(rpn, env));
    }
  });


  it('rejects malformed expressions (without asserting exact error text)', () => {
    expect(() => compile('(A+B')).toThrow();
    expect(() => compile('A+')).toThrow();
    expect(() => compile("'")).toThrow();
    expect(() => compile('A$B')).toThrow();
    expect(() => evaluateExpression('A+B', { A: true })).toThrow();
  });
});
