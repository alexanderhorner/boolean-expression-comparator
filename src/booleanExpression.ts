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
