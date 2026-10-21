// Reponimate studio front end (no build step).
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const HELP = {
  'repo-video': 'Paste a public GitHub URL. Reponimate clones it (without running any of its code), maps the architecture, retrieves real code with RAG and makes a 16:9 code-walkthrough video.',
  'doc-video': 'Paste documentation, notes or any description — or give a URL or a topic. You get a 16:9 explainer with an animated animated presenter teacher, whiteboards and captions.',
  'doc-reel': 'Same inputs, but a vertical 9:16 short (under a minute) with big captions — ready for Shorts / Reels.',
};

let mode = 'repo-video';
let current = null;
let source = null;

function setMode(m) {
  mode = m;
  document.body.dataset.mode = m;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === m));
  $('#mode-help').textContent = HELP[m];
  $('#trending').hidden = true;
  try { localStorage.setItem('reponimate.mode', m); } catch {}
}

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function showError(msg) {
  const el = $('#form-error');
  el.hidden = !msg;
  el.textContent = msg || '';
}

async function health() {
  try {
    const h = await api('/api/health');
    const item = (ok, label) => `<span class="${ok ? 'ok' : 'bad'}">${ok ? '●' : '○'} ${label}</span>`;
    $('#health').innerHTML = [
      item(h.llm.ollama, h.llm.ollama ? `Ollama (${h.llm.models.length} models)` : 'Ollama offline → extractive writer'),
      item(h.tts.piperVoice || h.tts.espeak, h.tts.piperVoice ? 'Piper voice' : h.tts.espeak ? 'eSpeak voice' : 'no voice'),
      item(h.ffmpeg, 'FFmpeg'),
      item(Boolean(h.browser), 'Chromium'),
      item(h.rustScanner, h.rustScanner ? 'Rust scanner' : 'TS scanner'),
    ].join('');
  } catch {
    $('#health').textContent = 'server unreachable';
  }
}

function formBody() {
  return {
    mode,
    repoUrl: $('#repoUrl').value.trim(),
    title: $('#title').value.trim(),
    text: $('#text').value,
    url: $('#url').value.trim(),
    topic: $('#topic').value.trim(),
    preview: $('#preview').checked,
    llm: $('#llm').value,
    channelName: $('#channelName').value.trim(),
  };
}

async function submit(e) {
  e.preventDefault();
  showError('');
  const btn = e.submitter ?? $('#job-form button[type=submit]');
  btn.disabled = true;
  try {
    const job = await api('/api/jobs', formBody());
    await refreshJobs();
    openJob(job.id);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function autopilot() {
  showError('');
  const btn = $('#autopilot');
  btn.disabled = true;
  btn.textContent = '⚡ Searching trends…';
  try {
    const r = await api('/api/autopilot', { mode, preview: $('#preview').checked, llm: $('#llm').value, channelName: $('#channelName').value.trim() });
    await refreshJobs();
    openJob(r.job.id);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Start — pick a trending topic for me';
  }
}

async function showTrending() {
  const box = $('#trending');
  box.hidden = false;
  box.innerHTML = '<p class="muted">Loading trending topics…</p>';
  try {
    const { items, errors } = await api(`/api/trending?mode=${mode}`);
    if (!items.length) {
      box.innerHTML = `<p class="muted">No trending items found. ${esc(errors.join('; '))}</p>`;
      return;
    }
    box.innerHTML = items
      .slice(0, 12)
      .map((it, i) => `<div class="trend"><div><div class="t">${esc(it.label)}</div><div class="d">${esc(it.detail)} · ${esc(it.source)}</div></div><button class="btn ghost" data-i="${i}">Use</button></div>`)
      .join('');
    box.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        const it = items[Number(b.dataset.i)];
        if (it.input.repoUrl) $('#repoUrl').value = it.input.repoUrl;
        if (it.input.topic) { $('#topic').value = it.input.topic; $('#url').value = ''; }
        if (it.input.urls?.length) { $('#url').value = it.input.urls[0]; $('#topic').value = ''; }
        if (it.input.textTitle) $('#title').value = it.input.textTitle;
        box.hidden = true;
      }),
    );
  } catch (err) {
    box.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

const MODE_LABEL = { 'repo-video': 'Repo → Video', 'doc-video': 'Description → Video', 'doc-reel': 'Description → Reel' };

function jobProgress(j) {
  const n = j.stages.length;
  return j.status === 'done' ? 100 : Math.round(((j.stageIndex + (j.progress || 0)) / n) * 100);
}

async function refreshJobs() {
  const jobs = await api('/api/jobs');
  const el = $('#jobs');
  if (!jobs.length) {
    el.innerHTML = '<p class="muted">No videos yet.</p>';
    return;
  }
  el.innerHTML = jobs
    .map(
      (j) => `<div class="job" data-id="${esc(j.id)}">
        <div><div class="name">${esc(j.label)}</div><div class="meta">${MODE_LABEL[j.mode] ?? j.mode} · ${new Date(j.createdAt).toLocaleString()}${j.stage && j.status === 'running' ? ` · ${esc(j.stage)}` : ''}</div></div>
        <span class="badge ${j.status}">${j.status}</span>
        <div class="bar"><i data-progress="${jobProgress(j)}"></i></div></div>`,
    )
    .join('');
  // The CSP forbids inline style attributes, so widths are applied through the CSSOM.
  el.querySelectorAll('[data-progress]').forEach((i) => (i.style.width = `${i.dataset.progress}%`));
  el.querySelectorAll('.job').forEach((d) => d.addEventListener('click', () => openJob(d.dataset.id)));
}

function logLine(l) {
  return `<div class="${esc(l.level)}">${esc(l.message)}</div>`;
}

async function openJob(id) {
  current = id;
  source?.close();
  const panel = $('#detail');
  panel.hidden = false;
  await renderDetail(id);
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  source = new EventSource(`/api/jobs/${encodeURIComponent(id)}/events`);
  let pending = false;
  const rerender = () => {
    if (pending) return;
    pending = true;
    setTimeout(async () => {
      pending = false;
      if (current === id) await renderDetail(id);
      await refreshJobs();
    }, 700);
  };
  source.addEventListener('log', (e) => {
    const logs = $('#logs');
    if (logs) {
      logs.insertAdjacentHTML('beforeend', logLine(JSON.parse(e.data)));
      logs.scrollTop = logs.scrollHeight;
    }
  });
  ['stage', 'status'].forEach((ev) => source.addEventListener(ev, rerender));
  source.addEventListener('progress', () => refreshJobs());
}

async function renderDetail(id) {
  const j = await api(`/api/jobs/${encodeURIComponent(id)}`);
  const file = (f) => `/files/${encodeURIComponent(j.id)}/${encodeURIComponent(f)}`;
  const dl = (f, label) => `<a class="btn ghost dl" href="${file(f)}?download=1" download>⬇ ${esc(label)}</a>`;
  const has = (f) => j.files.includes(f);
  const m = j.metadata;
  const q = j.quality;
  $('#detail').innerHTML = `
    <div class="detail-head"><h2>${esc(j.label)} <span class="badge ${j.status}">${j.status}</span></h2>
      <div class="actions">${j.status === 'failed' || j.status === 'incomplete' ? '<button class="btn ghost" id="resume">Resume from cache</button>' : ''}</div></div>
    ${j.error ? `<div class="error">${esc(j.error)}</div>` : ''}
    ${has('final.mp4') ? `<video controls preload="metadata" src="${file('final.mp4')}" ${has('thumbnail.png') ? `poster="${file('thumbnail.png')}"` : ''}></video>` : `<p class="muted">Stage: ${esc(j.stage ?? 'waiting')} — ${jobProgress(j)}%</p>`}
    ${has('final.mp4') || has('thumbnail.png') ? `<div class="actions downloads">${[
      has('final.mp4') && dl('final.mp4', 'Video (MP4)'),
      has('thumbnail.png') && dl('thumbnail.png', 'Thumbnail (PNG)'),
    ].filter(Boolean).join('')}</div>` : ''}
    <div class="grid2">
      ${m ? `<div class="box"><h3>Titles <button class="btn ghost copy" data-copy="titles">Copy</button></h3><pre id="titles">${esc(m.titles.join('\n'))}</pre></div>
      <div class="box"><h3>Description <button class="btn ghost copy" data-copy="desc">Copy</button></h3><pre id="desc">${esc(m.description)}</pre></div>
      <div class="box"><h3>Tags <button class="btn ghost copy" data-copy="tags">Copy</button></h3><pre id="tags">${esc(m.tags.join(', '))}</pre></div>` : ''}
      ${has('thumbnail.png') ? `<div class="box"><h3>Thumbnail <a class="btn ghost copy" href="${file('thumbnail.png')}?download=1" download>⬇ Download</a></h3><img class="thumb" src="${file('thumbnail.png')}" alt="thumbnail" /></div>` : ''}
      ${q ? `<div class="box"><h3>Quality report ${q.ok ? '✅' : '⚠️'}</h3><ul class="checks">${q.checks.map((c) => `<li class="${c.ok ? 'ok' : 'no'}">${c.ok ? '✓' : '!'} ${esc(c.name)} — <span class="muted">${esc(c.detail)}</span></li>`).join('')}</ul></div>` : ''}
      <div class="box"><h3>Files</h3><div class="files">${j.files.map((f) => `<a href="${file(f)}" target="_blank" rel="noopener">${esc(f)}</a>`).join('')}</div></div>
      <div class="box wide"><h3>Log</h3><div class="logs" id="logs">${j.logs.map(logLine).join('')}</div></div>
    </div>`;
  $('#resume')?.addEventListener('click', async () => {
    await api(`/api/jobs/${encodeURIComponent(j.id)}/resume`, {});
    openJob(j.id);
  });
  document.querySelectorAll('[data-copy]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText($('#' + b.dataset.copy).textContent);
        b.textContent = 'Copied ✓';
      } catch {
        b.textContent = 'Select & copy';
      }
      setTimeout(() => (b.textContent = 'Copy'), 1500);
    }),
  );
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));
$('#job-form').addEventListener('submit', submit);
$('#autopilot').addEventListener('click', autopilot);
$('#show-trending').addEventListener('click', showTrending);
// Remember the channel name between visits (per browser).
try { $('#channelName').value = localStorage.getItem('reponimate.channel') || ''; } catch {}
$('#channelName').addEventListener('change', () => { try { localStorage.setItem('reponimate.channel', $('#channelName').value.trim()); } catch {} });
let saved = 'repo-video';
try { saved = localStorage.getItem('reponimate.mode') || saved; } catch {}
setMode(HELP[saved] ? saved : 'repo-video');
health();
refreshJobs().catch(() => {});
setInterval(() => refreshJobs().catch(() => {}), 10000);
