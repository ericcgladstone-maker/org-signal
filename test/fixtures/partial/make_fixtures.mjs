// Incomplete and wrong uploads: fixtures for test/importers-partial/.
//
//   node test/fixtures/partial/make_fixtures.mjs
//
// Each case folder holds what a person would drop on the Data view: one or
// more zips, loose files or folders, as the platform delivers them or as they
// get damaged on the way (a part missing, the wrong format option, a browser
// rename, a truncated download). Content is fictional; structure follows the
// real exports, mostly by reusing the per-importer fixtures under
// ../importers-a and ../importers-b and cutting them the way real uploads are
// cut. README.md (same folder) lists every case and its real-world source.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, gzipSync } from '../../../vendor/fflate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const A = (...p) => path.join(HERE, '..', 'importers-a', ...p);
const B = (...p) => path.join(HERE, '..', 'importers-b', ...p);
const enc = s => (typeof s === 'string' ? new TextEncoder().encode(s) : s);
// Stable zip bytes: fflate stamps the current time unless told otherwise.
const MTIME = new Date('2026-10-04T10:15:00Z');

// Every file under dir as { 'rel/path': bytes }, optionally under a prefix.
function tree(dir, prefix = '', keep = () => true) {
  const out = {};
  const walk = (d) => {
    for (const n of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, n.name);
      if (n.isDirectory()) walk(f);
      else {
        const rel = path.relative(dir, f).split(path.sep).join('/');
        if (keep(rel)) out[prefix + rel] = new Uint8Array(fs.readFileSync(f));
      }
    }
  };
  walk(dir);
  return out;
}
const zip = files => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [enc(v), { mtime: MTIME }]])));

function reset(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}
function write(caseName, rel, bytes) {
  const f = path.join(HERE, caseName, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, enc(bytes));
}
const writeTree = (caseName, files) => { for (const [k, v] of Object.entries(files)) write(caseName, k, v); };

// ---- shared pieces -----------------------------------------------------------

const slackStd = tree(A('slack', 'standard'));
// Public channels only: what Free and Pro plans (and Business+ without the
// approved full export) produce. #general and #random are the public channels.
const slackPublic = Object.fromEntries(Object.entries(slackStd).filter(([k]) => /^(users|channels|integration_logs)\.json$|^(general|random)\//.test(k)));
const xModern = tree(B('x-archive', 'modern', 'twitter-2025-01-22-abc'));
const fb2024 = tree(B('meta', 'fb2024'));
const mbox = fs.readFileSync(A('email', 'takeout', 'Takeout', 'Mail', 'All mail Including Spam and Trash.mbox'));
const ics = fs.readFileSync(A('calendar', 'takeout', 'Takeout', 'Calendar', 'Team rota.ics'));
const waTxt = fs.readFileSync(B('whatsapp', 'WhatsApp Chat with Marcus Oyelaran.txt'));
const archiveBrowser = '<!DOCTYPE html><html><head><title>Archive Overview</title></head><body><h1>Archive for ada.example@example.com</h1></body></html>\n';

// The LinkedIn two-part delivery (seen in a real export on 2026-10-04): the
// first zip, minutes after the request, has profile files only; the second,
// about a day later, has everything, profile files included.
const liProfile = 'First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites,Instant Messengers\nAda,Example,,,,Researcher at Contoso,,Research,,"Lisbon, Portugal",,,\n';
const liPositions = 'Company Name,Title,Description,Location,Started On,Finished On\nContoso,Researcher,,Lisbon,Jan 2020,\n';
const liRegistration = 'Registered At,Registration Ip,Subscription Types\n1/12/10, 9:14 AM,,\n';
const liConnections = 'Notes:\n"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address using this setting https://www.linkedin.com/psettings/privacy/email. You can learn more here https://www.linkedin.com/help/linkedin/answer/261"\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nLena,Vogt,https://www.linkedin.com/in/lena-vogt,,Fabrikam,Engineer,08 Feb 2026\nTheo,Grant,https://www.linkedin.com/in/theogrant,theo.grant@example.com,"Contoso, Ltd.",Analyst,14 Mar 2025\n';
const liMessages = '"CONVERSATION ID","CONVERSATION TITLE","FROM","SENDER PROFILE URL","TO","RECIPIENT PROFILE URLS","DATE","SUBJECT","CONTENT","FOLDER","ATTACHMENTS","IS MESSAGE DRAFT","IS CONVERSATION DRAFT"\n'
  + '"2-cGFydC10d28tMDAwMQ==","","Lena Vogt","https://www.linkedin.com/in/lena-vogt","Ada Example","https://www.linkedin.com/in/ada-example-9f","2026-09-30 08:12:40 UTC","","Coffee next week?","INBOX","","No","No"\n'
  + '"2-cGFydC10d28tMDAwMQ==","","Ada Example","https://www.linkedin.com/in/ada-example-9f","Lena Vogt","https://www.linkedin.com/in/lena-vogt","2026-09-30 09:01:02 UTC","","Yes, Tuesday works.","INBOX","","No","No"\n';
const liInvitations = 'From,To,Sent At,Message,Direction,inviterProfileUrl,inviteeProfileUrl\nAda Example,Theo Grant,"3/14/25, 2:37 PM",,OUTGOING,https://www.linkedin.com/in/ada-example-9f,https://www.linkedin.com/in/theogrant\n';

// X archive manifest for one part of a split delivery. Each part carries the
// manifest of the whole archive (isPartialArchive true); the data files it
// lists are spread over the parts.
function xManifest(partial) {
  const text = new TextDecoder().decode(xModern['data/manifest.js']);
  const m = JSON.parse(text.slice(text.indexOf('=') + 1));
  // List only data files the fixture has, as a real manifest does.
  for (const t of Object.values(m.dataTypes)) if (t.files) t.files = t.files.filter(f => xModern[f.fileName] || f.count === '0');
  m.archiveInfo.isPartialArchive = partial;
  return 'window.__THAR_CONFIG = ' + JSON.stringify(m, null, 2);
}
const xPick = (re, extra = {}) => ({ ...Object.fromEntries(Object.entries(xModern).filter(([k]) => re.test(k) && k !== 'data/manifest.js')), 'data/manifest.js': xManifest(false), ...extra });

// ---- cases -------------------------------------------------------------------

const CASES = {};

// Split and multi-part archives -------------------------------------------------

CASES['takeout-split'] = (c) => {
  // Takeout parts: one export, numbered -001, -002; each has archive_browser.html.
  write(c, 'takeout-20261004T101500Z-001.zip', zip({ 'Takeout/archive_browser.html': archiveBrowser, 'Takeout/Mail/All mail Including Spam and Trash.mbox': mbox }));
  write(c, 'takeout-20261004T101500Z-002.zip', zip({ 'Takeout/archive_browser.html': archiveBrowser, 'Takeout/Calendar/Team rota.ics': ics }));
};

CASES['linkedin-parts'] = (c) => {
  write(c, 'Basic_LinkedInDataExport_10-04-2026.zip', zip({ 'Profile.csv': liProfile, 'Positions.csv': liPositions, 'Registration.csv': liRegistration }));
  write(c, 'Complete_LinkedInDataExport_10-05-2026.zip', zip({ 'Profile.csv': liProfile, 'Positions.csv': liPositions, 'Registration.csv': liRegistration,
    'Connections.csv': liConnections, 'messages.csv': liMessages, 'Invitations.csv': liInvitations }));
};

CASES['x-parts'] = (c) => {
  // A large X archive delivered as two zips. Part 1: account, profile, tweets;
  // part 2: the remaining tweet part, likes, follows and messages.
  const p1 = xPick(/^data\/(account|profile|tweets|note-tweet)\.js$|^data\/README\.txt$/, { 'data/manifest.js': xManifest(true), 'Your archive.html': '<!DOCTYPE html><title>Your archive</title>\n' });
  const p2 = xPick(/^data\/(tweets-part\d+|like(-part\d+)?|follower|following|direct-messages(-group)?)\.js$/, { 'data/manifest.js': xManifest(true) });
  write(c, 'twitter-2026-10-04-5e1c0a-part1.zip', zip(p1));
  write(c, 'twitter-2026-10-04-5e1c0a-part2.zip', zip(p2));
};

CASES['meta-parts'] = (c) => {
  // One Facebook export delivered as two zips. The long thread is cut between
  // them: message_1.json (newest) in part 1, message_2.json in part 2.
  const p1 = {}, p2 = {};
  for (const [k, v] of Object.entries(fb2024)) {
    if (/message_2\.json$/.test(k) || /archived_threads|e2ee_cutover/.test(k)) p2[k] = v; else p1[k] = v;
  }
  write(c, 'facebook-adaexample-2026-10-04-Ab12Cd.zip', zip(p1));
  write(c, 'facebook-adaexample-2026-10-04-Ef34Gh.zip', zip(p2));
};

CASES['slack-split'] = (c) => {
  // A Slack export someone split by hand to get under an upload limit: the
  // workspace files and #general in one zip, the other channels in another.
  const p1 = {}, p2 = {};
  for (const [k, v] of Object.entries(slackStd)) (/^[^/]+\.json$/.test(k) || /^general\//.test(k) ? p1 : p2)[k] = v;
  write(c, 'Acme Slack export Mar 4 2024 - part 1.zip', zip(p1));
  write(c, 'Acme Slack export Mar 4 2024 - part 2.zip', zip(p2));
};

CASES['discord-package'] = (c) => {
  // The whole package (one zip, never split), and a package without Messages/
  // (the person left "Messages" unticked, or deleted the folder to save space).
  const pkg = tree(B('discord', 'pkg-2025'));
  write(c, 'package.zip', zip(pkg));
  write(c, 'package-no-messages.zip', zip(Object.fromEntries(Object.entries(pkg).filter(([k]) => !/^Messages\//.test(k)))));
};

// Wrong format chosen ------------------------------------------------------------

const htmlThread = (title, rows) => `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title></head><body><div class="_a705"><div class="_a706" role="main">${rows.map(([who, text, when]) => `<div class="pam _3-95 _2ph- _a6-g uiBoxWhite noborder"><div class="_3-95 _2pim _a6-h _a6-i">${who}</div><div class="_3-95 _a6-p"><div><div></div><div>${text}</div></div></div><div class="_3-94 _a6-o">${when}</div></div>`).join('')}</div></div></body></html>\n`;

CASES['meta-html'] = (c) => {
  write(c, 'facebook-adaexample-2026-10-04-Html01.zip', zip({
    'your_activity_across_facebook/messages/inbox/jordanpike_ABC123/message_1.html': htmlThread('Jordan Pike', [['Jordan Pike', 'see you then', 'Jun 02, 2024 10:20:00 am'], ['Ana Kovač', 'great', 'Jun 02, 2024 10:21:00 am']]),
    'your_activity_across_facebook/messages/inbox/samrivera_9/message_1.html': htmlThread('Sam Rivera', [['Sam Rivera', 'hi', 'May 01, 2024 9:00:00 am']]),
    'start_here.html': '<!DOCTYPE html><title>Your information</title>\n',
  }));
  write(c, 'instagram-ada.example-2026-10-04-Html02.zip', zip({
    'your_instagram_activity/messages/inbox/otterlab_17841/message_1.html': htmlThread('otter.lab', [['otter.lab', 'hello', 'Aug 24, 2025 3:00 pm']]),
    'start_here.html': '<!DOCTYPE html><title>Your information</title>\n',
  }));
};

CASES['meta-mixed'] = (c) => {
  // A JSON export and an older HTML export of the same account dropped together.
  write(c, 'facebook-adaexample-2026-10-04-Js01.zip', zip(Object.fromEntries(Object.entries(fb2024).filter(([k]) => /inbox\//.test(k)))));
  write(c, 'facebook-adaexample-2025-01-10-Html03.zip', zip({
    'your_activity_across_facebook/messages/inbox/lenavogt_77/message_1.html': htmlThread('Lena Vogt', [['Lena Vogt', 'hi', 'Jan 02, 2025 10:20:00 am']]),
  }));
};

CASES['telegram-html'] = (c) => {
  // Telegram Desktop with "Format: HTML" (the default): a single chat and a full export.
  const msgs = n => `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Exported Data</title><link href="css/style.css" rel="stylesheet"/><script src="js/script.js" type="text/javascript"></script></head><body><div class="page_wrap"><div class="page_header"><div class="content"><div class="text bold">Cleo Park</div></div></div><div class="page_body chat_page"><div class="history"><div class="message default clearfix" id="message${n}"><div class="body"><div class="pull_right date details" title="14.11.2024 09:12:44 UTC+01:00">09:12</div><div class="from_name">Cleo Park</div><div class="text">first</div></div></div></div></div></div></body></html>\n`;
  writeTree(c, {
    'ChatExport_2026-10-04/messages.html': msgs(1), 'ChatExport_2026-10-04/messages2.html': msgs(2),
    'ChatExport_2026-10-04/css/style.css': 'body{margin:0}\n', 'ChatExport_2026-10-04/js/script.js': 'function CheckLocation(){}\n',
    'ChatExport_2026-10-04/images/back.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    'DataExport_2026-10-04/export_results.html': '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Exported Data</title></head><body><div class="page_header">Exported Data</div><a href="lists/chats.html">Chats</a></body></html>\n',
    'DataExport_2026-10-04/lists/chats.html': '<!DOCTYPE html><html><body><a href="../chats/chat_01/messages.html">Cleo Park</a></body></html>\n',
    'DataExport_2026-10-04/chats/chat_01/messages.html': msgs(3),
    'DataExport_2026-10-04/css/style.css': 'body{margin:0}\n', 'DataExport_2026-10-04/js/script.js': 'function CheckLocation(){}\n',
  });
};

CASES['whatsapp-variants'] = (c) => {
  // iOS "Attach Media": a zip with _chat.txt and the media; Android "Without
  // media": the .txt; and three per-chat zips exported one after another.
  const fz = fs.readFileSync(B('whatsapp', 'WhatsApp Chat - Project Falcon.zip'));
  write(c, 'with-media/WhatsApp Chat - Project Falcon.zip', fz);
  write(c, 'without-media/WhatsApp Chat with Marcus Oyelaran.txt', waTxt);
  const chat = (who) => `[04/03/2025, 09:0${who.length % 9}:12] Leo Brandt: hi ${who}\n[04/03/2025, 09:10:40] ${who}: hello Leo\n[04/03/2025, 09:11:02] Leo Brandt: ‎image omitted\n`;
  for (const who of ['Ines Duarte', 'Kofi Mensah', 'Rosa Lind']) {
    write(c, `per-chat/WhatsApp Chat - ${who}.zip`, zip({ '_chat.txt': chat(who), '00000003-PHOTO-2025-03-04-09-11-02.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) }));
  }
};

CASES['imessage-no-attachments'] = (c) => {
  // chat.db copied from ~/Library/Messages without the Attachments folder.
  write(c, 'chat.db', fs.readFileSync(B('imessage', 'chat.db')));
};

CASES['slack-free'] = (c) => {
  // Free and Pro plans: owners and admins can export public channels only.
  write(c, 'Acme Slack export Mar 4 2024.zip', zip(slackPublic));
};

CASES['teams-partial'] = (c) => {
  // A Graph dump where the messages folder did not come along (chats.json only),
  // and an eDiscovery "items report only" export without Items.csv (Summary only).
  write(c, 'graph-chats-only/chats.json', fs.readFileSync(A('teams', 'real-structure', 'graph-me', 'chats.json')));
  const pv = path.join(A('teams', 'real-structure', 'purview-new'));
  const rep = tree(pv);
  writeTree(c, Object.fromEntries(Object.entries(rep).filter(([k]) => /Summary/i.test(k)).map(([k, v]) => ['purview-summary-only/' + k, v])));
};

CASES['calendar-csv'] = (c) => {
  // Outlook (classic) File > Open & Export > Import/Export > Export to a file > CSV, Calendar folder.
  const head = '"Subject","Start Date","Start Time","End Date","End Time","All day event","Reminder on/off","Reminder Date","Reminder Time","Meeting Organizer","Required Attendees","Optional Attendees","Meeting Resources","Billing Information","Categories","Description","Location","Mileage","Priority","Private","Sensitivity","Show time as"';
  const row = (s, d, org, req, opt) => `"${s}","${d}","10:00:00 AM","${d}","11:00:00 AM","False","True","${d}","9:45:00 AM","${org}","${req}","${opt}",,,,"Weekly sync",,,"Normal","False","Normal","2"`;
  write(c, 'Calendar.CSV', `${head}\r\n${row('Project sync', '3/4/2024', 'Ana Ruiz', 'Ana Ruiz;Chen Li;Okafor, Ben', 'Dana Park')}\r\n${row('Budget review', '3/6/2024', 'Chen Li', 'Chen Li;Ana Ruiz', '')}\r\n`);
};

CASES['email-variants'] = (c) => {
  // A bare .mbox (Apple Mail / Thunderbird export) and an unzipped Takeout folder.
  write(c, 'mbox/Inbox.mbox', mbox);
  writeTree(c, { 'Takeout/archive_browser.html': archiveBrowser, 'Takeout/Mail/All mail Including Spam and Trash.mbox': mbox });
};

CASES['network-variants'] = (c) => {
  write(c, 'hyperedges.graphml', `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <graph id="G" edgedefault="undirected">
    <node id="a"/><node id="b"/><node id="c"/><node id="d"/>
    <edge source="a" target="b"/>
    <hyperedge><endpoint node="a"/><endpoint node="c"/><endpoint node="d"/></hyperedge>
    <hyperedge><endpoint node="b"/><endpoint node="c"/><endpoint node="d"/></hyperedge>
  </graph>
</graphml>
`);
  // Pajek project file: two networks one after the other (*Network marks each).
  write(c, 'two-networks.paj', `*Network friendship
*Vertices 3
1 "Ana"
2 "Ben"
3 "Chen"
*Arcs
1 2
2 3
*Network advice
*Vertices 3
1 "Ana"
2 "Ben"
3 "Chen"
*Arcs
3 1
`);
  write(c, 'two-networks.net', `*Network friendship
*Vertices 3
1 "Ana"
2 "Ben"
3 "Chen"
*Arcs
1 2
2 3
*Network advice
*Vertices 3
1 "Ana"
2 "Ben"
3 "Chen"
*Arcs
3 1
`);
  // GEXF 1.3 dynamic with spells (start/end per edge) and slice attributes.
  write(c, 'dynamic-spells.gexf', `<?xml version="1.0" encoding="UTF-8"?>
<gexf xmlns="http://gexf.net/1.3" version="1.3">
  <graph mode="dynamic" defaultedgetype="directed" timeformat="date">
    <nodes>
      <node id="a" label="Ana"><spells><spell start="2024-01-01" end="2024-06-30"/></spells></node>
      <node id="b" label="Ben"/>
      <node id="c" label="Chen"/>
    </nodes>
    <edges>
      <edge id="0" source="a" target="b"><spells><spell start="2024-01-01" end="2024-02-01"/><spell start="2024-04-01" end="2024-05-01"/></spells></edge>
      <edge id="1" source="b" target="c" start="2024-03-01"/>
    </edges>
  </graph>
</gexf>
`);
};

// Partial contents --------------------------------------------------------------

CASES['x-missing'] = (c) => {
  write(c, 'twitter-2026-10-04-no-tweets.zip', zip(xPick(/^data\/(manifest|account|profile|direct-messages(-group)?|follower|following)\.js$/)));
  write(c, 'twitter-2026-10-04-no-dms.zip', zip(xPick(/^data\/(manifest|account|profile|tweets(-part\d+)?|note-tweet)\.js$/)));
  write(c, 'twitter-2026-10-04-account-only.zip', zip(xPick(/^data\/(manifest|account|profile)\.js$/)));
};

CASES['slack-no-users'] = (c) => {
  write(c, 'Acme Slack export no users.zip', zip(Object.fromEntries(Object.entries(slackStd).filter(([k]) => k !== 'users.json'))));
  // Channel folders only: no users.json, no channels.json.
  write(c, 'Acme Slack channels only.zip', zip(Object.fromEntries(Object.entries(slackStd).filter(([k]) => /^(general|random)\//.test(k)))));
};

CASES['instagram-no-inbox'] = (c) => {
  // Instagram JSON export with "Followers and following" only (no Messages).
  const followers = JSON.stringify([{ title: '', media_list_data: [], string_list_data: [{ href: 'https://www.instagram.com/otter.lab', value: 'otter.lab', timestamp: 1724500000 }] }], null, 2);
  const following = JSON.stringify({ relationships_following: [{ title: '', string_list_data: [{ href: 'https://www.instagram.com/lena.vogt', value: 'lena.vogt', timestamp: 1724400000 }] }] }, null, 2);
  write(c, 'instagram-ada.example-2026-10-04-Q1w2E3.zip', zip({
    'connections/followers_and_following/followers_1.json': followers,
    'connections/followers_and_following/following.json': following,
    'personal_information/personal_information/personal_information.json': JSON.stringify({ profile_user: [{ string_map_data: { Username: { value: 'ada.example' } } }] }),
  }));
};

CASES['nc-no-edges'] = (c) => {
  // Network Canvas CSV export where no edge list was written (no ties elicited
  // or "edge list" unticked in Interviewer's export options).
  const keep = /^P014_9b2e0001_(ego|attributeList_Person)\.csv$/;
  for (const [k, v] of Object.entries(tree(A('network-canvas', 'csv')))) if (keep.test(k)) write(c, 'networkCanvasExport/' + k, v);
};

CASES['empty'] = (c) => {
  write(c, 'result.json', '');
  write(c, 'messages.csv', '');
  write(c, 'edges-header-only.csv', 'source,target,weight\n');
  write(c, 'Connections.csv', liConnections.split('\n').slice(0, 4).join('\n') + '\n');
  write(c, 'empty.zip', '');
  write(c, 'empty-calendar.ics', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Google Inc//Google Calendar 70.9054//EN\r\nX-WR-CALNAME:Empty\r\nEND:VCALENDAR\r\n');
  write(c, 'WhatsApp Chat with Nobody.txt', '');
};

// Damaged or mixed uploads --------------------------------------------------------

CASES['damaged'] = (c) => {
  const slack = zip(slackStd);
  write(c, 'truncated/Acme Slack export.zip', slack.subarray(0, Math.floor(slack.length * 0.6)));
  write(c, 'renamed/Acme Slack export.zip.zip', slack);
  write(c, 'renamed/Acme Slack export.zip (1)', slack);
  write(c, 'renamed/Acme Slack export (1).zip', slack);
  write(c, 'crdownload/Acme Slack export.zip.crdownload', slack.subarray(0, Math.floor(slack.length * 0.4)));
  write(c, 'not-a-zip/takeout-20261004T101500Z-001.zip', '<!DOCTYPE html><html><head><title>Google Accounts</title></head><body>Sign in to continue to Takeout</body></html>\n');
  write(c, 'tgz/takeout-20261004T101500Z-001.tgz', gzipSync(enc('Takeout/Mail/All mail Including Spam and Trash.mbox\0'), { mtime: MTIME }));
  // Purview / eDiscovery packages and other zips sent with a password:
  // entries flagged encrypted (general-purpose bit 0). The bytes are not real
  // ciphertext; nothing ever decrypts them.
  const enc1 = zip({ 'Items_0_2024-03-10T101500.csv': 'Conversation ID,Participants\n', 'Exchange/ana.ruiz@contoso.example.pst': 'not really a pst' });
  write(c, 'encrypted/Reports-ContosoCase-Export.zip', markEncrypted(enc1));
};

// Set the "encrypted" flag on every local and central header.
function markEncrypted(bytes) {
  const b = new Uint8Array(bytes);
  const dv = new DataView(b.buffer);
  for (let i = 0; i + 4 <= b.length; i++) {
    const sig = dv.getUint32(i, true);
    if (sig === 0x04034b50) dv.setUint16(i + 6, dv.getUint16(i + 6, true) | 1, true);
    else if (sig === 0x02014b50) dv.setUint16(i + 8, dv.getUint16(i + 8, true) | 1, true);
  }
  return b;
}

CASES['junk-folder'] = (c) => {
  writeTree(c, Object.fromEntries(Object.entries(slackStd).map(([k, v]) => ['Acme Slack export/' + k, v])));
  writeTree(c, {
    'Acme Slack export/.DS_Store': new Uint8Array([0, 0, 0, 1, 66, 117, 100, 49]),
    'Acme Slack export/team-photo.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]),
    'Acme Slack export/Onboarding.pdf': '%PDF-1.4\n%fictional\n',
    'Acme Slack export/notes.docx': zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document/>' }),
  });
};

CASES['zip-and-folder'] = (c) => {
  // Double-clicking a zip on a Mac unzips it into a folder of the same name
  // beside it; people then drop both. Once as is, once with a stray file added.
  write(c, 'same/Acme Slack export.zip', zip(slackStd));
  writeTree(c, Object.fromEntries(Object.entries(slackStd).map(([k, v]) => ['same/Acme Slack export/' + k, v])));
  write(c, 'extra/Acme Slack export.zip', zip(slackStd));
  writeTree(c, Object.fromEntries(Object.entries(slackStd).map(([k, v]) => ['extra/Acme Slack export/' + k, v])));
  write(c, 'extra/Acme Slack export/Meeting notes.pdf', '%PDF-1.4\n%fictional\n');
};

CASES['two-platforms'] = (c) => {
  write(c, 'Acme Slack export.zip', zip(slackStd));
  write(c, 'WhatsApp Chat with Marcus Oyelaran.txt', waTxt);
};

CASES['duplicate'] = (c) => {
  const slack = zip(slackStd);
  write(c, 'Acme Slack export.zip', slack);
  write(c, 'Acme Slack export (1).zip', slack);
  write(c, 'WhatsApp Chat with Marcus Oyelaran.txt', waTxt);
  write(c, 'WhatsApp Chat with Marcus Oyelaran (1).txt', waTxt);
};

CASES['encodings'] = (c) => {
  // Excel "Unicode Text (*.txt)": UTF-16LE with BOM, tab-separated, CRLF.
  const tsv = 'source\ttarget\tweight\r\nZoë Brandt\tJosé Pérez\t2\r\nJosé Pérez\tAna Ruiz\t1\r\nAna Ruiz\tZoë Brandt\t3\r\n';
  const u16 = new Uint8Array(2 + tsv.length * 2);
  u16[0] = 0xff; u16[1] = 0xfe;
  for (let i = 0; i < tsv.length; i++) { const k = tsv.charCodeAt(i); u16[2 + 2 * i] = k & 0xff; u16[3 + 2 * i] = k >> 8; }
  write(c, 'edges-utf16.txt', u16);
  // Excel "CSV UTF-8": BOM, CRLF.
  write(c, 'edges-bom-crlf.csv', '﻿source,target,weight\r\nZoë Brandt,José Pérez,2\r\nJosé Pérez,Ana Ruiz,1\r\nAna Ruiz,Zoë Brandt,3\r\n');
  // WhatsApp chat saved through Windows: BOM and CRLF.
  write(c, 'WhatsApp Chat with Leo Brandt.txt', '﻿' + new TextDecoder().decode(waTxt).replace(/\r?\n/g, '\r\n'));
};

CASES['pst'] = (c) => {
  write(c, 'archive.pst', fs.readFileSync(A('email', 'pst', 'archive.pst')));
};

// ---- run ---------------------------------------------------------------------

const only = process.argv.slice(2);
for (const [name, make] of Object.entries(CASES)) {
  if (only.length && !only.includes(name)) continue;
  reset(path.join(HERE, name));
  make(name);
}
console.log(`Wrote ${only.length || Object.keys(CASES).length} cases under ${HERE}`);
