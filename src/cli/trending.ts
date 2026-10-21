import type { Mode } from '../core/schemas.js';
import { trendingFor } from '../trending/trending.js';

const mode = (process.argv[2] as Mode) ?? 'repo-video';
const { items, errors } = await trendingFor(mode);
for (const [i, it] of items.entries()) console.log(`${String(i + 1).padStart(2)}. ${it.label}\n    ${it.detail ?? ''}\n    ${it.url}  [${it.source}]`);
if (errors.length) console.error(`\nSources that failed: ${errors.join('; ')}`);
