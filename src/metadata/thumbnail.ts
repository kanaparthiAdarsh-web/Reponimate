import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import type { AppConfig } from '../core/config.js';
import { ROOT } from '../core/config.js';
import { UserError } from '../core/errors.js';
import type { Analysis, Metadata, Script } from '../core/schemas.js';
import { PALETTES } from '../render/palette-data.js';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function fontFace(family: string, file: string, weight: number): string {
  const p = path.join(ROOT, 'node_modules', '@fontsource', file);
  if (!fs.existsSync(p)) return '';
  return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${fs.readFileSync(p).toString('base64')}) format('woff2');}`;
}

export function thumbnailHtml(meta: Metadata, script: Script, analysis: Analysis): string {
  const words = meta.thumbnailText.split(/\s+/).slice(0, 3);
  const code = script.scenes.find((s) => s.visual.code)?.visual.code;
  const p = script.theme ?? PALETTES.slate;
  // A flat presenter (same style as the video's host) pointing at the title.
  const person = `<svg class="person" viewBox="0 0 300 500"><g stroke-linecap="round" fill="none">
    <path d="M132 292 L120 384 L112 470" stroke="#3a3f4b" stroke-width="38"/><path d="M168 292 L182 384 L190 470" stroke="#3a3f4b" stroke-width="38"/>
    <path d="M112 150 Q150 136 188 150 L184 296 Q150 304 116 296 Z" fill="${p.primary}" stroke="none"/>
    <path d="M116 156 L64 214 L40 168" stroke="${p.primary}" stroke-width="28"/><circle cx="40" cy="166" r="13" fill="#E8B796" stroke="none"/>
    <path d="M184 156 L250 140 L292 104" stroke="${p.primary}" stroke-width="28"/><circle cx="292" cy="102" r="13" fill="#E8B796" stroke="none"/>
    <ellipse cx="150" cy="80" rx="38" ry="44" fill="#E8B796" stroke="none"/>
    <path d="M110 72 C108 42 128 30 152 30 C176 30 194 44 190 70 C184 56 170 48 150 50 C134 50 118 56 110 72 Z" fill="#3B2A20" stroke="none"/>
    <ellipse cx="136" cy="76" rx="5" ry="6" fill="#2A211C" stroke="none"/><ellipse cx="164" cy="76" rx="5" ry="6" fill="#2A211C" stroke="none"/>
    <path d="M136 100 Q150 116 164 100" fill="#6B2E2A" stroke="#6B2E2A" stroke-width="3"/></g></svg>`;
  const art = code
    ? `<pre class="code">${esc(code.code.split('\n').slice(0, 9).map((l) => l.slice(0, 38)).join('\n'))}</pre>${person}`
    : person;
  const sub = analysis.kind === 'repo' ? `${analysis.repo.owner}/${analysis.repo.name}` : script.mode === 'doc-reel' ? 'IN 60 SECONDS' : 'EXPLAINED SIMPLY';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFace('Inter', 'inter/files/inter-latin-800-normal.woff2', 800)}
${fontFace('JetBrains Mono', 'jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2', 400)}
*{margin:0;box-sizing:border-box}
body{width:1280px;height:720px;overflow:hidden;background:radial-gradient(ellipse at 25% 20%,${p.bg2} 0%,${p.bg} 65%);font-family:Inter,sans-serif;position:relative}
.t{position:absolute;left:70px;top:90px;width:700px;display:flex;flex-direction:column;gap:6px}
.w{font-weight:800;font-size:118px;line-height:.98;color:${p.text};letter-spacing:-3px;text-shadow:0 8px 0 rgba(0,0,0,.35);word-break:break-word}
.w:nth-child(2){color:${p.primary}}.w:nth-child(3){color:${p.secondary}}
.sub{position:absolute;left:74px;bottom:70px;font-family:'JetBrains Mono',monospace;font-size:30px;color:${p.muted}}
.bar{position:absolute;left:74px;bottom:120px;width:260px;height:12px;border-radius:6px;background:linear-gradient(90deg,${p.primary},${p.secondary})}
.code{position:absolute;right:120px;top:90px;width:420px;padding:30px;background:${p.codeBg};border:3px solid ${p.primary};border-radius:22px;color:${p.text};font:24px/1.45 'JetBrains Mono',monospace;transform:rotate(3deg);box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden}
.person{position:absolute;right:20px;bottom:-30px;width:260px;height:433px}
.badge{position:absolute;right:30px;top:24px;padding:8px 18px;border-radius:999px;background:${p.panel};color:${p.text};font:700 22px Inter,sans-serif;border:2px solid ${p.primary}}
</style></head><body><div class="t">${words.map((w) => `<div class="w">${esc(w)}</div>`).join('')}</div>${art}<div class="bar"></div><div class="sub">${esc(sub)}</div>${script.channelName ? `<div class="badge">${esc(script.channelName)}</div>` : ''}</body></html>`;
}

/** Renders thumbnail.html to a 1280x720 PNG with the locally installed Chromium. */
export async function renderThumbnail(o: { dir: string; meta: Metadata; script: Script; analysis: Analysis; cfg: AppConfig }): Promise<void> {
  const html = thumbnailHtml(o.meta, o.script, o.analysis);
  const htmlFile = path.join(o.dir, 'thumbnail.html');
  fs.writeFileSync(htmlFile, html);
  const exe = o.cfg.render.browserExecutable;
  if (!exe) throw new UserError('No Chromium found for the thumbnail.', 'Set BROWSER_EXECUTABLE in .env to a Chrome/Chromium binary.');
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const fontsOk = await page.evaluate(() => document.fonts.check('800 100px Inter'));
    if (!fontsOk) throw new Error('Thumbnail font failed to load');
    await page.screenshot({ path: path.join(o.dir, 'thumbnail.png') as `${string}.png`, type: 'png' });
  } finally {
    await browser.close();
  }
}
