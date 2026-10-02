// Ego builder step 6: review, analyze, export, resume.

import { html, useState } from '../../../../vendor/preact.js';
import { zipSync, strToU8 } from '../../../../vendor/fflate.js';
import * as E from '../../../builders/ego.js';
import { HandOffBar, downloadText, downloadBlob, readFileText } from '../shared.js';

// Multi-file picker (Network Canvas exports come as three CSVs).
function pickFiles(accept) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = true; input.style.display = 'none';
    input.onchange = () => { resolve([...(input.files || [])]); input.remove(); };
    document.body.appendChild(input);
    input.click();
  });
}

export function ReviewStep({ s, update, replace }) {
  const [msg, setMsg] = useState(null);
  const ties = E.tieList(s);
  const p = E.progress(s);
  const prefix = E.ncPrefix(s);
  const build = () => {
    const done = s.finishedAt ? s : { ...s, finishedAt: new Date().toISOString() };
    if (!s.finishedAt) update(() => done);
    return E.toDataset(done);
  };
  const saveJSON = () => downloadText(`ego-session-${prefix}.json`, E.sessionToJSON(s), 'application/json');
  const saveNC = () => {
    const files = E.toNetworkCanvasCSV(s);
    const zip = zipSync(Object.fromEntries(files.map(f => [f.name, strToU8(f.text)])));
    downloadBlob(`${prefix}_networkCanvasExport.zip`, new Blob([zip], { type: 'application/zip' }));
  };
  const resume = async () => {
    const files = await pickFiles('.json,.csv,application/json,text/csv');
    if (!files.length) return;
    try {
      const texts = await Promise.all(files.map(async f => ({ name: f.name, text: await readFileText(f) })));
      const json = texts.find(t => /\.json$/i.test(t.name));
      const next = json ? E.sessionFromJSON(json.text) : E.fromNetworkCanvasCSV(texts.filter(t => /\.csv$/i.test(t.name)), { template: s });
      replace(next);
      setMsg({ ok: true, text: `Loaded ${next.alters.length} people from ${files.map(f => f.name).join(', ')}.` });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  };
  return html`<div class="ob-stack">
    <dl class="ob-kv">
      <dt>Respondent</dt><dd>${s.egoLabel || 'unnamed'}${s.caseId ? ` (case ${s.caseId})` : ''}</dd>
      <dt>People named</dt><dd>${s.alters.length}</dd>
      <dt>Questions</dt><dd>${s.generators.map(g => `${g.name}: ${E.generatorCount(s, g.id)}`).join(', ') || 'none'}</dd>
      <dt>Answers</dt><dd>${p.answered} of ${p.cells}</dd>
      <dt>Alter ties</dt><dd>${ties.filter(t => t.on).length} of ${ties.length} pairs; ${Object.keys(s.ties).length} set by hand</dd>
      <dt>Complete</dt><dd>${Math.round(p.fraction * 100)}%</dd>
    </dl>
    <p class="ob-note">The network is ego's view: ties from the respondent to each person named (one per question that elicited them) and ties between those people as the respondent perceives them, not as observed.</p>
    <${HandOffBar} build=${build} disabled=${!s.alters.length} note=${s.alters.length ? null : 'Name at least one person first.'} />
    <div class="ob-section">
      <h3>Save and move data</h3>
      <div class="ob-row">
        <button type="button" class="ob-btn" onClick=${saveJSON}>Save session (JSON)</button>
        <button type="button" class="ob-btn" disabled=${!s.alters.length} onClick=${saveNC}>Network Canvas CSVs (zip)</button>
        <button type="button" class="ob-btn" onClick=${resume}>Resume from a file</button>
      </div>
      <p class="ob-note">The CSVs follow Network Canvas's export columns (ego file, attribute list, edge list), so they open in egor, ideanet or anything that reads Network Canvas. Resume accepts a saved session or those three CSVs.</p>
      ${msg ? html`<p class=${msg.ok ? 'ob-good' : 'ob-err'} role="status">${msg.text}</p>` : null}
    </div>
  </div>`;
}
