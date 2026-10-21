import { Composition, type CalculateMetadataFunction } from 'remotion';
import './fonts';
import { fixtureProps } from './fixture';
import type { VideoProps } from './types';
import { Explainer } from './Video';

/** Duration and size come from the real audio timings and the script format — never hard-coded. */
const calculateMetadata: CalculateMetadataFunction<VideoProps> = ({ props }) => {
  const portrait = props.script.format === 'portrait';
  return {
    durationInFrames: Math.max(1, Math.ceil(props.timing.totalSec * props.timing.fps)),
    fps: props.timing.fps,
    width: portrait ? 1080 : 1920,
    height: portrait ? 1920 : 1080,
  };
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Explainer" component={Explainer} defaultProps={fixtureProps('landscape')} calculateMetadata={calculateMetadata} durationInFrames={300} fps={30} width={1920} height={1080} />
    <Composition id="ExplainerReel" component={Explainer} defaultProps={fixtureProps('portrait')} calculateMetadata={calculateMetadata} durationInFrames={300} fps={30} width={1080} height={1920} />
  </>
);
