import type { Visual } from '../core/schemas.js';

export type FlowKind = 'start' | 'decision' | 'loop' | 'process' | 'return' | 'error';
export type Flow = NonNullable<Visual['flow']>;

const short = (s: string, n = 34): string => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

function stripComment(line: string): string {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/(^|\s)#(?![!\[]).*$/, '$1')
    .replace(/\/\*.*?\*\//g, '')
    .trimEnd();
}

const indentOf = (l: string): number => l.match(/^\s*/)![0].replace(/\t/g, '    ').length;

/**
 * Derives a flowchart from a genuine code excerpt with line-level static rules (no execution, no LLM):
 * the declaration starts the flow, if/switch become decisions, for/while/map become loops, return ends it,
 * throw/raise is an error exit, and runs of ordinary statements collapse into one step.
 * Every node keeps its source line so the video can light it up while that line is discussed.
 */
export function buildFlow(code: string, startLine: number, symbol?: string): Flow | null {
  const lines = code.split('\n');
  const nodes: (Flow['nodes'][number] & { indent: number })[] = [];
  let lastProcess = -1;
  let literalIndent = -1; // inside a multi-line object/array literal: its lines are data, not steps
  lines.forEach((raw, i) => {
    const line = stripComment(raw);
    const t = line.trim();
    const lineNo = startLine + i;
    if (literalIndent >= 0) {
      if (t && indentOf(line) <= literalIndent) literalIndent = -1;
      else return;
    }
    if (!t || /^[})\];,]+$/.test(t) || /^(else\b|} else\b|except\b|finally\b|catch\b|}\s*catch)/.test(t) || /^(import|from|use|package|@)/.test(t)) return;
    const indent = indentOf(line);
    let kind: FlowKind = 'process';
    let label = t.replace(/[{:]\s*$/, '').trim();
    const decl = /^(export\s+)?(default\s+)?(async\s+)?(function\*?|def|fn|func|pub\s+fn|pub\s+async\s+fn)\s/.test(t) || (symbol && new RegExp(`\\b${symbol}\\b\\s*[=(:]`).test(t) && nodes.length === 0);
    if (decl && nodes.length === 0) {
      kind = 'start';
      label = symbol ? `${symbol}(${(t.match(/\(([^)]*)\)/)?.[1] ?? '').slice(0, 22)})` : label;
    } else if (/^(if|elif|else if|} else if|switch|match|case|when)\b/.test(t) || /^\}\s*else\s+if\b/.test(t)) {
      kind = 'decision';
      const cond = t.match(/\((.*)\)/)?.[1] ?? t.replace(/^(\}\s*)?(else\s+)?(if|elif|switch|match|case|when)\s*/, '');
      label = `${cond.replace(/[{:]\s*$/, '').trim()}?`;
    } else if (/^(for|while|loop|do)\b/.test(t) || /\.(map|forEach|filter|reduce|flatMap)\(/.test(t)) {
      kind = 'loop';
      label = /^(for|while)/.test(t) ? (t.match(/\((.*)\)/)?.[1] ?? t.replace(/^(for|while)\s*/, '')).replace(/[{:]\s*$/, '') : label;
    } else if (/^return\b|^yield\b|=>\s*[^{]+;?$/.test(t) && !/^const|^let|^var/.test(t)) {
      kind = 'return';
      label = t.replace(/;$/, '');
    } else if (/^(throw|raise)\b|panic!|^return\s+Err\(/.test(t)) {
      kind = 'error';
      label = t.replace(/;$/, '').replace(/^throw new /, 'throw ');
    }
    if (kind === 'process' && /(=|:|\(|return)\s*[{[]\s*$/.test(t)) {
      literalIndent = indent;
      label = t.replace(/\s*[{[]\s*$/, '') + ' {…}';
    }
    if (kind === 'process') {
      // Merge consecutive plain statements at the same depth into one step.
      if (lastProcess === nodes.length - 1 && lastProcess >= 0 && nodes[lastProcess].indent === indent) {
        const n = nodes[lastProcess];
        if (!n.label.endsWith('…')) n.label = short(n.label, 30) + ' …';
        return;
      }
      lastProcess = nodes.length;
    }
    nodes.push({ id: `n${nodes.length}`, kind, label: short(label), line: lineNo, indent });
  });
  // A chart is only worth showing when the code has structure (a branch, loop, return or error).
  if (nodes.length < 3 || !nodes.some((n) => ['decision', 'loop', 'return', 'error'].includes(n.kind))) return null;
  // Keep the chart readable: at most 8 nodes, preferring structure over plain steps.
  while (nodes.length > 8) {
    const idx = nodes.findIndex((n, i) => i > 0 && n.kind === 'process');
    if (idx < 0) nodes.splice(8);
    else nodes.splice(idx, 1);
  }
  const edges: Flow['edges'] = [];
  nodes.forEach((n, i) => {
    const next = nodes[i + 1];
    if (!next) return;
    if (n.kind === 'return' || n.kind === 'error') {
      // A guarded early exit: flow continues from the decision's "no" branch instead.
      return;
    }
    edges.push({ from: n.id, to: next.id, label: n.kind === 'decision' ? 'yes' : n.kind === 'loop' ? 'each' : undefined });
    if (n.kind === 'decision') {
      // "no" goes to the first later node at the same or shallower depth.
      const after = nodes.slice(i + 1).find((m) => m.indent <= n.indent && m !== next);
      if (after) edges.push({ from: n.id, to: after.id, label: 'no' });
    }
  });
  // Early exits inside a decision: connect the node after the exit when nothing else reaches it.
  nodes.forEach((n, i) => {
    const next = nodes[i + 1];
    if (next && (n.kind === 'return' || n.kind === 'error') && !edges.some((e) => e.to === next.id)) {
      const decision = [...nodes.slice(0, i)].reverse().find((m) => m.kind === 'decision' && m.indent < n.indent);
      if (decision) edges.push({ from: decision.id, to: next.id, label: 'no' });
    }
  });
  return { nodes: nodes.map(({ indent: _i, ...n }) => n), edges };
}
