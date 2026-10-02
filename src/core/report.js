// Import report: what each source contributed, what went wrong, and what the
// data can and cannot show. Structured data only; the UI renders it.
//
// Everything is derived from the Dataset itself (events carry their source
// index) plus the counts and warnings importers recorded on each source, so
// the report is reproducible from a saved project.

import { EVENT_TYPES, ROLES, VISIBILITY, VIEWS } from './model.js';

// Warning severity. Importers may set w.severity themselves; otherwise the
// code decides: first the table of codes our importers emit, then patterns.
// Unknown codes default to 'warn' so nothing important is hidden.
//   error  the file or a whole part of it could not be used
//   warn   data was skipped, guessed or is less reliable than it looks
//   info   context worth knowing; nothing was lost
const CODES = {
  error: ['import-failed', 'pst-unsupported', 'parse-error', 'xml-error', 'no-network-questions', 'slack-bad-json', 'teams-bad-json',
    'teams-free-no-messages', 'spreadsheet-unsupported'],
  info: ['auto-mapping', 'multiple-egos', 'matrix-duplicate', 'pair-values-as-weights', 'self-nominations', 'self-loops',
    'direction-assumed', 'interval-end-dropped', 'edge-attrs-dropped', 'node-times-dropped', 'dynamic-attr-flattened',
    'slack-usergroup-mentions', 'teams-channel-visibility-unknown', 'mbox-preamble', 'empty-mbox', 'empty-file', 'duplicate-sessions-skipped'],
};
const CODE_SEV = new Map(Object.entries(CODES).flatMap(([sev, list]) => list.map(c => [c, sev])));
const SEVERITY = {
  error: [/unsupported$/, /failed$/, /corrupt/, /unreadable/, /bad-json$/],
  info: [/^multiple-/, /-deduped$/, /^metadata-/],
};
const SEV_RANK = { error: 0, warn: 1, info: 2 };

export function warningSeverity(w) {
  if (w.severity && w.severity in SEV_RANK) return w.severity;
  const code = String(w.code || '');
  if (CODE_SEV.has(code)) return CODE_SEV.get(code);
  for (const re of SEVERITY.error) if (re.test(code)) return 'error';
  for (const re of SEVERITY.info) if (re.test(code)) return 'info';
  return 'warn';
}

function tzStatus(tz) {
  const v = tz == null ? 'unknown' : String(tz);
  if (/^utc$/i.test(v)) return { value: 'UTC', status: 'exact', note: 'Times are absolute (UTC) in the source.' };
  if (/assumed|unknown|floating|local/i.test(v)) return { value: v, status: 'assumed', note: 'The source has wall-clock times without a zone; time-of-day and day boundaries may be shifted. Set the zone if you know it.' };
  return { value: v, status: 'zone', note: `Wall-clock times were read in ${v}.` };
}

const VIEW_LINES = {
  [VIEWS.FULL]: {
    can: ['Structure of the whole group in this export: who talks to whom, brokers, clusters, and how central each person is.'],
    cannot: ['Interaction that happened outside this export (other tools, meetings, hallways), or in conversations the export left out.'],
  },
  [VIEWS.EGO]: {
    can: ["The owner's contacts: how often, when and in which role each person interacts with the owner.", "The size and make-up of the owner's personal network."],
    cannot: ["Ties among the owner's contacts, except where they appear together on the same messages or meetings with the owner.", 'Whole-network measures such as centrality or brokerage for anyone but the owner: every tie runs through the owner, so these are biased toward them.'],
  },
  [VIEWS.CHAT]: {
    can: ['Who talks to whom within this one conversation, and how that changes over time.'],
    cannot: ["Relationships outside this conversation; people's positions in any wider network."],
  },
  [VIEWS.SAMPLE]: {
    can: ['Patterns in a sample of a larger population (who replies to or mentions whom among sampled posts).'],
    cannot: ['The complete structure: degrees are undercounted and paths between people outside the sample are missing.'],
  },
  [VIEWS.AUTHORED]: {
    can: ['What one account did: whom it replied to, mentioned, reposted or followed.'],
    cannot: ['What others wrote or how they responded; incoming ties are invisible.'],
  },
};

function familyLines(s, stats) {
  const can = [], cannot = [];
  const fmt = String(s.format || '');
  if (s.medium === 'email' || fmt === 'email') cannot.push('Blind copies on messages the owner received (Bcc is only visible on the sender\'s copy), and forwards that never reached this mailbox.');
  if (s.medium === 'calendar' || fmt === 'calendar') cannot.push('Actual attendance: calendar data shows invitations and responses, not who showed up.');
  if (fmt.startsWith('teams') && /purview/i.test(String(s.variant || ''))) cannot.push('Who said what to whom: the Purview item report lists the participants of each transcript only.');
  if (s.family === 'survey') {
    can.push('Ties people reported themselves (who they go to, feel close to, and so on).');
    cannot.push('Observed behaviour: these are self-reports, and ties between alters are the respondent\'s perception.');
  }
  if (s.family === 'network') cannot.push('How the ties were measured: the file holds declared ties whose origin and time window are not recorded.');
  if (stats.undated === stats.events && stats.events > 0) cannot.push('Change over time: no event has a timestamp.');
  if (stats.events > 0 && stats.withText === 0 && stats.byType.message > 0) cannot.push('Content measures (tone, topics, keywords): the messages carry no text.');
  if (stats.byType.copresence > 0) can.push('Who was together in the same meetings or conversations (co-presence), which is weaker evidence of a tie than a direct message.');
  if (s.view === VIEWS.FULL && s.medium === 'slack' && !stats.byVisibility.private && !stats.byVisibility.direct && !stats.byVisibility.group && stats.events > 0) {
    cannot.push('Private channels and direct messages: this looks like a public-channels-only export.');
  }
  return { can, cannot };
}

export function importReport(ds) {
  const e = ds.events;
  const S = ds.meta.sources.length;
  const per = Array.from({ length: S }, () => ({
    events: 0, byType: Object.fromEntries(EVENT_TYPES.map(t => [t, 0])), byRole: Object.fromEntries(ROLES.map(r => [r, 0])),
    tMin: Infinity, tMax: -Infinity, undated: 0, withText: 0, nodes: new Set(), contexts: new Set(), botEvents: 0, bots: new Set(),
    unresolved: 0, noTargets: 0,
  }));
  for (let i = 0; i < e.count; i++) {
    const p = per[e.source[i]];
    if (!p) continue;
    p.events++;
    p.byType[EVENT_TYPES[e.type[i]]]++;
    const t = e.t[i];
    if (Number.isFinite(t)) { if (t < p.tMin) p.tMin = t; if (t > p.tMax) p.tMax = t; } else p.undated++;
    if (e.text[i]) p.withText++;
    const a = e.actor[i];
    p.nodes.add(a);
    if (ds.nodes.isBot[a]) { p.botEvents++; p.bots.add(a); }
    if (e.context[i] >= 0) p.contexts.add(e.context[i]);
    if (e.tOff[i + 1] === e.tOff[i]) p.noTargets++;
    for (let j = e.tOff[i]; j < e.tOff[i + 1]; j++) {
      p.nodes.add(e.tgt[j]); p.byRole[ROLES[e.role[j]]]++;
      if (ds.nodes.isBot[e.tgt[j]]) p.bots.add(e.tgt[j]);
    }
  }

  const sources = ds.meta.sources.map((s, sid) => {
    const p = per[sid];
    const byVisibility = Object.fromEntries(VISIBILITY.map(v => [v, 0]));
    const byKind = {};
    for (const c of p.contexts) {
      byVisibility[VISIBILITY[ds.contexts.visibility[c]]]++;
      byKind[ds.contexts.kinds[c]] = (byKind[ds.contexts.kinds[c]] || 0) + 1;
    }
    const warnings = (s.warnings || []).map(w => ({ code: w.code, message: w.message, count: w.count ?? 1, severity: warningSeverity(w) }))
      .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.count - a.count || a.code.localeCompare(b.code));
    const unresolved = warnings.find(w => w.code === 'unresolved-parent')?.count || 0;
    const stats = { events: p.events, byType: p.byType, withText: p.withText, undated: p.undated, byVisibility };
    const view = VIEW_LINES[s.view] || { can: [], cannot: ['The kind of slice this source shows is not recorded, so which measures apply is unclear.'] };
    const fam = familyLines(s, stats);
    const canShow = [...view.can, ...fam.can];
    const cannotShow = [...view.cannot, ...fam.cannot];
    if (p.undated && p.undated < p.events) cannotShow.push(`Timing for ${p.undated} of ${p.events} events, which have no usable timestamp.`);
    const tz = tzStatus(s.tz);
    if (tz.status === 'assumed') cannotShow.push('Reliable time-of-day patterns, until the time zone is confirmed.');
    const egoIdx = s.egoKey ? ds.nodes.keys.indexOf(s.egoKey) : -1;
    return {
      id: sid,
      format: s.format, family: s.family, medium: s.medium, view: s.view, context: s.context,
      variant: s.variant ?? null, directed: s.directed ?? null,
      fileNames: s.fileNames || [],
      ego: s.egoKey ? { key: s.egoKey, label: egoIdx >= 0 ? ds.nodes.labels[egoIdx] : s.egoKey, inferredFrom: s.egoInferredFrom ?? null } : null,
      // Ego-interview sources with several respondents list them all (egoKey is then null).
      egos: Array.isArray(s.egoKeys) ? s.egoKeys.length : (s.egoKey ? 1 : 0),
      timeRange: Number.isFinite(p.tMin) ? { start: p.tMin, end: p.tMax } : null,
      tz,
      counts: {
        nodes: p.nodes.size, events: p.events,
        eventsByType: Object.fromEntries(Object.entries(p.byType).filter(([, v]) => v)),
        targetsByRole: Object.fromEntries(Object.entries(p.byRole).filter(([, v]) => v)),
        contexts: p.contexts.size, contextsByVisibility: Object.fromEntries(Object.entries(byVisibility).filter(([, v]) => v)), contextsByKind: byKind,
        messagesWithText: p.withText, undatedEvents: p.undated, eventsWithoutTargets: p.noTargets,
      },
      bots: { nodes: p.bots.size, events: p.botEvents },
      selfMessages: s.counts?.['self-messages'] ?? 0,
      unresolvedParents: unresolved,
      importerCounts: { ...(s.counts || {}) },
      warnings,
      worst: warnings.length ? warnings[0].severity : null,
      canShow, cannotShow,
    };
  });

  let tMin = Infinity, tMax = -Infinity;
  for (const s of sources) if (s.timeRange) { tMin = Math.min(tMin, s.timeRange.start); tMax = Math.max(tMax, s.timeRange.end); }
  const notes = [];
  const egoSources = sources.filter(s => s.view === VIEWS.EGO);
  if (egoSources.length > 1) notes.push(`${egoSources.length} sources are personal (ego) views. Combined, they still show only the parts of the network those owners took part in.`);
  if (new Set(sources.map(s => s.view)).size > 1) notes.push('Sources with different views were combined. Measures are checked against the narrowest view before they are shown.');
  if (ds.meta.merges?.length) notes.push(`${ds.meta.merges.reduce((n, m) => n + m.groups.length, 0)} identities were merged by hand; see the merge log.`);
  const empty = sources.filter(s => s.counts.events === 0);
  if (empty.length) notes.push(`${empty.length} source(s) produced no events.`);
  return {
    totals: {
      nodes: ds.nodes.count, events: e.count, contexts: ds.contexts.count, sources: S,
      bots: ds.nodes.isBot.reduce((a, b) => a + b, 0),
      timeRange: Number.isFinite(tMin) ? { start: tMin, end: tMax } : null,
      warnings: { error: 0, warn: 0, info: 0, ...countSev(sources) },
    },
    sources, notes,
  };
}

function countSev(sources) {
  const c = {};
  for (const s of sources) for (const w of s.warnings) c[w.severity] = (c[w.severity] || 0) + 1;
  return c;
}
