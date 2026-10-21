import React from 'react';
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Scene, Timing } from '../../core/schemas.js';
import { ArchitectureDiagram, BulletList, CodeWalkthrough, ComparisonPanel, FileTree, ProsConsPanel, StatsCounter, TerminalDemo } from './components/panels';
import { Background, Captions, LowerThird, ProgressBar, SectionTitle, Transition, revealFrame } from './components/primitives';
import { Stickman, Whiteboard } from './components/Stickman';
import { layoutFor, theme, type Layout } from './theme';
import type { CodeToken, VideoProps } from './types';

type SceneTiming = Timing['scenes'][number];

const IntroAnimation: React.FC<{ headline: string; subhead?: string; layout: Layout; badge?: string }> = ({ headline, subhead, layout, badge }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const letters = headline.split('');
  const size = Math.min(layout.unit * (layout.portrait ? 2.6 : 3.2), ((layout.width - layout.pad * 2) / Math.max(6, headline.length)) * 1.7);
  const line = spring({ frame: frame - 10, fps, config: { damping: 20 } });
  const sub = spring({ frame: frame - 18, fps, config: { damping: 20 } });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: layout.pad, flexDirection: 'column', gap: 30 }}>
      {badge && (
        <div style={{ fontFamily: theme.mono, fontSize: layout.unit * 0.55, color: theme.orange, border: `2px solid ${theme.orange}`, borderRadius: 999, padding: '8px 22px', opacity: sub }}>{badge}</div>
      )}
      <div style={{ fontFamily: theme.font, fontWeight: 800, fontSize: size, color: theme.text, textAlign: 'center', lineHeight: 1.05, letterSpacing: -1 }}>
        {letters.map((ch, i) => {
          const s = spring({ frame: frame - i * 1.2, fps, config: { damping: 12, stiffness: 140 } });
          return (
            <span key={i} style={{ display: 'inline-block', transform: `translateY(${(1 - s) * 60}px)`, opacity: s, whiteSpace: 'pre' }}>
              {ch}
            </span>
          );
        })}
      </div>
      <div style={{ height: 8, width: 360 * line, background: `linear-gradient(90deg, ${theme.cyan}, ${theme.orange})`, borderRadius: 4 }} />
      {subhead && (
        <div style={{ fontFamily: theme.font, fontSize: layout.unit * 0.95, color: theme.muted, textAlign: 'center', maxWidth: layout.width * 0.8, opacity: sub, transform: `translateY(${(1 - sub) * 20}px)`, lineHeight: 1.35 }}>
          {subhead}
        </div>
      )}
    </AbsoluteFill>
  );
};

const StickScene: React.FC<{ scene: Scene; words: SceneTiming['words']; layout: Layout }> = ({ scene, words, layout }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sm = scene.visual.stickman!;
  const board = sm.board;
  const reveal = board.map((_, i) => revealFrame(i, board.length, words, fps, 0.6));
  const figSize = layout.portrait ? 640 : 620;
  const bubble = sm.speech ? spring({ frame: frame - 12, fps, config: { damping: 14 } }) : 0;
  const figure = (
    <div style={{ position: 'relative' }}>
      {sm.speech && (
        <div style={{ position: 'absolute', top: -120, left: figSize * 0.42, background: theme.board, color: theme.ink, fontFamily: theme.hand, fontSize: layout.unit * 1.1, padding: '12px 26px', borderRadius: 26, transform: `scale(${bubble})`, transformOrigin: 'bottom left', whiteSpace: 'nowrap' }}>
          {sm.speech}
        </div>
      )}
      <Stickman pose={sm.pose} words={words} size={figSize} />
    </div>
  );
  if (!board.length) {
    return (
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: layout.portrait ? 'column' : 'row', gap: 60, padding: layout.pad }}>
        <div style={{ fontFamily: theme.font, fontWeight: 800, fontSize: layout.unit * (layout.portrait ? 2.2 : 2.6), color: theme.text, maxWidth: layout.portrait ? '100%' : '55%', textAlign: layout.portrait ? 'center' : 'left', lineHeight: 1.1 }}>
          {scene.visual.headline}
        </div>
        {figure}
        {sm.second && (
          <div style={{ position: 'absolute', right: layout.pad, bottom: layout.portrait ? 380 : 60 }}>
            <Stickman pose={sm.second} words={[]} size={figSize * 0.7} color={theme.orange} flip />
          </div>
        )}
      </AbsoluteFill>
    );
  }
  if (layout.portrait) {
    return (
      <AbsoluteFill style={{ padding: `${layout.pad + 80}px ${layout.pad}px`, flexDirection: 'column', alignItems: 'center', gap: 30 }}>
        <SectionTitle text={scene.visual.headline ?? scene.title} layout={layout} />
        <Whiteboard items={board} width={layout.width - layout.pad * 2} height={560} reveal={reveal} fontSize={layout.unit * 1.05} />
        <div style={{ marginTop: -10 }}>
          <Stickman pose={sm.pose} words={words} size={560} />
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ padding: `${layout.pad}px ${layout.pad}px 150px`, flexDirection: 'row', alignItems: 'flex-end', gap: 40 }}>
      <div style={{ width: '30%', display: 'flex', justifyContent: 'center' }}>{figure}</div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 30, alignSelf: 'stretch', justifyContent: 'center' }}>
        <SectionTitle text={scene.visual.headline ?? scene.title} layout={layout} />
        <Whiteboard items={board} width={1050} height={520} reveal={reveal} fontSize={layout.unit * 1.15} />
      </div>
      {sm.second && (
        <div style={{ position: 'absolute', left: layout.pad + 360, bottom: 120 }}>
          <Stickman pose={sm.second} words={[]} size={380} color={theme.orange} />
        </div>
      )}
    </AbsoluteFill>
  );
};

const SceneBody: React.FC<{ scene: Scene; timing: SceneTiming; tokens?: CodeToken[][]; layout: Layout; explainer: boolean }> = ({ scene, timing, tokens, layout, explainer }) => {
  const v = scene.visual;
  const words = timing.words;
  const contentW = layout.width - layout.pad * 2;
  const contentH = layout.height - (layout.portrait ? 900 : 360);
  const frame = (children: React.ReactNode, title = true) => (
    <AbsoluteFill style={{ padding: layout.portrait ? `${layout.pad + 90}px ${layout.pad}px` : `${layout.pad - 10}px ${layout.pad}px 150px`, flexDirection: 'column', gap: layout.portrait ? 40 : 34 }}>
      {title && <SectionTitle text={v.headline ?? scene.title} layout={layout} />}
      <div style={{ flex: 1, display: 'flex', alignItems: layout.portrait ? 'flex-start' : 'center', justifyContent: 'center' }}>{children}</div>
    </AbsoluteFill>
  );

  if (v.stickman) return <StickScene scene={scene} words={words} layout={layout} />;
  switch (scene.type) {
    case 'intro':
    case 'hook':
      return <IntroAnimation headline={v.headline ?? scene.title} subhead={v.subhead} layout={layout} badge={explainer ? 'EXPLAINED' : 'CODE TOUR'} />;
    case 'outro':
      return <IntroAnimation headline={v.headline ?? scene.title} subhead={v.subhead} layout={layout} badge="THANKS FOR WATCHING" />;
    case 'code':
      return v.code
        ? frame(<CodeWalkthrough code={v.code} tokens={tokens} words={words} layout={layout} width={contentW} height={contentH} />, false)
        : frame(<BulletList items={v.bullets ?? []} layout={layout} words={words} />);
    case 'architecture':
    case 'data-flow':
      return v.graph ? frame(<ArchitectureDiagram graph={v.graph} words={words} layout={layout} width={contentW} height={contentH - 60} />) : frame(null);
    case 'terminal':
      return v.terminal ? frame(<TerminalDemo terminal={v.terminal} words={words} layout={layout} width={contentW} />) : frame(null);
    case 'stats':
      return frame(
        <div style={{ display: 'flex', flexDirection: layout.portrait ? 'column' : 'row', gap: 40, width: '100%', alignItems: 'center' }}>
          <div style={{ flex: 1.3 }}>{v.stats && <StatsCounter stats={v.stats} layout={layout} words={words} />}</div>
          {v.files && v.files.length > 0 && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <FileTree files={v.files} layout={layout} maxItems={layout.portrait ? 8 : 12} />
            </div>
          )}
        </div>,
      );
    case 'pros-cons':
      return frame(<ProsConsPanel pros={v.pros ?? []} cons={v.cons ?? []} layout={layout} words={words} />);
    case 'comparison':
      return v.compare ? frame(<ComparisonPanel compare={v.compare} layout={layout} />) : frame(null);
    default:
      return frame(
        <div style={{ display: 'flex', alignItems: 'center', gap: 50, width: '100%' }}>
          {explainer && !layout.portrait && <Stickman pose="point" words={words} size={460} />}
          <div style={{ flex: 1 }}>
            <BulletList items={v.bullets ?? (v.subhead ? [v.subhead] : [])} layout={layout} words={words} />
          </div>
        </div>,
      );
  }
};

export const Explainer: React.FC<VideoProps> = ({ script, timing, code }) => {
  const { width, height, fps } = useVideoConfig();
  const layout = layoutFor(width, height);
  const explainer = script.mode !== 'repo-video';
  const total = Math.ceil(timing.totalSec * fps);
  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <Background layout={layout} />
      {script.scenes.map((scene, i) => {
        const t = timing.scenes.find((x) => x.id === scene.id);
        if (!t) return null;
        const from = Math.round(t.startSec * fps);
        const dur = Math.max(1, Math.round(t.durationSec * fps));
        return (
          <Sequence key={scene.id} from={from} durationInFrames={dur} name={`${scene.id} ${scene.type}`}>
            <Transition kind={scene.transition} durationInFrames={dur}>
              <SceneBody scene={scene} timing={t} tokens={code[scene.id]} layout={layout} explainer={explainer} />
            </Transition>
            {!['intro', 'hook', 'outro'].includes(scene.type) && !layout.portrait && <LowerThird label={`${String(i + 1).padStart(2, '0')} · ${scene.title}`} layout={layout} />}
            {scene.captions.enabled && <Captions words={t.words} maxWords={scene.captions.maxWords} layout={layout} emphasis={scene.emphasisWords} />}
          </Sequence>
        );
      })}
      <ProgressBar layout={layout} total={total} />
      <Watermark layout={layout} label={script.mode === 'repo-video' ? (script.url ?? '').replace('https://', '') : script.title} />
    </AbsoluteFill>
  );
};

const Watermark: React.FC<{ layout: Layout; label: string }> = ({ layout, label }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 30], [0, 0.55], { extrapolateRight: 'clamp' });
  if (!label) return null;
  return (
    <div style={{ position: 'absolute', right: layout.pad * 0.5, top: layout.portrait ? 60 : 44, fontFamily: theme.mono, fontSize: layout.unit * 0.45, color: theme.muted, opacity: o, maxWidth: layout.width * 0.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {label}
    </div>
  );
};
