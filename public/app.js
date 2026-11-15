const $ = id => document.getElementById(id);
let token = '', current = null, selected = null, offset = 0, demoEnabled = false;
const message = (text, error = false) => { $('notice').textContent = text; $('notice').classList.toggle('error', error); };
function el(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
function svg(tag, attributes = {}, text) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attributes).forEach(([k, v]) => e.setAttribute(k, String(v))); if (text !== undefined) e.textContent = text; return e; }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(20000) });
  const body = await response.json();
  if (!response.ok) { if (response.status === 401 && !$('auth-dialog').open) $('auth-dialog').showModal(); throw new Error(body.error || `Request failed (${response.status})`); }
  return body;
}
async function action(task) {
  for (const id of ['demo', 'healthy', 'refresh', 'upload']) $(id).disabled = true;
  message('Analyzing evidence…');
  try { await task(); } catch (err) { message(err.message, true); }
  finally { $('refresh').disabled = false; $('upload').disabled = false; $('demo').disabled = !demoEnabled; $('healthy').disabled = !demoEnabled; }
}
async function history(append = false) {
  if (!append) { offset = 0; $('history').replaceChildren(); }
  const { incidents } = await api(`/api/incidents?limit=20&offset=${offset}`);
  if (!incidents.length && !offset) $('history').append(el('p', 'No investigations yet.', 'small muted'));
  for (const item of incidents) {
    const button = el('button', undefined, 'history-item');
    button.classList.toggle('active', item.id === current?.id);
    button.append(el('strong', item.title), el('span', `${new Date(item.createdAt).toLocaleDateString()} · ${item.status.replaceAll('_', ' ')}`));
    button.addEventListener('click', () => action(async () => { render(await api(`/api/incidents/${item.id}`)); await history(); message('Investigation loaded.'); }));
    $('history').append(button);
  }
  offset += incidents.length; $('more').classList.toggle('hidden', incidents.length < 20);
}
async function connect() {
  const info = await api('/api/info'); demoEnabled = info.demoEnabled;
  $('demo').disabled = !demoEnabled; $('healthy').disabled = !demoEnabled;
  $('connection').textContent = `Connected · ${token ? 'authenticated' : 'local mode'} · ${info.retentionDays}d retention`;
  await history(); message(demoEnabled ? 'Ready. Start with a synthetic incident or import your own telemetry.' : 'Connected. Import telemetry to start an investigation.');
}
function render(item) {
  current = item; selected = item.result.candidates[0]?.service || item.incident.services[0];
  $('empty').classList.add('hidden'); $('investigation').classList.remove('hidden');
  $('incident-id').textContent = `INVESTIGATION / ${item.id.slice(0, 8)}`;
  $('title').textContent = item.incident.title;
  const times = item.incident.metrics.map(m => m.ts);
  $('window').textContent = `${new Date(Math.min(...times)).toLocaleString()} → ${new Date(Math.max(...times)).toLocaleTimeString()} · ${item.incident.metrics.length} metric samples`;
  $('status').textContent = item.result.status.replaceAll('_', ' '); $('status').classList.toggle('healthy', item.result.status === 'no_anomaly');
  $('lead').textContent = item.result.candidates[0]?.service || 'No anomaly';
  $('affected').textContent = `${item.result.signals.filter(s => s.anomalous).length} / ${item.incident.services.length}`;
  $('citations').textContent = item.result.evidence.length;
  $('summary').textContent = item.result.summary;
  $('truth').classList.toggle('hidden', !item.demoTruth);
  $('truth').textContent = item.demoTruth ? `SYNTHETIC DEMO · Known injected cause: ${item.demoTruth.rootCause || 'none'} · ${item.demoTruth.fault}. This label was not supplied to the model.` : '';
  $('limitations').replaceChildren(...item.result.limitations.map(l => el('li', l)));
  renderCandidates(); renderGraph(); renderDetail(); renderEvidence();
}
function renderCandidates() {
  $('candidates').replaceChildren();
  if (!current.result.candidates.length) $('candidates').append(el('p', 'No sustained anomaly to rank.', 'muted'));
  current.result.candidates.forEach((c, i) => {
    const button = el('button', undefined, `candidate${c.service === selected ? ' active' : ''}`);
    button.setAttribute('aria-pressed', String(c.service === selected));
    const top = el('div', undefined, 'candidate-top'), label = el('span'); label.append(el('span', String(i + 1).padStart(2, '0'), 'index'), el('strong', c.service));
    top.append(label, el('span', `${(c.rankingWeight * 100).toFixed(1)}%`, 'small muted'));
    const meter = el('meter'); meter.min = 0; meter.max = 1; meter.value = c.rankingWeight; meter.setAttribute('aria-label', `${c.service} ranking weight`);
    button.append(top, meter); button.addEventListener('click', () => { selected = c.service; renderCandidates(); renderDetail(); }); $('candidates').append(button);
  });
}
function renderGraph() {
  const graph = $('graph'); graph.replaceChildren();
  const services = current.incident.services, columns = Math.min(4, Math.ceil(Math.sqrt(services.length))), rows = Math.ceil(services.length / columns), height = Math.max(250, rows * 105);
  graph.setAttribute('viewBox', `0 0 620 ${height}`);
  const positions = new Map(services.map((s, i) => [s, { x: 85 + (i % columns) * (450 / Math.max(1, columns - 1)), y: 60 + Math.floor(i / columns) * 105 }]));
  const defs = svg('defs'), marker = svg('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }); marker.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#627474' })); defs.append(marker); graph.append(defs);
  for (const [from, to] of current.incident.edges) {
    const a = positions.get(from), b = positions.get(to), dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), trim = 37;
    graph.append(svg('line', { x1: a.x + dx / length * trim, y1: a.y + dy / length * trim, x2: b.x - dx / length * trim, y2: b.y - dy / length * trim, stroke: '#465858', 'stroke-width': 1.5, 'marker-end': 'url(#arrow)' }));
  }
  for (const s of services) {
    const pos = positions.get(s), lead = current.result.candidates[0]?.service === s, active = current.result.signals.find(r => r.service === s)?.anomalous;
    const color = lead ? '#c3f575' : active ? '#f9b36a' : '#73848b';
    graph.append(svg('circle', { cx: pos.x, cy: pos.y, r: 29, fill: lead ? '#303d22' : '#20282c', stroke: color, 'stroke-width': lead ? 2 : 1 }));
    graph.append(svg('text', { x: pos.x, y: pos.y + 5, 'text-anchor': 'middle', fill: color }, lead ? '◎' : '▦'));
    graph.append(svg('text', { x: pos.x, y: pos.y + 48, 'text-anchor': 'middle', class: 'node-label' }, s));
  }
}
function renderDetail() {
  const chart = $('chart'); chart.replaceChildren();
  $('chart-title').textContent = `${selected} · latency`;
  const rows = current.incident.metrics.filter(m => m.service === selected).sort((a, b) => a.ts - b.ts);
  const start = rows[0].ts, duration = Math.max(1, rows.at(-1).ts - start), max = Math.max(1, ...rows.map(r => r.latencyMs)) * 1.1;
  const x = ts => 45 + (ts - start) / duration * 550, y = n => 165 - n / max * 140;
  for (let i = 0; i <= 3; i++) { const value = max * i / 3; chart.append(svg('line', { x1: 45, x2: 595, y1: y(value), y2: y(value), stroke: '#303a3d' }), svg('text', { x: 38, y: y(value) + 4, 'text-anchor': 'end' }, value.toFixed(0))); }
  chart.append(svg('line', { x1: x(current.incident.baselineEnd), x2: x(current.incident.baselineEnd), y1: 15, y2: 165, stroke: '#8b9c91', 'stroke-dasharray': '4 5' }));
  chart.append(svg('polyline', { points: rows.map(r => `${x(r.ts)},${y(r.latencyMs)}`).join(' '), fill: 'none', stroke: '#c3f575', 'stroke-width': 2 }));
  chart.append(svg('text', { x: 45, y: 190 }, 'Baseline'), svg('text', { x: 595, y: 190, 'text-anchor': 'end' }, 'Observation window'));
  const candidate = current.result.candidates.find(c => c.service === selected);
  $('features').replaceChildren(...(candidate?.contributions || []).map(f => { const row = el('div', undefined, 'feature-row'); row.append(el('span', f.feature.replace(/([A-Z])/g, ' $1')), el('span', `${f.contribution >= 0 ? '+' : ''}${f.contribution.toFixed(3)}`)); return row; }));
  if (!candidate) $('features').append(el('p', 'No ranking was produced.', 'muted'));
}
function renderEvidence() {
  $('evidence-count').textContent = `${current.result.evidence.length} citations`;
  $('evidence').replaceChildren(...current.result.evidence.map(e => { const row = el('article', undefined, 'evidence-row'); const detail = el('div'); detail.append(el('code', e.id), el('p', e.kind === 'log' ? e.message : `${e.caller} → ${e.callee} · ${e.durationMs.toFixed(1)} ms · ${e.status}`)); row.append(el('span', e.kind, 'evidence-type'), el('span', e.service || e.callee), detail); return row; }));
  if (!current.result.evidence.length) $('evidence').append(el('p', 'No supporting log or trace citations were selected. Inspect metric signals above.', 'muted'));
}
for (const [id, clean] of [['demo', false], ['healthy', true]]) $(id).addEventListener('click', () => action(async () => { render(await api('/api/demo', { method: 'POST', body: JSON.stringify({ seed: 30000 + Math.floor(Math.random() * 10000), clean }) })); await history(); message('Analysis complete. Review the evidence and limitations below.'); }));
$('upload').addEventListener('change', () => action(async () => { const file = $('upload').files[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) throw new Error('Maximum file size is 2 MiB'); const data = JSON.parse(await file.text()); render(await api('/api/incidents', { method: 'POST', body: JSON.stringify(data) })); $('upload').value = ''; await history(); message('Telemetry analyzed and saved.'); }));
$('refresh').addEventListener('click', () => action(async () => { await history(); message('History refreshed.'); }));
$('more').addEventListener('click', () => action(async () => { await history(true); message('Older investigations loaded.'); }));
$('connect').addEventListener('click', () => $('auth-dialog').showModal());
$('cancel-auth').addEventListener('click', () => $('auth-dialog').close());
$('auth-form').addEventListener('submit', event => { event.preventDefault(); token = $('token').value; $('token').value = ''; $('auth-dialog').close(); action(connect); });
$('download').addEventListener('click', () => { if (!current) return; const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob), a = el('a'); a.href = url; a.download = `incident-${current.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
$('delete').addEventListener('click', () => { if (!current || !confirm('Permanently delete this stored investigation?')) return; action(async () => { await api(`/api/incidents/${current.id}`, { method: 'DELETE' }); current = null; $('investigation').classList.add('hidden'); $('empty').classList.remove('hidden'); await history(); message('Investigation deleted.'); }); });
connect().catch(err => { $('connection').textContent = 'Connection required'; message(err.message, true); });
