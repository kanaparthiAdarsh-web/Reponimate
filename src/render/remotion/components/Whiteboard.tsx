import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { alpha, theme } from '../theme';

/** Whiteboard whose lines are "written" one after another in a handwriting font. */
export const Whiteboard: React.FC<{ items: string[]; width: number; height: number; reveal: number[]; fontSize: number; title?: string }> = ({ items, width, height, reveal, fontSize, title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16 } });
  return (
    <div
      style={{
        width,
        height,
        background: theme.board,
        borderRadius: 18,
        border: `10px solid ${alpha(theme.boardInk, 0.18)}`,
        boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
        padding: fontSize * 0.9,
        boxSizing: 'border-box',
        transform: `scale(${0.9 + 0.1 * enter})`,
        opacity: enter,
        display: 'flex',
        flexDirection: 'column',
        gap: fontSize * 0.55,
        overflow: 'hidden',
      }}
    >
      {title && <div style={{ fontFamily: theme.hand, fontSize: fontSize * 1.15, color: theme.boardInk, borderBottom: `4px solid ${alpha(theme.primary, 0.6)}`, paddingBottom: 6 }}>{title}</div>}
      {items.map((item, i) => {
        const start = reveal[i] ?? 0;
        const chars = Math.floor(interpolate(frame, [start, start + Math.max(12, item.length * 0.9)], [0, item.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
        if (frame < start) return null;
        return (
          <div key={i} style={{ fontFamily: theme.hand, fontSize, color: theme.boardInk, lineHeight: 1.15, display: 'flex', gap: 14 }}>
            <span style={{ color: i % 2 ? theme.secondary : theme.primary, filter: 'brightness(0.75) saturate(1.4)' }}>✎</span>
            <span>{item.slice(0, chars)}</span>
          </div>
        );
      })}
    </div>
  );
};
