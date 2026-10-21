import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../core/config.js';
import { formatError, UserError } from '../core/errors.js';
import { slugify } from '../core/files.js';
import { JobInputSchema, type JobInput, type Mode } from '../core/schemas.js';
import { runPipeline } from '../pipeline/runner.js';
import { STAGES } from '../pipeline/stages.js';
import { pickTrending } from '../trending/trending.js';
import { parseArgs } from './args.js';

const HELP = `Reponimate — turn a GitHub repo or documentation into a narrated video.

Usage:
  npm run make-video -- https://github.com/OWNER/REPO            repo → long video (16:9)
  npm run make-video -- --mode doc-video --file notes.md         description → explainer video (16:9)
  npm run make-video -- --mode doc-reel --text "..."             description → reel/short (9:16)
  npm run make-video -- --mode doc-video --url https://...       explain a web page
  npm run make-video -- --mode doc-reel --topic "Black holes"    research a topic on Wikipedia
  npm run make-video -- --mode repo-video --trending             pick a trending repo automatically
  npm run make-video -- --mode doc-reel --trending               pick a trending topic automatically

Options:
  --mode repo-video|doc-video|doc-reel   (default: repo-video, or doc-video when no URL is given)
  --ref <branch|tag|sha>                 pin a repository revision
  --title "..."                          title for pasted text
  --out <dir>                            output directory (default: out/<slug>)
  --resume-from <stage>                  re-run from a stage: ${STAGES.map((s) => s.name).join(', ')}
  --stop-after <stage>                   stop after a stage (e.g. script)
  --llm ollama|anthropic|none            override LLM_PROVIDER (none = extractive, no model needed)
  --tts piper|kokoro|espeak              override TTS_PROVIDER
  --preview                              half-resolution fast render
  --chunk-render                         render in 20-second chunks (weak PCs; resumable)
  --fresh                                delete cached results for this video and start over
  --allow-execution                      not supported: repository code is never executed
`;

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (flags.help || flags.h || (!positional.length && !flags.mode && !flags.trending && !flags.text && !flags.file && !flags.url && !flags.topic)) {
    console.log(HELP);
    return;
  }
  if (flags['allow-execution']) throw new UserError('--allow-execution is intentionally not implemented: repository code is never executed.');
  const cfg = loadConfig();
  const repoUrl = positional.find((p) => /^https?:\/\//.test(p));
  let mode = (flags.mode as Mode | undefined) ?? (repoUrl ? 'repo-video' : 'doc-video');
  let input: JobInput = JobInputSchema.parse({
    mode,
    repoUrl: mode === 'repo-video' ? repoUrl : undefined,
    ref: typeof flags.ref === 'string' ? flags.ref : undefined,
    text: typeof flags.text === 'string' ? flags.text : typeof flags.file === 'string' ? fs.readFileSync(flags.file, 'utf8') : undefined,
    textTitle: typeof flags.title === 'string' ? flags.title : undefined,
    urls: [...(typeof flags.url === 'string' ? [flags.url] : []), ...(mode !== 'repo-video' && repoUrl ? [repoUrl] : [])],
    topic: typeof flags.topic === 'string' ? flags.topic : undefined,
    preview: Boolean(flags.preview),
    chunkRender: Boolean(flags['chunk-render']),
  });
  if (flags.trending) {
    const pick = await pickTrending(mode);
    console.log(`Trending pick: ${pick.label} (${pick.source})`);
    input = { ...input, ...pick.input };
    mode = input.mode;
  }
  const name = input.repoUrl ? input.repoUrl.replace(/^https:\/\/github\.com\//, '').replace('/', '-') : input.textTitle || input.topic || input.urls[0] || input.text?.slice(0, 40) || 'video';
  const dir = typeof flags.out === 'string' ? path.resolve(flags.out) : path.join(cfg.outDir, `${slugify(name)}-${mode}`);
  if (flags.fresh) fs.rmSync(dir, { recursive: true, force: true });
  else if (fs.existsSync(path.join(dir, 'job.json')) && !flags['resume-from']) {
    const when = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8')).createdAt;
    console.log(`Reusing cached results from ${when}. Pass --fresh to start over or --resume-from <stage> to redo part of it.`);
  }
  console.log(`Output: ${dir}`);
  const res = await runPipeline({
    cfg,
    dir,
    input,
    resumeFrom: typeof flags['resume-from'] === 'string' ? flags['resume-from'] : undefined,
    stopAfter: typeof flags['stop-after'] === 'string' ? flags['stop-after'] : undefined,
    llm: typeof flags.llm === 'string' ? flags.llm : undefined,
    tts: typeof flags.tts === 'string' ? flags.tts : undefined,
  });
  console.log(`\n✔ Done. ${res.warnings.length} warning(s). Files in ${res.dir}`);
  if (fs.existsSync(path.join(res.dir, 'final.mp4'))) {
    console.log('  Review the video before uploading, and enable YouTube\'s "altered or synthetic content" disclosure (AI voice).');
  }
}

main().catch((err) => {
  console.error('\n✖ ' + formatError(err));
  process.exit(1);
});
