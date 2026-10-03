// Teaching text for the Learn view. The meaning of every concept comes from
// the glossary (src/analysis/glossary.js), the same source as the API docs
// and every tooltip; this file adds what a first-time student needs around
// it: where the number appears in the app, how to read it, and the most
// common mistake. Keys are glossary keys.
//
// Each entry: { where: [[label, hash]], read, mistake, diagram? }.
// `diagram` names a figure in diagrams.js.

export const SECTIONS = [
  { id: 'basics', title: 'Basics', intro: 'What a network is made of, and the choices that make one.', keys: ['tie', 'directed', 'weight', 'path', 'communities', 'plantedGroup'] },
  { id: 'people', title: 'Who is central', intro: 'Measures for one person. Each answers a different question, so the "most central" person depends on the question.', keys: ['contacts', 'degree', 'inDegree', 'outDegree', 'strength', 'betweenness', 'closeness', 'clustering', 'eigenvector', 'pagerank', 'coreNumber', 'reciprocity'] },
  { id: 'ego', title: 'Personal (ego) networks', intro: 'One person and the people around them, from an interview or a personal export.', keys: ['ego', 'alter', 'nameGenerator', 'nameInterpreter', 'egoSize', 'egoDensity', 'effectiveSize', 'efficiency', 'constraint', 'diversity', 'homophily'] },
  { id: 'network', title: 'The whole network', intro: 'One number for everyone together.', keys: ['density', 'reciprocityNetwork', 'transitivity', 'avgClustering', 'components', 'largestComponentShare', 'avgPathLength', 'diameter', 'degreeCentralization', 'strengthGini', 'degreeAssortativity', 'modularity'] },
  { id: 'groups', title: 'Groups', intro: 'Do ties stay inside departments, majors or communities?', keys: ['eiIndex', 'assortativity', 'numericAssortativity', 'groupDensity'] },
  { id: 'chance', title: 'Is it more than chance?', intro: 'How the app tells a pattern from noise. Read these before calling anything a finding.', keys: ['nullModel', 'nullZ', 'nullP', 'rankInterval', 'topShare', 'randomSeed'] },
  { id: 'surveys', title: 'Surveys', intro: 'Collecting a network by asking people.', keys: ['roster'] },
  { id: 'time', title: 'Time and content', intro: 'Change over time, and what people wrote.', keys: ['tieTurnover', 'shiftZ', 'dz', 'sentiment', 'tfidf', 'topics', 'exposedShare'] },
];

const PEOPLE = ['People', 'people'];
const NETWORK = ['Network', 'network'];
const GROUPS = ['Groups', 'groups'];
const TIME = ['Time', 'time'];
const CONTENT = ['Content', 'content'];
const BUILD = ['Build', 'build'];
const GENERATE = ['Generate', 'generate'];

export const TEACH = {
  tie: {
    where: [['Network: the lines on the map, and the count in the first line', 'network'], BUILD],
    read: 'One line on the map is one tie. The tie count in Network counts pairs, or pairs per direction when the network is directed.',
    mistake: 'Counting messages as ties. Fifty emails between two people make one tie with a large weight, not fifty ties.',
  },
  directed: {
    where: [['Network: "(directed: a two-way tie counts as two)" after the tie count', 'network'], ['Construction settings: Direction', 'network']],
    read: 'If the network is directed, a friendship both people named is two ties. In an undirected network it is one.',
    mistake: 'Comparing tie counts of a directed and an undirected version of the same data: the directed count can be nearly double.',
  },
  weight: {
    where: [['Construction settings: Tie weight', 'network'], ['People: Strength', 'people']],
    read: 'Heavier ties mean more interaction or a closer rating. Strength adds a person\'s tie weights; Contacts ignores them.',
    mistake: 'Expecting betweenness or closeness to change when you change the weighting. They count steps, not weights.',
  },
  path: {
    where: [['Network: Average path length and Diameter', 'network']],
    read: 'Distance 1 is a direct tie, 2 is a friend of a friend. Betweenness and closeness are both built from these shortest paths.',
    mistake: 'Reading the map: two people drawn close together are not necessarily at a short distance. Read distances from the measures.',
  },
  communities: {
    where: [['Network: Color by > Community', 'network'], ['Groups: Communities', 'groups']],
    read: 'People in the same community have more ties to each other than to the rest. Numbers are names (community 1 is the largest), not ranks.',
    mistake: 'Treating the split as the one true grouping. Another seed or resolution can split a borderline person differently.',
  },
  plantedGroup: {
    where: [['Generate: the recovery check compares them', 'generate'], ['Groups: choose a department or the communities', 'groups']],
    read: 'When communities match departments, ties follow the org chart. When they do not, people organize their work differently from the chart.',
    mistake: 'Calling a mismatch an error of the method. It is often the interesting result.',
  },
  contacts: {
    where: [['People: the Contacts column (sorted by it at first)', 'people'], ['Network: Size by Contacts', 'network']],
    read: 'The person with the most contacts has the most different people tied to them. In an undirected network Contacts is the degree.',
    mistake: 'On a directed network, using "Total ties (in + out)" as the number of people: a two-way tie counts twice there.',
    diagram: 'degree',
  },
  degree: {
    where: [['People: Contacts (degree); on directed networks also Total ties (in + out)', 'people']],
    read: 'Undirected: the number of ties, which equals the number of contacts. Directed: ties in plus ties out, so a two-way tie counts twice.',
    mistake: 'Hand-computing degree on a directed network and comparing with Contacts: use Total ties (in + out) for that.',
    diagram: 'degree',
  },
  inDegree: { where: [PEOPLE], read: 'High in-degree: many people reach out to or name this person (popularity, being sought out).', mistake: 'Reading it on one person\'s export: only the owner\'s incoming ties are complete.' },
  outDegree: { where: [PEOPLE], read: 'High out-degree: this person reaches out to or names many others (activity, expansiveness).', mistake: 'Treating it as importance. It measures sending, which anyone can do.' },
  strength: { where: [PEOPLE], read: 'How much interaction, not with how many people. Compare with Contacts: high strength with few contacts means a few very heavy ties.', mistake: 'Comparing strength across networks built with different weighting (count vs log).' },
  betweenness: {
    where: [['People: Betweenness column', 'people'], ['Network: Size by Betweenness', 'network']],
    read: 'Between 0 and 1: the share of pairs of other people whose shortest route passes through this person. 1 is the center of a star; 0 is someone no shortest route needs. To get the raw count of pairs for an undirected network, multiply by (n-1)(n-2)/2.',
    mistake: 'Comparing a hand count with the app without normalizing. The app divides by the number of pairs, so a star center is 1, not 10.',
    diagram: 'betweenness',
  },
  closeness: {
    where: [['People: Closeness (harmonic)', 'people']],
    read: 'For each other person take 1 / distance (1 for a direct tie, 1/2 two steps away), add them up and divide by n-1. 1 means tied to everyone directly.',
    mistake: 'Expecting the textbook formula (n-1) / sum of distances. The harmonic version gives different values (and can order people a little differently), and still works when some people cannot be reached.',
    diagram: 'closeness',
  },
  clustering: {
    where: [['People: Clustering', 'people']],
    read: 'Of all pairs of this person\'s contacts, the share that are tied to each other. 1: everyone they know knows each other; 0: none do.',
    mistake: 'Reading clustering for someone with one or two contacts: one tie more or less flips it between 0 and 1.',
    diagram: 'clustering',
  },
  eigenvector: { where: [PEOPLE], read: 'High when your contacts are themselves well connected. Compare ranks, not values, across networks.', mistake: 'Reading scores outside the largest connected piece: they shrink toward 0 whatever their position.' },
  pagerank: { where: [PEOPLE], read: 'On directed networks: attention from people who themselves get attention. Values add up to 1, so they shrink as the network grows.', mistake: 'Comparing PageRank values between networks of different sizes.' },
  coreNumber: { where: [PEOPLE], read: 'How deep in the dense center someone sits: core 3 means part of a group where everyone has at least 3 ties within it.', mistake: 'Expecting it to separate people: many people share the same core number.' },
  reciprocity: { where: [PEOPLE], read: 'Share of this person\'s ties that run both ways.', mistake: 'Reading it on an undirected network, where every tie is two-way by definition, so it says nothing.' },
  ego: { where: [['Build: Ego interview', 'build'], ['People: the profile of the export owner', 'people']], read: 'All ego measures describe the network around one person: size, density, effective size, constraint.', mistake: 'Using betweenness in one person\'s data: ego is on every route by construction.' },
  alter: { where: [['Build: Ego interview, step 3 and later', 'build']], read: 'Ego\'s alters and the ties among them make the ego network.', mistake: 'Forgetting to record who knows whom among the alters: without it, density, effective size and constraint cannot be measured.' },
  nameGenerator: { where: [['Build: Ego interview, "Who comes to mind"', 'build']], read: 'Two or three generators ("discuss important matters", "socialize with") give a fuller list than one.', mistake: 'Leaving a low cap on names (5) when the assignment asks for 8 to 15 people.' },
  nameInterpreter: { where: [['Build: Ego interview, "About each person"', 'build']], read: 'These answers become attributes you can group and color by.', mistake: 'Asking many interpreters: each one is asked about every person named, so the interview gets long fast.' },
  egoSize: { where: [PEOPLE, ['Build: Ego interview review', 'build']], read: 'How many people ego is tied to.', mistake: 'Counting ego as part of the size.' },
  egoDensity: { where: [PEOPLE], read: 'Share of possible ties among ego\'s alters that exist (ego\'s own ties left out). High: a closed circle.', mistake: 'Comparing densities of ego networks of very different sizes: big networks have lower density by construction.' },
  effectiveSize: {
    where: [PEOPLE, ['Build: Ego interview review', 'build']],
    read: 'Contacts who are not redundant. If none of your alters know each other, effective size equals size; the more they know each other, the lower it is.',
    mistake: 'Expecting a weighted value to match the textbook: with tie weights, effective size and constraint come out weighted.',
    diagram: 'constraint',
  },
  efficiency: { where: [PEOPLE], read: 'Effective size divided by size: 1 means every contact brings someone new.', mistake: 'Reading it for a network of one or two contacts.' },
  constraint: {
    where: [PEOPLE, ['Build: Ego interview review', 'build']],
    read: 'High constraint (toward 1): your contacts know each other, so your network is closed. Low constraint: your contacts do not know each other, so you broker between them.',
    mistake: 'Reading high constraint as high influence. It is the reverse: high constraint means fewer brokerage opportunities.',
    diagram: 'constraint',
  },
  diversity: { where: [PEOPLE], read: 'How varied ego\'s contacts are on an attribute: 0 all alike.', mistake: 'Comparing across attributes with different numbers of values.' },
  homophily: { where: [PEOPLE], read: 'Share of ego\'s contacts in ego\'s own group.', mistake: 'Calling 60% "homophily" when ego\'s group is 60% of everyone: compare with the group\'s share.' },
  density: { where: [NETWORK], read: 'Share of all possible ties that exist. 1: everyone tied to everyone.', mistake: 'Comparing densities of networks of very different sizes: big networks are sparse by construction.' },
  reciprocityNetwork: { where: [NETWORK], read: 'Share of ties that are returned. Only meaningful on directed data.', mistake: 'Switching a survey union network to directed and reading reciprocity 1: union ties are two-way by construction.' },
  transitivity: { where: [NETWORK], read: 'How often a friend of a friend is also a friend. Read it against random networks with the same degrees.', mistake: 'Calling any positive value clustering: random networks have some too.' },
  avgClustering: { where: [NETWORK], read: 'Average of every person\'s clustering.', mistake: 'Expecting it to equal transitivity: people with few contacts weigh more here.' },
  components: { where: [NETWORK], read: 'Separate pieces with no path between them; a person with no ties is a piece of their own.', mistake: 'Reading many components as fragmentation when they are mostly isolates.' },
  largestComponentShare: { where: [NETWORK], read: 'Share of people in the biggest connected piece.', mistake: 'Ignoring it when reading path lengths: those are measured inside pieces only.' },
  avgPathLength: { where: [NETWORK], read: 'Typical number of steps between two people who can reach each other.', mistake: 'Comparing across networks where many people cannot reach each other.' },
  diameter: { where: [NETWORK], read: 'The longest of all shortest routes.', mistake: 'Treating it as typical: one long chain sets it.' },
  degreeCentralization: { where: [NETWORK], read: '1 is a star, 0 is everyone with the same number of ties.', mistake: 'Missing that one bot or hub can drive it.' },
  strengthGini: { where: [NETWORK], read: '0: everyone interacts equally; near 1: one person does nearly all of it.', mistake: 'Forgetting that isolates count as zeros.' },
  degreeAssortativity: { where: [NETWORK], read: 'Positive: well-connected people tie to each other. Negative: hubs tie to the less connected.', mistake: 'Reading it without the random-network comparison.' },
  modularity: { where: [NETWORK, GROUPS], read: 'Up to about 1: the network splits cleanly into groups. Read it against random networks: they also score above 0.', mistake: 'Calling any positive modularity a community structure.' },
  eiIndex: { where: [['Groups: E-I index', 'groups']], read: '-1: every tie inside groups; +1: every tie across. Compare with what random mixing would give for these group sizes.', mistake: 'Reading -0.5 as "siloed" without the random expectation: big groups have more internal options by chance.' },
  assortativity: { where: [['Groups: the reading at the top', 'groups']], read: '1: ties only within groups; 0: no preference (as random); negative: ties mostly across.', mistake: 'Reading the value without the comparison with random networks below it.' },
  numericAssortativity: { where: [GROUPS], read: 'Whether people tie to others with similar values (tenure, year).', mistake: 'Missing non-linear patterns: it only sees straight-line similarity.' },
  groupDensity: { where: [['Groups: the mixing matrix', 'groups']], read: 'Share of possible ties inside a group, or between two groups.', mistake: 'Reading density for a group of two or three people.' },
  nullModel: {
    where: [['Network: Whole network vs random', 'network'], ['Groups: the comparison under the reading', 'groups']],
    read: 'If the real network sits far outside the spread of the random ones, the pattern is unlikely to be chance given everyone\'s number of ties.',
    mistake: 'Treating "more than chance" as an explanation. It says the pattern is real, not what caused it.',
  },
  nullZ: { where: [NETWORK, GROUPS], read: 'How many standard deviations the real value is from the random average. Beyond about 2 (either sign) is unusual; 50 is far outside anything chance gave.', mistake: 'Comparing z values between tests: a huge z on a tight null is not a bigger effect.' },
  nullP: { where: [NETWORK, GROUPS], read: 'The share of random networks at least as extreme. With 200 random networks the smallest p possible is 1/201 (about 0.005): "none of the 200 came this close".', mistake: 'Reading p = 0.005 as "0.5% chance the finding is wrong". It is the share of random networks that came this close.' },
  rankInterval: { where: [['People: rank stability', 'people']], read: 'Resample the events many times and recompute: if a person stays at rank 1 to 2, the ranking is settled; rank 1 to 30 is not.', mistake: 'Expecting it to test whether a tie exists. Resampling events only shows how much the ranking depends on which events happened to be recorded.' },
  topShare: { where: [['People: rank stability', 'people']], read: 'In what share of the resamples this person was in the top k. 100% is settled.', mistake: 'Reading 60% as "in the top 10": in 40% of resamples they were not.' },
  randomSeed: { where: [GENERATE, ['Basis lines: "seed 1"', 'network']], read: 'Same seed, same result: that is how a classmate can reproduce your numbers.', mistake: 'Confusing it with the first user of a word in diffusion (Content).' },
  roster: { where: [['Build: Roster survey', 'build']], read: 'Union: a tie if either person named the other. Reciprocated: only if both did. Reciprocated networks are smaller and denser in strong ties.', mistake: 'Comparing union and reciprocated networks without saying which one each number comes from.' },
  tieTurnover: { where: [TIME], read: 'How many ties appear and disappear between windows.', mistake: 'Reading churn in daily windows as real change: short windows miss ties by chance.' },
  shiftZ: { where: [['Time: Detected shifts', 'time']], read: 'A week far outside the previous 8 weeks is flagged.', mistake: 'Calling every flag an event: holidays and gaps in the data flag too.' },
  dz: { where: [['Time: Before and after', 'time']], read: 'Size of the average per-person change around the date: about 0.2 small, 0.5 moderate, 0.8 large.', mistake: 'Reading it as caused by the date: anything else that changed then counts too.' },
  sentiment: { where: [['Content: Tone', 'content']], read: 'Average tone from -1 to +1; compare groups or weeks, not single messages.', mistake: 'Trusting it on sarcasm, jargon or other languages.' },
  tfidf: { where: [CONTENT], read: 'Words this person or group uses more than the others.', mistake: 'Reading lists for units with very little text.' },
  topics: { where: [CONTENT], read: 'Clusters of words that tend to appear together; name them yourself from their words.', mistake: 'Treating them as fixed: change the number of topics or the seed and they change.' },
  exposedShare: { where: [['Content: Diffusion', 'content']], read: 'Share of adopters who had a tied, earlier adopter. Compare with the shuffled-time baseline.', mistake: 'Calling exposure influence: tied people also share meetings and news.' },
};

// "Find it in the app": the questions of the Networks 101 assignments, each
// with where to go. `to` is a hash; `learn` names concepts to read first.
export const TASKS = [
  { a: 'A1', q: 'Who has the most ties?', how: 'People, sorted by Contacts (the default order). On a directed network, Contacts counts people; Total ties (in + out) counts ties.', to: 'people', learn: ['contacts'] },
  { a: 'A1', q: 'Who connects two groups?', how: 'People, sort by Betweenness; then check on the Network map that this person sits between the groups.', to: 'people', learn: ['betweenness'] },
  { a: 'A1', q: 'How many ties does the network have?', how: 'Network, the first line under the title ("8 people and 11 ties").', to: 'network', learn: ['tie', 'directed'] },
  { a: 'A2', q: 'Check degree, betweenness and closeness computed by hand', how: 'People. Betweenness is normalized (a share of pairs) and closeness is harmonic; see their entries here for how to convert.', to: 'people', learn: ['betweenness', 'closeness'] },
  { a: 'A3', q: 'Run an ego interview and read size, density, effective size and constraint', how: 'Build > Ego interview; the review step and the People profile show the ego measures.', to: 'build', learn: ['ego', 'nameGenerator', 'constraint', 'effectiveSize'] },
  { a: 'A4', q: 'Find the groups (communities) in a class survey', how: 'Network, Color by > Community; Groups, choose Communities.', to: 'network', learn: ['communities', 'plantedGroup'] },
  { a: 'A4', q: 'Does friendship stay within majors?', how: 'Groups, choose the major; read the sentence at the top and its comparison with random networks.', to: 'groups', learn: ['assortativity', 'nullModel'] },
  { a: 'A4', q: 'Union vs reciprocated networks', how: 'Build > Roster, when combining the responses (or drop the response files on Data and choose the combine rule).', to: 'build', learn: ['roster'] },
  { a: 'A5', q: 'Top brokers and how stable that ranking is', how: 'People, sort by Betweenness, then Rank stability.', to: 'people', learn: ['rankInterval', 'topShare'] },
  { a: 'A5', q: 'Did the measures find the planted brokers?', how: 'Generate, the recovery check below the form (also linked from Network).', to: 'generate', learn: ['plantedGroup'] },
  { a: 'A6', q: 'Are departments siloed?', how: 'Groups: the E-I index against its random expectation, and the mixing matrix.', to: 'groups', learn: ['eiIndex', 'nullModel'] },
  { a: 'A6', q: 'When did the silo form?', how: 'Time, Detected shifts.', to: 'time', learn: ['shiftZ'] },
  { a: 'A7', q: 'What can my own export show and not show?', how: 'Data, the import report: "can show" and "cannot show" for each source.', to: 'data', learn: ['ego'] },
  { a: 'A8', q: 'Build the network three ways and compare the top 5', how: 'Network or People > Construction settings; after Apply, the notice lists what changed.', to: 'network', learn: ['tie', 'weight'] },
  { a: 'A9', q: 'Did a word spread along ties?', how: 'Content > Diffusion: the exposed share against the shuffled-time baseline.', to: 'content', learn: ['exposedShare', 'nullModel'] },
  { a: 'A10', q: 'When did the reorg happen and what changed?', how: 'Time: Detected shifts, then Before and after at that date.', to: 'time', learn: ['shiftZ', 'dz'] },
  { a: 'A11', q: 'Perceived networks: who perceives best?', how: 'Build > Perceived networks, then Compare.', to: 'build', learn: [] },
  { a: 'A12', q: 'Export the methods appendix and a GEXF file', how: 'Methods & Export.', to: 'methods', learn: ['nullModel', 'randomSeed'] },
];

// Worked examples, opened in Build. The id is passed as #build?example=<id>;
// Build (src/ui/build) loads the example of that id. Keep these ids in step
// with Build's example library (docs/api/ui-core.md, "Learn links").
export const EXAMPLES = [
  { id: 'two-cliques-broker', title: 'Two cliques and a broker', what: 'The broker is the only route between the teams: highest betweenness, though not the most contacts.', learn: ['betweenness', 'contacts'] },
  { id: 'path-and-star', title: 'Path and star', what: 'The star center has betweenness 1; in the path the middle people score highest and the ends 0. Compare with your hand values.', learn: ['betweenness', 'closeness', 'degree'] },
  { id: 'ring-small-world', title: 'Ring vs ring with shortcuts', what: 'A few shortcuts cut the average path length sharply while clustering barely moves.', learn: ['avgPathLength', 'clustering'] },
  { id: 'class-friendships', title: 'Class friendships with majors', what: 'Friendships mostly within majors: positive assortativity, far from what random networks give.', learn: ['assortativity', 'eiIndex', 'nullModel'] },
  { id: 'ego-10', title: 'A 10-person ego network', what: 'Two circles that do not know each other: low constraint, effective size close to size.', learn: ['constraint', 'effectiveSize', 'ego'] },
];
