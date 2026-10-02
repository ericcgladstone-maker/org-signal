// Which measures mean something for this dataset and network.
//
// Every measure gets a level ('ok' | 'caution' | 'na') and a plain-language
// reason the UI shows next to it. The checks encode what the source can and
// cannot see: in one person's mailbox every path runs through the owner, so
// betweenness there describes the export, not the organisation.

import { VIEWS } from '../core/model.js';
import { graphOf, components } from './graph.js';
import { NODE_METRICS } from './metrics.js';

const RANK = { ok: 0, caution: 1, na: 2 };
const HIERARCHY_KEYS = /^(manager|manager_?id|managerkey|reports_?to|supervisor|supervisor_?id|boss|line_?manager)$/i;

export const APPLICABILITY_KEYS = [...NODE_METRICS,
  'density', 'reciprocityNetwork', 'transitivity', 'avgClustering', 'avgPathLength', 'degreeCentralization', 'strengthGini', 'degreeAssortativity',
  'communities', 'groups', 'ego', 'nullModel', 'resampleRanks', 'timeSeries', 'detectShifts', 'compareBeforeAfter',
  'affect', 'keywords', 'topics', 'diffusion', 'hierarchy'];

export function applicability(ds, net) {
  const out = {};
  for (const k of APPLICABILITY_KEYS) out[k] = { level: 'ok', reasons: [] };
  const flag = (keys, level, reason) => {
    for (const k of [].concat(keys)) {
      const o = out[k];
      if (!o) continue;
      if (RANK[level] > RANK[o.level]) o.level = level;
      if (level !== 'ok' && !o.reasons.includes(reason)) o.reasons.push(reason);
    }
  };

  const sources = ds.meta?.sources || [];
  const views = sources.map(s => s.view || VIEWS.FULL);
  const has = (v) => views.includes(v);
  const only = (vs) => views.length > 0 && views.every(v => vs.includes(v));
  const g = graphOf(net);
  const n = net.n;
  const pathMetrics = ['betweenness', 'betweennessWeighted', 'closeness', 'closenessWeighted'];
  const globalMetrics = [...pathMetrics, 'eigenvector', 'pagerank', 'coreNumber', 'avgPathLength', 'degreeCentralization', 'communities'];

  // --- source view ---
  // An ego-network interview is also an ego view, but nothing in it is a
  // message: the respondent names people and says who knows whom. Direction
  // and reciprocity are not observed, and ties among the people named are
  // the respondent's perception, which is the design, not a gap.
  const interview = sources.length > 0 && sources.every(s => s.format === 'ego-interview' || s.family === 'survey' && s.view === VIEWS.EGO);
  if (interview) {
    flag(pathMetrics, 'na', 'In an ego-network interview every path runs through the respondent, so path measures describe the interview design, not anyone\'s position.');
    flag(['eigenvector', 'pagerank', 'degreeCentralization', 'avgPathLength', 'coreNumber'], 'caution', 'Everyone here was named by one respondent; whole-network rankings mostly reflect who the respondent tied together.');
    flag(['inDegree', 'outDegree', 'inStrength', 'outStrength', 'reciprocity', 'reciprocityNetwork'], 'na', 'The respondent reports every tie, so who named whom is not observed: direction and reciprocity mean nothing here. Treat the ties as undirected.');
    flag(['constraint', 'effectiveSize', 'egoDensity', 'clustering', 'density', 'transitivity', 'avgClustering', 'communities'], 'caution', 'Ties among the people named are as the respondent sees them (perceived, not observed), and only people the respondent named are present.');
    flag(['groups', 'nullModel'], 'caution', 'Everyone is tied to the respondent by design; rewired comparison networks ignore that, so read z and p as rough.');
  } else if (only([VIEWS.EGO])) {
    flag(pathMetrics, 'na', "This is one person's export: every path runs through its owner, so path measures describe the export, not the network.");
    flag(['eigenvector', 'pagerank', 'degreeCentralization', 'avgPathLength', 'coreNumber'], 'caution', "In one person's export, others are seen only through their contact with the owner.");
    flag(['constraint', 'effectiveSize', 'egoDensity', 'clustering'], 'caution', "Ties among the owner's contacts are visible only when the owner was on the message; brokerage and density among alters are understated.");
    flag(['density', 'communities', 'transitivity', 'avgClustering'], 'caution', "Ties the owner never saw are missing, so the network looks sparser and more centralised than it is.");
    flag(['inDegree', 'reciprocity', 'reciprocityNetwork'], 'caution', "Only messages the owner sent or received are present.");
    flag(['groups', 'nullModel'], 'caution', "In one person's export, ties among the owner's contacts are only partly visible: group mixing describes what the owner saw, and rewired comparison networks ignore that everyone is tied to the owner.");
  } else if (has(VIEWS.EGO)) {
    flag(globalMetrics, 'caution', "Some sources are one person's export; their owners look more central than they are.");
    flag(['groups', 'nullModel'], 'caution', "Some sources are one person's export: ties among that person's contacts are only partly visible, so group mixing partly describes what the owner saw.");
  }
  if (only([VIEWS.CHAT])) {
    flag(pathMetrics, 'caution', 'A single conversation: everyone hears everyone, so differences in path position are small and mostly reflect who spoke when.');
    flag(['communities'], 'caution', 'A single conversation rarely contains separate communities.');
  }
  if (only([VIEWS.AUTHORED])) {
    flag(['inDegree', 'inStrength', 'reciprocity', 'reciprocityNetwork', 'pagerank'], 'na', 'The source holds only what one account wrote; nobody else\'s actions toward others are present.');
    flag([...pathMetrics, 'eigenvector', 'communities', 'constraint', 'effectiveSize', 'clustering', 'egoDensity', 'transitivity', 'avgClustering', 'density'], 'na', 'Only one account\'s outgoing actions are present; this is a list of contacts, not a network.');
  }
  if (has(VIEWS.SAMPLE)) {
    flag([...globalMetrics, 'density', 'transitivity', 'avgClustering', 'constraint', 'effectiveSize'], 'caution', 'The data are a sample of a larger population: degrees and paths are biased downward, and who looks central depends on what was sampled.');
  }
  // Ego measures are always defined; for ego views they are the primary measures.
  const egoKeys = [...new Set(sources.filter(s => s.view === VIEWS.EGO).flatMap(s => [s.egoKey, ...(s.egoKeys || [])]).filter(Boolean))];

  // --- direction and weights ---
  if (!net.directed) {
    flag(['inDegree', 'outDegree', 'inStrength', 'outStrength'], 'na', 'The network is undirected; in and out are the same as degree.');
    flag(['reciprocity', 'reciprocityNetwork'], 'na', 'Reciprocity needs a directed network.');
  }
  const binary = net.settings?.weighting === 'binary';
  if (binary) {
    flag(['strength', 'inStrength', 'outStrength'], 'caution', 'Weighting is binary, so strength equals degree.');
    flag(['betweennessWeighted', 'closenessWeighted'], 'na', 'Weighting is binary; the weighted versions are identical to the unweighted ones.');
  }
  const rules = net.settings?.rules || {};
  const on = Object.keys(rules).filter(r => rules[r]?.on);
  if (on.length && on.every(r => r === 'copresence')) {
    flag(pathMetrics, 'caution', 'Ties come only from shared meetings, which create cliques; path measures mostly reflect meeting size.');
    flag(['clustering', 'transitivity', 'avgClustering', 'constraint', 'effectiveSize', 'egoDensity'], 'caution', 'Each meeting creates a clique, which inflates clustering and constraint.');
  }
  if (on.includes('adjacency')) flag(['reciprocity', 'reciprocityNetwork'], 'caution', 'Turn-taking ties are inferred in both directions by construction, which inflates reciprocity.');
  if (net.directed && sources.some(s => s.directed === false)) flag(['reciprocity', 'reciprocityNetwork', 'inDegree', 'outDegree'], 'caution', 'Some sources record undirected ties (connections, drawn or undirected network files); they enter the directed network in both directions, which inflates reciprocity.');
  if (on.includes('follow') && on.length === 1) flag(['strength', 'inStrength', 'outStrength'], 'caution', 'Follows have no strength; every tie weighs the same.');

  // --- size, isolates, components ---
  const cc = components(g);
  let isolates = 0, nontrivial = 0;
  for (const s of cc.sizes) { if (s === 1) isolates++; else nontrivial++; }
  if (n < 3) flag(APPLICABILITY_KEYS.filter(k => !['affect', 'keywords', 'topics', 'hierarchy', 'timeSeries'].includes(k)), 'na', 'Fewer than three people in the network.');
  else if (n < 10) flag([...globalMetrics, 'nullModel', 'resampleRanks', 'groups'], 'caution', 'Very small network: single ties move these numbers a lot.');
  if (nontrivial > 1) {
    flag(['eigenvector'], 'caution', `The network has ${nontrivial} separate components; eigenvector scores outside the largest one shrink toward zero and are not comparable.`);
    flag(['closeness', 'closenessWeighted', 'avgPathLength'], 'caution', `The network has ${nontrivial} separate components; people in small components look peripheral partly because they cannot reach the rest.`);
    flag(['betweenness', 'betweennessWeighted'], 'caution', `Betweenness is computed within each of ${nontrivial} components; it cannot exceed what a small component allows.`);
  }
  if (n && isolates / n > 0.2) flag(['density', 'avgClustering', 'degreeCentralization', 'strengthGini'], 'caution', `${isolates} of ${n} people have no ties under the current rules; whole-network averages include them.`);
  if (!net.edges.count) flag(APPLICABILITY_KEYS.filter(k => !['affect', 'keywords', 'topics', 'hierarchy'].includes(k)), 'na', 'No ties under the current construction rules.');
  if (n > 3000) flag(['betweenness', 'betweennessWeighted', 'closeness', 'closenessWeighted'], 'caution', 'Large network: path measures are estimated from a sample of sources unless exact computation is requested.');

  // --- attributes and hierarchy ---
  const schema = ds.attributeSchema || [];
  const cats = schema.filter(s => ['categorical', 'boolean', 'ordinal'].includes(s.type) && !HIERARCHY_KEYS.test(s.key));
  if (!cats.length) flag(['groups'], 'na', 'No categorical attribute (department, team, location...) is loaded.');
  else if (Math.max(...cats.map(s => s.coverage ?? 1)) < 0.8) flag(['groups'], 'caution', 'Attribute values are missing for more than 20% of people; group measures cover only those with values.');
  const hier = schema.find(s => HIERARCHY_KEYS.test(s.key));
  if (!hier) flag('hierarchy', 'na', 'No manager or reports-to attribute is loaded.');
  else flag(['betweenness', 'betweennessWeighted', 'constraint', 'effectiveSize'], 'caution', 'Managers sit on paths between their reports by design; compare brokers with peers at the same level.');

  // --- time ---
  const ev = ds.events;
  let timed = 0, tMin = Infinity, tMax = -Infinity, withText = 0, messages = 0;
  for (let i = 0; i < ev.count; i++) {
    const t = ev.t[i];
    if (Number.isFinite(t)) { timed++; if (t < tMin) tMin = t; if (t > tMax) tMax = t; }
    if (ev.type[i] === 0) { messages++; if (ev.text?.[i]) withText++; }
  }
  const span = timed ? tMax - tMin : 0;
  const DAY = 86400000;
  if (timed < 2 || span <= 0) flag(['timeSeries', 'detectShifts', 'compareBeforeAfter', 'diffusion'], 'na', 'Events have no usable timestamps.');
  else {
    if (timed / ev.count < 0.8) flag(['timeSeries', 'detectShifts', 'compareBeforeAfter', 'diffusion'], 'caution', `${Math.round((1 - timed / ev.count) * 100)}% of events have no timestamp and are left out of time analyses.`);
    if (span < 14 * DAY) flag(['timeSeries', 'detectShifts', 'compareBeforeAfter'], 'caution', 'The data cover less than two weeks; shifts cannot be separated from day-to-day noise.');
    if (span < 56 * DAY) flag(['detectShifts'], 'caution', 'Fewer than eight weekly windows: too few to estimate a baseline.');
  }
  // --- content ---
  if (!withText) flag(['affect', 'keywords', 'topics', 'diffusion'], 'na', 'No message text is present.');
  else {
    if (withText / Math.max(1, messages) < 0.5) flag(['affect', 'keywords', 'topics'], 'caution', `Only ${Math.round((withText / messages) * 100)}% of messages have text.`);
    flag('affect', 'caution', 'Lexicon sentiment (VADER) is approximate: it misses sarcasm, domain jargon and non-English text. Compare groups, not single messages.');
    if (withText < 200) flag(['topics', 'diffusion'], 'caution', 'Fewer than 200 messages with text; topics and adoption patterns will be unstable.');
  }

  const res = {};
  for (const [k, o] of Object.entries(out)) res[k] = { level: o.level, reason: o.reasons.join(' '), reasons: o.reasons };
  res._context = { egoKeys, egoNodes: egoKeys.map(k => ds.nodes.keys.indexOf(k)).filter(i => i >= 0), views: [...new Set(views)], directed: net.directed, weighting: net.settings?.weighting, components: nontrivial, isolates, nodes: n, timedShare: ev.count ? timed / ev.count : 0, span, textShare: messages ? withText / messages : 0 };
  return res;
}
