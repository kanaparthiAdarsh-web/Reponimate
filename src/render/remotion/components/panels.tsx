import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Graph, Visual, WordTiming } from '../../../core/schemas.js';
import { alpha, theme, type Layout } from '../theme';
import type { CodeToken } from '../types';
import { revealFrame, useEntrance } from './primitives';
import { DrawnIcon } from './Props';
import { Flowchart } from './Flowchart';
import { LANGUAGE_COLORS } from '../../palette-data';

/* ------------------------------ CodeWalkthrough ------------------------------ */

export const CodeWalkthrough: React.FC<{ code: NonNullable<Visual['code']>; tokens?: CodeToken[][]; words: WordTiming[]; layout: Layout; width: number; height: number; flow?: Visual['flow'] }> = ({
  code,
  tokens,
  words,
  layout,
  width: totalWidth,
  height,
  flow,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = useEntrance(4);
  const width = totalWidth;
  const lines = tokens ?? code.code.split('\n').map((l) => [{ content: l, color: theme.text }]);
  const longest = Math.max(20, ...code.code.split('\n').map((l) => l.replace(/\t/g, '  ').length));
  const fontSize = Math.max(20, Math.min(layout.unit * 0.78, (width - 140) / (longest * 0.62), (height - 120) / (lines.length * 1.5)));
  // Step through the highlighted lines in sync with the narration.
  const hl = code.highlight.length ? code.highlight : [code.startLine];
  const step = hl.findLastIndex((_, i) => frame >= revealFrame(i, hl.length, words, fps, 1));
  const active = hl[Math.max(0, step)];
  // Camera: ease toward the active line and zoom in slightly each time the highlight moves.
  const stepStart = revealFrame(Math.max(0, step), hl.length, words, fps, 1);
  const cam = spring({ frame: frame - stepStart, fps, config: { damping: 20, stiffness: 80 } });
  const lineH = fontSize * 1.45;
  const visibleH = height - 90;
  const contentH = lines.length * lineH + 36;
  const yFor = (line: number) => (contentH > visibleH ? Math.min(0, Math.max(visibleH - contentH, visibleH / 2 - (line - code.startLine) * lineH)) : 0);
  const camY = yFor(hl[Math.max(0, step - 1)]) + (yFor(active) - yFor(hl[Math.max(0, step - 1)])) * cam;
  const zoom = 1 + 0.04 * Math.sin(Math.min(1, cam) * Math.PI);
  const panel = (
    <div
      style={{
        width,
        height,
        background: theme.codeBg,
        border: `2px solid ${theme.panelBorder}`,
        borderRadius: 20,
        boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
        overflow: 'hidden',
        opacity: enter,
        transform: `translateY(${(1 - enter) * 40}px)`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 22px', background: theme.panel, borderBottom: `2px solid ${theme.panelBorder}` }}>
        {[theme.danger, theme.secondary, theme.success].map((c) => (
          <div key={c} style={{ width: 16, height: 16, borderRadius: 8, background: c }} />
        ))}
        <div style={{ marginLeft: 14, fontFamily: theme.mono, fontSize: layout.unit * 0.5, color: theme.muted }}>
          {code.path} · lines {code.startLine}–{code.endLine}
        </div>
      </div>
      <div style={{ overflow: 'hidden', height: height - 62 }}>
      <div style={{ padding: '18px 0', fontFamily: theme.mono, fontSize, lineHeight: 1.45, transform: `translateY(${camY}px) scale(${zoom})`, transformOrigin: `30% ${(active - code.startLine) * lineH}px` }}>
        {lines.map((line, i) => {
          const n = code.startLine + i;
          const on = n === active;
          const appear = interpolate(frame, [6 + i * 1.5, 14 + i * 1.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <div key={i} style={{ display: 'flex', background: on ? alpha(theme.primary, 0.14) : 'transparent', borderLeft: `6px solid ${on ? theme.primary : 'transparent'}`, opacity: appear, whiteSpace: 'pre-wrap' }}>
              <span style={{ width: fontSize * 3.2, textAlign: 'right', paddingRight: fontSize * 0.9, color: on ? theme.primary : alpha(theme.muted, 0.55), flexShrink: 0 }}>{n}</span>
              <span style={{ opacity: on || !code.highlight.length ? 1 : 0.72 }}>
                {line.map((tk, k) => (
                  <span key={k} style={{ color: tk.color }}>
                    {tk.content.replace(/\t/g, '  ')}
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
  if (!flow) return panel;
  // Alternate views for every explained line: code first (line highlighted), then a card-flip to the
  // flowchart with that line's node lit, then back to code for the next line.
  const prev = hl[Math.max(0, step - 1)];
  const nextStart = step + 1 < hl.length ? revealFrame(step + 1, hl.length, words, fps, 1) : stepStart + fps * 6;
  const span = Math.max(fps * 1.5, nextStart - stepStart);
  const phase = step < 0 ? 0 : (frame - stepStart) / span;
  const flipAt = 0.5;
  const toChart = interpolate(phase, [flipAt - 0.06, flipAt + 0.06], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const back = step + 1 < hl.length ? interpolate(phase, [0.94, 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0;
  const showChart = Math.max(0, toChart - back);
  const angle = showChart * 180;
  const chart = <Flowchart flow={flow} activeLine={active} prevLine={prev} stepFrame={stepStart + Math.round(span * flipAt)} layout={layout} width={totalWidth} height={height - 40} />;
  const face = (child: React.ReactNode, rot: number) => (
    <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: `rotateY(${rot}deg)`, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>{child}</div>
  );
  return (
    <div style={{ position: 'relative', width: totalWidth, height, perspective: 2200 }}>
      <div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: `rotateY(${angle}deg)` }}>
        {face(panel, 0)}
        {face(<div style={{ background: alpha(theme.panel, 0.85), border: `2px solid ${theme.panelBorder}`, borderRadius: 20, padding: 20 }}>{chart}</div>, 180)}
      </div>
      <div style={{ position: 'absolute', top: -46, right: 0, display: 'flex', gap: 8, fontFamily: theme.mono, fontSize: layout.unit * 0.42 }}>
        {['CODE', 'FLOW'].map((label, i) => {
          const on = i === 0 ? angle < 90 : angle >= 90;
          return (
            <div key={label} style={{ padding: '4px 14px', borderRadius: 999, background: on ? theme.primary : theme.panel, color: on ? theme.ink : theme.muted, border: `1px solid ${theme.panelBorder}` }}>
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ------------------------------ ArchitectureDiagram ------------------------------ */

/** Layered layout computed from the graph data (longest path depth). No LLM-generated drawing code. */
export function layoutGraph(g: Graph, width: number, height: number, vertical: boolean): Map<string, { x: number; y: number }> {
  const depth = new Map<string, number>(g.nodes.map((n) => [n.id, 0]));
  for (let iter = 0; iter < g.nodes.length; iter++) {
    let changed = false;
    for (const e of g.edges) {
      const d = (depth.get(e.from) ?? 0) + 1;
      if (depth.has(e.to) && d > depth.get(e.to)! && d < g.nodes.length) {
        depth.set(e.to, d);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const layers = new Map<number, string[]>();
  for (const n of g.nodes) {
    const d = depth.get(n.id)!;
    layers.set(d, [...(layers.get(d) ?? []), n.id]);
  }
  const keys = [...layers.keys()].sort((a, b) => a - b);
  const pos = new Map<string, { x: number; y: number }>();
  keys.forEach((k, li) => {
    const ids = layers.get(k)!;
    ids.forEach((id, i) => {
      const a = (li + 0.5) / keys.length;
      const b = (i + 0.5) / ids.length;
      pos.set(id, vertical ? { x: b * width, y: a * height } : { x: a * width, y: b * height });
    });
  });
  return pos;
}

export const ArchitectureDiagram: React.FC<{ graph: Graph; words: WordTiming[]; layout: Layout; width: number; height: number }> = ({ graph, words, layout, width, height }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pos = layoutGraph(graph, width, height, layout.portrait);
  // Size boxes to the longest label (monospace ≈ 0.6em per char), within what the layers allow.
  const longest = Math.max(6, ...graph.nodes.map((n) => Math.min(24, n.label.length)));
  const layers = new Set([...pos.values()].map((p) => (layout.portrait ? p.y : p.x))).size || 1;
  const maxW = (layout.portrait ? width : width / layers) - 40;
  const fontPx = Math.max(18, Math.min(28, (maxW - 36) / (longest * 0.6)));
  const nodeW = Math.min(maxW, longest * fontPx * 0.6 + 40);
  const nodeH = fontPx * 2.6;
  const order = graph.nodes.map((n) => n.id);
  const appear = (id: string): number => revealFrame(order.indexOf(id), order.length + 2, words, fps, 0.3);
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.muted} />
        </marker>
      </defs>
      {graph.edges.map((e, i) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        const start = Math.max(appear(e.from), appear(e.to)) + 6;
        const p = interpolate(frame, [start, start + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        // trim lines so they start/end at the node borders
        const trimA = layout.portrait ? nodeH / 2 / Math.max(0.3, Math.abs(dy / len)) : nodeW / 2 / Math.max(0.3, Math.abs(dx / len));
        const ax = a.x + (dx / len) * Math.min(trimA, len / 3);
        const ay = a.y + (dy / len) * Math.min(trimA, len / 3);
        const bx = b.x - (dx / len) * Math.min(trimA + 8, len / 3);
        const by = b.y - (dy / len) * Math.min(trimA + 8, len / 3);
        const ext = e.to.startsWith('ext:');
        // Data packets travel along every edge once it is drawn.
        const packets = p >= 1 ? [0, 0.5].map((off) => ((frame - start - 18) / (fps * 1.6) + off + i * 0.17) % 1) : [];
        return (
          <g key={i}>
          {packets.map((q, k) => (
            <circle key={k} cx={ax + (bx - ax) * q} cy={ay + (by - ay) * q} r={7} fill={ext ? theme.secondary : theme.primary} opacity={Math.sin(q * Math.PI)} />
          ))}
          <line
            x1={ax}
            y1={ay}
            x2={ax + (bx - ax) * p}
            y2={ay + (by - ay) * p}
            stroke={ext ? theme.secondary : theme.muted}
            strokeWidth={3}
            strokeDasharray={ext ? '10 8' : undefined}
            markerEnd={p > 0.95 ? 'url(#arrow)' : undefined}
            opacity={0.85}
          />
          </g>
        );
      })}
      {graph.nodes.map((n) => {
        const p0 = pos.get(n.id)!;
        const s = spring({ frame: frame - appear(n.id), fps, config: { damping: 14 } });
        const ext = n.group === 'external';
        // Pulse a node while the narrator says its name.
        const t = frame / fps;
        const stem = n.label.replace(/^…/, '').split('/').filter(Boolean).pop()!.replace(/\.[a-z]+$/, '').toLowerCase();
        const spoken = words.some((w) => t >= w.start - 0.1 && t <= w.end + 0.4 && w.text.toLowerCase().includes(stem));
        const pulse = spoken ? 1.08 + 0.03 * Math.sin(t * 12) : 1;
        return (
          <g key={n.id} transform={`translate(${p0.x - (nodeW * s * pulse) / 2} ${p0.y - (nodeH * s * pulse) / 2}) scale(${s * pulse})`} filter={spoken ? `drop-shadow(0 0 12px ${alpha(theme.primary, 0.8)})` : undefined} style={{ transformOrigin: `${nodeW / 2}px ${nodeH / 2}px`, transformBox: 'fill-box' }} opacity={s}>
            <rect width={nodeW} height={nodeH} rx={16} fill={ext ? alpha(theme.secondary, 0.12) : theme.panel} stroke={ext ? theme.secondary : theme.primary} strokeWidth={3} />
            <text x={nodeW / 2} y={nodeH / 2} textAnchor="middle" fontFamily={theme.mono} fontSize={fontPx} fill={theme.text} dominantBaseline="middle">
              {n.label.length > 24 ? '…' + n.label.slice(-23) : n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

/* ------------------------------ TerminalDemo ------------------------------ */

export const TerminalDemo: React.FC<{ terminal: NonNullable<Visual['terminal']>; words: WordTiming[]; layout: Layout; width: number }> = ({ terminal, words, layout, width }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = useEntrance(2);
  const fs = layout.unit * 0.72;
  return (
    <div style={{ width, background: theme.codeBg, borderRadius: 18, border: `2px solid ${theme.panelBorder}`, overflow: 'hidden', opacity: enter, transform: `scale(${0.95 + 0.05 * enter})` }}>
      <div style={{ padding: '12px 22px', background: theme.panel, fontFamily: theme.mono, fontSize: layout.unit * 0.48, color: theme.secondary }}>⚠ {terminal.label}</div>
      <div style={{ padding: 28, fontFamily: theme.mono, fontSize: fs, lineHeight: 1.6 }}>
        {terminal.lines.map((l, i) => {
          const start = revealFrame(i, terminal.lines.length, words, fps, 0.5);
          const chars = Math.floor(interpolate(frame, [start, start + l.text.length * 1.2 + 4], [0, l.text.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
          if (frame < start) return null;
          const typing = chars < l.text.length;
          return (
            <div key={i} style={{ color: l.kind === 'cmd' ? theme.text : theme.muted, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              <span style={{ color: theme.success }}>{l.kind === 'cmd' ? '$ ' : '# '}</span>
              {l.text.slice(0, chars)}
              {typing && frame % 20 < 10 && <span style={{ background: theme.text }}>&nbsp;</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ------------------------------ Stats, FileTree, Bullets, ProsCons ------------------------------ */

export const StatsCounter: React.FC<{ stats: NonNullable<Visual['stats']>; layout: Layout; words: WordTiming[] }> = ({ stats, layout, words }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: layout.portrait ? '1fr 1fr' : `repeat(${Math.min(4, stats.length)}, 1fr)`, gap: 20 }}>
      {stats.map((s, i) => {
        const start = revealFrame(i, stats.length, words, fps, 0.3);
        const p = spring({ frame: frame - start, fps, config: { damping: 20 } });
        const val = Math.round(interpolate(frame, [start, start + 40], [0, s.value], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
        return (
          <div key={i} style={{ background: theme.panel, border: `2px solid ${theme.panelBorder}`, borderRadius: 20, padding: '20px 24px', opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
            <div style={{ fontFamily: theme.font, fontWeight: 800, fontSize: layout.unit * (layout.portrait ? 2 : 1.5), color: i % 2 ? theme.secondary : theme.primary }}>
              {val.toLocaleString('en-US')}
              {s.suffix ?? ''}
            </div>
            <div style={{ fontFamily: theme.font, fontSize: layout.unit * 0.7, color: theme.muted }}>{s.label}</div>
          </div>
        );
      })}
    </div>
  );
};

export const FileTree: React.FC<{ files: string[]; layout: Layout; maxItems?: number }> = ({ files, layout, maxItems = 14 }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ background: theme.panel, border: `2px solid ${theme.panelBorder}`, borderRadius: 18, padding: '22px 28px', fontFamily: theme.mono, fontSize: layout.unit * 0.55, color: theme.text, lineHeight: 1.55 }}>
      {files.slice(0, maxItems).map((f, i) => {
        const depth = f.split('/').length - 1;
        const o = interpolate(frame, [8 + i * 3, 16 + i * 3], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        return (
          <div key={f} style={{ paddingLeft: depth * 28, opacity: o, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span style={{ color: depth ? theme.muted : theme.primary }}>{depth ? '└ ' : '▸ '}</span>
            {f.split('/').pop()}
          </div>
        );
      })}
      {files.length > maxItems && <div style={{ color: theme.muted }}>… {files.length - maxItems} more</div>}
    </div>
  );
};

export const BulletList: React.FC<{ items: string[]; layout: Layout; words: WordTiming[]; accent?: string }> = ({ items, layout, words, accent = theme.primary }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: layout.unit * 0.7 }}>
      {items.map((item, i) => {
        const start = revealFrame(i, items.length, words, fps, 0.4);
        const p = spring({ frame: frame - start, fps, config: { damping: 18 } });
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 22, opacity: p, transform: `translateX(${(1 - p) * 50}px)` }}>
            <div style={{ minWidth: layout.unit * 1.3, display: 'flex' }}>
              <DrawnIcon kind={(['bolt', 'check', 'star'] as const)[i % 3]} size={layout.unit * 1.3} color={i % 2 ? theme.secondary : accent} start={start + 4} />
            </div>
            <div style={{ fontFamily: theme.font, fontWeight: 600, fontSize: layout.unit * 0.95, color: theme.text, lineHeight: 1.3 }}>{item}</div>
          </div>
        );
      })}
    </div>
  );
};

export const ProsConsPanel: React.FC<{ pros: string[]; cons: string[]; layout: Layout; words: WordTiming[] }> = ({ pros, cons, layout, words }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const all = [...pros.map((p) => ['+', p] as const), ...cons.map((c) => ['−', c] as const)];
  const col = (title: string, color: string, items: string[], offset: number) => (
    <div style={{ flex: 1, background: theme.panel, border: `2px solid ${color}55`, borderRadius: 22, padding: 30 }}>
      <div style={{ fontFamily: theme.font, fontWeight: 800, fontSize: layout.unit * 1.0, color, marginBottom: 18 }}>{title}</div>
      {items.map((it, i) => {
        const start = revealFrame(offset + i, all.length, words, fps, 0.4);
        const p = spring({ frame: frame - start, fps, config: { damping: 18 } });
        return (
          <div key={i} style={{ display: 'flex', gap: 14, fontFamily: theme.font, fontSize: layout.unit * 0.72, color: theme.text, marginBottom: 16, opacity: p, transform: `translateY(${(1 - p) * 20}px)`, lineHeight: 1.3 }}>
            <span style={{ flexShrink: 0, display: 'flex' }}>
              <DrawnIcon kind={title === 'Pros' ? 'check' : 'cross'} size={layout.unit * 0.85} color={color} start={start + 2} />
            </span>
            <span>{it}</span>
          </div>
        );
      })}
      {!items.length && <div style={{ fontFamily: theme.font, fontSize: layout.unit * 0.65, color: theme.muted }}>None found</div>}
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: layout.portrait ? 'column' : 'row', gap: 32 }}>
      {col('Pros', theme.primary, pros, 0)}
      {col('Cons', theme.secondary, cons, pros.length)}
    </div>
  );
};

export const ComparisonPanel: React.FC<{ compare: NonNullable<Visual['compare']>; layout: Layout }> = ({ compare, layout }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${compare.columns.length}, 1fr)`, gap: 4, fontFamily: theme.font, fontSize: layout.unit * 0.65 }}>
      {compare.columns.map((c) => (
        <div key={c} style={{ background: theme.primary, color: theme.ink, fontWeight: 800, padding: 16 }}>
          {c}
        </div>
      ))}
      {compare.rows.flatMap((r, i) =>
        r.map((cell, j) => (
          <div key={`${i}-${j}`} style={{ background: theme.panel, color: theme.text, padding: 16, opacity: interpolate(frame, [10 + i * 8, 20 + i * 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
            {cell}
          </div>
        )),
      )}
    </div>
  );
};

/* ------------------------------ BarChart ------------------------------ */

export const BarChart: React.FC<{ bars: NonNullable<Visual['bars']>; layout: Layout; words: WordTiming[]; title?: string }> = ({ bars, layout, words, title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const max = Math.max(1, ...bars.map((b) => b.value));
  const total = bars.reduce((a, b) => a + b.value, 0) || 1;
  return (
    <div style={{ background: theme.panel, border: `2px solid ${theme.panelBorder}`, borderRadius: 20, padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {title && <div style={{ fontFamily: theme.font, fontWeight: 700, fontSize: layout.unit * 0.6, color: theme.muted }}>{title}</div>}
      {bars.map((b, i) => {
        const start = revealFrame(i, bars.length, words, fps, 0.6);
        const p = spring({ frame: frame - start, fps, config: { damping: 18, stiffness: 70 } });
        return (
          <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: layout.unit * 4.2, fontFamily: theme.mono, fontSize: layout.unit * 0.55, color: theme.text, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.label}</div>
            <div style={{ flex: 1, height: layout.unit * 0.8, background: theme.codeBg, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ width: `${(b.value / max) * 100 * p}%`, height: '100%', borderRadius: 8, background: LANGUAGE_COLORS[b.label] ?? (i % 2 ? theme.secondary : theme.primary), opacity: 0.85 }} />
            </div>
            <div style={{ width: layout.unit * 2, fontFamily: theme.font, fontWeight: 700, fontSize: layout.unit * 0.55, color: theme.muted }}>{Math.round((b.value / total) * 100 * p)}%</div>
          </div>
        );
      })}
    </div>
  );
};
