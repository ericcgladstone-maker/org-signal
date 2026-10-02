// Org Signal internal data model.
//
// Every source (importers, hand builders, the synthetic generator) writes a
// Dataset through DatasetBuilder. Every analysis reads a Dataset. Nothing else
// is shared, so this file is the contract between the halves of the app.
//
// Shape (after build()):
//   meta        { name, createdAt, sources: SourceInfo[] }
//   nodes       { count, keys[], labels[], attrs[{}], isBot Uint8Array, platformIds[{}] }
//   attributeSchema  [{ key, type, label, values? }]   inferred from node attrs
//   contexts    { count, keys[], names[], kinds[], visibility Uint8Array, medium[], members[] }
//   events      columnar; see EventColumns below
//
// Events are stored column-wise in typed arrays so a few million of them fit
// in memory and can be handed to a Web Worker without copying.

export const EVENT_TYPES = ['message', 'copresence', 'declared', 'reaction', 'repost', 'like', 'follow', 'join', 'leave'];
export const ROLES = ['to', 'cc', 'bcc', 'mention', 'reply', 'dm', 'attendee', 'member', 'declared', 'subject'];
export const VISIBILITY = ['public', 'private', 'direct', 'group', 'unknown'];

// What kind of slice of a network a source shows. Measures check this.
export const VIEWS = {
  FULL: 'full',         // a bounded group, everyone's interactions (admin Slack export, roster survey)
  EGO: 'ego',           // one person's interactions with others (mailbox, X archive, LinkedIn)
  CHAT: 'chat',         // one conversation (a single WhatsApp export)
  SAMPLE: 'sample',     // a sample of a larger population (research datasets)
  AUTHORED: 'authored', // only what one account wrote (Bluesky repo, Discord package)
};

export const CONTEXTS = ['workplace', 'online', 'professional', 'personal', 'community', 'survey', 'custom'];

const typeIndex = Object.fromEntries(EVENT_TYPES.map((t, i) => [t, i]));
const roleIndex = Object.fromEntries(ROLES.map((r, i) => [r, i]));
const visIndex = Object.fromEntries(VISIBILITY.map((v, i) => [v, i]));

export class DatasetBuilder {
  constructor({ name = 'Untitled', source } = {}) {
    this.name = name;
    this.sources = [];
    this._source = -1;
    this._nodeIndex = new Map();
    this.nodes = { keys: [], labels: [], attrs: [], isBot: [], platformIds: [] };
    this._ctxIndex = new Map();
    this.contexts = { keys: [], names: [], kinds: [], visibility: [], medium: [], members: [] };
    this.ev = { type: [], t: [], actor: [], context: [], parentKey: [], weight: [], source: [], tOff: [0], tgt: [], role: [], text: [], keys: [] };
    this._eventKeyIndex = new Map();
    if (source) this.beginSource(source);
  }

  // Start a new source. Importers call this once per input they read.
  // info: { format, family, medium, view, context, tz, fileNames[], egoKey? }
  beginSource(info) {
    const s = { id: this.sources.length, format: 'unknown', family: 'custom', medium: 'unknown', view: VIEWS.FULL,
      context: 'custom', tz: 'UTC', fileNames: [], egoKey: null, counts: {}, warnings: [], ...info };
    this.sources.push(s);
    this._source = s.id;
    return s.id;
  }

  get source() { return this.sources[this._source]; }

  // Record a problem the import report should show. Repeated codes are counted, not duplicated.
  warn(code, message, count = 1) {
    const w = this.source.warnings.find(x => x.code === code);
    if (w) w.count += count; else this.source.warnings.push({ code, message, count });
  }

  stat(name, inc = 1) { this.source.counts[name] = (this.source.counts[name] || 0) + inc; }

  // Add or update a node. key must be namespaced, e.g. 'slack:U012AB' or 'email:ann@x.org'.
  // Returns the node index. Later calls merge label, attrs and platform ids.
  node(key, { label, attrs, isBot, platformIds } = {}) {
    let i = this._nodeIndex.get(key);
    if (i === undefined) {
      i = this.nodes.keys.length;
      this._nodeIndex.set(key, i);
      this.nodes.keys.push(key);
      this.nodes.labels.push(label ?? key.slice(key.indexOf(':') + 1));
      this.nodes.attrs.push({});
      this.nodes.isBot.push(0);
      this.nodes.platformIds.push({});
    } else if (label && this.nodes.labels[i] === key.slice(key.indexOf(':') + 1)) {
      this.nodes.labels[i] = label;
    }
    if (attrs) for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== '') this.nodes.attrs[i][k] = v;
    if (isBot) this.nodes.isBot[i] = 1;
    if (platformIds) Object.assign(this.nodes.platformIds[i], platformIds);
    return i;
  }

  hasNode(key) { return this._nodeIndex.has(key); }
  nodeIndex(key) { return this._nodeIndex.get(key) ?? -1; }

  // Add or update a context (channel, DM, email thread, meeting, chat, subreddit...).
  context(key, { name, kind = 'channel', visibility = 'unknown', medium, members } = {}) {
    let i = this._ctxIndex.get(key);
    if (i === undefined) {
      i = this.contexts.keys.length;
      this._ctxIndex.set(key, i);
      this.contexts.keys.push(key);
      this.contexts.names.push(name ?? key);
      this.contexts.kinds.push(kind);
      this.contexts.visibility.push(visIndex[visibility] ?? visIndex.unknown);
      this.contexts.medium.push(medium ?? this.source?.medium ?? 'unknown');
      this.contexts.members.push(members ? [...members] : null);
    } else {
      if (name) this.contexts.names[i] = name;
      if (members) this.contexts.members[i] = [...new Set([...(this.contexts.members[i] || []), ...members])];
    }
    return i;
  }

  contextIndex(key) { return this._ctxIndex.get(key) ?? -1; }

  // Add an event.
  //   type      one of EVENT_TYPES
  //   t         ms since epoch, UTC. NaN or null when unknown.
  //   actor     node index (who acted)
  //   targets   [[nodeIndex, role], ...]  role one of ROLES
  //   context   context index or -1
  //   key       optional unique string so other events can name this one as parent
  //   parentKey optional key of the event this replies to / reposts / reacts to
  //   text      optional message text
  //   weight    optional, default 1 (e.g. survey closeness, reaction count)
  event({ type = 'message', t = NaN, actor, targets = [], context = -1, key = null, parentKey = null, text = null, weight = 1 }) {
    const ty = typeIndex[type];
    if (ty === undefined) throw new Error(`Unknown event type: ${type}`);
    if (!(actor >= 0)) throw new Error('event() needs an actor node index');
    const ev = this.ev;
    const i = ev.type.length;
    ev.type.push(ty);
    ev.t.push(t == null ? NaN : t);
    ev.actor.push(actor);
    ev.context.push(context);
    ev.parentKey.push(parentKey);
    ev.weight.push(weight);
    ev.source.push(this._source);
    for (const [n, r] of targets) {
      const ri = roleIndex[r];
      if (ri === undefined) throw new Error(`Unknown role: ${r}`);
      if (n === actor || !(n >= 0)) continue;
      ev.tgt.push(n); ev.role.push(ri);
    }
    ev.tOff.push(ev.tgt.length);
    ev.text.push(text);
    ev.keys.push(key);
    if (key != null) this._eventKeyIndex.set(key, i);
    return i;
  }

  eventIndex(key) { return this._eventKeyIndex.get(key) ?? -1; }

  build() {
    const ev = this.ev;
    const n = ev.type.length;
    // Resolve parent keys to indices. Parents missing from the data are counted per source.
    const parent = new Int32Array(n).fill(-1);
    const unresolved = new Map();
    for (let i = 0; i < n; i++) {
      const pk = ev.parentKey[i];
      if (pk == null) continue;
      const p = this._eventKeyIndex.get(pk);
      if (p === undefined) unresolved.set(ev.source[i], (unresolved.get(ev.source[i]) || 0) + 1);
      else parent[i] = p;
    }
    for (const [sid, count] of unresolved) {
      this.sources[sid].warnings.push({ code: 'unresolved-parent', message: 'Replies or reactions whose parent message is not in the data', count });
    }
    const nodes = {
      count: this.nodes.keys.length,
      keys: this.nodes.keys,
      labels: this.nodes.labels,
      attrs: this.nodes.attrs,
      isBot: Uint8Array.from(this.nodes.isBot),
      platformIds: this.nodes.platformIds,
    };
    const contexts = {
      count: this.contexts.keys.length,
      keys: this.contexts.keys,
      names: this.contexts.names,
      kinds: this.contexts.kinds,
      visibility: Uint8Array.from(this.contexts.visibility),
      medium: this.contexts.medium,
      members: this.contexts.members,
    };
    const events = {
      count: n,
      type: Uint8Array.from(ev.type),
      t: Float64Array.from(ev.t),
      actor: Int32Array.from(ev.actor),
      context: Int32Array.from(ev.context),
      parent,
      weight: Float32Array.from(ev.weight),
      source: Uint16Array.from(ev.source),
      tOff: Int32Array.from(ev.tOff),
      tgt: Int32Array.from(ev.tgt),
      role: Uint8Array.from(ev.role),
      text: ev.text,
      keys: ev.keys,
    };
    return {
      meta: { name: this.name, createdAt: Date.now(), sources: this.sources },
      nodes,
      attributeSchema: inferAttributeSchema(nodes.attrs),
      contexts,
      events,
    };
  }
}

// ---- schema inference ------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

export function inferAttributeSchema(attrs) {
  const keys = new Map();
  for (const a of attrs) for (const k of Object.keys(a)) {
    if (!keys.has(k)) keys.set(k, []);
    keys.get(k).push(a[k]);
  }
  const schema = [];
  for (const [key, vals] of keys) {
    const distinct = new Set(vals.map(v => String(v)));
    let type;
    if (vals.every(v => typeof v === 'boolean' || /^(true|false|yes|no)$/i.test(String(v)))) type = 'boolean';
    else if (vals.every(v => typeof v === 'number' || (String(v).trim() !== '' && !isNaN(Number(v))))) type = distinct.size <= 12 && vals.length > 30 ? 'ordinal' : 'numeric';
    else if (vals.every(v => DATE_RE.test(String(v)))) type = 'date';
    else if (/(^|_)(id|uuid|email|url)$/i.test(key) || distinct.size > Math.max(50, vals.length * 0.9)) type = distinct.size === vals.length ? 'id' : 'text';
    else type = 'categorical';
    const entry = { key, type, label: key.replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase()), coverage: vals.length / (attrs.length || 1) };
    if (type === 'categorical' || type === 'boolean' || type === 'ordinal') entry.values = [...distinct].sort();
    schema.push(entry);
  }
  return schema;
}

// ---- helpers for readers of a Dataset ---------------------------------------

export function eventTargets(ds, i) {
  const { tOff, tgt, role } = ds.events;
  const out = [];
  for (let j = tOff[i]; j < tOff[i + 1]; j++) out.push([tgt[j], ROLES[role[j]]]);
  return out;
}

export function eventType(ds, i) { return EVENT_TYPES[ds.events.type[i]]; }
export function contextVisibility(ds, c) { return c < 0 ? 'unknown' : VISIBILITY[ds.contexts.visibility[c]]; }

// Dataset -> structured-cloneable payload plus the list of buffers to transfer to a worker.
export function toTransfer(ds) {
  const e = ds.events;
  const transfer = [e.type, e.t, e.actor, e.context, e.parent, e.weight, e.source, e.tOff, e.tgt, e.role, ds.nodes.isBot, ds.contexts.visibility].map(a => a.buffer);
  return { payload: ds, transfer };
}

// Plain JSON round trip for project files. Typed arrays become tagged objects.
export function toJSON(ds) {
  return JSON.stringify(ds, (k, v) => {
    if (ArrayBuffer.isView(v)) return { __ta: v.constructor.name, d: Array.from(v, x => (Number.isNaN(x) ? null : x)) };
    return v;
  });
}

const TA = { Uint8Array, Uint16Array, Int32Array, Float32Array, Float64Array };
export function fromJSON(str) {
  return JSON.parse(str, (k, v) => {
    if (v && typeof v === 'object' && v.__ta) return TA[v.__ta].from(v.d, x => (x === null ? NaN : x));
    return v;
  });
}

export const MODEL_VERSION = 1;
