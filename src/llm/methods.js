// Methods appendix, built deterministically (no LLM).
//
// Given what was actually done (sources and their views, construction
// settings, metrics, null models, resampling, time windows, content methods
// and their parameters), produce Markdown suitable for a paper appendix, with
// references for the standard methods. Only methods that were used are
// described and only references that are cited are listed.
//
// References were checked against Crossref / publisher records on 2026-10-02.

import { VIEWS } from '../core/model.js';

export const REFERENCES = {
  brandes2001: 'Brandes, U. (2001). A faster algorithm for betweenness centrality. *Journal of Mathematical Sociology, 25*(2), 163-177. https://doi.org/10.1080/0022250X.2001.9990249',
  burt1992: 'Burt, R. S. (1992). *Structural holes: The social structure of competition.* Harvard University Press.',
  blondel2008: 'Blondel, V. D., Guillaume, J.-L., Lambiotte, R., & Lefebvre, E. (2008). Fast unfolding of communities in large networks. *Journal of Statistical Mechanics: Theory and Experiment, 2008*(10), P10008. https://doi.org/10.1088/1742-5468/2008/10/P10008',
  newman2002: 'Newman, M. E. J. (2002). Assortative mixing in networks. *Physical Review Letters, 89*(20), 208701. https://doi.org/10.1103/PhysRevLett.89.208701',
  newman2003: 'Newman, M. E. J. (2003). Mixing patterns in networks. *Physical Review E, 67*(2), 026126. https://doi.org/10.1103/PhysRevE.67.026126',
  krackhardt1988: 'Krackhardt, D., & Stern, R. N. (1988). Informal networks and organizational crises: An experimental simulation. *Social Psychology Quarterly, 51*(2), 123-140. https://doi.org/10.2307/2786835',
  hutto2014: 'Hutto, C. J., & Gilbert, E. (2014). VADER: A parsimonious rule-based model for sentiment analysis of social media text. *Proceedings of the International AAAI Conference on Web and Social Media, 8*(1), 216-225. https://doi.org/10.1609/icwsm.v8i1.14550',
  maslov2002: 'Maslov, S., & Sneppen, K. (2002). Specificity and stability in topology of protein networks. *Science, 296*(5569), 910-913. https://doi.org/10.1126/science.1065103',
  page1999: 'Page, L., Brin, S., Motwani, R., & Winograd, T. (1999). *The PageRank citation ranking: Bringing order to the web* (Technical Report 1999-66). Stanford InfoLab. http://ilpubs.stanford.edu:8090/422/',
  bonacich1972: 'Bonacich, P. (1972). Factoring and weighting approaches to status scores and clique identification. *Journal of Mathematical Sociology, 2*(1), 113-120. https://doi.org/10.1080/0022250X.1972.9989806',
  bonacich1987: 'Bonacich, P. (1987). Power and centrality: A family of measures. *American Journal of Sociology, 92*(5), 1170-1182. https://doi.org/10.1086/228631',
  freeman1977: 'Freeman, L. C. (1977). A set of measures of centrality based on betweenness. *Sociometry, 40*(1), 35-41. https://doi.org/10.2307/3033543',
  freeman1978: 'Freeman, L. C. (1978). Centrality in social networks: Conceptual clarification. *Social Networks, 1*(3), 215-239. https://doi.org/10.1016/0378-8733(78)90021-7',
  marchiori2000: 'Marchiori, M., & Latora, V. (2000). Harmony in the small-world. *Physica A, 285*(3-4), 539-546. https://doi.org/10.1016/S0378-4371(00)00311-3',
  boldi2014: 'Boldi, P., & Vigna, S. (2014). Axioms for centrality. *Internet Mathematics, 10*(3-4), 222-262. https://doi.org/10.1080/15427951.2013.865686',
  watts1998: "Watts, D. J., & Strogatz, S. H. (1998). Collective dynamics of 'small-world' networks. *Nature, 393*(6684), 440-442. https://doi.org/10.1038/30918",
  seidman1983: 'Seidman, S. B. (1983). Network structure and minimum degree. *Social Networks, 5*(3), 269-287. https://doi.org/10.1016/0378-8733(83)90028-X',
  batagelj2003: 'Batagelj, V., & Zaversnik, M. (2003). *An O(m) algorithm for cores decomposition of networks* (arXiv:cs/0310049). https://arxiv.org/abs/cs/0310049',
  newman2004: 'Newman, M. E. J., & Girvan, M. (2004). Finding and evaluating community structure in networks. *Physical Review E, 69*(2), 026113. https://doi.org/10.1103/PhysRevE.69.026113',
  traag2019: 'Traag, V. A., Waltman, L., & van Eck, N. J. (2019). From Louvain to Leiden: Guaranteeing well-connected communities. *Scientific Reports, 9*, 5233. https://doi.org/10.1038/s41598-019-41695-z',
  efron1993: 'Efron, B., & Tibshirani, R. J. (1993). *An introduction to the bootstrap.* Chapman & Hall.',
  borgatti2006: 'Borgatti, S. P., Carley, K. M., & Krackhardt, D. (2006). On the robustness of centrality measures under conditions of imperfect data. *Social Networks, 28*(2), 124-136. https://doi.org/10.1016/j.socnet.2005.05.001',
  blei2003: 'Blei, D. M., Ng, A. Y., & Jordan, M. I. (2003). Latent Dirichlet allocation. *Journal of Machine Learning Research, 3*, 993-1022.',
  krippendorff2019: 'Krippendorff, K. (2019). *Content analysis: An introduction to its methodology* (4th ed.). SAGE. https://doi.org/10.4135/9781071878781',
  cohen1960: 'Cohen, J. (1960). A coefficient of agreement for nominal scales. *Educational and Psychological Measurement, 20*(1), 37-46. https://doi.org/10.1177/001316446002000104',
  wasserman1994: 'Wasserman, S., & Faust, K. (1994). *Social network analysis: Methods and applications.* Cambridge University Press. https://doi.org/10.1017/CBO9780511815478',
  kleinberg1999: 'Kleinberg, J. M. (1999). Authoritative sources in a hyperlinked environment. *Journal of the ACM, 46*(5), 604-632. https://doi.org/10.1145/324133.324140',
  sparckjones1972: 'Sparck Jones, K. (1972). A statistical interpretation of term specificity and its application in retrieval. *Journal of Documentation, 28*(1), 11-21. https://doi.org/10.1108/eb026526',
  garlaschelli2004: 'Garlaschelli, D., & Loffredo, M. I. (2004). Patterns of link reciprocity in directed networks. *Physical Review Letters, 93*(26), 268701. https://doi.org/10.1103/PhysRevLett.93.268701',
};

// In-text citation labels.
const CITE = {
  brandes2001: 'Brandes, 2001', burt1992: 'Burt, 1992', blondel2008: 'Blondel et al., 2008', newman2002: 'Newman, 2002',
  newman2003: 'Newman, 2003', krackhardt1988: 'Krackhardt & Stern, 1988', hutto2014: 'Hutto & Gilbert, 2014',
  maslov2002: 'Maslov & Sneppen, 2002', page1999: 'Page et al., 1999', bonacich1972: 'Bonacich, 1972', bonacich1987: 'Bonacich, 1987',
  freeman1977: 'Freeman, 1977', freeman1978: 'Freeman, 1978', marchiori2000: 'Marchiori & Latora, 2000', boldi2014: 'Boldi & Vigna, 2014',
  watts1998: 'Watts & Strogatz, 1998', seidman1983: 'Seidman, 1983', batagelj2003: 'Batagelj & Zaversnik, 2003',
  newman2004: 'Newman & Girvan, 2004', traag2019: 'Traag et al., 2019', efron1993: 'Efron & Tibshirani, 1993',
  borgatti2006: 'Borgatti et al., 2006', blei2003: 'Blei et al., 2003', krippendorff2019: 'Krippendorff, 2019', cohen1960: 'Cohen, 1960',
  wasserman1994: 'Wasserman & Faust, 1994', kleinberg1999: 'Kleinberg, 1999', sparckjones1972: 'Sparck Jones, 1972',
  garlaschelli2004: 'Garlaschelli & Loffredo, 2004',
};

// Node metrics: plain-language definition and references.
const NODE_METRIC_TEXT = {
  degree: ['Degree: number of distinct contacts.', ['freeman1978']],
  inDegree: ['In-degree: number of distinct people who directed ties to the node.', ['wasserman1994']],
  outDegree: ['Out-degree: number of distinct people the node directed ties to.', ['wasserman1994']],
  strength: ['Strength: sum of tie weights (weighted degree).', ['wasserman1994']],
  inStrength: ['In-strength: sum of incoming tie weights.', ['wasserman1994']],
  outStrength: ['Out-strength: sum of outgoing tie weights.', ['wasserman1994']],
  betweenness: ['Betweenness: share of shortest paths between other pairs that pass through the node, computed with Brandes\' algorithm.', ['freeman1977', 'brandes2001']],
  closeness: ['Closeness (harmonic): mean of inverse shortest-path distances to all other nodes, which remains defined in disconnected networks.', ['marchiori2000', 'boldi2014']],
  eigenvector: ['Eigenvector centrality: centrality proportional to the centrality of one\'s contacts.', ['bonacich1972', 'bonacich1987']],
  pagerank: ['PageRank: stationary probability of a random walk with teleportation.', ['page1999']],
  hits: ['Hubs and authorities (HITS).', ['kleinberg1999']],
  clustering: ['Local clustering coefficient: share of a node\'s contact pairs that are themselves connected.', ['watts1998']],
  coreNumber: ['Core number: the largest k for which the node belongs to the k-core.', ['seidman1983', 'batagelj2003']],
  reciprocity: ['Reciprocity: share of a node\'s directed ties that are returned.', ['wasserman1994', 'garlaschelli2004']],
  constraint: ['Constraint: Burt\'s measure of how much a node\'s contacts are connected to each other (low constraint indicates brokerage opportunity).', ['burt1992']],
  effectiveSize: ['Effective size: number of contacts minus the redundancy among them.', ['burt1992']],
  egoDensity: ['Ego-network density: density of ties among a node\'s contacts.', ['wasserman1994']],
};

const NETWORK_STAT_TEXT = {
  density: ['density (share of possible ties present)', ['wasserman1994']],
  reciprocity: ['reciprocity (share of directed ties that are mutual)', ['garlaschelli2004']],
  transitivity: ['transitivity (share of connected triples that are closed)', ['wasserman1994']],
  avgClustering: ['average local clustering', ['watts1998']],
  components: ['number of connected components', ['wasserman1994']],
  largestComponentShare: ['share of nodes in the largest component', []],
  avgPathLength: ['average shortest-path length within components', ['watts1998']],
  degreeCentralization: ['degree centralization', ['freeman1978']],
  strengthGini: ['Gini coefficient of node strength (inequality of activity)', []],
  modularity: ['modularity of the detected partition', ['newman2004']],
  assortativity: ['degree assortativity', ['newman2002']],
};

const RULE_TEXT = {
  reply: 'a reply links the replier to the author of the message replied to',
  mention: 'a mention links the author to each person mentioned',
  dm: 'a direct message links sender and recipient(s)',
  to: 'an email links the sender to each To recipient',
  cc: 'an email links the sender to each Cc recipient',
  bcc: 'an email links the sender to each Bcc recipient',
  adjacency: 'consecutive messages by different people in the same channel within a time window link their authors',
  copresence: 'attendance at the same meeting or membership of the same small group links the people present',
  declared: 'a survey or hand-entered nomination links respondent and nominee',
  repost: 'a repost links the reposter to the original author',
  like: 'a like links the liker to the author',
  follow: 'a follow links the follower to the followed account',
  reaction: 'a reaction links the reacting person to the message author',
};

const VIEW_TEXT = {
  [VIEWS.FULL]: 'a bounded group in which everyone\'s interactions are recorded',
  [VIEWS.EGO]: 'one person\'s own interactions (an ego network); ties among that person\'s contacts are not observed',
  [VIEWS.CHAT]: 'a single conversation',
  [VIEWS.SAMPLE]: 'a sample of a larger population',
  [VIEWS.AUTHORED]: 'only what one account wrote',
};

const fmtDate = t => (typeof t === 'number' && Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null);
const fmtNum = x => (typeof x === 'number' ? x.toLocaleString('en-US') : String(x));

// buildMethodsAppendix(input) -> markdown
// input = { dataset | meta, settings, network, metrics: [names], networkStats: [names], approx: { [metric]: text },
//           communities: { method, resolution, seed, runs }, groups: [attrKeys],
//           nullModel: { stats, reps, seed }, resampling: { metric(s), reps, top, seed, scheme },
//           time: { window, start, end, metrics }, content: { affect, keywords, topics, coding }, software: { name, version } }
export function buildMethodsAppendix(input = {}) {
  const used = new Set();
  const cite = keys => { keys.forEach(k => used.add(k)); return keys.length ? ` (${keys.map(k => CITE[k]).join('; ')})` : ''; };
  const meta = input.dataset?.meta || input.meta || {};
  const sources = meta.sources || [];
  const s = input.settings || {};
  const net = input.network || null;
  const out = [];
  const sw = input.software || { name: 'Org Signal', version: '2' };

  out.push('# Methods appendix', '');

  // 1. Data
  out.push('## Data sources', '');
  if (!sources.length) out.push('No source information was recorded.', '');
  for (const src of sources) {
    const files = (src.fileNames || []).length;
    const counts = Object.entries(src.counts || {}).map(([k, v]) => `${fmtNum(v)} ${k}`).join(', ');
    out.push(`- **${src.format}** (${src.family || 'unknown family'}, ${src.medium || 'unknown medium'}, ${src.context || 'unknown'} context). View: *${src.view}*, i.e. ${VIEW_TEXT[src.view] || 'unspecified'}.${src.egoKey ? ' The ego is the export owner.' : ''}${files ? ` ${files} file${files === 1 ? '' : 's'} read.` : ''}${counts ? ` Records: ${counts}.` : ''}${src.tz ? ` Time zone: ${src.tz}.` : ''}`);
    for (const w of src.warnings || []) out.push(`  - Import note: ${w.message} (${fmtNum(w.count)}).`);
  }
  if (input.dataset?.nodes) out.push('', `After identity matching the dataset contained ${fmtNum(input.dataset.nodes.count)} people or accounts and ${fmtNum(input.dataset.events?.count ?? 0)} events.`);
  out.push('');

  // 2. Construction
  out.push('## Network construction', '');
  const rules = Object.entries(s.rules || {}).filter(([, r]) => r?.on);
  if (rules.length) {
    out.push('Ties were built from the following event rules:', '');
    for (const [k, r] of rules) {
      let extra = '';
      if (k === 'adjacency' && r.windowMin != null) extra = ` (window ${r.windowMin} minutes)`;
      if (k === 'copresence' && r.normalize) extra = ' (weights normalized by group size)';
      out.push(`- ${k}: ${RULE_TEXT[k] || 'custom rule'}${extra}; weight ${r.weight ?? 1}.`);
    }
    out.push('');
  }
  const parts = [];
  parts.push(`The network was treated as ${s.directed ? 'directed' : 'undirected'}`);
  if (s.weighting) parts.push(`tie weights were ${s.weighting === 'count' ? 'event counts' : s.weighting === 'log' ? 'log-transformed event counts, log(1 + count)' : 'binary (present or absent)'}`);
  if (s.minWeight != null && s.minWeight > 0) parts.push(`ties below weight ${s.minWeight} were dropped`);
  if (s.maxRecipients != null) parts.push(`messages with more than ${s.maxRecipients} recipients were excluded, so broadcasts do not create ties`);
  if (s.time && (fmtDate(s.time.start) || fmtDate(s.time.end))) parts.push(`only events from ${fmtDate(s.time.start) || 'the start of the data'} to ${fmtDate(s.time.end) || 'the end of the data'} were used`);
  if (s.visibility?.length) parts.push(`contexts were limited to visibility ${s.visibility.join(', ')}`);
  if (s.media?.length) parts.push(`media were limited to ${s.media.join(', ')}`);
  if (s.excludeBots) parts.push('accounts flagged as bots were excluded');
  if (s.includeIsolates != null) parts.push(s.includeIsolates ? 'isolates were kept' : 'isolates were removed');
  out.push(parts.join('; ') + '.');
  if (net) out.push('', `The resulting network had ${fmtNum(net.n)} nodes and ${fmtNum(net.edges?.count ?? net.edgeCount ?? 0)} ${net.directed ? 'directed' : 'undirected'} ties.`);
  out.push('');

  // 3. Measures
  const metrics = (input.metrics || []).filter(m => NODE_METRIC_TEXT[m]);
  const nstats = (input.networkStats || []).filter(m => NETWORK_STAT_TEXT[m]);
  if (metrics.length || nstats.length) {
    out.push('## Measures', '');
    for (const m of metrics) {
      const [text, refs] = NODE_METRIC_TEXT[m];
      const approx = input.approx?.[m] ? ` Approximation: ${input.approx[m]}.` : '';
      out.push(`- ${text}${cite(refs)}${approx}`);
    }
    if (nstats.length) out.push(`- Whole-network statistics: ${nstats.map(k => NETWORK_STAT_TEXT[k][0] + cite(NETWORK_STAT_TEXT[k][1])).join('; ')}.`);
    out.push('');
  }

  // 4. Communities
  if (input.communities) {
    const c = input.communities;
    out.push('## Community detection', '');
    out.push(`Communities were detected with the Louvain method${cite(['blondel2008'])}, which maximizes modularity${cite(['newman2004'])}, at resolution ${c.resolution ?? 1} with random seed ${c.seed ?? 'unspecified'}${c.runs ? ` over ${c.runs} runs` : ''}. Louvain partitions depend on the seed and can contain poorly connected communities${cite(['traag2019'])}, so community boundaries should be read as one plausible partition.`, '');
  }

  // 5. Groups
  if (input.groups?.length) {
    out.push('## Group comparison', '');
    out.push(`Groups were defined by the attribute${input.groups.length > 1 ? 's' : ''} ${input.groups.map(g => `\`${g}\``).join(', ')}. Mixing between groups was summarized by attribute assortativity${cite(['newman2003'])} and the E-I index, (external - internal) / (external + internal) ties${cite(['krackhardt1988'])}.`, '');
  }

  // 6. Inference
  if (input.nullModel || input.resampling) {
    out.push('## Statistical comparison and robustness', '');
    if (input.nullModel) {
      const nm = input.nullModel;
      out.push(`Observed whole-network statistics (${(nm.stats || []).join(', ')}) were compared with ${nm.reps} degree-preserving randomizations produced by edge swapping${cite(['maslov2002'])} (seed ${nm.seed ?? 'unspecified'}). We report the null mean, standard deviation, z-score and ${nm.pDefinition || 'p-value'}.`);
    }
    if (input.resampling) {
      const r = input.resampling;
      const ms = [].concat(r.metric || r.metrics || []).join(', ');
      out.push(`Rank stability for ${ms || 'node rankings'} was assessed by recomputing the network on ${r.reps} resamples${r.scheme ? ` (${r.scheme})` : ' of events'}${cite(['efron1993'])} (seed ${r.seed ?? 'unspecified'}); we report each node's rank interval and how often it stayed in the top ${r.top ?? 'k'}. Centrality rankings are known to be sensitive to missing data${cite(['borgatti2006'])}.`);
    }
    out.push('');
  }

  // 7. Time
  if (input.time) {
    const t = input.time;
    out.push('## Time windows', '');
    out.push(`Measures${t.metrics?.length ? ` (${t.metrics.join(', ')})` : ''} were recomputed in consecutive ${t.window} windows${fmtDate(t.start) ? ` from ${fmtDate(t.start)}` : ''}${fmtDate(t.end) ? ` to ${fmtDate(t.end)}` : ''}, using the same construction rules in every window. A tie was counted as formed in the first window in which it appeared and dissolved in the first window after its last appearance.`, '');
  }

  // 8. Content
  const c = input.content;
  if (c && (c.affect || c.keywords || c.topics || c.coding)) {
    out.push('## Content analysis', '');
    if (c.affect) out.push(`Message affect was scored with VADER${cite(['hutto2014'])}, a lexicon- and rule-based sentiment model; the compound score ranges from -1 to 1 and was aggregated by ${c.affect.by || 'network'}. VADER was built for English social-media text and is less reliable for other languages, domain jargon and sarcasm.`);
    if (c.keywords) out.push(`Distinctive terms were ranked by TF-IDF weighting${cite(['sparckjones1972'])}${c.keywords.by ? ` within each ${c.keywords.by}` : ''}${c.keywords.k ? `, top ${c.keywords.k}` : ''}.`);
    if (c.topics) {
      const lda = !c.topics.method || /lda/i.test(c.topics.method);
      out.push(`Topics were estimated with ${lda ? 'latent Dirichlet allocation' : c.topics.method}${lda ? cite(['blei2003']) : ''} with ${c.topics.k} topics (seed ${c.topics.seed ?? 'unspecified'}).`);
    }
    if (c.coding) {
      const cd = c.coding;
      const cb = cd.codebook || { codes: [] };
      out.push('');
      out.push(`Qualitative codes were applied by a large language model (${cd.settings?.provider || 'provider unspecified'}, model \`${cd.settings?.model || 'unspecified'}\`) using a codebook of ${cb.codes.length} code${cb.codes.length === 1 ? '' : 's'} (${cb.multiLabel ? 'multiple codes per message allowed' : 'one code per message'}). Only message text was sent, truncated to ${cd.settings?.maxChars ?? 1000} characters, in batches of ${cd.settings?.batchSize ?? 'unspecified'}.`);
      if (cd.sample) out.push(`The sample of ${fmtNum(cd.sample.size)} messages was drawn from ${fmtNum(cd.sample.population)} eligible messages, stratified by ${cd.sample.strataBy} with proportional allocation and at least one message per stratum where possible (seed ${cd.sample.seed}).`);
      if (cd.settings?.doubleCode) {
        const ag = cd.agreement?.overall;
        const agText = ag ? (ag.kappa != null ? ` Agreement between the two codings: Cohen's kappa ${round3(ag.kappa)}, Krippendorff's alpha ${round3(ag.alpha)}, raw agreement ${round3(ag.agreement)}.` : ag.meanKappa != null ? ` Mean per-code Cohen's kappa ${round3(ag.meanKappa)}; exact match on the full code set ${round3(ag.exactMatch)}.` : '') : '';
        out.push(`Every message was coded twice, independently${cd.settings.secondModel && cd.settings.secondModel !== cd.settings.model ? ` by \`${cd.settings.model}\` and \`${cd.settings.secondModel}\`` : ', in a different batch order'}, and agreement was measured with Cohen's kappa${cite(['cohen1960'])} and Krippendorff's alpha${cite(['krippendorff2019'])}.${agText} Agreement between two runs of a model measures consistency, not validity; codes should be validated against human coding of a subsample.`);
      } else {
        out.push('Codes were not double-coded, so no reliability estimate is available; validate against human coding of a subsample before relying on them.');
      }
      out.push('', 'Codebook:', '');
      for (const code of cb.codes) out.push(`- \`${code.id}\`${code.label ? ` (${code.label})` : ''}: ${code.definition}`);
    }
    out.push('');
  }

  // 9. Limitations implied by the data's views.
  const views = new Set(sources.map(x => x.view));
  const lim = [];
  if (views.has(VIEWS.EGO)) lim.push('Ego-view sources record only the export owner\'s own interactions; ties among their contacts are unobserved, so whole-network statistics and the centrality of anyone but the ego are not interpretable from those sources alone.');
  if (views.has(VIEWS.CHAT)) lim.push('Chat-view sources cover single conversations and do not represent the participants\' wider networks.');
  if (views.has(VIEWS.SAMPLE)) lim.push('Sample-view sources are part of a larger population; network statistics depend on the sampling design and should not be read as population values.');
  if (views.has(VIEWS.AUTHORED)) lim.push('Authored-view sources contain only what one account wrote; incoming ties are missing.');
  if (sources.length > 1) lim.push('Sources were merged by identity matching; unmatched or mismatched identities split or join people.');
  lim.push('Communication traces record observable interaction, not relationships, attitudes or individual traits; the measures describe structural positions and patterns of observed communication only.');
  out.push('## Limitations', '', ...lim.map(x => `- ${x}`), '');

  out.push(`Analyses were performed with ${sw.name} ${sw.version}. Settings above are as recorded by the application at the time of export.`, '');

  // References
  const refs = [...used].map(k => REFERENCES[k]).sort((a, b) => a.localeCompare(b));
  if (refs.length) out.push('## References', '', ...refs.map(r => `- ${r}`), '');
  return out.join('\n');
}

function round3(x) { return typeof x === 'number' && Number.isFinite(x) ? x.toFixed(3) : 'n/a'; }
