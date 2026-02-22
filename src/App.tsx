import React, { useState, useMemo, useRef } from 'react';
import katex from 'katex';
import { useWindowVirtualizer } from '@tanstack/react-virtual';

type Op = 'AND' | 'OR' | 'XOR' | 'NOT';

type Token =
  | { type: 'VAR'; name: string }
  | { type: 'CONST'; value: boolean }
  | { type: 'LPAREN' }
  | { type: 'RPAREN' }
  | { type: 'OP'; op: Op; prefix?: boolean }
  | { type: 'POSTFIX_NOT' };

const unicodeApos = /[\u2018\u2019\u02BC\u2032]/g; // ‘ ’ ʻ ′

function normalizeInput(s: string): string {
  return s
    .replace(unicodeApos, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(srcRaw: string): Token[] {
  const src = normalizeInput(srcRaw);
  const tokens: Token[] = [];
  let i = 0;
  const isLetter = (ch: string) => /[A-Za-z]/.test(ch);
  const isVarRest = (ch: string) => /[0-9_]/.test(ch);

  while (i < src.length) {
    const ch = src[i];

    if (ch === ' ') { i++; continue; }

    if (ch === '(') { tokens.push({ type: 'LPAREN' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'RPAREN' }); i++; continue; }

    // Operators
    if (ch === '+' || ch === '|') { tokens.push({ type: 'OP', op: 'OR' }); i++; continue; }
    if (ch === '*' || ch === '·' || ch === '.') { tokens.push({ type: 'OP', op: 'AND' }); i++; continue; }
    if (ch === '^') { tokens.push({ type: 'OP', op: 'XOR' }); i++; continue; }
    if (ch === '!' || ch === '~') { tokens.push({ type: 'OP', op: 'NOT', prefix: true }); i++; continue; }
    if (ch === "'") { tokens.push({ type: 'POSTFIX_NOT' }); i++; continue; }

    // Constants
    if (ch === '1') { tokens.push({ type: 'CONST', value: true }); i++; continue; }
    if (ch === '0') { tokens.push({ type: 'CONST', value: false }); i++; continue; }

    // Variable: single letter, optionally followed by digits/underscores
    if (isLetter(ch)) {
      let j = i + 1;
      while (j < src.length && isVarRest(src[j])) j++;
      const name = src.slice(i, j);
      tokens.push({ type: 'VAR', name });
      i = j;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at position ${i + 1}`);
  }

  // Insert implicit ANDs: value-like then value-like or prefix-not or '('
  const out: Token[] = [];
  const isValueLike = (t?: Token) =>
    t && (t.type === 'VAR' || t.type === 'CONST' || t.type === 'RPAREN');
  const isStartsValue = (t?: Token) =>
    t && (t.type === 'VAR' || t.type === 'CONST' || t.type === 'LPAREN' || (t.type === 'OP' && t.prefix));

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const next = tokens[k + 1];
    out.push(t);
    if (isValueLike(t) && isStartsValue(next)) {
      out.push({ type: 'OP', op: 'AND' });
    }
    // Allow chained postfix NOTs like A'' -> handled naturally
  }

  return out;
}

function toRPN(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const ops: Token[] = [];

  const prec = (t: Token): number => {
    if (t.type !== 'OP') return -1;
    switch (t.op) {
      case 'NOT': return 4;
      case 'AND': return 3;
      case 'XOR': return 2;
      case 'OR': return 1;
      default: return 0;
    }
  };

  const isLeftAssoc = (t: Token): boolean => {
    if (t.type !== 'OP') return true;
    if (t.op === 'NOT') return false;
    return true;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
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
    if (t.type === 'LPAREN') { ops.push(t); continue; }
    if (t.type === 'RPAREN') {
      while (ops.length && ops[ops.length - 1].type !== 'LPAREN') {
        output.push(ops.pop()!);
      }
      if (!ops.length) throw new Error('Mismatched parentheses');
      ops.pop();
      continue;
    }
  }

  while (ops.length) {
    const top = ops.pop()!;
    if (top.type === 'LPAREN' || top.type === 'RPAREN') throw new Error('Mismatched parentheses');
    output.push(top);
  }

  return output;
}

type ASTNode =
  | { type: 'VAR'; name: string }
  | { type: 'CONST'; value: boolean }
  | { type: 'NOT'; expr: ASTNode }
  | { type: 'AND' | 'OR' | 'XOR'; left: ASTNode; right: ASTNode };

function rpnToAST(rpn: Token[]): ASTNode {
  const st: ASTNode[] = [];
  for (const t of rpn) {
    if (t.type === 'VAR') st.push({ type: 'VAR', name: t.name });
    else if (t.type === 'CONST') st.push({ type: 'CONST', value: t.value });
    else if (t.type === 'OP') {
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
  switch (op) {
    case 'NOT':
      return 4;
    case 'AND':
      return 3;
    case 'XOR':
      return 2;
    case 'OR':
      return 1;
    default:
      return 0;
  }
}

function astToLatex(node: ASTNode, parentPrec = 0): string {
  switch (node.type) {
    case 'VAR':
      return node.name;
    case 'CONST':
      return node.value ? '1' : '0';
    case 'NOT': {
      const inner = astToLatex(node.expr, 0).replace(/\s+/g, ' ').trim();
      return `\\overline{${inner}}`;
    }
    case 'AND':
    case 'OR':
    case 'XOR': {
      const p = opPrec(node.type);
      const left = astToLatex(node.left, p);
      const right = astToLatex(node.right, p);
      const opLatex =
        node.type === 'AND' ? '\\cdot' : node.type === 'OR' ? '+' : '\\oplus';
      let res = `${left} ${opLatex} ${right}`;
      if (p < parentPrec) res = `\\left(${res}\\right)`;
      return res;
    }
  }
}

function makeFilledBitset(totalRows: number, value: boolean): Uint32Array {
  const words = Math.ceil(totalRows / 32);
  const out = new Uint32Array(words);
  if (!value || words === 0) return out;
  out.fill(0xffffffff);
  const tailBits = totalRows & 31;
  if (tailBits !== 0) {
    out[words - 1] = (1 << tailBits) - 1;
  }
  return out;
}

function buildVariableBitsets(vars: string[], totalRows: number): Map<string, Uint32Array> {
  const byVar = new Map<string, Uint32Array>();
  for (let v = 0; v < vars.length; v++) {
    const bits = new Uint32Array(Math.ceil(totalRows / 32));
    const block = 1 << (vars.length - 1 - v);
    const cycle = block << 1;
    for (let i = block; i < totalRows; i += cycle) {
      const end = Math.min(i + block, totalRows);
      for (let r = i; r < end; r++) {
        bits[r >>> 5] |= 1 << (r & 31);
      }
    }
    byVar.set(vars[v], bits);
  }
  return byVar;
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
    if (t.type === 'CONST') {
      stack.push(t.value ? allTrue : allFalse);
      continue;
    }
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
    if (t.op === 'AND') {
      for (let i = 0; i < words; i++) out[i] = a[i] & b[i];
    } else if (t.op === 'OR') {
      for (let i = 0; i < words; i++) out[i] = a[i] | b[i];
    } else {
      for (let i = 0; i < words; i++) out[i] = a[i] ^ b[i];
    }
    stack.push(out);
  }

  if (stack.length !== 1) throw new Error('Invalid expression');
  return stack[0];
}

function getBit(bits: Uint32Array, row: number): boolean {
  return ((bits[row >>> 5] >>> (row & 31)) & 1) === 1;
}

function getAssignmentBit(row: number, varPosition: number, varCount: number): boolean {
  return ((row >>> (varCount - 1 - varPosition)) & 1) === 1;
}

function extractVars(tokens: Token[]): string[] {
  const set = new Set<string>();
  for (const t of tokens) if (t.type === 'VAR') set.add(t.name);
  return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function compile(expr: string) {
  const toks = tokenize(expr);
  const rpn = toRPN(toks);
  const vars = extractVars(toks);
  const ast = rpnToAST(rpn);
  return { rpn, vars, ast };
}

function asBit(b: boolean): 0 | 1 { return b ? 1 : 0; }

export default function App() {
  const [expr1, setExpr1] = useState<string>("(A+B‘)‘");
  const [expr2, setExpr2] = useState<string>("A‘*B");
  const [onlyDiff, setOnlyDiff] = useState(false);

  const { table, vars, err, latex1, latex2 } = useMemo(() => {
    try {
      const c1 = compile(expr1);
      const c2 = compile(expr2);
      const allVars = Array.from(new Set([...c1.vars, ...c2.vars])).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const totalRows = Math.max(1, 2 ** allVars.length);
      const varBitsets = buildVariableBitsets(allVars, totalRows);
      const v1Bits = evalRPNBitset(c1.rpn, varBitsets, totalRows);
      const v2Bits = evalRPNBitset(c2.rpn, varBitsets, totalRows);
      const data = Array.from({ length: totalRows }, (_, row) => {
        const v1 = getBit(v1Bits, row);
        const v2 = getBit(v2Bits, row);
        return { row, v1, v2, same: v1 === v2 };
      });
      const latex1 = katex.renderToString(astToLatex(c1.ast), { throwOnError: false });
      const latex2 = katex.renderToString(astToLatex(c2.ast), { throwOnError: false });
      return { table: data, vars: allVars, err: null as string | null, latex1, latex2 };
    } catch (e: any) {
      return { table: [] as any[], vars: [] as string[], err: e?.message ?? String(e), latex1: '', latex2: '' };
    }
  }, [expr1, expr2]);

  const display = useMemo(() => (onlyDiff ? table.filter((r) => !r.same) : table), [table, onlyDiff]);

  const listRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useWindowVirtualizer({
    count: display.length,
    estimateSize: () => 35,
    overscan: 5,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });
  const gridTemplate = useMemo(
    () => `repeat(${vars.length + 2}, minmax(0,1fr))`,
    [vars.length]
  );

  return (
    <main className="min-h-screen w-full bg-neutral-50 text-neutral-900 p-6 flex flex-col">
      <div className="max-w-5xl mx-auto flex-1">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Boolean Expression Comparator</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Enter two Boolean expressions. Table highlights <span className="font-semibold text-green-700">matches</span> in green and <span className="font-semibold text-red-700">differences</span> in red.
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            Syntax: OR <code className="px-1 bg-neutral-200 rounded">+</code>, AND <code className="px-1 bg-neutral-200 rounded">*</code> or adjacency, NOT postfix <code className="px-1 bg-neutral-200 rounded">A'</code> (also works with ‘ ’) or prefix <code className="px-1 bg-neutral-200 rounded">!A</code>, XOR <code className="px-1 bg-neutral-200 rounded">^</code>, constants <code className="px-1 bg-neutral-200 rounded">1</code>/<code className="px-1 bg-neutral-200 rounded">0</code>.
          </p>
        </header>

        <section className="grid md:grid-cols-2 gap-4 mb-4">
          <div className="bg-white rounded-2xl shadow-sm p-4 border border-neutral-200">
            <label className="block text-sm font-medium mb-2">Expression 1</label>
            <input
              className="w-full rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-blue-500 px-3 py-2 font-mono"
              value={expr1}
              onChange={(e) => setExpr1(e.target.value)}
              placeholder="e.g., (A+B')'"
            />
            <div className="mt-2 min-h-[2rem] text-lg">
              {latex1 && <span dangerouslySetInnerHTML={{ __html: latex1 }} />}
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-4 border border-neutral-200">
            <label className="block text-sm font-medium mb-2">Expression 2</label>
            <input
              className="w-full rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-blue-500 px-3 py-2 font-mono"
              value={expr2}
              onChange={(e) => setExpr2(e.target.value)}
              placeholder="e.g., A'*B"
            />
            <div className="mt-2 min-h-[2rem] text-lg">
              {latex2 && <span dangerouslySetInnerHTML={{ __html: latex2 }} />}
            </div>
          </div>
        </section>

        <section className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center cursor-pointer select-none">
              <input
                type="checkbox"
                className="mr-2 h-4 w-4"
                checked={onlyDiff}
                onChange={(e) => setOnlyDiff(e.target.checked)}
              />
              <span className="text-sm">Show only differing rows</span>
            </label>
          </div>
          {err ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
              Parse error: {err}
            </div>
          ) : (
            <div className="text-sm text-neutral-600">Variables: {vars.length ? vars.join(', ') : '—'}</div>
          )}
        </section>

        <div ref={listRef} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-neutral-200">
          <div className="min-w-full text-sm">
            <div
              className="bg-neutral-100 text-neutral-700 sticky top-0 grid"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              {vars.map((v) => (
                <div key={v} className="px-3 py-2 font-semibold">{v}</div>
              ))}
              <div className="px-3 py-2 font-semibold">Expr 1</div>
              <div className="px-3 py-2 font-semibold">Expr 2</div>
            </div>
            {err ? (
              <div className="px-3 py-4 text-neutral-500">Fix the error to see the table.</div>
            ) : display.length === 0 ? (
              <div className="px-3 py-4 text-neutral-500">No rows to display.</div>
            ) : (
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((item) => {
                  const row = display[item.index];
                  const rowClass = row.same ? 'bg-green-50' : 'bg-red-50';
                  return (
                    <div
                      key={item.key}
                      className={`grid ${rowClass}`}
                      style={{
                        gridTemplateColumns: gridTemplate,
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${item.size}px`,
                        transform: `translateY(${item.start - rowVirtualizer.options.scrollMargin}px)`,
                      }}
                    >
                      {vars.map((v, idx) => (
                        <div key={v} className="px-3 py-1.5 font-mono">{asBit(getAssignmentBit(row.row, idx, vars.length))}</div>
                      ))}
                      <div className={`px-3 py-1.5 font-mono ${row.same ? 'text-green-700' : 'text-red-700'}`}>{asBit(row.v1)}</div>
                      <div className={`px-3 py-1.5 font-mono ${row.same ? 'text-green-700' : 'text-red-700'}`}>{asBit(row.v2)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <details className="mt-4 text-sm text-neutral-700">
          <summary className="cursor-pointer select-none font-medium">Help & tips</summary>
          <div className="mt-2 space-y-1">
            <p>Use <code className="px-1 bg-neutral-200 rounded">'</code> after a variable or parenthesis to negate: <code className="px-1 bg-neutral-200 rounded">(A+B)'</code>.</p>
            <p>Adjacency is AND: <code className="px-1 bg-neutral-200 rounded">AB</code> means <code className="px-1 bg-neutral-200 rounded">A*B</code>.</p>
            <p>Unicode apostrophes ‘ ’ are accepted. Prefix NOT with <code className="px-1 bg-neutral-200 rounded">!A</code> also works.</p>
            <p>XOR with <code className="px-1 bg-neutral-200 rounded">^</code>. Constants <code className="px-1 bg-neutral-200 rounded">1</code> and <code className="px-1 bg-neutral-200 rounded">0</code>.</p>
          </div>
        </details>
      </div>
      <footer className="text-[0.6rem] text-neutral-500 text-center mt-4">
        © 2025 Alexander Horner
      </footer>
    </main>
  );
}
