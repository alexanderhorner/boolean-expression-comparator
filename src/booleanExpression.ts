export type Op = 'AND' | 'OR' | 'XOR' | 'NOT';

export type Token =
  | { type: 'VAR'; name: string }
  | { type: 'CONST'; value: boolean }
  | { type: 'LPAREN' }
  | { type: 'RPAREN' }
  | { type: 'OP'; op: Op; prefix?: boolean }
  | { type: 'POSTFIX_NOT' };

const unicodeApos = /[\u2018\u2019\u02BC\u2032]/g;

export function normalizeInput(s: string): string {
  return s
    .replace(unicodeApos, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(srcRaw: string): Token[] {
  const src = normalizeInput(srcRaw);
  const tokens: Token[] = [];
  let i = 0;
  const isLetter = (ch: string) => /[A-Za-z]/.test(ch);
  const isVarRest = (ch: string) => /[0-9_]/.test(ch);

  while (i < src.length) {
    const ch = src[i];

    if (ch === ' ') {
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'LPAREN' });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'RPAREN' });
      i++;
      continue;
    }

    if (ch === '+' || ch === '|') {
      tokens.push({ type: 'OP', op: 'OR' });
      i++;
      continue;
    }

    if (ch === '*' || ch === '·' || ch === '.') {
      tokens.push({ type: 'OP', op: 'AND' });
      i++;
      continue;
    }

    if (ch === '^') {
      tokens.push({ type: 'OP', op: 'XOR' });
      i++;
      continue;
    }

    if (ch === '!' || ch === '~') {
      tokens.push({ type: 'OP', op: 'NOT', prefix: true });
      i++;
      continue;
    }

    if (ch === "'") {
      tokens.push({ type: 'POSTFIX_NOT' });
      i++;
      continue;
    }

    if (ch === '1') {
      tokens.push({ type: 'CONST', value: true });
      i++;
      continue;
    }

    if (ch === '0') {
      tokens.push({ type: 'CONST', value: false });
      i++;
      continue;
    }

    if (isLetter(ch)) {
      let j = i + 1;
      while (j < src.length && isVarRest(src[j])) {
        j++;
      }
      tokens.push({ type: 'VAR', name: src.slice(i, j) });
      i = j;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at position ${i + 1}`);
  }

  const out: Token[] = [];
  const isValueLike = (t?: Token) => t && (t.type === 'VAR' || t.type === 'CONST' || t.type === 'RPAREN');
  const startsValue = (t?: Token) =>
    t && (t.type === 'VAR' || t.type === 'CONST' || t.type === 'LPAREN' || (t.type === 'OP' && t.prefix));

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const next = tokens[k + 1];
    out.push(t);
    if (isValueLike(t) && startsValue(next)) {
      out.push({ type: 'OP', op: 'AND' });
    }
  }

  return out;
}

export function toRPN(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const ops: Token[] = [];

  const prec = (t: Token): number => {
    if (t.type !== 'OP') return -1;
    if (t.op === 'NOT') return 4;
    if (t.op === 'AND') return 3;
    if (t.op === 'XOR') return 2;
    if (t.op === 'OR') return 1;
    return 0;
  };

  const isLeftAssoc = (t: Token): boolean => !(t.type === 'OP' && t.op === 'NOT');

  for (const t of tokens) {
    if (t.type === 'VAR' || t.type === 'CONST') {
      output.push(t);
      continue;
    }

    if (t.type === 'POSTFIX_NOT') {
      output.push({ type: 'OP', op: 'NOT' });
      continue;
    }

    if (t.type === 'OP') {
      while (
        ops.length > 0 &&
        ops[ops.length - 1].type === 'OP' &&
        ((isLeftAssoc(t) && prec(ops[ops.length - 1]) >= prec(t)) || (!isLeftAssoc(t) && prec(ops[ops.length - 1]) > prec(t)))
      ) {
        output.push(ops.pop()!);
      }
      ops.push(t);
      continue;
    }

    if (t.type === 'LPAREN') {
      ops.push(t);
      continue;
    }

    if (t.type === 'RPAREN') {
      while (ops.length && ops[ops.length - 1].type !== 'LPAREN') {
        output.push(ops.pop()!);
      }
      if (!ops.length) throw new Error('Mismatched parentheses');
      ops.pop();
    }
  }

  while (ops.length) {
    const top = ops.pop()!;
    if (top.type === 'LPAREN' || top.type === 'RPAREN') throw new Error('Mismatched parentheses');
    output.push(top);
  }

  return output;
}

export type ASTNode =
  | { type: 'VAR'; name: string }
  | { type: 'CONST'; value: boolean }
  | { type: 'NOT'; expr: ASTNode }
  | { type: 'AND' | 'OR' | 'XOR'; left: ASTNode; right: ASTNode };

export function rpnToAST(rpn: Token[]): ASTNode {
  const st: ASTNode[] = [];

  for (const t of rpn) {
    if (t.type === 'VAR') {
      st.push({ type: 'VAR', name: t.name });
      continue;
    }

    if (t.type === 'CONST') {
      st.push({ type: 'CONST', value: t.value });
      continue;
    }

    if (t.type === 'OP') {
      if (t.op === 'NOT') {
        const a = st.pop();
        if (!a) throw new Error('NOT missing operand');
        st.push({ type: 'NOT', expr: a });
      } else {
        const b = st.pop();
        const a = st.pop();
        if (!a || !b) throw new Error(`${t.op} missing operand`);
        st.push({ type: t.op, left: a, right: b });
      }
    }
  }

  if (st.length !== 1) throw new Error('Invalid expression');
  return st[0];
}

function opPrec(op: Op | 'NOT'): number {
  if (op === 'NOT') return 4;
  if (op === 'AND') return 3;
  if (op === 'XOR') return 2;
  if (op === 'OR') return 1;
  return 0;
}

export function astToLatex(node: ASTNode, parentPrec = 0): string {
  if (node.type === 'VAR') return node.name;
  if (node.type === 'CONST') return node.value ? '1' : '0';
  if (node.type === 'NOT') {
    const inner = astToLatex(node.expr, 0).replace(/\s+/g, ' ').trim();
    return `\\overline{${inner}}`;
  }

  const p = opPrec(node.type);
  const left = astToLatex(node.left, p);
  const right = astToLatex(node.right, p);
  const opLatex = node.type === 'AND' ? '\\cdot' : node.type === 'OR' ? '+' : '\\oplus';
  let res = `${left} ${opLatex} ${right}`;
  if (p < parentPrec) res = `\\left(${res}\\right)`;
  return res;
}

export function evalRPN(rpn: Token[], env: Record<string, boolean>): boolean {
  const st: boolean[] = [];

  for (const t of rpn) {
    if (t.type === 'CONST') {
      st.push(t.value);
      continue;
    }

    if (t.type === 'VAR') {
      if (!(t.name in env)) throw new Error(`Variable '${t.name}' is undefined`);
      st.push(env[t.name]);
      continue;
    }

    if (t.type === 'OP') {
      if (t.op === 'NOT') {
        if (st.length < 1) throw new Error('NOT missing operand');
        st.push(!st.pop()!);
      } else {
        if (st.length < 2) throw new Error(`${t.op} missing operand`);
        const b = st.pop()!;
        const a = st.pop()!;
        if (t.op === 'AND') st.push(a && b);
        else if (t.op === 'OR') st.push(a || b);
        else st.push(a !== b);
      }
    }
  }

  if (st.length !== 1) throw new Error('Invalid expression');
  return st[0];
}

const variableBitsetCache = new Map<string, Uint32Array>();
const allOnesCache = new Map<number, Uint32Array>();
const allZeroCache = new Map<number, Uint32Array>();

function createAllOnesBits(rows: number): Uint32Array {
  const cached = allOnesCache.get(rows);
  if (cached) return cached;

  const words = Math.ceil(rows / 32);
  const bits = new Uint32Array(words);
  bits.fill(0xffffffff);

  const remainder = rows & 31;
  if (remainder !== 0) {
    bits[words - 1] = (1 << remainder) - 1;
  }

  allOnesCache.set(rows, bits);
  return bits;
}

function createAllZeroBits(rows: number): Uint32Array {
  const cached = allZeroCache.get(rows);
  if (cached) return cached;

  const bits = new Uint32Array(Math.ceil(rows / 32));
  allZeroCache.set(rows, bits);
  return bits;
}

function buildVariableBitset(totalRows: number, varIndex: number, varCount: number): Uint32Array {
  const cacheKey = `${varCount}:${varIndex}`;
  const cached = variableBitsetCache.get(cacheKey);
  if (cached) return cached;

  const words = Math.ceil(totalRows / 32);
  const bits = new Uint32Array(words);
  const period = 1 << (varCount - varIndex);
  const highSpan = period >> 1;

  for (let row = 0; row < totalRows; row++) {
    if (row % period >= highSpan) {
      bits[row >> 5] |= 1 << (row & 31);
    }
  }

  variableBitsetCache.set(cacheKey, bits);
  return bits;
}

function bitwiseBinary(a: Uint32Array, b: Uint32Array, op: 'AND' | 'OR' | 'XOR'): Uint32Array {
  const out = new Uint32Array(a.length);
  if (op === 'AND') {
    for (let i = 0; i < a.length; i++) out[i] = a[i] & b[i];
  } else if (op === 'OR') {
    for (let i = 0; i < a.length; i++) out[i] = a[i] | b[i];
  } else {
    for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  }
  return out;
}

function bitwiseNot(a: Uint32Array, rows: number): Uint32Array {
  const out = new Uint32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = ~a[i];

  const remainder = rows & 31;
  if (remainder !== 0) {
    out[out.length - 1] &= (1 << remainder) - 1;
  }

  return out;
}

/**
 * Evaluates an expression for every row of a full truth table in one pass with bit-parallel Uint32 operations.
 * Row ordering matches `allAssignments(vars)`: row 0 is all-zero, row (2^n - 1) is all-one.
 */
export function evalRPNBatchBits(rpn: Token[], vars: string[]): { bits: Uint32Array; rows: number } {
  const varCount = vars.length;
  if (varCount >= 31) {
    throw new Error('Batch evaluation supports at most 30 variables');
  }

  const rows = Math.max(1, 1 << varCount);
  const varIndex = new Map<string, number>();
  for (let i = 0; i < vars.length; i++) varIndex.set(vars[i], i);

  const allOnes = createAllOnesBits(rows);
  const allZero = createAllZeroBits(rows);
  const st: Uint32Array[] = [];

  for (const t of rpn) {
    if (t.type === 'CONST') {
      st.push(t.value ? allOnes : allZero);
      continue;
    }

    if (t.type === 'VAR') {
      const idx = varIndex.get(t.name);
      if (idx === undefined) throw new Error(`Variable '${t.name}' is undefined`);
      st.push(buildVariableBitset(rows, idx, varCount));
      continue;
    }

    if (t.type === 'OP') {
      if (t.op === 'NOT') {
        if (st.length < 1) throw new Error('NOT missing operand');
        st.push(bitwiseNot(st.pop()!, rows));
      } else {
        if (st.length < 2) throw new Error(`${t.op} missing operand`);
        const b = st.pop()!;
        const a = st.pop()!;
        st.push(bitwiseBinary(a, b, t.op));
      }
    }
  }

  if (st.length !== 1) throw new Error('Invalid expression');
  return { bits: st[0], rows };
}

export function bitAt(bits: Uint32Array, row: number): boolean {
  return ((bits[row >> 5] >> (row & 31)) & 1) === 1;
}

function rowsToIndices(bits: Uint32Array, rows: number): number[] {
  const out: number[] = [];
  for (let row = 0; row < rows; row++) {
    if (bitAt(bits, row)) out.push(row);
  }
  return out;
}

export function indicesFromBits(bits: Uint32Array, rows: number): number[] {
  return rowsToIndices(bits, rows);
}

export function extractVars(tokens: Token[]): string[] {
  const set = new Set<string>();
  for (const t of tokens) if (t.type === 'VAR') set.add(t.name);
  return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function compile(expr: string) {
  const tokens = tokenize(expr);
  const rpn = toRPN(tokens);
  const vars = extractVars(tokens);
  const ast = rpnToAST(rpn);
  return { tokens, rpn, vars, ast };
}

export function allAssignments(vars: string[]): Record<string, boolean>[] {
  const n = vars.length;
  const total = Math.max(1, 1 << n);
  const out: Record<string, boolean>[] = [];

  for (let i = 0; i < total; i++) {
    const row: Record<string, boolean> = {};
    for (let v = 0; v < n; v++) {
      row[vars[v]] = !!((i >> (n - 1 - v)) & 1);
    }
    out.push(row);
  }

  return out;
}
