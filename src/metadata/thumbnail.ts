import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import type { AppConfig } from '../core/config.js';
import { ROOT } from '../core/config.js';
import { UserError } from '../core/errors.js';
import type { Analysis, Metadata, Script } from '../core/schemas.js';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function fontFace(family: string, file: string, weight: number): string {
  const p = path.join(ROOT, 'node_modules', '@fontsource', file);
  if (!fs.existsSync(p)) return '';
  return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${fs.readFileSync(p).toString('base64')}) format('woff2');}`;
}

export function thumbnailHtml(meta: Metadata, script: Script, analysis: Analysis): string {
  const words = meta.thumbnailText.split(/\s+/).slice(0, 3);
  const code = script.scenes.find((s) => s.visual.code)?.visual.code;
  const art = code
    ? `<pre class="code">${esc(code.code.split('\n').slice(0, 9).map((l) => l.slice(0, 38)).join('\n'))}</pre>`
    : `<svg class="stick" viewBox="0 0 300 500"><g stroke="#E6EDF7" stroke-width="10" fill="none" stroke-linecap="round"><circle cx="150" cy="88" r="40" fill="#0B1426"/><path d="M150 128 L150 285"/><path d="M150 150 L80 210 L40 160"/><path d="M150 150 L230 120 L290 70"/><path d="M150 285 L120 380 L110 470"/><path d="M150 285 L180 380 L190 470"/><path d="M134 102 Q150 118 166 102"/></g><circle cx="134" cy="82" r="6" fill="#E6EDF7"/><circle cx="166" cy="82" r="6" fill="#E6EDF7"/></svg>`;
  const sub = analysis.kind === 'repo' ? `${analysis.repo.owner}/${analysis.repo.name}` : script.mode === 'doc-reel' ? 'IN 60 SECONDS' : 'EXPLAINED SIMPLY';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFace('Inter', 'inter/files/inter-latin-800-normal.woff2', 800)}
${fontFace('JetBrains Mono', 'jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2', 400)}
*{margin:0;box-sizing:border-box}
body{width:1280px;height:720px;overflow:hidden;background:radial-gradient(ellipse at 25% 20%,#16294A 0%,#0B1426 65%);font-family:Inter,sans-serif;position:relative}
.t{position:absolute;left:70px;top:90px;width:700px;display:flex;flex-direction:column;gap:6px}
.w{font-weight:800;font-size:118px;line-height:.98;color:#fff;letter-spacing:-3px;text-shadow:0 8px 0 rgba(0,0,0,.35);word-break:break-word}
.w:nth-child(2){color:#22D3EE}.w:nth-child(3){color:#FB923C}
.sub{position:absolute;left:74px;bottom:70px;font-family:'JetBrains Mono',monospace;font-size:30px;color:#8DA2C0}
.bar{position:absolute;left:74px;bottom:120px;width:260px;height:12px;border-radius:6px;background:linear-gradient(90deg,#22D3EE,#FB923C)}
.code{position:absolute;right:50px;top:110px;width:440px;padding:30px;background:#0A1222;border:3px solid #22D3EE;border-radius:22px;color:#E6EDF7;font:24px/1.45 'JetBrains Mono',monospace;transform:rotate(3deg);box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden}
.stick{position:absolute;right:120px;top:120px;width:300px;height:500px}
</style></head><body><div class="t">${words.map((w) => `<div class="w">${esc(w)}</div>`).join('')}</div>${art}<div class="bar"></div><div class="sub">${esc(sub)}</div></body></html>`;
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
