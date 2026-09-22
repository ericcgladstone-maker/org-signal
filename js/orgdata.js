'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// OrgSignal — Domain Data
// Static domain data: theory library, synthetic data generator config,
// and message templates. Change GENERATOR_CONFIG to tune synthetic demos.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Theory library ────────────────────────────────────────────────────────────
// Each entry: { id, concept, author, year, body, condition(orgMetrics, findings) }
const THEORY_LIBRARY = [
  {
    id: 'structural_holes',
    concept: 'Structural holes & brokerage',
    author: 'Burt', year: 1992,
    body: 'Gaps between disconnected groups are structural holes. Those who span them gain information advantages and coordination power — but create single points of failure when they exit.',
    condition: (m, f) => f.some(x => x.type === 'BRIDGE')
  },
  {
    id: 'weak_ties',
    concept: 'Strength of weak ties',
    author: 'Granovetter', year: 1973,
    body: 'Weak cross-group ties carry more novel information than strong within-group ties. Pre-departure behavior often shows investment shifting toward new weak ties outside the immediate group.',
    condition: (m, f) => f.some(x => x.type === 'FLIGHT_RISK')
  },
  {
    id: 'status_position',
    concept: 'Status-position divergence',
    author: 'Podolny & Baron', year: 1997,
    body: 'Formal rank and network position routinely diverge. Those with informal influence exceeding formal status face recognition pressure — historically predictive of exit or internal negotiation.',
    condition: (m, f) => f.some(x => x.type === 'HIDDEN_INFLUENCER')
  },
  {
    id: 'frontstage_backstage',
    concept: 'Frontstage / backstage performance',
    author: 'Goffman', year: 1959,
    body: 'Individuals manage different public and private performances. A large gap between public and private communication register may indicate identity performance pressure rather than authentic engagement.',
    condition: (m, f) => f.some(x => x.type === 'INAUTHENTICITY')
  },
  {
    id: 'network_closure',
    concept: 'Network closure & trust',
    author: 'Coleman', year: 1988,
    body: 'Dense reciprocal ties generate trust and enforce norms. High reciprocity indicates genuine two-way exchange; low reciprocity in dense networks signals broadcast-style communication.',
    condition: (m, f) => f.some(x => x.type === 'ASYMMETRIC')
  },
  {
    id: 'exit_voice_loyalty',
    concept: 'Exit, voice & loyalty',
    author: 'Hirschman', year: 1970,
    body: 'When dissatisfied, people either exit, raise voice, or stay loyal. Communication withdrawal — declining message volume, reduced initiation — is often the behavioral precursor to the exit decision.',
    condition: (m, f) => f.some(x => x.type === 'FLIGHT_RISK')
  },
  {
    id: 'homophily',
    concept: 'Homophily & communication clustering',
    author: 'McPherson, Smith-Lovin & Cook', year: 2001,
    body: 'People preferentially communicate with those similar to themselves. Strong departmental clustering in communication networks limits information flow and cross-functional coordination.',
    condition: (m) => m?.full?.giniDegree > 0.25
  },
  {
    id: 'psychological_safety',
    concept: 'Psychological safety & communication',
    author: 'Edmondson', year: 1999,
    body: 'Teams with psychological safety show higher rates of candid communication, question-asking, and error reporting. Divergence between public and private communication registers may reflect unsafe environments.',
    condition: (m, f) => f.some(x => x.type === 'INAUTHENTICITY')
  },
  {
    id: 'betweenness_power',
    concept: 'Betweenness & information control',
    author: 'Freeman', year: 1977,
    body: 'Betweenness centrality measures control over information flow. High betweenness confers power — but also creates dependency. Networks with concentrated betweenness are structurally fragile.',
    condition: (m, f) => f.some(x => x.type === 'BRIDGE')
  },
  {
    id: 'organizational_resilience',
    concept: 'Network redundancy & resilience',
    author: 'Weick', year: 1993,
    body: 'Resilient organizations maintain multiple overlapping information pathways. When critical connectors exit, redundant ties allow the network to reorganize. Their absence causes cascading coordination failures.',
    condition: (m, f) => f.some(x => x.type === 'BRIDGE')
  }
];

// ── Secondary insight prompt functions ───────────────────────────────────────
const SECONDARY_INSIGHT_PROMPTS = [
  (p, m, f, a) => {
    const risks = p.filter(x => x.flightRisk);
    const hidden = f.filter(x => x.type === 'HIDDEN_INFLUENCER');
    if (risks.length > 0 && hidden.length > 0) {
      const rp = p.find(x => x.id === risks[0].id);
      const hp = p.find(x => x.id === hidden[0].uid);
      if (rp && hp) return `You have flagged ${rp.name} as a flight risk and ${hp.name} as an underrecognized influencer. Are these patterns connected? Specifically: does ${hp.name}'s private network include ${rp.name}, and if so, what does that relationship look like?`;
    }
    return null;
  },
  (p, m, f, a) => {
    const bridges = f.filter(x => x.type === 'BRIDGE');
    const risks = p.filter(x => x.flightRisk);
    if (bridges.length > 0 && risks.length > 0) {
      const bp = p.find(x => x.id === bridges[0].uid);
      const rp = risks[0];
      return `${bp?.name} is the primary structural bridge, and ${rp?.name} is flagged as a flight risk. Are they in the same department? Do they communicate frequently? Could ${rp?.name}'s departure affect the bridge's load?`;
    }
    return null;
  },
  (p, m, f, a) => {
    const depts = [...new Set(p.map(x => x.dept).filter(Boolean))];
    if (depts.length >= 2) return `Which departments communicate least with each other, and what does that structural distance imply for cross-functional coordination? Are there any departments that are effectively isolated from the rest of the network?`;
    return null;
  },
  (p, m, f, a) => {
    const sentFlags = f.filter(x => x.type === 'INAUTHENTICITY');
    if (sentFlags.length > 0) {
      const sp = p.find(x => x.id === sentFlags[0].uid);
      return `The sentiment divergence flags are concentrated — are they clustered in the same department or reporting chain? If so, that suggests a cultural or leadership driver rather than individual behavior. What does the pattern look like across the org?`;
    }
    return null;
  },
  (p, m, f, a) => {
    return `Who in this organization has high influence stability — consistent across public, private, and direct message networks — but has not been flagged for anything? These people are often the quiet load-bearing members whose departure would be disproportionately disruptive.`;
  },
  (p, m, f, a) => {
    return `Looking at the initiation ratio data: who starts conversations, and who mostly responds? Are there people with high reciprocity but low initiation — engaged but passive? Are there high initiators with low reciprocity — active but not drawing response?`;
  }
];

// ── Synthetic data generator config ──────────────────────────────────────────
const GENERATOR_CONFIG = {
  sizes: {
    small:  { n: 25, depts: 4 },
    medium: { n: 45, depts: 7 },
    large:  { n: 80, depts: 9 },
  },
  density: {
    sparse:   { msgsPerPerson: 80,  privateRatio: 0.12, dmRatio: 0.10 },
    moderate: { msgsPerPerson: 220, privateRatio: 0.20, dmRatio: 0.15 },
    dense:    { msgsPerPerson: 420, privateRatio: 0.28, dmRatio: 0.22 },
  },
};

const GEN_DEPT_NAMES  = ['Engineering', 'Product', 'Design', 'Marketing', 'Customer Success', 'Finance', 'People Ops', 'Data', 'Executive'];
const GEN_FIRST_NAMES = ['Alex','Jordan','Morgan','Taylor','Casey','Riley','Sam','Drew','Quinn','Avery','Blake','Cameron','Dana','Ellis','Finley','Gray','Harper','Jamie','Kendall','Lane','Marlowe','Noel','Parker','Reese','Sage','Tatum','Val','Aaron','Beth','Carlos','Diana','Evan','Fiona','George','Hannah','Ivan','Julia','Kevin','Laura','Marcus'];
const GEN_LAST_NAMES  = ['Chen','Okafor','Reeves','Simmons','Hargrove','Fischer','Diop','Laurent','Tanaka','Johansson','Nguyen','Patel','Kim','Martinez','Johnson','Williams','Brown','Davis','Wilson','Moore','Taylor','Anderson','Thomas','Jackson','White','Harris','Martin','Garcia','Lee','Walker'];
const GEN_ROLES = {
  Engineering:        ['Engineer', 'Senior Engineer', 'Staff Engineer', 'Engineering Lead'],
  Product:            ['PM', 'Senior PM', 'Principal PM', 'VP Product'],
  Design:             ['Designer', 'Senior Designer', 'Design Lead'],
  Marketing:          ['Marketing Manager', 'Content Lead', 'VP Marketing'],
  'Customer Success': ['CSM', 'Senior CSM', 'CS Manager'],
  Finance:            ['Analyst', 'Senior Analyst', 'Finance Manager'],
  'People Ops':       ['HR Generalist', 'People Partner', 'HR Director'],
  Data:               ['Data Analyst', 'Data Scientist', 'Analytics Lead'],
  Executive:          ['CEO', 'COO', 'CTO'],
};

const GEN_MSG = {
  public_normal: [
    'Quick update on the {project} -- we\'re on track for the {date} deadline.',
    'Heads up: {project} review is on the calendar for {day}.',
    'Update on {project}: {status}. Let me know if you have questions.',
    'Just wrapped up {task}. Notes in the doc.',
    'Reminder: {meeting} is tomorrow at {time}. Agenda in the thread.',
    '@{mention} can you take a look at this when you get a chance?',
    'Circling back on {topic} -- still waiting on input from {dept}.',
    'Numbers look good on {metric}. Full breakdown in the doc.',
    'Following up on {project} from last week -- where are we?',
    '{task} is done. Moving to {next_task}.',
    'Anyone have bandwidth to review {deliverable} before EOD?',
    'Status check on {project}: {status}.',
  ],
  public_bridge: [
    'Connecting {dept1} and {dept2} on this -- {name} you should be looped in.',
    'This touches both {dept1} and {dept2}. I\'ll coordinate.',
    'Looping in {name} from {dept} -- they have context on the {topic} side.',
    'Cross-functional heads up: {project} affects {dept1} and {dept2}.',
    'Routing this to {name} -- best person to answer the {dept} side.',
  ],
  private_normal: [
    'Worth a conversation? I have some thoughts on {topic} I\'d rather not put in the main channel.',
    'Just between us -- {concern}. Not sure how to raise it publicly.',
    'Flagging this privately first: {issue}.',
    'Can we sync on {topic}? Some things I want to think through.',
    'Heads up -- I\'m hearing some concern about {topic} from a few people.',
    'Quick question, keeping this off the main channel: {question}?',
    'I\'m a bit worried about {concern}. What\'s your read?',
  ],
  private_flight: [
    'Honestly been questioning whether this is the right fit lately.',
    'I\'ve been putting out feelers. Not sure how much longer I see myself here.',
    'The {issue} situation really got to me. Still processing it.',
    'Between us, I think I need a change. Not ready to say anything yet.',
    'Manager and I are not aligned. It\'s been wearing on me.',
    'I don\'t know. I\'m just not feeling the same energy I used to.',
  ],
  dm_normal: [
    'Hey -- quick question on {topic}.',
    'Do you have 15 min this week to sync on {project}?',
    'Thanks for the help on {task} earlier.',
    'Just wanted to flag {issue} -- thought you should know.',
    'Can you review this before I send it out?',
    'What\'s your honest read on {topic}?',
  ],
  dm_flight: [
    'Can I ask you something in confidence?',
    'I\'ve been talking to a recruiter. Not sure yet but want your thoughts.',
    'Do you ever feel like your work here isn\'t being recognized?',
    'Between us -- I\'m not happy. Haven\'t told anyone else.',
  ],
};
