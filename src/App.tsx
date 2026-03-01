import React, { useState, useMemo, useRef } from 'react';
import katex from 'katex';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { astToLatex, bitAt, compile, evalRPNBatchBits, type Token } from './booleanExpression';

function asBit(b: boolean): 0 | 1 { return b ? 1 : 0; }

type ExpressionEntry = {
  id: number;
  value: string;
};

type CompiledExpression = {
  id: number;
  value: string;
  vars: string[];
  rpn: Token[];
  latex: string;
  error: null;
};

type InvalidExpression = {
  id: number;
  value: string;
  vars: [];
  rpn: null;
  latex: '';
  error: string;
};

type ExpressionResult = CompiledExpression | InvalidExpression;

export default function App() {
  const [expressions, setExpressions] = useState<ExpressionEntry[]>([
    { id: 1, value: "(A+B‘)‘" },
    { id: 2, value: "A‘*B" },
  ]);
  const [nextExprId, setNextExprId] = useState(3);
  const [onlyDiff, setOnlyDiff] = useState(false);

  const { table, vars, compiledExpressions } = useMemo(() => {
    const compiled = expressions.map<ExpressionResult>((expr) => {
      if (!expr.value.trim()) {
        return { id: expr.id, value: expr.value, vars: [], rpn: null, latex: '', error: 'Expression is empty' };
      }
      try {
        const c = compile(expr.value);
        return {
          id: expr.id,
          value: expr.value,
          vars: c.vars,
          rpn: c.rpn,
          latex: katex.renderToString(astToLatex(c.ast), { throwOnError: false }),
          error: null,
        };
      } catch (e: any) {
        return { id: expr.id, value: expr.value, vars: [], rpn: null, latex: '', error: e?.message ?? String(e) };
      }
    });

    const valid = compiled.filter((expr): expr is CompiledExpression => expr.error === null);
    const allVars = Array.from(new Set(valid.flatMap((expr) => expr.vars))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const rowCount = Math.max(1, 1 << allVars.length);

    const compiledBits = compiled.map((expr) => {
      if (expr.error || !expr.rpn) return null;
      const { bits } = evalRPNBatchBits(expr.rpn, allVars);
      return bits;
    });

    const data = Array.from({ length: rowCount }, (_, rowIndex) => {
      const values = compiled.map((expr, exprIdx) => {
        if (expr.error || !expr.rpn) {
          return { id: expr.id, ok: false as const, error: expr.error };
        }
        return { id: expr.id, ok: true as const, value: bitAt(compiledBits[exprIdx]!, rowIndex) };
      });

      const validValues = values.filter((cell): cell is { id: number; ok: true; value: boolean } => cell.ok).map((cell) => cell.value);
      const hasDiff = validValues.length > 1 && !validValues.every((value) => value === validValues[0]);

      return { rowIndex, values, hasDiff };
    });

    return { table: data, vars: allVars, compiledExpressions: compiled };
  }, [expressions]);

  const display = useMemo(() => (onlyDiff ? table.filter((r) => r.hasDiff) : table), [table, onlyDiff]);

  const listRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useWindowVirtualizer({
    count: display.length,
    estimateSize: () => 35,
    overscan: 5,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });
  const gridTemplate = useMemo(
    () => `repeat(${vars.length + expressions.length}, minmax(0,1fr))`,
    [vars.length, expressions.length]
  );

  const updateExpression = (id: number, value: string) => {
    setExpressions((prev) => prev.map((expr) => (expr.id === id ? { ...expr, value } : expr)));
  };

  const addExpression = () => {
    setExpressions((prev) => [...prev, { id: nextExprId, value: '' }]);
    setNextExprId((id) => id + 1);
  };

  const removeExpression = (id: number) => {
    setExpressions((prev) => (prev.length <= 1 ? prev : prev.filter((expr) => expr.id !== id)));
  };

  return (
    <main className="min-h-screen w-full bg-neutral-50 text-neutral-900 p-6 flex flex-col">
      <div className="max-w-5xl mx-auto flex-1">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Boolean Expression Comparator</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Compare one or more Boolean expressions. Table highlights <span className="font-semibold text-green-700">matches</span> in green and <span className="font-semibold text-red-700">differences</span> in red.
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            Syntax: OR <code className="px-1 bg-neutral-200 rounded">+</code>, AND <code className="px-1 bg-neutral-200 rounded">*</code> or adjacency, NOT postfix <code className="px-1 bg-neutral-200 rounded">A'</code> (also works with ‘ ’) or prefix <code className="px-1 bg-neutral-200 rounded">!A</code>, XOR <code className="px-1 bg-neutral-200 rounded">^</code>, constants <code className="px-1 bg-neutral-200 rounded">1</code>/<code className="px-1 bg-neutral-200 rounded">0</code>.
          </p>
        </header>

        <section className="space-y-4 mb-4">
          <h2 className="text-sm font-semibold text-neutral-700">Expressions</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {expressions.map((expr, index) => {
              const compiled = compiledExpressions.find((item) => item.id === expr.id);
              return (
                <div key={expr.id} className="bg-white rounded-2xl shadow-sm p-4 border border-neutral-200 transition hover:shadow-md">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium">Expression {index + 1}</label>
                    <button
                      type="button"
                      onClick={() => removeExpression(expr.id)}
                      disabled={expressions.length === 1}
                      className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-neutral-300 text-neutral-600 hover:text-red-600 hover:border-red-300 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-neutral-600 disabled:hover:border-neutral-300 disabled:hover:bg-transparent"
                      title="Remove expression"
                      aria-label={`Remove expression ${index + 1}`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.35 9m-4.78 0L9.26 9m9.97-3.21c.34.05.68.1 1.02.16m-1.02-.16L18.16 19.67A2.25 2.25 0 0115.91 21.75H8.09a2.25 2.25 0 01-2.24-2.08L4.77 5.79m14.46 0a48.108 48.108 0 00-3.48-.4m-12 0c.34-.06.68-.11 1.02-.16m0 0a48.11 48.11 0 013.48-.4m7.5 0V4.88c0-1.18-.91-2.17-2.09-2.21a51.964 51.964 0 00-3.82 0C8.66 2.71 7.75 3.7 7.75 4.88v.51m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>
                  <input
                    className="w-full rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-blue-500 px-3 py-2 font-mono"
                    value={expr.value}
                    onChange={(e) => updateExpression(expr.id, e.target.value)}
                    placeholder="e.g., (A+B')'"
                  />
                  <div className="mt-2 min-h-[2rem] text-lg">
                    {compiled?.latex && <span dangerouslySetInnerHTML={{ __html: compiled.latex }} />}
                  </div>
                </div>
              );
            })}
          </div>
          <div>
            <button
              type="button"
              onClick={addExpression}
              className="inline-flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg bg-white text-neutral-800 border border-neutral-300 hover:bg-neutral-100 shadow-sm"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add expression
            </button>
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
          <div className="text-sm text-neutral-600">Variables: {vars.length ? vars.join(', ') : '—'}</div>
        </section>

        <section className="mb-3 space-y-2">
          {compiledExpressions.filter((expr) => expr.error !== null).map((expr, idx) => (
            <div key={expr.id} className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
              Expression {expressions.findIndex((item) => item.id === expr.id) + 1 || idx + 1}: {expr.error}
            </div>
          ))}
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
              {expressions.map((_, idx) => (
                <div key={idx} className="px-3 py-2 font-semibold">Expr {idx + 1}</div>
              ))}
            </div>
            {display.length === 0 ? (
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
                  const rowClass = row.hasDiff ? 'bg-red-50' : 'bg-green-50';
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
                      {vars.map((v, varIdx) => {
                        const bit = (row.rowIndex >> (vars.length - 1 - varIdx)) & 1;
                        return <div key={v} className="px-3 py-1.5 font-mono">{bit as 0 | 1}</div>;
                      })}
                      {row.values.map((cell) => (
                        <div key={cell.id} className={`px-3 py-1.5 font-mono ${row.hasDiff ? 'text-red-700' : 'text-green-700'}`}>
                          {cell.ok ? (
                            asBit(cell.value)
                          ) : (
                            <span title={cell.error} className="text-amber-600">⚠️</span>
                          )}
                        </div>
                      ))}
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
