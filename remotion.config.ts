import { Config } from '@remotion/cli/config';

// Used only by `npm run studio`. Programmatic renders configure themselves in src/render/render.ts.
Config.setVideoImageFormat('jpeg');
Config.setConcurrency(2);
