type Op = 'AND' | 'OR' | 'XOR' | 'NOT';

type Token =
  | { type: 'VAR'; name: string }
  | { type: 'CONST'; value: boolean }
  | { type: 'LPAREN' }
  | { type: 'RPAREN' }
  | { type: 'OP'; op: Op; prefix?: boolean }
  | { type: 'POSTFIX_NOT' };

const unicodeApos = /[\u2018\u2019\u02BC\u2032]/g;

function normalizeInput(s: string): string {
  return s.replace(unicodeApos, "'").replace(/\s+/g, ' ').trim();
}

function tokenize(srcRaw: string): Token[] {
  const src = normalizeInput(srcRaw);
  const tokens: Token[] = [];
  let i = 0;
  const isLetterCode = (code: number) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  const isVarRestCode = (code: number) => (code >= 48 && code <= 57) || code === 95;

  while (i < src.length) {
    const ch = src[i];
    const code = src.charCodeAt(i);

    if (ch === ' ') { i++; continue; }
    if (ch === '(') { tokens.push({ type: 'LPAREN' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'RPAREN' }); i++; continue; }
    if (ch === '+' || ch === '|') { tokens.push({ type: 'OP', op: 'OR' }); i++; continue; }
    if (ch === '*' || ch === '·' || ch === '.') { tokens.push({ type: 'OP', op: 'AND' }); i++; continue; }
    if (ch === '^') { tokens.push({ type: 'OP', op: 'XOR' }); i++; continue; }
    if (ch === '!' || ch === '~') { tokens.push({ type: 'OP', op: 'NOT', prefix: true }); i++; continue; }
    if (ch === "'") { tokens.push({ type: 'POSTFIX_NOT' }); i++; continue; }
    if (ch === '1') { tokens.push({ type: 'CONST', value: true }); i++; continue; }
    if (ch === '0') { tokens.push({ type: 'CONST', value: false }); i++; continue; }

    if (isLetterCode(code)) {
      let j = i + 1;
      while (j < src.length && isVarRestCode(src.charCodeAt(j))) j++;
      tokens.push({ type: 'VAR', name: src.slice(i, j) });
      i = j;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at position ${i + 1}`);
  }

  const out: Token[] = [];
  const isValueLike = (t?: Token) => t && (t.type === 'VAR' || t.type === 'CONST' || t.type === 'RPAREN');
  const isStartsValue = (t?: Token) => t && (t.type === 'VAR' || t.type === 'CONST' || t.type === 'LPAREN' || (t.type === 'OP' && t.prefix));

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    out.push(t);
    if (isValueLike(t) && isStartsValue(tokens[k + 1])) out.push({ type: 'OP', op: 'AND' });
  }

  return out;
}

function toRPN(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const ops: Token[] = [];
  const prec = (t: Token): number => t.type !== 'OP' ? -1 : t.op === 'NOT' ? 4 : t.op === 'AND' ? 3 : t.op === 'XOR' ? 2 : 1;
  const isLeftAssoc = (t: Token): boolean => t.type !== 'OP' || t.op !== 'NOT';

  for (const t of tokens) {
    if (t.type === 'VAR' || t.type === 'CONST') output.push(t);
    else if (t.type === 'POSTFIX_NOT') output.push({ type: 'OP', op: 'NOT' });
    else if (t.type === 'OP') {
      while (
        ops.length > 0 &&
        ops[ops.length - 1].type === 'OP' &&
        ((isLeftAssoc(t) && prec(ops[ops.length - 1]) >= prec(t)) || (!isLeftAssoc(t) && prec(ops[ops.length - 1]) > prec(t)))
      ) output.push(ops.pop()!);
      ops.push(t);
    } else if (t.type === 'LPAREN') ops.push(t);
    else {
      while (ops.length && ops[ops.length - 1].type !== 'LPAREN') output.push(ops.pop()!);
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

function extractVars(tokens: Token[]): string[] {
  const set = new Set<string>();
  for (const t of tokens) if (t.type === 'VAR') set.add(t.name);
  return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function buildVariableBitsets(vars: string[], totalRows: number): Map<string, Uint32Array> {
  const byVar = new Map<string, Uint32Array>();
  const words = Math.ceil(totalRows / 32);
  for (let v = 0; v < vars.length; v++) {
    const bits = new Uint32Array(words);
    const block = 2 ** (vars.length - 1 - v);

    if (block >= 32) {
      const onesWords = block >>> 5;
      const cycleWords = onesWords << 1;
      for (let start = 0; start < words; start += cycleWords) {
        const onesStart = start + onesWords;
        const onesEnd = Math.min(onesStart + onesWords, words);
        if (onesStart < words) bits.fill(0xffffffff, onesStart, onesEnd);
      }
    } else {
      const cycle = block << 1;
      let pattern = 0;
      for (let bit = 0; bit < 32; bit++) if ((bit % cycle) >= block) pattern |= (1 << bit) >>> 0;
      bits.fill(pattern >>> 0);
    }

    byVar.set(vars[v], bits);
  }

  const tailBits = totalRows & 31;
  if (tailBits !== 0 && words > 0) {
    const tailMask = ((1 << tailBits) - 1) >>> 0;
    for (const bits of byVar.values()) bits[words - 1] &= tailMask;
  }

  return byVar;
}

function makeFilledBitset(totalRows: number, value: boolean): Uint32Array {
  const words = Math.ceil(totalRows / 32);
  const out = new Uint32Array(words);
  if (!value || words === 0) return out;
  out.fill(0xffffffff);
  const tailBits = totalRows & 31;
  if (tailBits !== 0) out[words - 1] = (1 << tailBits) - 1;
  return out;
}

function evalRPNBitset(rpn: Token[], vars: Map<string, Uint32Array>, totalRows: number): Uint32Array {
  const stack: Uint32Array[] = [];
  const words = Math.ceil(totalRows / 32);
  const allTrue = makeFilledBitset(totalRows, true);
  const allFalse = new Uint32Array(words);
  const tailBits = totalRows & 31;
  const tailMask = tailBits === 0 ? 0xffffffff : (1 << tailBits) - 1;

  for (const t of rpn) {
    if (t.type === 'VAR') {
      const col = vars.get(t.name);
      if (!col) throw new Error(`Unknown variable ${t.name}`);
      stack.push(col);
      continue;
    }
    if (t.type === 'CONST') { stack.push(t.value ? allTrue : allFalse); continue; }
    if (t.type !== 'OP') continue;
    if (t.op === 'NOT') {
      if (stack.length < 1) throw new Error('NOT missing operand');
      const a = stack.pop()!;
      const out = new Uint32Array(words);
      for (let i = 0; i < words; i++) out[i] = ~a[i];
      if (words > 0) out[words - 1] &= tailMask;
      stack.push(out);
      continue;
    }

    if (stack.length < 2) throw new Error(`${t.op} missing operand`);
    const b = stack.pop()!;
    const a = stack.pop()!;
    const out = new Uint32Array(words);
    if (t.op === 'AND') for (let i = 0; i < words; i++) out[i] = a[i] & b[i];
    else if (t.op === 'OR') for (let i = 0; i < words; i++) out[i] = a[i] | b[i];
    else for (let i = 0; i < words; i++) out[i] = a[i] ^ b[i];
    stack.push(out);
  }

  if (stack.length !== 1) throw new Error('Invalid expression');
  return stack[0];
}

function popcount32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function collectSetBitIndices(bits: Uint32Array, totalRows: number): Uint32Array {
  let count = 0;
  for (let i = 0; i < bits.length; i++) count += popcount32(bits[i]);
  const out = new Uint32Array(count);
  let idx = 0;
  for (let wordIndex = 0; wordIndex < bits.length; wordIndex++) {
    let word = bits[wordIndex];
    while (word !== 0) {
      const lsb = word & -word;
      const bitPos = 31 - Math.clz32(lsb);
      const row = (wordIndex << 5) + bitPos;
      if (row < totalRows) out[idx++] = row;
      word ^= lsb;
    }
  }
  return out;
}

type WorkerRequest = { id: number; expr1: string; expr2: string; needDiffRows: boolean };

type WorkerResponse = {
  id: number;
  vars: string[];
  totalRows: number;
  v1Bits: Uint32Array;
  v2Bits: Uint32Array;
  diffRows: Uint32Array;
  timings: { parseMs: number; prepMs: number; evalMs: number; diffMs: number; totalMs: number };
  diffCount: number;
  err: string | null;
};

const cache = new Map<string, Omit<WorkerResponse, 'id'>>();

const MAX_VARIABLES = 25;
const CACHE_LIMIT = 8;


self.onmessage = (evt: MessageEvent<WorkerRequest>) => {
  const { id, expr1, expr2, needDiffRows } = evt.data;
  const key = `${expr1}\u0000${expr2}\u0000${needDiffRows ? '1' : '0'}`;
  const hit = cache.get(key);
  if (hit) {
    const clone: WorkerResponse = {
      ...hit,
      id,
      v1Bits: hit.v1Bits.slice(),
      v2Bits: hit.v2Bits.slice(),
      diffRows: hit.diffRows.slice(),
    };
    (self as unknown as Worker).postMessage(clone, [clone.v1Bits.buffer, clone.v2Bits.buffer, clone.diffRows.buffer]);
    return;
  }

  const t0 = performance.now();
  try {
    const c1Tokens = tokenize(expr1);
    const c2Tokens = tokenize(expr2);
    const c1Rpn = toRPN(c1Tokens);
    const c2Rpn = toRPN(c2Tokens);
    const vars = Array.from(new Set([...extractVars(c1Tokens), ...extractVars(c2Tokens)])).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (vars.length > MAX_VARIABLES) {
      throw new Error(`Too many variables (${vars.length}). Maximum supported is ${MAX_VARIABLES} to prevent browser crashes.`);
    }
    const t1 = performance.now();

    const totalRows = Math.max(1, 2 ** vars.length);
    const varBitsets = buildVariableBitsets(vars, totalRows);
    const t2 = performance.now();

    const v1Bits = evalRPNBitset(c1Rpn, varBitsets, totalRows);
    const v2Bits = evalRPNBitset(c2Rpn, varBitsets, totalRows);
    const t3 = performance.now();

    const diffBits = new Uint32Array(v1Bits.length);
    for (let i = 0; i < diffBits.length; i++) diffBits[i] = v1Bits[i] ^ v2Bits[i];
    let diffCount = 0;
    for (let i = 0; i < diffBits.length; i++) diffCount += popcount32(diffBits[i]);
    const diffRows = needDiffRows ? collectSetBitIndices(diffBits, totalRows) : new Uint32Array(0);
    const t4 = performance.now();

    const payload: Omit<WorkerResponse, 'id'> = {
      vars,
      totalRows,
      v1Bits,
      v2Bits,
      diffRows,
      timings: { parseMs: t1 - t0, prepMs: t2 - t1, evalMs: t3 - t2, diffMs: t4 - t3, totalMs: t4 - t0 },
      diffCount,
      err: null,
    };

    if (vars.length <= 22) {
      cache.delete(key);
      cache.set(key, payload);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    }

    const out: WorkerResponse = { ...payload, id };
    (self as unknown as Worker).postMessage(out, [out.v1Bits.buffer, out.v2Bits.buffer, out.diffRows.buffer]);
  } catch (e: any) {
    const out: WorkerResponse = {
      id,
      vars: [],
      totalRows: 0,
      v1Bits: new Uint32Array(0),
      v2Bits: new Uint32Array(0),
      diffRows: new Uint32Array(0),
      timings: { parseMs: 0, prepMs: 0, evalMs: 0, diffMs: 0, totalMs: performance.now() - t0 },
      diffCount: 0,
      err: e?.message ?? String(e),
    };
    (self as unknown as Worker).postMessage(out, [out.v1Bits.buffer, out.v2Bits.buffer, out.diffRows.buffer]);
  }
};
