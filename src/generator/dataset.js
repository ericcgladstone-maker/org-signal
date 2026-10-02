// Interaction records -> Dataset through DatasetBuilder, the same way the
// importer for that medium would map them (targets and roles per the data
// model contract): DM partners as `dm`, email recipients as `to/cc/bcc`, a
// reply's parent author as `reply`, mentions as `mention`, meeting attendees
// as `attendee`, group-chat audience as `member`, survey and connection ties
// as `declared`, follows as `follow` with the followed account as `subject`.

import { DatasetBuilder } from '../core/model.js';
import { KEY_PREFIX } from './identity.js';
import { makeFilter } from './observe.js';

const CONTEXT_KIND = {
  channel: 'channel', dm: 'dm', group_dm: 'group_dm', email_thread: 'email_thread', list: 'mailing_list', meeting: 'meeting',
  chat: 'chat', group_chat: 'chat', subreddit: 'subreddit', server_channel: 'channel', thread: 'thread', survey: 'survey', network: 'network',
};

const DIRECT = new Set(['dm', 'group_dm', 'chat']);

export const FAMILY = {
  slack: 'workplace', email: 'workplace', calendar: 'workplace', x: 'online', bluesky: 'online', mastodon: 'online', linkedin: 'professional',
  whatsapp: 'personal', imessage: 'personal', telegram: 'personal', discord: 'community', reddit: 'community', survey: 'survey', network: 'network',
};

export function makeDatasetSink({ world, medium, ident, obs, name, seed }) {
  const prefix = KEY_PREFIX[medium] || medium;
  const b = new DatasetBuilder({ name });
  const egoKey = obs.ego >= 0 ? ident.key[obs.ego] : null;
  b.beginSource({
    format: 'synthetic', family: FAMILY[medium] || 'custom', medium, view: obs.view, context: world.context, tz: 'UTC',
    fileNames: [], egoKey, generator: { context: world.context, medium, preset: world.preset, seed },
  });
  const keep = makeFilter(obs);
  const nodeIdx = new Int32Array(world.n).fill(-1);
  const botIdx = new Map();
  const listIdx = new Map();
  const ctxIdx = new Map();

  const node = i => {
    if (i < 0) return -1;
    let k = nodeIdx[i];
    if (k < 0) {
      k = b.node(ident.key[i], { label: ident.label[i], attrs: world.people.attrs[i], isBot: !!world.isBot[i], platformIds: ident.platformIds[i] });
      nodeIdx[i] = k;
    }
    return k;
  };
  const botNode = (ctx, a) => {
    let k = botIdx.get(a);
    if (k === undefined) {
      const bot = ctx.bots[-1 - a] || { name: 'bot' + (-1 - a) };
      k = b.node(`${prefix}:bot-${bot.name}`, { label: bot.label || bot.name, isBot: true, attrs: { kind: 'bot' } });
      botIdx.set(a, k);
    }
    return k;
  };
  const actorNode = (ctx, a) => (a >= 0 ? node(a) : botNode(ctx, a));

  const context = (ctx, si) => {
    if (!(si >= 0)) return -1;
    let c = ctxIdx.get(si);
    if (c === undefined) {
      const s = ctx.spaces[si];
      const kind = CONTEXT_KIND[s.kind] || s.kind;
      const label = s.name || s.subject || (s.kind === 'dm' || s.kind === 'chat' ? s.members.map(m => ident.label[m]).join(', ') : s.key);
      c = b.context(`${prefix}:${s.key}`, { name: label, kind, visibility: s.visibility || 'unknown', medium, members: s.everyone || s.members.length > 2000 ? null : s.members.map(m => ident.key[m]) });
      ctxIdx.set(si, c);
    }
    return c;
  };

  if (obs.view === 'full') for (let i = 0; i < world.n; i++) node(i);
  if (obs.ego >= 0) node(obs.ego);

  let kept = 0;
  function sink(rec, ctx) {
    if (!keep(rec, ctx)) return;
    kept++;
    const s = rec.space >= 0 ? ctx.spaces[rec.space] : null;
    const actor = actorNode(ctx, rec.actor);
    const targets = [];
    const add = (arr, role) => { if (arr) for (const p of arr) if (p >= 0) targets.push([node(p), role]); };
    let type = 'message', weight = 1;
    switch (rec.kind) {
      case 'message': {
        if (s && s.list) {
          let li = listIdx.get(rec.space);
          if (li === undefined) { li = b.node(`${prefix}:${s.address}`, { label: s.name, attrs: { is_list: true } }); listIdx.set(rec.space, li); }
          targets.push([li, 'to']);
          break;
        }
        const direct = s && (s.kind === 'dm' || s.kind === 'group_dm' || s.kind === 'chat');
        add(rec.to, direct ? 'dm' : 'to');
        add(rec.cc, 'cc'); add(rec.bcc, 'bcc');
        add(rec.audience, 'member');
        add(rec.mentions, 'mention');
        if (rec.replyTo >= 0) targets.push([node(rec.replyTo), 'reply']);
        break;
      }
      case 'reaction': type = 'reaction'; if (rec.replyTo >= 0) targets.push([node(rec.replyTo), 'subject']); break;
      case 'like': type = 'like'; if (rec.replyTo >= 0) targets.push([node(rec.replyTo), 'subject']); break;
      case 'repost': type = 'repost'; if (rec.replyTo >= 0) targets.push([node(rec.replyTo), 'subject']); break;
      case 'follow': type = 'follow'; add(rec.to, 'subject'); break;
      case 'join': type = 'join'; break;
      case 'leave': type = 'leave'; break;
      case 'meeting': type = 'copresence'; add(rec.present || rec.attendees, 'attendee'); weight = (rec.meta?.durMin || 30) / 60; break;
      case 'declared': type = 'declared'; add(rec.to, 'declared'); weight = rec.weight ?? 1; break;
      default: type = 'message';
    }
    // Only messages outside direct conversations can be parents (of replies,
    // reactions, likes, reposts) in any simulator, so only they get event keys.
    // That spares millions of key strings and index entries at scale.
    const keyed = rec.kind === 'message' && !(s && DIRECT.has(s.kind));
    b.event({
      type, t: rec.t, actor, targets, context: context(ctx, rec.space),
      key: keyed ? `${prefix}:e${rec.id}` : null, parentKey: rec.parent >= 0 ? `${prefix}:e${rec.parent}` : null,
      text: rec.text ?? null, weight,
    });
    b.stat(type);
  }

  return {
    sink,
    get kept() { return kept; },
    finish() { return b.build(); },
  };
}
