'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// OrgSignal — Helpers
// Pure utility functions: citation stripping, JSON repair, safe HTML rendering,
// Claude API wrapper, file utilities, and Slack/HR data ingestion.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Citation stripping ────────────────────────────────────────────────────────
// Must run BEFORE any JSON parse attempt and BEFORE any innerHTML render.
// Handles: <cite index="N">text</cite>, <cite index="N"/>, bare [N] footnotes.
function stripCitations(text) {
  if (!text) return text;
  // Remove <cite index="...">inner text</cite> — keep inner text
  let out = text.replace(/<cite\s+index="[^"]*">([^<]*)<\/cite>/gi, '$1');
  // Remove self-closing <cite index="..."/>
  out = out.replace(/<cite\s+index="[^"]*"\s*\/>/gi, '');
  // Remove residual empty cite tags
  out = out.replace(/<cite[^>]*>/gi, '').replace(/<\/cite>/gi, '');
  return out;
}

// ── JSON repair ───────────────────────────────────────────────────────────────
// Attempts to extract the first complete {...} block from a malformed response.
// Returns parsed object/array on success, null on failure.
function repairJson(text) {
  if (!text) return null;

  // Strip citations first so they don't confuse the parser
  const clean = stripCitations(text);

  // Strip markdown code fences
  const stripped = clean.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Try direct parse
  try { return JSON.parse(stripped); } catch (_) {}

  // Try to extract first complete { } block
  const objMatch = stripped.match(/(\{[\s\S]*\})/);
  if (objMatch) {
    try { return JSON.parse(objMatch[1]); } catch (_) {}
  }

  // Try to extract first complete [ ] block
  const arrMatch = stripped.match(/(\[[\s\S]*\])/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[1]); } catch (_) {}
  }

  return null;
}

// ── Safe markdown rendering ───────────────────────────────────────────────────
// Escapes HTML, then applies minimal safe markdown transforms.
// Use instead of raw innerHTML = response to prevent XSS.
function safeMarkdown(text) {
  if (!text) return '';
  // Strip citations before rendering
  const clean = stripCitations(text);
  // HTML-escape
  const escaped = clean
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  // Convert **bold** to <strong>
  const bolded = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Convert line breaks
  return bolded.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
}

// ── Claude API wrapper ────────────────────────────────────────────────────────
async function callClaude(prompt, maxTokens = 1000, systemPrompt = null, useWebSearch = false) {
  const messages = [{ role: 'user', content: prompt }];
  const body = {
    model:      CONFIG.MODEL_ID,
    max_tokens: maxTokens,
    messages,
  };
  if (systemPrompt) body.system = systemPrompt;
  if (useWebSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: CONFIG.WEB_SEARCH_MAX_USES }];
  }

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

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${response.status}`);
  }

  const data = await response.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Slack ZIP parser ──────────────────────────────────────────────────────────
async function parseSlackZip(file) {
  const zip = await JSZip.loadAsync(file);
  const messages = [];

  const usersFile = zip.file('users.json');
  let slackUsers = [];
  if (usersFile) {
    try { slackUsers = JSON.parse(await usersFile.async('text')); } catch (_) {}
  }

  const userMap = {};
  for (const u of slackUsers) {
    userMap[u.id] = u.real_name || u.name || u.id;
  }

  const chanFile = zip.file('channels.json');
  let chanList = [];
  if (chanFile) {
    try { chanList = JSON.parse(await chanFile.async('text')); } catch (_) {}
  }
  const channelMeta = {};
  for (const c of chanList) {
    channelMeta[c.name || c.id] = { type: 'public', members: c.members || [] };
  }

  const fileList = [];
  zip.forEach((path, entry) => { if (!entry.dir) fileList.push({ path, entry }); });

  for (const { path, entry } of fileList) {
    if (!path.endsWith('.json')) continue;
    if (path === 'users.json' || path === 'channels.json' || path === 'integration_logs.json') continue;

    let msgs;
    try { msgs = JSON.parse(await entry.async('text')); } catch (_) { continue; }
    if (!Array.isArray(msgs)) continue;

    const parts = path.split('/').filter(Boolean);
    let channelName, channelType;

    if (parts[0] === 'dms' || parts[0] === 'direct_messages') {
      channelType = 'direct';
      channelName = parts[1] || parts[0];
    } else if (parts[0] === 'private_channels' || parts[0] === 'mpims') {
      channelType = 'private';
      channelName = parts[1] || parts[0];
    } else if (parts.length >= 2) {
      channelType = 'public';
      channelName = parts[0];
    } else {
      continue;
    }

    for (const m of msgs) {
      if (m.type !== 'message' && !m.user) continue;
      if (!m.user) continue;
      messages.push({
        user:        m.user,
        name:        m.user_profile?.real_name || userMap[m.user] || m.user,
        text:        m.text || '',
        ts:          parseFloat(m.ts || 0),
        channel:     channelName,
        channelType,
        parentUser:  m.parent_user_id || null,
        threadTs:    m.thread_ts || null,
      });
    }
  }

  return { messages, userMap, slackUsers };
}

// ── HR normalization ──────────────────────────────────────────────────────────
async function normalizeHRWithClaude(rawText, knownUserIds, knownNames) {
  const stepId = procStep('Normalizing HR data…', 'running');

  // Fast path: if CSV has expected column names, parse directly without Claude
  const lines = rawText.trim().split(/\r?\n/);
  const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
  const uidCol = headers.findIndex(h => ['userid', 'user_id', 'slack_id', 'id'].includes(h));

  if (uidCol >= 0) {
    const nameCol    = headers.indexOf('fullname') >= 0 ? headers.indexOf('fullname') : headers.indexOf('name');
    const deptCol    = headers.indexOf('dept') >= 0 ? headers.indexOf('dept') : headers.indexOf('department');
    const roleCol    = headers.indexOf('role') >= 0 ? headers.indexOf('role') : headers.indexOf('title');
    const genderCol  = headers.indexOf('gender');
    const tenureCol  = headers.indexOf('tenure');
    const perfCol    = headers.indexOf('perf_rating') >= 0 ? headers.indexOf('perf_rating') : headers.indexOf('perf');
    const managerCol = headers.indexOf('manager_id') >= 0 ? headers.indexOf('manager_id') : headers.indexOf('managerid');
    const riskCol    = headers.indexOf('flight_risk_flag') >= 0 ? headers.indexOf('flight_risk_flag') : headers.indexOf('flightrisk');

    const parseVal  = (row, col) => col >= 0 && row[col] ? row[col].replace(/"/g, '').trim() : null;
    const parseBool = v => v ? ['yes', 'true', '1'].includes(v.toLowerCase()) : null;

    const hrPeople = lines.slice(1).filter(l => l.trim()).map(line => {
      const row = line.split(',');
      const risk = parseVal(row, riskCol);
      return {
        id:         parseVal(row, uidCol),
        name:       parseVal(row, nameCol),
        dept:       parseVal(row, deptCol),
        role:       parseVal(row, roleCol),
        gender:     parseVal(row, genderCol),
        tenure:     parseVal(row, tenureCol),
        perf:       parseVal(row, perfCol),
        managerId:  parseVal(row, managerCol),
        flightRisk: parseBool(risk),
        notes:      null,
      };
    }).filter(p => p.id);

    procUpdate(stepId, `HR data parsed directly — ${hrPeople.length} records (userid column detected)`);
    return hrPeople;
  }

  // Fallback: use Claude to normalize unknown format
  const prompt = buildHRNormalizationPrompt(rawText, knownUserIds, knownNames);
  const response = await callClaude(prompt, CONFIG.HR_NORMALIZE_MAX_TOKENS);
  const cleaned = stripCitations(response);
  const hrPeople = repairJson(cleaned);

  if (!Array.isArray(hrPeople)) {
    procUpdate(stepId, `HR normalization: could not parse response`, 'warn');
    return [];
  }

  procUpdate(stepId, `HR data normalized — ${hrPeople.length} records matched`);
  return hrPeople;
}

// ── People inference and merging ──────────────────────────────────────────────
function inferPeopleFromSlack(messages) {
  const seen = new Map();
  for (const m of messages) {
    if (!seen.has(m.user)) seen.set(m.user, { name: m.name, msgCount: 0 });
    seen.get(m.user).msgCount++;
  }
  return Array.from(seen.entries()).map(([id, v]) => ({
    id, name: v.name, msgCount: v.msgCount,
    dept: null, role: null, gender: null, tenure: null,
    perf: null, managerId: null, flightRisk: null, notes: null,
  }));
}

function mergePeople(slackPeople, hrPeople) {
  const byId   = new Map(slackPeople.map(p => [p.id, { ...p }]));
  const byName = new Map(slackPeople.map(p => [p.name.toLowerCase(), p.id]));

  for (const hr of hrPeople) {
    let uid = hr.id;
    if (!uid || !byId.has(uid)) {
      const key = (hr.name || '').toLowerCase();
      uid = byName.get(key);
      if (!uid) {
        for (const [nm, id] of byName) {
          if (nm.includes(key.split(' ')[0]) || key.includes(nm.split(' ')[0])) {
            uid = id; break;
          }
        }
      }
    }
    if (uid && byId.has(uid)) {
      const p = byId.get(uid);
      p.dept       = hr.dept      || p.dept;
      p.role       = hr.role      || p.role;
      p.gender     = hr.gender    || p.gender;
      p.tenure     = hr.tenure    || p.tenure;
      p.perf       = hr.perf      || p.perf;
      p.managerId  = hr.managerId || p.managerId;
      p.flightRisk = hr.flightRisk != null ? hr.flightRisk : p.flightRisk;
      p.notes      = hr.notes     || p.notes;
    }
  }

  return Array.from(byId.values()).filter(p => p.msgCount > CONFIG.MIN_MESSAGES_FOR_PERSON);
}
