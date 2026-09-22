'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// OrgSignal — Application
// State, pipeline orchestration, rendering, analyst panel, graph modal,
// downloads. All DOM interaction lives here.
// ═══════════════════════════════════════════════════════════════════════════════

const State = {
  apiKey:      '',
  slackFile:   null,
  hrFile:      null,
  people:      [],
  metrics:     {},
  analyses:    {},
  orgAnalysis: null,
  findings:    [],
  orgMetrics:  {},
  deptMetrics: {},
  graphData:   null,
  chatHistory: [],
  processing:  false,
};

// ── Processing screen ─────────────────────────────────────────────────────────
let procStepCount = 0;

function procStep(text, status = 'done') {
  const container = document.getElementById('proc-steps');
  const id = `step-${procStepCount++}`;
  const div = document.createElement('div');
  div.className = 'proc-step visible';
  div.id = id;
  const icons = { done: '✓', running: '…', warn: '⚠' };
  div.innerHTML = `<span class="step-icon ${status}">${icons[status] || '✓'}</span><span class="step-text">${text}</span>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return id;
}

function procUpdate(id, text, status = 'done') {
  const el = document.getElementById(id);
  if (!el) return;
  const icons = { done: '✓', running: '…', warn: '⚠' };
  el.querySelector('.step-icon').textContent = icons[status] || '✓';
  el.querySelector('.step-icon').className = `step-icon ${status}`;
  el.querySelector('.step-text').innerHTML = text;
}

function setProgress(pct, label = '') {
  document.getElementById('proc-bar').style.width = pct + '%';
  if (label) document.getElementById('proc-count').textContent = label;
}

// ── Upload screen file handling ───────────────────────────────────────────────
function setupFileHandlers() {
  const slackInput = document.getElementById('slack-file-input');
  const hrInput    = document.getElementById('hr-file-input');
  const slackDrop  = document.getElementById('slack-drop');
  const hrDrop     = document.getElementById('hr-drop');

  slackDrop.addEventListener('click', () => slackInput.click());
  hrDrop.addEventListener('click',    () => hrInput.click());

  slackInput.addEventListener('change', () => {
    if (slackInput.files[0]) setSlackFile(slackInput.files[0]);
  });
  hrInput.addEventListener('change', () => {
    if (hrInput.files[0]) setHRFile(hrInput.files[0]);
  });

  setupDrop(slackDrop, f => setSlackFile(f));
  setupDrop(hrDrop,    f => setHRFile(f));
}

function setupDrop(zone, cb) {
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) cb(f);
  });
}

function setSlackFile(f) {
  State.slackFile = f;
  document.getElementById('slack-drop-label').textContent = `✓ ${f.name} (${(f.size / 1024).toFixed(0)} KB)`;
  document.getElementById('slack-drop').classList.add('loaded');
  checkReady();
}

function setHRFile(f) {
  State.hrFile = f;
  document.getElementById('hr-drop-label').textContent = `✓ ${f.name}`;
  document.getElementById('hr-drop').classList.add('loaded');
  checkReady();
}

function checkReady() {
  const key = document.getElementById('api-key-input').value.trim();
  document.getElementById('analyze-btn').disabled = !(State.slackFile && key.length > 10);
}

function checkReadyGen() {
  const key = document.getElementById('api-key-input-gen').value.trim();
  document.getElementById('gen-analyze-btn').disabled = key.length < 10;
}

function setUploadMode(mode) {
  const isGen = mode === 'generate';
  document.getElementById('upload-mode-content').style.display   = isGen ? 'none' : 'block';
  document.getElementById('generate-mode-content').style.display = isGen ? 'block' : 'none';
  document.getElementById('mode-upload-btn').classList.toggle('active', !isGen);
  document.getElementById('mode-gen-btn').classList.toggle('active', isGen);
}

// ── Generator UI ──────────────────────────────────────────────────────────────
async function runGenerator() {
  const btn    = document.getElementById('gen-analyze-btn');
  const status = document.getElementById('gen-status');
  btn.disabled = true;
  btn.textContent = 'Generating...';

  const config = {
    size:         document.getElementById('gen-size').value,
    structure:    document.getElementById('gen-structure').value,
    density:      document.getElementById('gen-density').value,
    flightRisk:   document.getElementById('gen-flight').value,
    sentimentDiv: document.getElementById('gen-sentiment').value,
  };

  try {
    status.textContent = 'Building org structure...';
    await sleep(30);
    status.textContent = 'Generating communication data...';
    await sleep(30);

    const { zipBlob, hrBlob, people, messageCount } = await generateSyntheticData(config);
    status.textContent = `Generated: ${people.length} people, ${messageCount.toLocaleString()} messages`;
    await sleep(200);

    const key = document.getElementById('api-key-input-gen').value.trim();
    document.getElementById('api-key-input').value = key;

    setSlackFile(new File([zipBlob], 'synthetic_org.zip', { type: 'application/zip' }));
    setHRFile(new File([hrBlob], 'synthetic_hr.csv', { type: 'text/csv' }));

    await sleep(400);
    startAnalysis();
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'Generate and analyze';
  }
}

// ── Main analysis pipeline ────────────────────────────────────────────────────
async function startAnalysis() {
  State.apiKey = document.getElementById('api-key-input').value.trim();
  if (!State.slackFile || !State.apiKey) return;

  document.getElementById('upload-screen').style.display = 'none';
  document.getElementById('processing-screen').style.display = 'flex';
  setProgress(0, '');

  try {
    // Step 1: Parse Slack zip
    const s1 = procStep('Parsing Slack export…', 'running');
    const { messages } = await parseSlackZip(State.slackFile);
    procUpdate(s1, `Slack export parsed — <strong>${messages.length.toLocaleString()} messages</strong> across ${new Set(messages.map(m => m.channel)).size} channels`);
    setProgress(8);

    // Step 2: Infer people
    const s2 = procStep('Identifying people…', 'running');
    let slackPeople = inferPeopleFromSlack(messages).filter(p => p.msgCount >= 3);
    procUpdate(s2, `<strong>${slackPeople.length} people</strong> identified from Slack activity`);
    setProgress(14);

    // Step 3: HR data
    let hrPeople = [];
    if (State.hrFile) {
      const s3 = procStep('Reading HR data…', 'running');
      const rawHR = await readFileAsText(State.hrFile);
      hrPeople = await normalizeHRWithClaude(rawHR, slackPeople.map(p => p.id), slackPeople.map(p => p.name));
      procUpdate(s3, `HR data processed — <strong>${hrPeople.length} records</strong> matched`);
    } else {
      procStep('No HR file provided — using Slack-derived data only', 'warn');
    }
    setProgress(20);

    // Step 4: Merge
    const s4 = procStep('Merging and validating people data…', 'running');
    State.people = mergePeople(slackPeople, hrPeople);
    procUpdate(s4, `<strong>${State.people.length} people</strong> — dept: ${State.people.filter(p => p.dept).length}, perf: ${State.people.filter(p => p.perf).length}, flight risk: ${State.people.filter(p => p.flightRisk).length}`);
    document.getElementById('proc-org-name').textContent = `${State.people.length} people · ${new Set(State.people.map(p => p.dept).filter(Boolean)).size} departments`;
    setProgress(26);

    // Step 5: Compute metrics
    const s5 = procStep('Computing network metrics…', 'running');
    const { metrics, orgMetrics, deptMetrics } = computeAllMetrics(messages, State.people);
    State.metrics    = metrics;
    State.orgMetrics = orgMetrics;
    State.deptMetrics = deptMetrics;
    procUpdate(s5, `Network metrics computed — betweenness, eigenvector, reciprocity, HAI, visibility lift, bridging bias across 4 partitions`);
    setProgress(38);

    // Step 6: Rule-based findings
    const s6 = procStep('Identifying structural signals…', 'running');
    State.findings = generateFindings(State.people, metrics);
    procUpdate(s6, `<strong>${State.findings.length} findings</strong> identified`);
    setProgress(44);

    // Step 7: Build message index
    const msgByUser = {};
    for (const p of State.people) msgByUser[p.id] = [];
    for (const m of messages) {
      if (msgByUser[m.user]) msgByUser[m.user].push(m);
    }

    // Step 8: Per-person LLM analysis
    const s8 = procStep(`Analyzing people with Claude — 0 / ${State.people.length}`, 'running');
    State.analyses = {};
    let analyzed = 0;

    for (let i = 0; i < State.people.length; i += CONFIG.ANALYSIS_BATCH_SIZE) {
      const batch = State.people.slice(i, i + CONFIG.ANALYSIS_BATCH_SIZE);
      await Promise.all(batch.map(async person => {
        try {
          const userMsgs = msgByUser[person.id] || [];
          const sample   = [
            ...userMsgs.filter(m => m.channelType === 'public').slice(0, CONFIG.SAMPLE_PUB_MSGS),
            ...userMsgs.filter(m => m.channelType === 'private').slice(0, CONFIG.SAMPLE_PRIV_MSGS),
            ...userMsgs.filter(m => m.channelType === 'direct').slice(0, CONFIG.SAMPLE_DM_MSGS),
          ];
          State.analyses[person.id] = await analyzePersonWithClaude(person, metrics, sample);
        } catch (e) {
          State.analyses[person.id] = { narrative: `Analysis unavailable: ${e.message}`, archetype: null, sentimentScore: 0.5, sentimentDivergence: 0 };
        }
        analyzed++;
        setProgress(44 + Math.round((analyzed / State.people.length) * 36), `${analyzed} / ${State.people.length} people analyzed`);
        procUpdate(s8, `Analyzing people with Claude — <strong>${analyzed} / ${State.people.length}</strong>`, 'running');
      }));
      if (i + CONFIG.ANALYSIS_BATCH_SIZE < State.people.length) await sleep(CONFIG.BATCH_PAUSE_MS);
    }
    procUpdate(s8, `All <strong>${State.people.length} people</strong> analyzed`);
    setProgress(80);

    // Step 9: Inauthenticity findings post-LLM
    const inauthentic = State.people
      .filter(p => { const a = State.analyses[p.id]; return a && a.sentimentDivergence > CONFIG.INAUTHENTICITY_DIVERGENCE_THRESHOLD; })
      .sort((a, b) => (State.analyses[b.id]?.sentimentDivergence || 0) - (State.analyses[a.id]?.sentimentDivergence || 0))
      .slice(0, CONFIG.MAX_INAUTHENTICITY_FINDINGS);
    if (inauthentic.length) {
      const names = inauthentic.map(p => p.name).join(' and ');
      State.findings.push({
        type: 'INAUTHENTICITY', color: '#c8a97e', icon: '🎭',
        title: `Sentiment divergence detected`,
        body: `${names} show meaningfully higher positive sentiment in public channels than in private or direct messages — a pattern consistent with performed positivity. Worth examining alongside manager and performance data.`,
        uids: inauthentic.map(p => p.id),
        uid:  inauthentic[0]?.id,
      });
    }

    // Step 10: Org synthesis
    const s10 = procStep('Generating organizational synthesis…', 'running');
    try {
      State.orgAnalysis = await generateOrgSynthesis(State.people, metrics, orgMetrics, deptMetrics, State.findings, State.analyses);
      procUpdate(s10, `Organizational synthesis complete`);
    } catch (e) {
      procUpdate(s10, `Org synthesis unavailable: ${e.message}`, 'warn');
    }
    setProgress(95);

    // Step 11: Build graph data
    const s11 = procStep('Preparing visualization data…', 'running');
    State.graphData = buildGraphData(messages, State.people, metrics);
    procUpdate(s11, `Graph data ready`);
    setProgress(100, 'Complete');

    await sleep(600);
    showApp();

  } catch (err) {
    procStep(`Error: ${err.message}`, 'warn');
    console.error(err);
  }
}

// ── LLM analysis calls ────────────────────────────────────────────────────────
async function analyzePersonWithClaude(person, metrics, sampleMessages) {
  const m = metrics[person.id];
  if (!m) return null;

  const prompt = buildPersonAnalysisPrompt(person, m, sampleMessages);
  const text   = await callClaude(prompt, CONFIG.PER_PERSON_MAX_TOKENS);

  const archetypeMatch = text.match(/ARCHETYPE:\s*([^\n\r]{3,50})/i);
  const archetype = archetypeMatch ? archetypeMatch[1].trim() : null;

  const posWords = ['great','good','awesome','excellent','love','amazing','fantastic','nice','thanks','helpful','wonderful','happy','pleased','solid','appreciate','excited','brilliant','perfect','outstanding'];
  const negWords = ['issue','problem','concern','unfortunately','difficult','frustrating','blocked','delayed','error','failing','worried','unclear','missing','broken','risk','behind','stuck'];
  let posCount = 0, negCount = 0;
  const pubMsgs  = sampleMessages.filter(m => m.channelType === 'public');
  const privMsgs = sampleMessages.filter(m => m.channelType !== 'public');
  let pubPos = 0, pubNeg = 0, privPos = 0, privNeg = 0;

  for (const msg of sampleMessages) {
    const words = msg.text.toLowerCase().split(/\W+/);
    for (const w of words) {
      if (posWords.includes(w)) posCount++;
      if (negWords.includes(w)) negCount++;
    }
  }
  for (const msg of pubMsgs)  { const w = msg.text.toLowerCase().split(/\W+/); for (const wd of w) { if (posWords.includes(wd)) pubPos++; if (negWords.includes(wd)) pubNeg++; } }
  for (const msg of privMsgs) { const w = msg.text.toLowerCase().split(/\W+/); for (const wd of w) { if (posWords.includes(wd)) privPos++; if (negWords.includes(wd)) privNeg++; } }

  const sentimentScore    = posCount / (posCount + negCount || 1);
  const pubSent           = pubPos  / (pubPos  + pubNeg  || 1);
  const privSent          = privPos / (privPos + privNeg || 1);
  const sentimentDivergence = pubSent - privSent;

  return { narrative: text, archetype, sentimentScore, sentimentDivergence, pubSentiment: pubSent, privSentiment: privSent };
}

async function generateOrgSynthesis(people, metrics, orgMetrics, deptMetrics, findings, analyses) {
  const prompt = buildOrgSynthesisPrompt(people, metrics, orgMetrics, deptMetrics, findings, analyses);
  return await callClaude(prompt, CONFIG.ORG_SYNTHESIS_MAX_TOKENS);
}

// ── App shell ─────────────────────────────────────────────────────────────────
function showApp() {
  document.getElementById('processing-screen').style.display = 'none';

  let appEl = document.getElementById('app');
  if (!appEl) {
    appEl = document.createElement('div');
    appEl.id = 'app';
    document.body.appendChild(appEl);
  }
  appEl.style.display = 'flex';
  appEl.style.flexDirection = 'column';
  appEl.style.height = '100vh';
  appEl.innerHTML = buildAppShell();

  document.querySelectorAll('.rtab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showScreen(btn.dataset.screen);
    });
  });

  document.getElementById('analyst-float-btn').addEventListener('click', () => openAnalyst(null));
  document.getElementById('ap-close').addEventListener('click', closeAnalyst);
  document.getElementById('ap-send-btn').addEventListener('click', () => sendAnalystMessage());
  document.getElementById('ap-textarea').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAnalystMessage(); }
  });

  document.getElementById('dept-filter-bar').addEventListener('click', e => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    document.querySelectorAll('#dept-filter-bar .pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    renderPeopleList(pill.dataset.dept || '');
  });
  document.getElementById('sort-bar').addEventListener('click', e => {
    const btn = e.target.closest('.sbtn');
    if (!btn) return;
    document.querySelectorAll('#sort-bar .sbtn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderPeopleList(
      document.querySelector('#dept-filter-bar .pill.active')?.dataset.dept || '',
      btn.dataset.sort
    );
  });

  renderBriefing();
  renderPeopleList('', 'influence');
  showScreen('briefing');
  setupGraphModal();
}

function buildAppShell() {
  return `
<div class="v3-header">
  <div class="v3-logo">OrgSignal <span class="v3-logo-ver">v3</span></div>
  <nav class="ribbon">
    <button class="rtab active" data-screen="briefing">◈ Briefing</button>
    <button class="rtab" data-screen="people">⊹ People</button>
    <button class="rtab" data-screen="departments">▦ Departments</button>
    <button class="rtab" data-screen="network">◎ Network map</button>
    <button class="rtab" data-screen="reports">↓ Reports</button>
  </nav>
  <div class="v3-header-end">
    <button class="hbtn" onclick="location.reload()">New analysis</button>
  </div>
</div>
<div class="v3-body">
  <div class="v3-main" id="v3-main">
    <div class="screen active" id="screen-briefing"></div>
    <div class="screen" id="screen-people" style="flex-direction:column;">
      <div class="people-bar">
        <div class="dept-pills" id="dept-filter-bar"><button class="pill active" data-dept="">All</button></div>
        <div class="sort-row" id="sort-bar">
          <span class="sort-lbl">Sort</span>
          <button class="sbtn active" data-sort="influence">Influence</button>
          <button class="sbtn" data-sort="connections">Connections</button>
          <button class="sbtn" data-sort="reciprocity">Reciprocity</button>
          <button class="sbtn" data-sort="flags">Flags first</button>
        </div>
      </div>
      <div class="people-list" id="people-list"></div>
    </div>
    <div class="screen" id="screen-departments"></div>
    <div class="screen" id="screen-flags"></div>
    <div class="screen" id="screen-network" style="padding:2rem;color:var(--text-muted);font-size:0.85rem;">
      <button style="margin-bottom:1rem;" class="hbtn" onclick="openGraphModal()">Open network map</button><br>
      Use the network map to explore communication topology visually.
    </div>
    <div class="screen" id="screen-reports"></div>
  </div>
</div>
<button class="analyst-float" id="analyst-float-btn"><div class="af-dot"></div>Analyst</button>
<div class="analyst-panel" id="analyst-panel">
  <div class="ap-hdr">
    <div><div class="ap-title">Analyst</div><div class="ap-sub" id="ap-sub">Loading context…</div></div>
    <button class="ap-close" id="ap-close">×</button>
  </div>
  <div class="ap-msgs" id="ap-msgs">
    <div class="ap-ctx" id="ap-ctx">Preparing analysis context…</div>
    <div class="ap-starters" id="ap-starters"></div>
  </div>
  <div class="ap-input-wrap">
    <div class="ap-input-row">
      <textarea id="ap-textarea" rows="2" placeholder="Ask about the organization…"></textarea>
      <button class="ap-send" id="ap-send-btn">↑</button>
    </div>
  </div>
</div>
<div class="person-modal" id="person-modal">
  <div class="pm-box" id="pm-box"></div>
</div>`;
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  if (name === 'departments') renderDepartments();
  if (name === 'reports')     renderReports();
}

// ── Briefing ──────────────────────────────────────────────────────────────────
function renderBriefing() {
  const people     = State.people;
  const metrics    = State.metrics;
  const findings   = State.findings || [];
  const orgMetrics = State.orgMetrics || {};
  const analyses   = State.analyses || {};

  const n           = people.length;
  const depts       = new Set(people.map(p => p.dept).filter(Boolean)).size;
  const reciprocity = Math.round((orgMetrics.full?.meanReciprocity || 0) * 100);
  const gini        = (orgMetrics.full?.giniDegree || 0).toFixed(2);
  const flightRisks = people.filter(p => p.flightRisk);
  const bridges     = findings.filter(f => f.type === 'BRIDGE');
  const hidden      = findings.filter(f => f.type === 'HIDDEN_INFLUENCER');

  const parts = [];
  if (flightRisks.length > 0) parts.push(`<span class="b-hl-risk">${flightRisks.length} departure signal${flightRisks.length > 1 ? 's' : ''}.</span>`);
  if (bridges.length > 0) parts.push(`<span class="b-hl-accent">One structural vulnerability.</span>`);
  if (hidden.length > 0) parts.push(`<span class="b-hl-note">${hidden.length} hidden influencer${hidden.length > 1 ? 's' : ''}.</span>`);
  const headline = parts.length > 0
    ? `A broadly healthy network.<br>${parts.join('<br>')}`
    : `A well-connected, reciprocal organization.`;

  const applicableTheories = THEORY_LIBRARY.filter(t => t.condition(orgMetrics, findings)).slice(0, 3);
  const patternBlocks      = buildPatternBlocks(people, metrics, findings, analyses, orgMetrics);
  const exploreQueries     = buildExploreQueries(findings, people);

  document.getElementById('screen-briefing').innerHTML = `
<div class="briefing" id="briefing-content">
  <div class="b-eyebrow">Communication network analysis · ${n} people · ${depts > 0 ? depts + ' departments · ' : ''}${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
  <h1 class="b-headline">${headline}</h1>
  <p class="b-lede">${buildLede(people, metrics, findings, orgMetrics, reciprocity, gini)}</p>
  ${patternBlocks}
  <div id="secondary-insights"></div>
  <div class="insight-refresh">
    <button class="refresh-btn" id="refresh-btn" onclick="loadSecondaryInsights()">◈ Surface deeper insights</button>
    <span class="refresh-note" id="refresh-note">Second-order patterns · cross-individual connections · emergent questions</span>
  </div>
  <div style="margin-top:1rem;">
    <div class="section-divider">Theoretical context</div>
    <div class="theory-grid">${applicableTheories.map(t => buildTheoryCard(t, findings, people)).join('')}</div>
  </div>
  <div class="section-divider">Continue exploring</div>
  <div class="explore-grid">${exploreQueries}</div>
</div>`;

  initAnalyst(people, metrics, findings, analyses, orgMetrics);
}

function buildLede(people, metrics, findings, orgMetrics, reciprocity, gini) {
  const flightCount = people.filter(p => p.flightRisk).length;
  const bridges     = findings.filter(f => f.type === 'BRIDGE');
  const hidden      = findings.filter(f => f.type === 'HIDDEN_INFLUENCER');

  let lede = `Information moves well here. With ${reciprocity}% mean reciprocity and a degree Gini of ${gini}, most relationships are genuinely two-way and connection inequality is low.`;
  if (bridges.length > 0) {
    const bridge = people.find(p => p.id === bridges[0].uid);
    if (bridge) lede += ` Beneath that surface: ${bridge.name} is the irreplaceable junction between departments — a single point of failure that formal org charts would not predict.`;
  }
  if (flightCount > 0) {
    lede += ` ${flightCount === 1 ? 'One person is' : flightCount + ' people are'} showing behavioral signatures consistent with departure.`;
  }
  if (hidden.length > 0) {
    const h = people.find(p => p.id === hidden[0].uid);
    if (h) lede += ` And ${h.name}'s actual organizational influence is substantially invisible to any formal title or org chart.`;
  }
  return lede;
}

function buildPatternBlocks(people, metrics, findings, analyses, orgMetrics) {
  let html = '';

  // Bridge
  const bridgeFindings = findings.filter(f => f.type === 'BRIDGE');
  if (bridgeFindings.length > 0) {
    const topBridge  = people.find(p => p.id === bridgeFindings[0].uid);
    const instances  = bridgeFindings.map(f => {
      const p = people.find(x => x.id === f.uid); if (!p) return '';
      const m = metrics[p.id];
      return `<div class="inst-row" onclick="openPersonModal('${p.id}')">
        <div class="inst-name">${p.name}</div>
        <div class="inst-role">${p.role || ''}${p.dept ? ' · ' + p.dept : ''}</div>
        <div class="inst-mets">
          <div class="im"><span class="im-l">Betweenness</span><span class="im-v hi">${(m?.full?.betweenness || 0).toFixed(3)}</span></div>
          <div class="im"><span class="im-l">Core score</span><span class="im-v hi">${m?.derived?.coreScore || '—'}</span></div>
        </div>
        <div class="inst-arrow">›</div></div>`;
    }).join('');
    html += `<div class="pattern-block pb-structural">
      <div class="pb-labels">
        <span class="pb-type structural" data-tip="A structural risk is a vulnerability in how information flows — typically a single person or gap whose removal would fragment communication.">Structural risk</span>
        <span class="pb-sep">·</span>
        <span class="pb-theory">Burt's structural holes (1992)<div class="pb-theory-tip">Gaps between disconnected groups are structural holes. Those who span them gain coordination power — but create fragility when they exit.</div></span>
      </div>
      <div class="pb-title">Bridge concentration: ${bridgeFindings.length === 1 ? 'one person spans' : bridgeFindings.length + ' people span'} the major cross-departmental gaps.</div>
      <div class="pb-body">In a well-distributed network, brokerage function is spread across multiple people. Here it is concentrated. <strong>${topBridge?.name || 'This person'} holds maximum betweenness centrality</strong> — sitting on the shortest information path between more pairs of people than anyone else. The risk is not their workload. The risk is that no redundancy exists.</div>
      <div class="pb-evidence">
        <div class="ev"><span class="ev-l">Betweenness</span><span class="ev-v hi">${(metrics[bridgeFindings[0].uid]?.full?.betweenness || 0).toFixed(3)} · maximum</span></div>
        <div class="ev"><span class="ev-l">Network-spanning brokers</span><span class="ev-v lo">${bridgeFindings.length} of ${people.length}</span></div>
      </div>
      <div class="pb-instances"><div class="pb-inst-label">Instance${bridgeFindings.length > 1 ? 's' : ''}</div>${instances}</div>
      <div class="pb-footer">
        <div class="pb-action">Implication: develop secondary brokers or redistribute liaison roles before this concentration becomes acute.</div>
        <div class="an-nudge" onclick="openAnalyst('What happens to information flow if ${topBridge?.name || 'the primary bridge'} leaves?')">
          <span class="an-text">Ask the analyst:</span>
          <div class="an-btn">◈ What happens if they leave?</div>
        </div>
      </div>
    </div>`;
  }

  // Flight risk
  const riskFindings = findings.filter(f => f.type === 'FLIGHT_RISK');
  const hrRisks      = people.filter(p => p.flightRisk);
  const allRisks     = [...new Set([...riskFindings.map(f => f.uid), ...hrRisks.map(p => p.id)])];
  if (allRisks.length > 0) {
    const instances = allRisks.map(uid => {
      const p = people.find(x => x.id === uid); if (!p) return '';
      const m = metrics[uid];
      return `<div class="inst-row" onclick="openPersonModal('${uid}')">
        <div class="inst-name">${p.name}</div>
        <div class="inst-role">${p.role || ''}${p.dept ? ' · ' + p.dept : ''}</div>
        <div class="inst-mets">
          <div class="im"><span class="im-l">Mgr proximity</span><span class="im-v ${(m?.derived?.managerProximity || 0) < 0.1 ? 'lo' : 'n'}">${Math.round((m?.derived?.managerProximity || 0) * 100)}%</span></div>
          <div class="im"><span class="im-l">HAI</span><span class="im-v n">${Math.round((m?.derived?.hai || 0) * 100)}%</span></div>
        </div>
        <div class="inst-arrow">›</div></div>`;
    }).join('');
    const topRisk = people.find(p => p.id === allRisks[0]);
    html += `<div class="pattern-block pb-risk">
      <div class="pb-labels">
        <span class="pb-type risk" data-tip="Pre-departure behavioral signatures: declining manager proximity, shrinking public channel engagement, concentrated DM relationships.">Flight risk</span>
        <span class="pb-sep">·</span>
        <span class="pb-theory">Granovetter · weak tie theory (1973)<div class="pb-theory-tip">Weak ties to distant groups carry novel information. When someone's relational investment shifts toward new weak ties outside their group, it often signals an emerging alternative social anchor.</div></span>
        <span class="pb-sep">·</span>
        <span class="pb-theory">Hirschman · exit-voice-loyalty (1970)<div class="pb-theory-tip">When dissatisfied, people exit, raise voice, or stay loyal. Communication withdrawal is often the behavioral precursor to the exit decision.</div></span>
      </div>
      <div class="pb-title">Pre-departure behavioral signature${allRisks.length > 1 ? 's' : ''} in ${allRisks.length} individual${allRisks.length > 1 ? 's' : ''}.</div>
      <div class="pb-body">The network shows ${allRisks.length === 1 ? 'one person' : allRisks.length + ' people'} whose communication patterns have diverged from what their roles and tenure would predict. The diagnostic signatures: <strong>collapse in manager-directed communication</strong>, formation of concentrated DM relationships outside the department, and reduced public channel engagement.</div>
      <div class="pb-evidence">
        <div class="ev"><span class="ev-l">HR flags active</span><span class="ev-v lo">${hrRisks.length}</span></div>
        <div class="ev"><span class="ev-l">Network-corroborated</span><span class="ev-v lo">${allRisks.length}</span></div>
      </div>
      <div class="pb-instances"><div class="pb-inst-label">Instance${allRisks.length > 1 ? 's' : ''}</div>${instances}</div>
      <div class="pb-footer">
        <div class="pb-action">Implication: the network data adds specificity to the HR flag. Each case warrants direct evaluation.</div>
        <div class="an-nudge" onclick="openAnalyst('Walk me through the flight risk situation in detail — who is most at risk and why?')">
          <span class="an-text">Ask the analyst:</span>
          <div class="an-btn">◈ Who is most at risk and why?</div>
        </div>
      </div>
    </div>`;
  }

  // Hidden influencers
  const hiddenFindings = findings.filter(f => f.type === 'HIDDEN_INFLUENCER');
  if (hiddenFindings.length > 0) {
    const topHidden = people.find(p => p.id === hiddenFindings[0].uid);
    const instances = hiddenFindings.map(f => {
      const p = people.find(x => x.id === f.uid); if (!p) return '';
      const m = metrics[p.id];
      return `<div class="inst-row" onclick="openPersonModal('${p.id}')">
        <div class="inst-name">${p.name}</div>
        <div class="inst-role">${p.role || ''}${p.dept ? ' · ' + p.dept : ''}</div>
        <div class="inst-mets">
          <div class="im"><span class="im-l">Vis. lift</span><span class="im-v lo">${(m?.derived?.visibilityLift || 0).toFixed(2)}</span></div>
          <div class="im"><span class="im-l">HAI</span><span class="im-v md">${Math.round((m?.derived?.hai || 0) * 100)}%</span></div>
        </div>
        <div class="inst-arrow">›</div></div>`;
    }).join('');
    html += `<div class="pattern-block pb-hidden">
      <div class="pb-labels">
        <span class="pb-type hidden" data-tip="Influence that exceeds formal title — exercised primarily through private channels and DMs. Invisible to org charts but structurally significant.">Hidden influence</span>
        <span class="pb-sep">·</span>
        <span class="pb-theory">Podolny & Baron · status-position divergence (1997)<div class="pb-theory-tip">Formal rank and network position routinely diverge. Those with informal influence exceeding formal status face recognition pressure — predictive of exit or internal negotiation.</div></span>
      </div>
      <div class="pb-title">${hiddenFindings.length === 1 ? 'One person\'s' : hiddenFindings.length + ' people\'s'} informal influence is invisible to any formal org chart.</div>
      <div class="pb-body">Private and direct message eigenvector centrality places ${topHidden?.name || 'this person'} near the top of the organization. Their public channel presence does not reflect this. The gap between <strong>private network position and public visibility</strong> is among the largest in the dataset. This represents organizational value that is substantially unpriced by formal title.</div>
      <div class="pb-evidence">
        <div class="ev"><span class="ev-l">Visibility lift</span><span class="ev-v lo">${(metrics[hiddenFindings[0].uid]?.derived?.visibilityLift || 0).toFixed(2)}</span></div>
        <div class="ev"><span class="ev-l">HAI</span><span class="ev-v md">${Math.round((metrics[hiddenFindings[0].uid]?.derived?.hai || 0) * 100)}%</span></div>
      </div>
      <div class="pb-instances"><div class="pb-inst-label">Instance${hiddenFindings.length > 1 ? 's' : ''}</div>${instances}</div>
      <div class="pb-footer">
        <div class="pb-action">Implication: status-position divergence at this magnitude is a retention signal. Consider whether their formal role reflects their actual function.</div>
        <div class="an-nudge" onclick="openAnalyst('Is ${topHidden?.name || 'the hidden influencer'} a retention risk, and what does their private network reveal?')">
          <span class="an-text">Ask the analyst:</span>
          <div class="an-btn">◈ Is this a retention risk?</div>
        </div>
      </div>
    </div>`;
  }

  // Sentiment divergence
  const sentFindings = findings.filter(f => f.type === 'INAUTHENTICITY');
  if (sentFindings.length > 0) {
    const topSent = people.find(p => p.id === sentFindings[0].uid);
    const instances = sentFindings.map(f => {
      const p = people.find(x => x.id === f.uid); if (!p) return '';
      const m = metrics[p.id];
      const a = analyses[p.id];
      return `<div class="inst-row" onclick="openPersonModal('${p.id}')">
        <div class="inst-name">${p.name}</div>
        <div class="inst-role">${p.role || ''}${p.dept ? ' · ' + p.dept : ''}</div>
        <div class="inst-mets">
          <div class="im"><span class="im-l">Sent. divergence</span><span class="im-v lo">${(a?.sentimentDivergence || 0).toFixed(2)}</span></div>
          <div class="im"><span class="im-l">Reciprocity</span><span class="im-v ${(m?.full?.reciprocity || 0) < 0.65 ? 'lo' : 'n'}">${Math.round((m?.full?.reciprocity || 0) * 100)}%</span></div>
        </div>
        <div class="inst-arrow">›</div></div>`;
    }).join('');
    html += `<div class="pattern-block pb-sentiment">
      <div class="pb-labels">
        <span class="pb-type sentiment" data-tip="A measurable gap between public and private communication sentiment.">Authenticity signal</span>
        <span class="pb-sep">·</span>
        <span class="pb-theory">Goffman · frontstage/backstage (1959)<div class="pb-theory-tip">Individuals manage different public and private performances. A large sustained gap may indicate identity performance pressure or genuine dissatisfaction being masked.</div></span>
      </div>
      <div class="pb-title">Public communication register diverges from private in ${sentFindings.length} individual${sentFindings.length > 1 ? 's' : ''}.</div>
      <div class="pb-body">Sentiment analysis reveals a gap between markedly positive public communication and more negative private or DM communication. <strong>What is being communicated publicly is not a reliable signal of private orientation.</strong></div>
      <div class="pb-evidence">
        <div class="ev"><span class="ev-l">Individuals flagged</span><span class="ev-v lo">${sentFindings.length}</span></div>
        <div class="ev"><span class="ev-l">Strongest divergence</span><span class="ev-v lo">${(State.analyses[sentFindings[0].uid]?.sentimentDivergence || 0).toFixed(2)}</span></div>
      </div>
      <div class="pb-instances"><div class="pb-inst-label">Instance${sentFindings.length > 1 ? 's' : ''}</div>${instances}</div>
      <div class="pb-footer">
        <div class="pb-action">Implication: worth examining alongside performance and manager data.</div>
        <div class="an-nudge" onclick="openAnalyst('What does the sentiment divergence pattern suggest about ${topSent?.dept || 'this department'} culture and leadership dynamics?')">
          <span class="an-text">Ask the analyst:</span>
          <div class="an-btn">◈ What does this suggest about team dynamics?</div>
        </div>
      </div>
    </div>`;
  }

  // Asymmetric
  const asymFindings = findings.filter(f => f.type === 'ASYMMETRIC');
  if (asymFindings.length > 0) {
    const p = people.find(x => x.id === asymFindings[0].uid);
    const m = metrics[p?.id];
    if (p && m) {
      html += `<div class="pattern-block pb-sentiment">
        <div class="pb-labels">
          <span class="pb-type sentiment">Communication pattern</span>
          <span class="pb-sep">·</span>
          <span class="pb-theory">Coleman · network closure & trust (1988)<div class="pb-theory-tip">Dense reciprocal ties generate trust and enforce norms. Asymmetric communication suggests broadcast-style leadership or one-sided relationship dynamics.</div></span>
        </div>
        <div class="pb-title">Asymmetric communication pattern detected: messages sent are not being returned at expected rates.</div>
        <div class="pb-body"><strong>${p.name}</strong> shows ${Math.round((m.full?.reciprocity || 0) * 100)}% reciprocity against an organizational mean of ${Math.round((State.orgMetrics?.full?.meanReciprocity || 0) * 100)}%.</div>
        <div class="pb-evidence">
          <div class="ev"><span class="ev-l">${p.name} reciprocity</span><span class="ev-v lo">${Math.round((m.full?.reciprocity || 0) * 100)}%</span></div>
          <div class="ev"><span class="ev-l">Org mean</span><span class="ev-v n">${Math.round((State.orgMetrics?.full?.meanReciprocity || 0) * 100)}%</span></div>
        </div>
        <div class="pb-instances">
          <div class="pb-inst-label">Instance</div>
          <div class="inst-row" onclick="openPersonModal('${p.id}')">
            <div class="inst-name">${p.name}</div>
            <div class="inst-role">${p.role || ''}${p.dept ? ' · ' + p.dept : ''}</div>
            <div class="inst-mets"><div class="im"><span class="im-l">Reciprocity</span><span class="im-v lo">${Math.round((m.full?.reciprocity || 0) * 100)}%</span></div></div>
            <div class="inst-arrow">›</div>
          </div>
        </div>
        <div class="pb-footer">
          <div class="pb-action">Implication: worth examining whether this reflects intentional broadcast leadership or missed engagement opportunities.</div>
          <div class="an-nudge" onclick="openAnalyst('What does ${p.name}\'s low reciprocity pattern reveal about their communication style and relationships?')">
            <span class="an-text">Ask the analyst:</span>
            <div class="an-btn">◈ Explain this pattern</div>
          </div>
        </div>
      </div>`;
    }
  }

  // Network health (always shown)
  const giniVal  = orgMetrics.full?.giniDegree || 0;
  const recipVal = orgMetrics.full?.meanReciprocity || 0;
  html += `<div class="pattern-block pb-healthy">
    <div class="pb-labels">
      <span class="pb-type healthy" data-tip="Positive structural indicators — high reciprocity, low degree inequality, distributed influence.">Network health</span>
      <span class="pb-sep">·</span>
      <span class="pb-theory">Coleman · network closure (1988)<div class="pb-theory-tip">Dense reciprocal ties generate trust and reinforce norms. High mean reciprocity indicates genuine two-way exchange rather than hierarchical broadcasting.</div></span>
    </div>
    <div class="pb-title">The broader network structure is egalitarian, reciprocal, and resilient.</div>
    <div class="pb-body">Beyond the flagged patterns, this organization's communication topology is genuinely healthy. A <strong>Gini coefficient of ${giniVal.toFixed(2)}</strong> indicates low inequality in connection patterns. Mean reciprocity of <strong>${Math.round(recipVal * 100)}%</strong> shows that the majority of relationships involve genuine two-way exchange.</div>
    <div class="pb-evidence">
      <div class="ev"><span class="ev-l">Degree Gini</span><span class="ev-v hi">${giniVal.toFixed(2)}</span></div>
      <div class="ev"><span class="ev-l">Mean reciprocity</span><span class="ev-v hi">${Math.round(recipVal * 100)}%</span></div>
      <div class="ev"><span class="ev-l">Top-10% share</span><span class="ev-v hi">${Math.round((orgMetrics.full?.top10share || 0) * 100)}%</span></div>
    </div>
    <div class="pb-footer">
      <div class="pb-action">The identified risks are manageable if addressed specifically.</div>
      <div class="an-nudge" onclick="openAnalyst('How does this organization compare structurally to typical organizations of this size and type?')">
        <span class="an-text">Ask the analyst:</span>
        <div class="an-btn">◈ How does this compare to typical orgs?</div>
      </div>
    </div>
  </div>`;

  return html;
}

// ── Secondary insights ────────────────────────────────────────────────────────
let secondaryInsightIndex = 0;

async function loadSecondaryInsights() {
  const btn       = document.getElementById('refresh-btn');
  const note      = document.getElementById('refresh-note');
  const container = document.getElementById('secondary-insights');

  while (secondaryInsightIndex < SECONDARY_INSIGHT_PROMPTS.length) {
    const promptFn  = SECONDARY_INSIGHT_PROMPTS[secondaryInsightIndex];
    const question  = promptFn(State.people, State.metrics, State.findings, State.analyses);
    secondaryInsightIndex++;

    if (question) {
      btn.disabled = true;
      btn.textContent = '◈ Generating deeper insight…';

      const systemPrompt = buildAnalystSystemPrompt(State.people, State.metrics, State.analyses, State.findings, State.orgMetrics);
      const fullPrompt   = buildSecondaryInsightPrompt(question, systemPrompt);

      try {
        // useWebSearch=true: live search enriches comparative/research-backed insights
        const response = await callClaude(fullPrompt, CONFIG.SECONDARY_INSIGHT_MAX_TOKENS, systemPrompt, true);
        const safeResponse = safeMarkdown(response);

        const block = document.createElement('div');
        block.className = 'pattern-block pb-structural';
        block.style.borderLeftColor = 'var(--teal)';
        block.innerHTML = `
          <div class="pb-labels">
            <span class="pb-type structural" style="color:var(--teal)">Deeper insight</span>
            <span class="pb-sep">·</span>
            <span style="font-size:0.6rem;color:var(--text-dim);font-family:'DM Mono',monospace;">second-order analysis</span>
          </div>
          <div class="pb-body" style="margin-bottom:0.5rem;">${safeResponse}</div>
          <div class="pb-footer">
            <div></div>
            <div class="an-nudge" onclick="openAnalyst(${JSON.stringify(question)})">
              <span class="an-text">Explore further:</span>
              <div class="an-btn">◈ Ask the analyst</div>
            </div>
          </div>`;
        container.appendChild(block);
        block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (_) {}

      const remaining = SECONDARY_INSIGHT_PROMPTS.slice(secondaryInsightIndex)
        .some(fn => fn(State.people, State.metrics, State.findings, State.analyses) !== null);

      if (remaining) {
        btn.disabled = false;
        btn.textContent = '◈ Surface another insight';
        note.textContent = 'More patterns available';
      } else {
        btn.disabled = true;
        btn.textContent = '◈ No further insights';
        note.textContent = 'All second-order patterns have been surfaced.';
      }
      return;
    }
  }

  btn.disabled = true;
  btn.textContent = '◈ No further insights';
  note.textContent = 'All second-order patterns have been surfaced.';
}

// ── Theory cards ──────────────────────────────────────────────────────────────
function buildTheoryCard(theory, findings, people) {
  let signal = '';
  if (theory.id === 'structural_holes') {
    const b = findings.find(f => f.type === 'BRIDGE');
    const bp = b ? people.find(p => p.id === b.uid) : null;
    if (bp) signal = `→ ${bp.name} spans every major structural hole in this network.`;
  } else if (theory.id === 'weak_ties' || theory.id === 'exit_voice_loyalty') {
    const risks = people.filter(p => p.flightRisk);
    if (risks.length > 0) signal = `→ ${risks.map(p => p.name).join(', ')} show${risks.length === 1 ? 's' : ''} behavioral signatures consistent with this theory.`;
  } else if (theory.id === 'status_position') {
    const h = findings.find(f => f.type === 'HIDDEN_INFLUENCER');
    const hp = h ? people.find(p => p.id === h.uid) : null;
    if (hp) signal = `→ ${hp.name}: ${hp.role || 'title'} understates top-tier network position.`;
  } else if (theory.id === 'frontstage_backstage' || theory.id === 'psychological_safety') {
    const s = findings.find(f => f.type === 'INAUTHENTICITY');
    const sp = s ? people.find(p => p.id === s.uid) : null;
    if (sp) signal = `→ ${sp.name} shows the strongest frontstage/backstage divergence.`;
  } else if (theory.id === 'network_closure') {
    const a = findings.find(f => f.type === 'ASYMMETRIC');
    const ap = a ? people.find(p => p.id === a.uid) : null;
    if (ap) signal = `→ ${ap.name} shows the most pronounced asymmetric pattern.`;
  }
  const askQ = `Explain how ${theory.concept} (${theory.author}, ${theory.year}) applies specifically to what we see in this organization's data.`;
  return `<div class="theory-card" onclick="openAnalyst(${JSON.stringify(askQ)})">
    <div class="tc-concept">${theory.concept}</div>
    <div class="tc-author">${theory.author}, ${theory.year}</div>
    <div class="tc-body">${theory.body}</div>
    ${signal ? `<div class="tc-signal">${signal}</div>` : ''}
    <div class="tc-ask">◈ Ask the analyst about this →</div>
  </div>`;
}

function buildExploreQueries(findings, people) {
  const queries = [
    { label: 'People view', q: null, dest: 'People →', screen: 'people', body: 'Browse all people ranked by influence, with inline signals and metric tooltips.' },
    { label: 'Ask the analyst', q: 'Which department has the most fragile internal communication structure, and why?', dest: 'Open analyst →', body: 'Which department has the most fragile internal structure?' },
    { label: 'Ask the analyst', q: 'Where are the structural holes that no one is currently bridging?', dest: 'Open analyst →', body: 'Where are the unspanned structural holes?' },
    { label: 'Reports', q: null, dest: 'Reports →', screen: 'reports', body: 'Download the full employee report, org report, and master data CSV.' }
  ];
  return queries.map(item => `
    <div class="explore-card" onclick="${item.q ? `openAnalyst(${JSON.stringify(item.q)})` : `showScreen('${item.screen}')`}">
      <div class="ec-label">${item.label}</div>
      <div class="ec-q">${item.body}</div>
      <div class="ec-dest">${item.dest}</div>
    </div>`).join('');
}

// ── People list ───────────────────────────────────────────────────────────────
function renderPeopleList(deptFilter = '', sortBy = 'influence') {
  const depts   = [...new Set(State.people.map(p => p.dept).filter(Boolean))].sort();
  const pillsEl = document.getElementById('dept-filter-bar');
  if (pillsEl && pillsEl.children.length <= 1) {
    depts.forEach(d => {
      const btn = document.createElement('button');
      btn.className = 'pill'; btn.dataset.dept = d; btn.textContent = d;
      pillsEl.appendChild(btn);
    });
  }

  let people = [...State.people];
  if (deptFilter) people = people.filter(p => p.dept === deptFilter);
  const metrics  = State.metrics;
  const findings = State.findings || [];

  people.sort((a, b) => {
    const ma = metrics[a.id], mb = metrics[b.id];
    if (sortBy === 'influence')    return (mb?.derived?.coreScore || 0) - (ma?.derived?.coreScore || 0);
    if (sortBy === 'connections')  return (mb?.full?.degree || 0) - (ma?.full?.degree || 0);
    if (sortBy === 'reciprocity')  return (mb?.full?.reciprocity || 0) - (ma?.full?.reciprocity || 0);
    if (sortBy === 'flags') {
      const fa = (a.flightRisk ? 10 : 0) + (findings.some(f => f.uid === a.id) ? 5 : 0);
      const fb = (b.flightRisk ? 10 : 0) + (findings.some(f => f.uid === b.id) ? 5 : 0);
      return fb - fa;
    }
    return 0;
  });

  const container = document.getElementById('people-list');
  if (!container) return;
  container.innerHTML = people.map((p, i) => buildPersonCard(p, i + 1)).join('');
}

function buildPersonCard(person, rank) {
  const m        = State.metrics[person.id];
  const a        = State.analyses[person.id];
  const findings = State.findings || [];

  const isBridge    = findings.some(f => f.uid === person.id && f.type === 'BRIDGE');
  const isHidden    = findings.some(f => f.uid === person.id && f.type === 'HIDDEN_INFLUENCER');
  const isSentiment = findings.some(f => f.uid === person.id && f.type === 'INAUTHENTICITY');
  const isAsymmetric = findings.some(f => f.uid === person.id && f.type === 'ASYMMETRIC');

  let cardClass = 'pc-none', tag = '';
  if (person.flightRisk) { cardClass = 'pc-risk'; tag = '<span class="ptag t-risk" data-tip="HR-flagged departure risk, corroborated by network signals.">Flight risk</span>'; }
  else if (isBridge)  { cardClass = 'pc-bridge'; tag = '<span class="ptag t-bridge" data-tip="Highest betweenness centrality — information routes through this person more than anyone else.">Bridge node</span>'; }
  else if (isHidden)  { cardClass = 'pc-hidden'; tag = '<span class="ptag t-hidden" data-tip="Exercises more influence through private and DM channels than their public profile suggests.">Hidden influencer</span>'; }
  else if (isSentiment) { cardClass = 'pc-diverge'; tag = '<span class="ptag t-diverge" data-tip="Public messages are measurably more positive than private ones.">Sentiment gap</span>'; }
  else if (isAsymmetric) { cardClass = 'pc-diverge'; tag = '<span class="ptag t-diverge" data-tip="High degree but low reciprocity — broadcast-style communication pattern.">Low reciprocity</span>'; }

  const narrative = a?.narrative || '';
  const signal    = narrative
    ? narrative.split('. ').slice(0, 2).join('. ') + '.'
    : `${person.role || 'Team member'} in ${person.dept || 'this organization'}.`;

  const degree   = m?.full?.degree || 0;
  const recip    = Math.round((m?.full?.reciprocity || 0) * 100);
  const core     = m?.derived?.coreScore || 0;
  const hai      = Math.round((m?.derived?.hai || 0) * 100);
  const viLift   = m?.derived?.visibilityLift;

  let metricPills = `
    <div class="pcm" data-tip="Unique people communicated with across all channels"><span class="pcm-l">Connections</span><span class="pcm-v ${degree > 30 ? 'hi' : degree < 15 ? 'lo' : 'n'}">${degree}</span></div>
    <div class="pcm" data-tip="Fraction of outgoing communication that is reciprocated."><span class="pcm-l">Reciprocity</span><span class="pcm-v ${recip > 80 ? 'hi' : recip < 60 ? 'lo' : 'n'}">${recip}%</span></div>
    <div class="pcm" data-tip="Combined degree + eigenvector percentile."><span class="pcm-l">Core score</span><span class="pcm-v ${core > 75 ? 'hi' : core < 30 ? 'lo' : 'n'}">${core}</span></div>`;

  if (person.flightRisk && m?.derived?.managerProximity !== undefined) {
    const mp = Math.round((m.derived.managerProximity || 0) * 100);
    metricPills += `<div class="pcm" data-tip="DM contact directed at direct manager as fraction of top partner."><span class="pcm-l">Mgr proximity</span><span class="pcm-v ${mp < 10 ? 'lo' : mp < 25 ? 'md' : 'n'}">${mp}%</span></div>`;
  }
  if (isHidden || viLift !== undefined) {
    metricPills += `<div class="pcm" data-tip="Public minus private eigenvector centrality. Negative = hidden influencer."><span class="pcm-l">Vis. lift</span><span class="pcm-v ${viLift < -0.15 ? 'lo' : viLift > 0.15 ? 'hi' : 'n'}">${(viLift || 0).toFixed(2)}</span></div>`;
  }
  if (isBridge && m?.full?.betweenness !== undefined) {
    metricPills += `<div class="pcm" data-tip="Position on shortest paths between all other pairs."><span class="pcm-l">Betweenness</span><span class="pcm-v hi">${(m.full.betweenness || 0).toFixed(3)}</span></div>`;
  }
  metricPills += `<div class="pcm" data-tip="Fraction of activity in private channels or DMs."><span class="pcm-l">HAI</span><span class="pcm-v n">${hai}%</span></div>`;

  const questions = buildPersonQuestions(person, findings, m, a);
  // Escape signal text to prevent XSS from narrative content
  const safeSignal = safeMarkdown(signal);

  return `<div class="person-card ${cardClass}" onclick="openPersonModal('${person.id}')">
    <div>
      <div class="pc-top">
        <span class="pc-name">${person.name}</span>
        ${person.role ? `<span class="pc-title">${person.role}</span>` : ''}
        ${person.dept ? `<span class="pc-dept">${person.dept}</span>` : ''}
      </div>
      <div class="pc-signal">${safeSignal}</div>
      <div class="pc-mets">${metricPills}</div>
      <div class="pc-analyst">${questions}</div>
    </div>
    <div class="pc-right">${tag}</div>
  </div>`;
}

function buildPersonQuestions(person, findings, m, a) {
  const name      = person.name;
  const isBridge  = findings.some(f => f.uid === person.id && f.type === 'BRIDGE');
  const isHidden  = findings.some(f => f.uid === person.id && f.type === 'HIDDEN_INFLUENCER');
  const isSent    = findings.some(f => f.uid === person.id && f.type === 'INAUTHENTICITY');
  const qs = [];
  if (person.flightRisk) {
    qs.push(`Walk me through ${name}'s pre-departure behavioral signatures.`);
    qs.push(`What intervention, if any, does the data suggest for ${name}?`);
    qs.push(`Who in ${name}'s network might know what's going on?`);
  } else if (isBridge) {
    qs.push(`What happens to information flow if ${name} leaves?`);
    qs.push(`Who could develop into a secondary broker to reduce ${name}'s concentration risk?`);
    qs.push(`Is ${name} likely experiencing coordination overload given their structural position?`);
  } else if (isHidden) {
    qs.push(`Is ${name} a retention risk given the gap between their title and network position?`);
    qs.push(`Who makes up ${name}'s private network, and what does that tell us?`);
    qs.push(`What would ${name}'s departure cost the organization that isn't visible on the org chart?`);
  } else if (isSent) {
    qs.push(`What does ${name}'s sentiment pattern reveal about their relationship to this organization?`);
    qs.push(`Is the sentiment divergence around ${name} an individual pattern or a team dynamic?`);
  } else {
    qs.push(`What is ${name}'s informal role in the organization beyond their title?`);
    qs.push(`How central is ${name} to cross-departmental information flow?`);
  }
  return qs.slice(0, 3).map(q =>
    `<button class="pc-ask" onclick="event.stopPropagation();openAnalyst(${JSON.stringify(q)})">${q}</button>`
  ).join('');
}

// ── Person modal ──────────────────────────────────────────────────────────────
function openPersonModal(uid) {
  const person = State.people.find(p => p.id === uid);
  if (!person) return;
  const m     = State.metrics[uid];
  const a     = State.analyses[uid];
  const modal = document.getElementById('person-modal');
  const box   = document.getElementById('pm-box');

  const partners = (m?.topPartners || []).slice(0, 7).map(tp => {
    const partner = State.people.find(p => p.id === tp.id);
    return `<div class="pm-partner-row">
      <div class="pm-partner-name">${partner?.name || tp.name || tp.id}</div>
      <div class="pm-partner-msgs">${tp.count} interactions</div>
    </div>`;
  }).join('');

  const questions  = buildPersonQuestions(person, State.findings || [], m, a);
  const safeNarrative = a?.narrative ? safeMarkdown(a.narrative) : '';

  box.innerHTML = `
    <div class="pm-header">
      <div>
        <div class="pm-name">${person.name}</div>
        <div class="pm-role">${[person.role, person.dept, person.tenure ? person.tenure + ' tenure' : ''].filter(Boolean).join(' · ')}</div>
      </div>
      <button class="pm-close" onclick="document.getElementById('person-modal').classList.remove('open')">×</button>
    </div>
    ${a?.archetype ? `<div class="pm-archetype">Archetype: ${a.archetype}</div>` : ''}
    ${safeNarrative ? `<div class="pm-narrative">${safeNarrative}</div>` : ''}
    <div class="pm-section-label">Network metrics</div>
    <div class="pm-metrics-grid">
      <div class="pm-metric"><div class="pm-metric-val ${(m?.full?.degree || 0) > 30 ? 'hi' : 'n'}">${m?.full?.degree || '—'}</div><div class="pm-metric-label">Connections</div></div>
      <div class="pm-metric"><div class="pm-metric-val ${(m?.full?.reciprocity || 0) > 0.8 ? 'hi' : (m?.full?.reciprocity || 0) < 0.6 ? 'lo' : 'n'}">${Math.round((m?.full?.reciprocity || 0) * 100)}%</div><div class="pm-metric-label">Reciprocity</div></div>
      <div class="pm-metric"><div class="pm-metric-val n">${m?.derived?.coreScore || '—'}</div><div class="pm-metric-label">Core score</div></div>
      <div class="pm-metric"><div class="pm-metric-val n">${(m?.full?.betweenness || 0).toFixed(3)}</div><div class="pm-metric-label">Betweenness</div></div>
      <div class="pm-metric"><div class="pm-metric-val n">${Math.round((m?.derived?.hai || 0) * 100)}%</div><div class="pm-metric-label">HAI</div></div>
      <div class="pm-metric"><div class="pm-metric-val ${(m?.derived?.visibilityLift || 0) < -0.15 ? 'lo' : 'n'}">${(m?.derived?.visibilityLift || 0).toFixed(2)}</div><div class="pm-metric-label">Vis. lift</div></div>
      <div class="pm-metric"><div class="pm-metric-val n">${m?.derived?.influenceStability || '—'}</div><div class="pm-metric-label">Inf. stability</div></div>
      <div class="pm-metric"><div class="pm-metric-val n">${Math.round((m?.derived?.conversationInitiationRatio || 0) * 100)}%</div><div class="pm-metric-label">Initiates</div></div>
    </div>
    ${partners ? `<div class="pm-section-label">Top communication partners</div><div class="pm-partners">${partners}</div>` : ''}
    <div class="pm-section-label">Ask the analyst</div>
    <div class="pm-analyst">${questions}</div>`;

  modal.classList.add('open');
  modal.onclick = e => { if (e.target === modal) modal.classList.remove('open'); };
}

// ── Departments ───────────────────────────────────────────────────────────────
function renderDepartments() {
  const el = document.getElementById('screen-departments');
  if (!el || el.dataset.rendered) return;

  const depts = [...new Set(State.people.map(p => p.dept).filter(Boolean))].sort();
  if (depts.length === 0) {
    el.innerHTML = '<div style="padding:2rem;color:var(--text-muted);font-size:0.85rem;">No department data available. Upload an HR file with department information to enable this view.</div>';
    return;
  }

  // Fixed: use State.deptMetrics (not State.orgMetrics?.depts)
  const deptMetrics = State.deptMetrics || {};
  let html = '<div style="max-width:1100px;margin:0 auto;padding:2rem 3rem;">';
  html += '<div class="b-eyebrow" style="margin-bottom:1.5rem;">Department analysis</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.75rem;">';

  depts.forEach(dept => {
    const members = State.people.filter(p => p.dept === dept);
    const dm      = deptMetrics[dept] || {};
    const risks   = members.filter(p => p.flightRisk);
    const bridges = (State.findings || []).filter(f => f.type === 'BRIDGE' && members.some(m => m.id === f.uid));
    const hidden  = (State.findings || []).filter(f => f.type === 'HIDDEN_INFLUENCER' && members.some(m => m.id === f.uid));
    const topPerson = [...members].sort((a, b) => (State.metrics[b.id]?.derived?.coreScore || 0) - (State.metrics[a.id]?.derived?.coreScore || 0))[0];
    const avgCore   = members.length > 0 ? Math.round(members.reduce((s, p) => s + (State.metrics[p.id]?.derived?.coreScore || 0), 0) / members.length) : 0;
    const avgRecip  = members.length > 0 ? Math.round(members.reduce((s, p) => s + (State.metrics[p.id]?.full?.reciprocity || 0), 0) / members.length * 100) : 0;
    const flags = [];
    if (risks.length > 0)   flags.push(`<span class="ptag t-risk">${risks.length} flight risk</span>`);
    if (bridges.length > 0) flags.push(`<span class="ptag t-bridge">bridge node</span>`);
    if (hidden.length > 0)  flags.push(`<span class="ptag t-hidden">hidden influencer</span>`);

    html += `<div class="pattern-block pb-structural" style="cursor:pointer;" onclick="openAnalyst('Give me a detailed analysis of the ${dept} department — their internal communication patterns, key connectors, risks, and how they connect to the rest of the organization.')">
      <div class="pb-labels">
        <span class="pb-type structural">${dept}</span>
        <span class="pb-sep">·</span>
        <span style="font-size:0.65rem;color:var(--text-dim);">${members.length} people</span>
        ${flags.join('')}
      </div>
      <div class="pb-title">${topPerson ? `Led by ${topPerson.name} by network influence.` : dept + ' team.'}</div>
      <div class="pb-evidence" style="margin-bottom:0.5rem;">
        <div class="ev"><span class="ev-l">Avg core score</span><span class="ev-v n">${avgCore}</span></div>
        <div class="ev"><span class="ev-l">Avg reciprocity</span><span class="ev-v ${avgRecip > 80 ? 'hi' : avgRecip < 65 ? 'lo' : 'n'}">${avgRecip}%</span></div>
        <div class="ev"><span class="ev-l">Members</span><span class="ev-v n">${members.length}</span></div>
      </div>
      <div class="an-nudge" onclick="event.stopPropagation();openAnalyst('How does the ${dept} department connect to the rest of the organization, and what are the structural risks?')">
        <div class="an-btn">◈ Analyze ${dept}</div>
      </div>
    </div>`;
  });

  html += '</div></div>';
  el.innerHTML = html;
  el.dataset.rendered = '1';
}

// ── Reports ───────────────────────────────────────────────────────────────────
function renderReports() {
  const el = document.getElementById('screen-reports');
  if (!el || el.dataset.rendered) return;
  el.innerHTML = `<div style="max-width:1100px;margin:0 auto;padding:2rem 3rem;">
    <div class="b-eyebrow" style="margin-bottom:1.5rem;">Reports & exports</div>
    <div style="display:flex;flex-direction:column;gap:0.75rem;">
      <div class="pattern-block pb-structural" style="cursor:pointer;" onclick="downloadOrgReport()">
        <div class="pb-labels"><span class="pb-type structural">Organizational report</span></div>
        <div class="pb-title">Full org-level synthesis</div>
        <div class="pb-body" style="margin-bottom:0.5rem;">Network structure, key influencers, risks, department breakdown, and organizational synthesis. Plain text.</div>
        <div class="an-btn" style="display:inline-flex;">↓ Download org report</div>
      </div>
      <div class="pattern-block pb-hidden" style="cursor:pointer;" onclick="downloadEmployeeReport()">
        <div class="pb-labels"><span class="pb-type hidden">Employee report</span></div>
        <div class="pb-title">Per-person analysis — all ${State.people.length} people</div>
        <div class="pb-body" style="margin-bottom:0.5rem;">Individual metrics, top communication partners, archetype, and narrative for every person. Plain text.</div>
        <div class="an-btn" style="display:inline-flex;background:rgba(120,96,184,0.1);border-color:rgba(120,96,184,0.3);color:var(--purple);">↓ Download employee report</div>
      </div>
      <div class="pattern-block pb-healthy" style="cursor:pointer;" onclick="downloadMasterCSV()">
        <div class="pb-labels"><span class="pb-type healthy">Master data</span></div>
        <div class="pb-title">All metrics, all people — machine-readable</div>
        <div class="pb-body" style="margin-bottom:0.5rem;">Every computed metric for every person. CSV format for further analysis in Excel, R, or Python.</div>
        <div class="an-btn" style="display:inline-flex;background:rgba(61,168,112,0.1);border-color:rgba(61,168,112,0.3);color:var(--green);">↓ Download CSV</div>
      </div>
    </div>
  </div>`;
  el.dataset.rendered = '1';
}

// ── Analyst panel ─────────────────────────────────────────────────────────────
let analystHistory = [];

function initAnalyst(people, metrics, findings, analyses, orgMetrics) {
  const n     = people.length;
  const depts = new Set(people.map(p => p.dept).filter(Boolean)).size;
  document.getElementById('ap-sub').textContent = `Claude · ${n} people${depts > 0 ? ', ' + depts + ' depts' : ''} · full context · web search`;
  document.getElementById('ap-ctx').innerHTML = `<strong>Analysis complete.</strong> ${n} people${depts > 0 ? ' across ' + depts + ' departments' : ''}. ${findings.length} findings. All metrics and narratives loaded. Web search enabled for comparative and research-backed questions.`;

  const starters = [
    'Who would cause the most disruption if they left?',
    'Where are the structural holes no one is currently bridging?',
    'Which department is most structurally fragile?'
  ];
  if (people.some(p => p.flightRisk)) {
    const risk = people.find(p => p.flightRisk);
    starters.unshift(`Walk me through the ${risk.name} situation.`);
  }

  const startersEl = document.getElementById('ap-starters');
  startersEl.innerHTML = starters.slice(0, 3).map(q =>
    `<button class="ap-s" onclick="fireStarterQ(this)">${q}</button>`
  ).join('');
  analystHistory = [];
}

function fireStarterQ(btn) {
  const q = btn.textContent;
  btn.closest('.ap-starters').style.display = 'none';
  openAnalyst(q);
  sendAnalystMessage(q);
}

function openAnalyst(prefill) {
  document.getElementById('analyst-panel').classList.add('open');
  document.getElementById('analyst-float-btn').style.display = 'none';
  if (prefill) {
    const ta = document.getElementById('ap-textarea');
    ta.value = prefill; ta.focus();
  }
}

function closeAnalyst() {
  document.getElementById('analyst-panel').classList.remove('open');
  document.getElementById('analyst-float-btn').style.display = 'flex';
}

async function sendAnalystMessage(prefilled) {
  const ta   = document.getElementById('ap-textarea');
  const text = prefilled || ta.value.trim();
  if (!text) return;
  ta.value = '';

  const msgs = document.getElementById('ap-msgs');
  const starters = document.getElementById('ap-starters');
  if (starters) starters.style.display = 'none';

  const qEl = document.createElement('div');
  qEl.className = 'ap-q';
  qEl.textContent = text;
  msgs.appendChild(qEl);

  const thinkEl = document.createElement('div');
  thinkEl.className = 'ap-a';
  thinkEl.innerHTML = '<em style="color:var(--text-dim)">Thinking…</em>';
  msgs.appendChild(thinkEl);
  msgs.scrollTop = msgs.scrollHeight;

  analystHistory.push({ role: 'user', content: text });

  try {
    const systemPrompt = buildAnalystSystemPrompt(State.people, State.metrics, State.analyses, State.findings, State.orgMetrics);
    const body = {
      model:      CONFIG.MODEL_ID,
      max_tokens: CONFIG.ANALYST_MAX_TOKENS,
      system:     systemPrompt,
      messages:   analystHistory,
      // Web search enabled: analyst can retrieve current benchmarks and research
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: CONFIG.WEB_SEARCH_MAX_USES }],
    };

    const response = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': State.apiKey,
        'anthropic-version': CONFIG.API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    const data  = await response.json();
    const reply = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || 'No response.';
    analystHistory.push({ role: 'assistant', content: reply });
    // Strip citations, then safe-render markdown
    thinkEl.innerHTML = safeMarkdown(reply);
  } catch (e) {
    thinkEl.innerHTML = `<em style="color:var(--red)">Error: ${e.message}</em>`;
  }

  msgs.scrollTop = msgs.scrollHeight;
  document.getElementById('ap-send-btn').disabled = false;
}

// ── Downloads ─────────────────────────────────────────────────────────────────
function downloadMasterCSV() {
  const byId = new Map(State.people.map(p => [p.id, p]));
  const headers = [
    'id','name','dept','role','gender','tenure','perf','managerId','flightRisk',
    'degree_full','betweenness_full','eigenvector_full','reciprocity_full',
    'degree_public','betweenness_public','eigenvector_public','reciprocity_public',
    'degree_private','betweenness_private','eigenvector_private','reciprocity_private',
    'degree_direct','betweenness_direct','eigenvector_direct','reciprocity_direct',
    'hai','pei','influenceStability','visibilityLift','bridgingBias','coreScore',
    'managerProximity','peerReliance','topPartners','archetype',
  ];
  const rows = State.people.map(p => {
    const m = State.metrics[p.id] || {};
    const a = State.analyses[p.id] || {};
    const mgrName = byId.get(p.managerId)?.name || '';
    const partVals = ['full','public','private','direct'].flatMap(pt => [
      m[pt]?.degree || 0,
      (m[pt]?.betweenness || 0).toFixed(4),
      (m[pt]?.eigenvector || 0).toFixed(4),
      (m[pt]?.reciprocity || 0).toFixed(4),
    ]);
    return [
      p.id, p.name, p.dept || '', p.role || '', p.gender || '', p.tenure || '', p.perf || '',
      mgrName, p.flightRisk || false,
      ...partVals,
      (m.hai || 0).toFixed(4), (m.pei || 0).toFixed(4),
      (m.influenceStability || 0).toFixed(4), (m.visibilityLift || 0).toFixed(4),
      (m.bridgingBias || 0).toFixed(4), (m.coreScore || 0).toFixed(4),
      m.managerProximity != null ? m.managerProximity.toFixed(4) : '',
      (m.peerReliance || 0).toFixed(4),
      (m.topPartners || []).slice(0, 5).map(tp => tp.name).join(';'),
      a.archetype || '',
    ];
  });
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadFile('orgsignal_master_data.csv', csv, 'text/csv');
}

function downloadEmployeeReport() {
  const byId = new Map(State.people.map(p => [p.id, p]));
  const lines = [
    'ORGSIGNAL — EMPLOYEE REPORT',
    `Generated: ${new Date().toLocaleString()}`,
    `Scope: ${State.people.length} employees`, '',
    '═'.repeat(60), '    NETWORK-WIDE SUMMARY', '═'.repeat(60),
    `  Total people: ${State.people.length}`,
    `  Departments: ${[...new Set(State.people.map(p => p.dept).filter(Boolean))].join(', ')}`,
    `  Full network — mean degree: ${State.orgMetrics?.full?.meanDegree?.toFixed(0)}, reciprocity: ${(State.orgMetrics?.full?.meanReciprocity * 100 || 0).toFixed(0)}%`,
    `  Degree Gini (inequality): ${State.orgMetrics?.full?.giniDegree?.toFixed(3)}`, '',
  ];

  const sorted = [...State.people].sort((a, b) => (State.metrics[b.id]?.influenceStability || 0) - (State.metrics[a.id]?.influenceStability || 0));
  for (const p of sorted) {
    const m = State.metrics[p.id];
    const a = State.analyses[p.id];
    const mgrName  = byId.get(p.managerId)?.name || 'None';
    const flags    = (State.findings || []).filter(f => f.uids?.includes(p.id)).map(f => f.title).join('; ');
    const partners = (m?.topPartners || []).slice(0, 5).map(tp => `${tp.name} (${tp.count})`).join(', ');
    lines.push('─'.repeat(60), `  ${p.name.toUpperCase()}`, '─'.repeat(60));
    lines.push(`  Role: ${p.role || 'Unknown'}  |  Dept: ${p.dept || 'Unknown'}`);
    lines.push(`  Gender: ${p.gender || 'Unknown'}  |  Tenure: ${p.tenure || 'Unknown'}  |  Perf: ${p.perf || 'Unknown'}`);
    lines.push(`  Manager: ${mgrName}  |  Flight Risk: ${p.flightRisk ? 'YES' : 'No'}`);
    if (flags) lines.push(`  Flags: ${flags}`);
    lines.push('', `  Partners (top 5): ${partners || 'None'}`, '');
    for (const pt of ['full', 'public', 'private', 'direct']) {
      const pm = m?.[pt];
      if (pm) lines.push(`  [${pt.toUpperCase()}] degree=${pm.degree}  betweenness=${pm.betweenness.toFixed(3)}  reciprocity=${(pm.reciprocity * 100).toFixed(0)}%`);
    }
    if (a?.archetype) lines.push(`  Archetype: ${a.archetype}`);
    if (a?.narrative) {
      lines.push('', '  Analysis:', '');
      const words = a.narrative.split(' ');
      let line = '    ';
      for (const w of words) {
        if ((line + w).length > 90) { lines.push(line); line = '    ' + w + ' '; }
        else line += w + ' ';
      }
      if (line.trim()) lines.push(line);
    }
    lines.push('');
  }
  downloadFile('orgsignal_employee_report.txt', lines.join('\n'), 'text/plain');
}

function downloadOrgReport() {
  if (!State.orgAnalysis) { alert('Organizational synthesis not available.'); return; }
  const deptSummary = Object.entries(State.deptMetrics || {}).map(([dept, dm]) =>
    `  ${dept}: ${dm.count} people, core=${(dm.meanCoreScore * 100).toFixed(0)}th pct, reciprocity=${(dm.meanReciprocity * 100).toFixed(0)}%, HAI=${(dm.meanHAI * 100).toFixed(0)}%`
  ).join('\n');

  const topInfluencers = [...State.people].sort((a, b) => (State.metrics[b.id]?.derived?.influenceStability || 0) - (State.metrics[a.id]?.derived?.influenceStability || 0)).slice(0, 8);
  const topBridges     = [...State.people].sort((a, b) => (State.metrics[b.id]?.full?.betweenness || 0) - (State.metrics[a.id]?.full?.betweenness || 0)).slice(0, 5);
  const flightRisks    = State.people.filter(p => p.flightRisk === true || p.flightRisk === 'Yes');

  const lines = [
    'ORGSIGNAL — ORGANIZATIONAL REPORT',
    `Generated: ${new Date().toLocaleString()}`,
    `Organization: ${State.people.length} people, ${Object.keys(State.deptMetrics || {}).length} departments`, '',
    '═'.repeat(60), '1. NETWORK STRUCTURE', '═'.repeat(60), '',
    ...['full', 'public', 'private', 'direct'].map(pt => {
      const om = State.orgMetrics?.[pt]; if (!om) return '';
      return [`  ${pt.toUpperCase()}:`, `    Nodes: ${om.nodeCount}  Edges: ${om.edgeCount}  Mean degree: ${om.meanDegree?.toFixed(0)}  Gini: ${om.giniDegree?.toFixed(3)}  Reciprocity: ${(om.meanReciprocity * 100)?.toFixed(0)}%`, ''].join('\n');
    }),
    '═'.repeat(60), '2. TOP INFLUENCERS', '═'.repeat(60), '',
    ...topInfluencers.map(p => `  ${p.name} (${p.dept || '?'}): stability=${((State.metrics[p.id]?.derived?.influenceStability || 0) * 100).toFixed(0)}th pct, archetype: ${State.analyses[p.id]?.archetype || '?'}`),
    '', '  Top Bridge Nodes:',
    ...topBridges.map(p => `  ${p.name}: betweenness=${((State.metrics[p.id]?.full?.betweenness || 0)).toFixed(3)}`),
    '', '═'.repeat(60), '3. FLAGS AND RISKS', '═'.repeat(60), '',
    `  Flight Risk Flags (${flightRisks.length}):`,
    ...(flightRisks.length ? flightRisks.map(p => `    ${p.name}: mgrProximity=${State.metrics[p.id]?.derived?.managerProximity != null ? (State.metrics[p.id].derived.managerProximity * 100).toFixed(0) + '%' : 'N/A'}`) : ['    None']),
    '', ...State.findings.map(f => `  [${f.type}] ${f.title}\n  ${f.body}`),
    '', '═'.repeat(60), '4. DEPARTMENT BREAKDOWN', '═'.repeat(60), '',
    deptSummary, '',
    '═'.repeat(60), '5. ORGANIZATIONAL SYNTHESIS', '═'.repeat(60), '',
    (State.orgAnalysis || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^#{1,3}\s*/gm, ''),
  ];
  downloadFile('orgsignal_org_report.txt', lines.filter(l => l !== undefined).join('\n'), 'text/plain');
}

// ── Graph modal ───────────────────────────────────────────────────────────────
let simulation = null, currentView = 'full';

function setupGraphModal() {
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      renderGraph(currentView);
    });
  });
  document.getElementById('graph-color-select')?.addEventListener('change', () => renderGraph(currentView));
  document.getElementById('graph-size-select')?.addEventListener('change', () => renderGraph(currentView));
}

function openGraphModal() {
  document.getElementById('graph-modal').classList.add('open');
  if (State.graphData) setTimeout(() => renderGraph(currentView), 100);
}

function closeGraphModal() {
  document.getElementById('graph-modal').classList.remove('open');
  if (simulation) { simulation.stop(); simulation = null; }
}

function exportGraphSVG() {
  const svg = document.querySelector('#graph-container svg');
  if (!svg) return;
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.style.background = '#090b10';
  const svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  downloadFile('orgsignal_network.svg', svgStr, 'image/svg+xml;charset=utf-8');
}

function renderGraph(view) {
  const container = document.getElementById('graph-container');
  container.innerHTML = '';
  if (!State.graphData) return;
  const W = container.clientWidth, H = container.clientHeight;
  if (!W || !H) return;

  const colorMetric = document.getElementById('graph-color-select').value;
  const sizeMetric  = document.getElementById('graph-size-select').value;
  const nodes       = State.graphData.nodes.map(n => ({ ...n }));
  let rawLinks = State.graphData.links.map(l => ({
    source: typeof l.source === 'object' ? l.source.id : l.source,
    target: typeof l.target === 'object' ? l.target.id : l.target,
    weight: l.weight, type: l.type
  }));
  if (view !== 'full') rawLinks = rawLinks.filter(l => l.type === view);
  const filteredLinks = rawLinks.map(l => ({ ...l }));

  const depts     = [...new Set(nodes.map(n => n.dept).filter(Boolean))];
  const deptColor = d3.scaleOrdinal(d3.schemeTableau10).domain(depts);

  function nodeColor(d) {
    if (colorMetric === 'community') return deptColor(d.dept || 'Other');
    if (colorMetric === 'betweenness') return d3.interpolateRdYlGn(d.betweenness);
    if (colorMetric === 'reciprocity') return d3.interpolateBlues(d.reciprocity);
    if (colorMetric === 'dept') return deptColor(d.dept || 'Other');
    return '#6b9fd4';
  }
  function nodeRadius(d) {
    const base = 6;
    if (sizeMetric === 'degree')      return base + d.degree * 0.05;
    if (sizeMetric === 'betweenness') return base + d.betweenness * 14;
    if (sizeMetric === 'eigenvector') return base + d.eigenvector * 14;
    return base + d.coreScore * 8;
  }

  const svg = d3.select(container).append('svg').attr('width', W).attr('height', H);
  svg.append('defs').append('marker').attr('id', 'arrowhead').attr('viewBox', '0 -3 6 6').attr('refX', 12).attr('refY', 0).attr('markerWidth', 4).attr('markerHeight', 4).attr('orient', 'auto').append('path').attr('d', 'M0,-3L6,0L0,3').attr('fill', 'rgba(100,120,160,0.4)');
  const g = svg.append('g');
  svg.call(d3.zoom().scaleExtent([0.2, 4]).on('zoom', e => g.attr('transform', e.transform)));

  const link = g.append('g').selectAll('line').data(filteredLinks).join('line')
    .attr('stroke', l => l.type === 'direct' ? 'rgba(107,159,212,0.25)' : l.type === 'private' ? 'rgba(158,126,201,0.2)' : 'rgba(100,120,160,0.15)')
    .attr('stroke-width', l => Math.min(1 + l.weight * 0.03, 3));

  const node = g.append('g').selectAll('circle').data(nodes).join('circle')
    .attr('r', nodeRadius).attr('fill', nodeColor)
    .attr('stroke', d => d.flightRisk ? '#e05c5c' : 'rgba(255,255,255,0.15)')
    .attr('stroke-width', d => d.flightRisk ? 2.5 : 0.8)
    .attr('cursor', 'pointer')
    .call(d3.drag().on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }).on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; }).on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }));

  const label = g.append('g').selectAll('text').data(nodes.filter(n => n.coreScore > 0.5)).join('text')
    .attr('text-anchor', 'middle').attr('dy', '0.35em')
    .attr('font-size', 9).attr('fill', 'rgba(232,234,240,0.7)').attr('pointer-events', 'none')
    .text(d => d.name.split(' ')[0]);

  const tooltip = document.getElementById('tooltip');
  node.on('mouseover', (event, d) => {
    tooltip.style.display = 'block';
    tooltip.innerHTML = `<div class="tooltip-name">${d.name}</div>
      <div class="tooltip-row"><span class="tooltip-lbl">${d.role || ''}</span></div>
      <div class="tooltip-row"><span class="tooltip-lbl">Dept</span><span class="tooltip-val">${d.dept || '?'}</span></div>
      <div class="tooltip-row"><span class="tooltip-lbl">Connections</span><span class="tooltip-val">${d.degree}</span></div>
      <div class="tooltip-row"><span class="tooltip-lbl">Core score</span><span class="tooltip-val">${(d.coreScore * 100).toFixed(0)}</span></div>
      ${d.flightRisk ? '<div style="color:#e05c5c;margin-top:4px;font-size:0.7rem;">⚠ Flight risk flag</div>' : ''}`;
  }).on('mousemove', event => {
    tooltip.style.left = (event.clientX + 14) + 'px';
    tooltip.style.top  = (event.clientY - 28) + 'px';
  }).on('mouseout', () => { tooltip.style.display = 'none'; })
    .on('mouseover.highlight', (event, d) => {
      const connected = new Set(filteredLinks.filter(l => l.source.id === d.id || l.target.id === d.id).flatMap(l => [l.source.id, l.target.id]));
      node.attr('opacity', n => connected.has(n.id) || n.id === d.id ? 1 : 0.2);
      link.attr('opacity', l => l.source.id === d.id || l.target.id === d.id ? 0.9 : 0.05);
    }).on('mouseout.highlight', () => { node.attr('opacity', 1); link.attr('opacity', 1); })
    .on('click', (event, d) => { closeGraphModal(); setTimeout(() => openPersonModal(d.id), 100); });

  if (simulation) simulation.stop();
  const maxWeight = Math.max(...filteredLinks.map(l => l.weight || 1));
  const sparseLinks = filteredLinks.filter(l => (l.weight || 1) >= Math.max(2, maxWeight * 0.05));
  simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(sparseLinks).id(d => d.id).distance(80).strength(0.15))
    .force('charge', d3.forceManyBody().strength(-400).distanceMax(400))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + 8))
    .on('tick', () => {
      link.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      node.attr('cx', d => d.x).attr('cy', d => d.y);
      label.attr('x', d => d.x).attr('y', d => d.y - nodeRadius(d) - 4);
    });
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupFileHandlers();
  document.getElementById('api-key-input').addEventListener('input', checkReady);
  // Graph modal view buttons (present in static HTML)
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      renderGraph(currentView);
    });
  });
  document.getElementById('graph-color-select')?.addEventListener('change', () => renderGraph(currentView));
  document.getElementById('graph-size-select')?.addEventListener('change', () => renderGraph(currentView));
});
