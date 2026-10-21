import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Visual } from '../../../core/schemas.js';
import { alpha, theme, type Layout } from '../theme';

type Flow = NonNullable<Visual['flow']>;

/**
 * Flowchart of the on-screen code. Nodes appear top to bottom; the node whose source line is being
 * explained glows, and a packet travels into it from the previous step.
 */
export const Flowchart: React.FC<{ flow: Flow; activeLine: number; prevLine: number; stepFrame: number; layout: Layout; width: number; height: number }> = ({
  flow,
  activeLine,
  prevLine,
  stepFrame,
  layout,
  width,
  height,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const n = flow.nodes.length;
  const gap = height / n;
  const nodeH = Math.min(78, gap * 0.62);
  const nodeW = Math.min(width * 0.8, 380);
  const cx = width * 0.45;
  const pos = new Map(flow.nodes.map((node, i) => [node.id, { x: cx, y: gap * (i + 0.5) }]));
  const activeIdx = Math.max(0, flow.nodes.reduce((acc, node, i) => (node.line <= activeLine ? i : acc), 0));
  const prevIdx = Math.max(0, flow.nodes.reduce((acc, node, i) => (node.line <= prevLine ? i : acc), 0));
  const travel = spring({ frame: frame - stepFrame, fps, config: { damping: 22, stiffness: 70 } });
  const fs = Math.max(17, Math.min(layout.unit * 0.5, nodeH * 0.3));

  const colorOf = (kind: string): string =>
    kind === 'decision' ? theme.secondary : kind === 'error' ? theme.danger : kind === 'return' ? theme.success : kind === 'loop' ? theme.tertiary : theme.primary;

  const shape = (kind: string, w: number, h: number, fill: string, stroke: string, glow: boolean) => {
    const common = { fill, stroke, strokeWidth: glow ? 4 : 2.5 };
    switch (kind) {
      case 'decision':
        return <polygon points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`} {...common} />;
      case 'loop':
        return <polygon points={`${h * 0.35},0 ${w - h * 0.35},0 ${w},${h / 2} ${w - h * 0.35},${h} ${h * 0.35},${h} 0,${h / 2}`} {...common} />;
      case 'start':
      case 'return':
      case 'error':
        return <rect width={w} height={h} rx={h / 2} {...common} />;
      default:
        return <rect width={w} height={h} rx={10} {...common} />;
    }
  };

  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <defs>
        <marker id="flowArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.muted} />
        </marker>
      </defs>
      {flow.edges.map((e, i) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        const fromIdx = flow.nodes.findIndex((x) => x.id === e.from);
        const appear = interpolate(frame, [8 + fromIdx * 6, 20 + fromIdx * 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const side = e.label === 'no';
        const y1 = a.y + nodeH / 2;
        const y2 = b.y - nodeH / 2;
        const d = side
          ? `M ${a.x + nodeW / 2} ${a.y} C ${a.x + nodeW / 2 + 70} ${a.y}, ${b.x + nodeW / 2 + 70} ${b.y}, ${b.x + nodeW / 2 + 4} ${b.y}`
          : `M ${a.x} ${y1} L ${b.x} ${y2}`;
        return (
          <g key={i} opacity={appear}>
            <path d={d} stroke={side ? alpha(theme.secondary, 0.8) : theme.muted} strokeWidth={2.5} fill="none" strokeDasharray={side ? '8 6' : undefined} markerEnd="url(#flowArrow)" />
            {e.label && (
              <text x={side ? a.x + nodeW / 2 + 50 : a.x + 12} y={side ? (a.y + b.y) / 2 : (y1 + y2) / 2 + 5} fontFamily={theme.mono} fontSize={fs * 0.8} fill={side ? theme.secondary : theme.muted}>
                {e.label}
              </text>
            )}
          </g>
        );
      })}
      {/* packet travelling from the previous step to the active one */}
      {activeIdx !== prevIdx && travel < 0.98 && (
        <circle cx={cx} cy={gap * (prevIdx + 0.5) + (gap * (activeIdx - prevIdx)) * travel} r={9} fill={theme.primary} opacity={0.9} />
      )}
      {flow.nodes.map((node, i) => {
        const p = pos.get(node.id)!;
        const s = spring({ frame: frame - (6 + i * 6), fps, config: { damping: 15 } });
        const active = i === activeIdx;
        const done = i < activeIdx;
        const c = colorOf(node.kind);
        const pulse = active ? 1 + 0.025 * Math.sin((frame / fps) * 8) : 1;
        return (
          <g key={node.id} transform={`translate(${p.x - (nodeW * s * pulse) / 2} ${p.y - (nodeH * s * pulse) / 2}) scale(${s * pulse})`} filter={active ? `drop-shadow(0 0 14px ${alpha(c, 0.8)})` : undefined} opacity={active ? 1 : done ? 0.85 : 0.55}>
            {shape(node.kind, nodeW, nodeH, active ? alpha(c, 0.25) : theme.panel, c, active)}
            <text x={nodeW / 2} y={nodeH / 2} textAnchor="middle" dominantBaseline="middle" fontFamily={theme.mono} fontSize={fs} fill={theme.text}>
              {node.label}
            </text>
            <text x={-12} y={nodeH / 2} textAnchor="end" dominantBaseline="middle" fontFamily={theme.mono} fontSize={fs * 0.72} fill={active ? c : theme.muted}>
              L{node.line}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
