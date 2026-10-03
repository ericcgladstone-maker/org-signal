// Shared-survey responses: the files (or pasted text blocks) respondents
// send back from an Org Signal share link, recombined into one network.
//
// Formats are defined in src/builders/share.js (ours, so nothing here is
// guessed). A drop may hold any number of response files (.json), text files
// of pasted response blocks, and optionally the survey file itself. All of
// them are read together, because recombining is a whole-set operation: the
// merge rule needs both people's answers, and who did not respond, who
// answered twice and who answered another survey can only be said with the
// full set in hand.
//
// The reference survey is the survey file when one is in the drop, else the
// survey most of the responses answered; responses to any other survey are
// rejected with a message naming them. Duplicates keep the latest response.

import { peek } from '../core/fileset.js';
import { parseResponses, recombine, writeRecombined, sniffShared } from '../builders/share.js';
import { MERGE_RULES } from '../builders/roster.js';

const CANDIDATE = /\.(json|txt|eml|text)$/i;

async function detect(fs) {
  const hits = [];
  let candidates = 0;
  for (const e of fs.entries) {
    if (!CANDIDATE.test(e.rel) || e.size > 5e6) continue;
    candidates++;
    if (candidates > 2000) break;
    let head = '';
    try { head = await peek(e, 4096); } catch { continue; }
    const kind = sniffShared(head);
    if (kind) hits.push({ rel: e.rel, kind });
  }
  const responses = hits.filter(h => h.kind === 'response').length;
  if (!responses) return { score: 0, reason: '' };
  return {
    score: 0.97,
    reason: `${responses} Org Signal survey ${responses === 1 ? 'response' : 'responses'}${hits.length > responses ? ' and the survey file' : ''}`,
    files: hits.map(h => h.rel),
  };
}

async function importResponses(fs, { builder, options = {}, progress = () => {}, signal } = {}) {
  const items = [], surveys = [], errors = [];
  const files = fs.entries.filter(e => CANDIDATE.test(e.rel));
  for (let k = 0; k < files.length; k++) {
    if (signal?.aborted) throw Object.assign(new Error('Import cancelled.'), { name: 'AbortError' });
    const e = files[k];
    progress(k / files.length, `Reading ${e.rel}`);
    const text = await e.text();
    if (!sniffShared(text.slice(0, 4096)) && !sniffShared(text)) continue;
    const r = parseResponses(text, { file: e.rel.split('/').pop() });
    items.push(...r.responses); surveys.push(...r.surveys); errors.push(...r.errors);
  }
  const result = recombine(items, { surveys });
  result.invalid.push(...errors);
  if (!result.survey) {
    builder.beginSource({ format: 'shared-survey', family: 'survey', medium: 'survey', view: 'full', context: 'survey', fileNames: files.map(f => f.rel) });
    for (const x of result.invalid) builder.warn('survey-invalid', `${x.file || 'A file'} could not be used: ${x.reason}.`);
    throw new Error(result.invalid.length ? `No usable response: ${result.invalid.map(x => `${x.file || 'a file'} (${x.reason})`).join('; ')}.` : 'No Org Signal survey responses found.');
  }
  const mergeRule = MERGE_RULES.some(m => m.id === options.mergeRule) ? options.mergeRule : null;
  writeRecombined(builder, result, { mergeRule, fileNames: files.map(f => f.rel) });
  for (const s of builder.sources) if (s.format === 'shared-survey') s.counts.responses = result.accepted.length;
  progress(1, 'Recombined');
}

export default {
  id: 'shared-survey',
  label: 'Shared survey responses',
  family: 'survey',
  detect,
  options: [
    { key: 'mergeRule', label: 'Combine self-reports (roster surveys)', type: 'select', default: 'survey',
      choices: [{ value: 'survey', label: "The survey's own rule" }, ...MERGE_RULES.map(m => ({ value: m.id, label: m.label }))] },
  ],
  import: importResponses,
};
