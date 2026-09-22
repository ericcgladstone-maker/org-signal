'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// OrgSignal — Synthetic Data Generator
// Generates realistic synthetic Slack + HR data for demos and testing.
// All parameters are in GENERATOR_CONFIG (js/orgdata.js).
// ═══════════════════════════════════════════════════════════════════════════════

function gRand(arr)          { return arr[Math.floor(Math.random() * arr.length)]; }
function gRandInt(min, max)  { return Math.floor(Math.random() * (max - min + 1)) + min; }
function gFill(tmpl, vars)   { return tmpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] || k); }

function genVars(sender, receiver) {
  return {
    project:     gRand(['Q2 roadmap', 'sprint 14', 'the migration', 'launch prep', 'the audit', 'onboarding flow']),
    task:        gRand(['the review', 'the analysis', 'the writeup', 'the integration', 'the report']),
    topic:       gRand(['the timeline', 'resourcing', 'the process', 'priorities', 'the feedback']),
    dept:        receiver ? receiver.dept : 'the team',
    dept1:       sender.dept,
    dept2:       receiver ? receiver.dept : 'Product',
    name:        receiver ? receiver.name.split(' ')[0] : 'team',
    date:        gRand(['Friday', 'end of month', 'next week', 'the 15th']),
    day:         gRand(['Monday', 'Tuesday', 'Wednesday', 'Thursday']),
    time:        gRand(['10am', '2pm', '3pm', '11am']),
    meeting:     gRand(['standup', 'sprint review', 'all-hands', '1:1', 'sync']),
    status:      gRand(['on track', 'slightly behind', 'blocked on design', 'waiting on approval']),
    metric:      gRand(['engagement', 'conversion', 'response time', 'coverage']),
    next_task:   gRand(['QA', 'review', 'deployment', 'sign-off']),
    deliverable: gRand(['the brief', 'the deck', 'the spec', 'the report']),
    issue:       gRand(['the timeline slipping', 'the resourcing gap', 'the misalignment']),
    concern:     gRand(['the pace of decisions', 'the communication gaps', 'the unclear ownership']),
    question:    gRand(['who owns this', 'what the timeline is', 'whether this is the right approach']),
    mention:     receiver ? receiver.name.split(' ')[0] : 'team',
  };
}

function buildSyntheticPeople(n, deptNames) {
  const usedNames = new Set();
  const people = [];
  const deptList = deptNames.slice(0, Math.min(deptNames.length, 9));

  const deptSizes = {};
  deptList.forEach(d => deptSizes[d] = 0);
  for (let i = 0; i < n; i++) deptSizes[deptList[i % deptList.length]]++;

  let idx = 0;
  for (const dept of deptList) {
    const count = deptSizes[dept];
    const roles = GEN_ROLES[dept] || ['Manager', 'Specialist', 'Lead'];
    for (let i = 0; i < count; i++) {
      let name;
      do { name = `${gRand(GEN_FIRST_NAMES)} ${gRand(GEN_LAST_NAMES)}`; } while (usedNames.has(name));
      usedNames.add(name);
      const id = `U${String(idx + 1).padStart(3, '0')}`;
      const role = i === 0 ? roles[roles.length - 1] : gRand(roles.slice(0, -1));
      people.push({
        id, name, dept, role,
        tenure: gRand(['<1', '1-3', '3-5', '5+']),
        perf: gRand(['High', 'High', 'Medium', 'Medium', 'Low']),
        flightRisk: false,
        isLead: i === 0,
      });
      idx++;
    }
  }

  const exec = people.find(p => p.dept === 'Executive') || people[0];
  const byDept = {};
  for (const p of people) { if (!byDept[p.dept]) byDept[p.dept] = []; byDept[p.dept].push(p); }
  for (const dept of Object.keys(byDept)) {
    const lead = byDept[dept].find(p => p.isLead) || byDept[dept][0];
    lead.managerId = exec.id;
    byDept[dept].filter(p => p.id !== lead.id).forEach(p => p.managerId = lead.id);
  }

  return people;
}

function applyGenStructure(people, structure, flightRisk, sentimentDiv) {
  const frCount = flightRisk === 'none' ? 0 : flightRisk === 'mild' ? 1 : 3;
  const frCandidates = people.filter(p => !p.isLead && p.dept !== 'Executive');
  const shuffled = [...frCandidates].sort(() => Math.random() - 0.5);
  for (let i = 0; i < Math.min(frCount, shuffled.length); i++) shuffled[i].flightRisk = true;

  const sdCount = sentimentDiv === 'low' ? 0 : sentimentDiv === 'moderate' ? 2 : 4;
  const sdCandidates = people.filter(p => !p.flightRisk).sort(() => Math.random() - 0.5);
  for (let i = 0; i < Math.min(sdCount, sdCandidates.length); i++) sdCandidates[i].sentDivergent = true;

  const leads = people.filter(p => p.isLead);
  if (structure === 'bridge-dependent') {
    if (leads[0]) leads[0].isBridge = true;
  } else if (structure === 'random' && leads.length) {
    gRand(leads).isBridge = true;
  }

  return people;
}

function buildSyntheticMessages(people, densityCfg, structure) {
  const byId = {};
  for (const p of people) byId[p.id] = p;
  const byDept = {};
  for (const p of people) { if (!byDept[p.dept]) byDept[p.dept] = []; byDept[p.dept].push(p.id); }
  const bridges = people.filter(p => p.isBridge).map(p => p.id);
  const leads   = people.filter(p => p.isLead).map(p => p.id);
  const now     = Date.now() / 1000;
  const messages = [];

  // Compute crossRatio once — structure is fixed for the whole generator run
  const crossRatio = structure === 'siloed' ? 0.04 : structure === 'bridge-dependent' ? 0.07 : 0.16;

  for (const person of people) {
    const deptPeers = byDept[person.dept].filter(id => id !== person.id);
    const others    = people.filter(p => p.dept !== person.dept).map(p => p.id);
    const total     = densityCfg.msgsPerPerson;
    const indivMult = 0.65 + Math.random() * 0.7;

    // Public within-dept (fixed from crossRatio computed above)
    const pubWithin = Math.floor(total * (1 - densityCfg.privateRatio - densityCfg.dmRatio - crossRatio) * indivMult);
    for (let i = 0; i < pubWithin; i++) {
      if (!deptPeers.length) continue;
      const pubPeers = person.flightRisk
        ? deptPeers.filter(id => id !== person.managerId)
        : deptPeers;
      if (!pubPeers.length) continue;
      const target = gRand(pubPeers);
      const vars   = genVars(person, byId[target]);
      const text   = person.isBridge && Math.random() < 0.4
        ? gFill(gRand(GEN_MSG.public_bridge), vars)
        : gFill(gRand(GEN_MSG.public_normal), vars);
      const chan = person.dept.toLowerCase().replace(/\s+/g, '-');
      messages.push({ user: person.id, text, ts: (now - gRandInt(0, 60 * 86400)).toFixed(6), channelPath: chan, channelType: 'public', target });
    }

    // Public cross-dept
    const pubCross = Math.floor(total * crossRatio * indivMult);
    for (let i = 0; i < pubCross; i++) {
      if (!others.length) continue;
      let target;
      if (structure === 'bridge-dependent' && bridges.length && Math.random() < 0.65) target = gRand(bridges);
      else if (structure === 'distributed' && leads.length) target = gRand(leads);
      else target = gRand(others);
      const vars = genVars(person, byId[target]);
      const text = person.isBridge && Math.random() < 0.4
        ? gFill(gRand(GEN_MSG.public_bridge), vars)
        : gFill(gRand(GEN_MSG.public_normal), vars);
      const chan = person.dept.toLowerCase().replace(/\s+/g, '-');
      messages.push({ user: person.id, text, ts: (now - gRandInt(0, 60 * 86400)).toFixed(6), channelPath: chan, channelType: 'public', target });
    }

    // Private
    const privateMultiplier = person.flightRisk ? 1.6 : 1.0;
    const privCount = Math.floor(total * densityCfg.privateRatio * indivMult * privateMultiplier);
    const privPool  = [...deptPeers, ...others.slice(0, 5)];
    for (let i = 0; i < privCount; i++) {
      if (!privPool.length) continue;
      const target = gRand(privPool);
      const vars   = genVars(person, byId[target]);
      const text   = person.flightRisk && Math.random() < 0.45
        ? gFill(gRand(GEN_MSG.private_flight), vars)
        : gFill(gRand(GEN_MSG.private_normal), vars);
      const chan = `private-${person.dept.toLowerCase().replace(/\s+/g, '-')}`;
      messages.push({ user: person.id, text, ts: (now - gRandInt(0, 60 * 86400)).toFixed(6), channelPath: `private_channels/${chan}`, channelType: 'private', target });
    }

    // DMs
    const dmCount = Math.floor(total * densityCfg.dmRatio * indivMult);
    let dmPool;
    if (person.flightRisk) {
      dmPool = others.filter(id => id !== person.managerId);
    } else {
      const managerArr = person.managerId ? Array(4).fill(person.managerId) : [];
      dmPool = [...deptPeers, ...managerArr].filter(Boolean);
    }
    for (let i = 0; i < dmCount; i++) {
      if (!dmPool.length) continue;
      const target  = gRand(dmPool);
      const vars    = genVars(person, byId[target]);
      const text    = person.flightRisk && Math.random() < 0.35
        ? gFill(gRand(GEN_MSG.dm_flight), vars)
        : gFill(gRand(GEN_MSG.dm_normal), vars);
      const members = [person.id, target].sort().join('-');
      messages.push({ user: person.id, text, ts: (now - gRandInt(0, 60 * 86400)).toFixed(6), channelPath: `dms/${members}`, channelType: 'direct', target });
    }
  }

  return messages;
}

async function generateSyntheticData(config) {
  const { size, structure, density, flightRisk, sentimentDiv } = config;
  const sizeCfg    = GENERATOR_CONFIG.sizes[size];
  const densityCfg = GENERATOR_CONFIG.density[density];
  const deptNames  = GEN_DEPT_NAMES.slice(0, sizeCfg.depts);

  let people = buildSyntheticPeople(sizeCfg.n, deptNames);
  people = applyGenStructure(people, structure, flightRisk, sentimentDiv);
  const messages = buildSyntheticMessages(people, densityCfg, structure);

  const zip = new JSZip();

  zip.file('users.json', JSON.stringify(people.map(p => ({
    id: p.id, name: p.name.toLowerCase().replace(' ', '.'),
    real_name: p.name, profile: { real_name: p.name, title: p.role }
  }))));

  const deptChannels = deptNames.map(d => ({
    id:      'C' + Math.random().toString(36).substr(2, 8).toUpperCase(),
    name:    d.toLowerCase().replace(/\s+/g, '-'),
    members: people.filter(p => p.dept === d).map(p => p.id),
  }));
  zip.file('channels.json', JSON.stringify(deptChannels));

  const byChannel = {};
  for (const m of messages) {
    if (!byChannel[m.channelPath]) byChannel[m.channelPath] = [];
    byChannel[m.channelPath].push({
      type: 'message', user: m.user, text: m.text, ts: m.ts,
      ...(m.target ? { parent_user_id: m.target } : {}),
    });
  }
  for (const [path, msgs] of Object.entries(byChannel)) {
    zip.file(`${path}/messages.json`, JSON.stringify(msgs));
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });

  const hrRows = ['userid,name,dept,role,tenure,perf,manager_id,flight_risk_flag'];
  for (const p of people) {
    hrRows.push(`${p.id},${p.name},${p.dept},${p.role},${p.tenure},${p.perf},${p.managerId || ''},${p.flightRisk ? 'Yes' : 'No'}`);
  }
  const hrBlob = new Blob([hrRows.join('\n')], { type: 'text/csv' });

  return { zipBlob, hrBlob, people, messageCount: messages.length };
}
