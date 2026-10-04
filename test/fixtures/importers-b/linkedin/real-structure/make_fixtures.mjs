// Writes the LinkedIn real-structure fixtures (see README.md next to this file).
// Every value is fictional; the structure (file names, header lines, column
// order, quoting, preamble, date formats, delimiters, trailing newlines) follows
// what real exports of each era look like.
//
//   node test/fixtures/importers-b/linkedin/real-structure/make_fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const write = (rel, text) => {
  const p = path.join(HERE, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
// Plain CSV writer: quote only when needed (pre-2026 exports), LF line ends.
const q = v => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
const csv = (rows, { trailing = true } = {}) => rows.map(r => r.map(q).join(',')).join('\n') + (trailing ? '\n' : '');
// 2026 messages.csv: every field quoted, the header too; empty fields are "".
const csvAllQuoted = rows => rows.map(r => r.map(v => '"' + v.replace(/"/g, '""') + '"').join(',')).join('\n') + '\n';

// The Connections.csv preamble, byte for byte as exported Sep 2022 - Oct 2026.
const NOTES = 'Notes:\n"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address using this setting https://www.linkedin.com/psettings/privacy/email. You can learn more here https://www.linkedin.com/help/linkedin/answer/261"\n\n';

const PROFILE_H = ['First Name', 'Last Name', 'Maiden Name', 'Address', 'Birth Date', 'Headline', 'Summary', 'Industry', 'Zip Code', 'Geo Location', 'Twitter Handles', 'Websites', 'Instant Messengers'];
const profile = (first, last, headline, geo) => csv([PROFILE_H, [first, last, '', '', '', headline, '', 'Software Development', '', geo, '', '', '']]);
const IN = s => 'https://www.linkedin.com/in/' + s;

const M9 = ['CONVERSATION ID', 'CONVERSATION TITLE', 'FROM', 'SENDER PROFILE URL', 'TO', 'DATE', 'SUBJECT', 'CONTENT', 'FOLDER'];
const M10 = ['CONVERSATION ID', 'CONVERSATION TITLE', 'FROM', 'SENDER PROFILE URL', 'TO', 'RECIPIENT PROFILE URLS', 'DATE', 'SUBJECT', 'CONTENT', 'FOLDER'];
const SPIN = '<p class="spinmail-quill-editor__spin-break">';

// ---- 2021: Basic archive, no preamble, no URL column, 9-column messages ----
{
  const D = 'Basic_LinkedInDataExport_05-14-2021/';
  write(D + 'Profile.csv', profile('Maya', 'Lindgren', 'Product Designer', 'Oslo, Norway'));
  write(D + 'Connections.csv', csv([
    ['First Name', 'Last Name', 'Email Address', 'Company', 'Position', 'Connected On'],
    ['Priya', 'Raman', '', 'Fabrikam', 'Data Analyst', '12 Mar 2021'],
    ['Theo', 'Grant', 'theo.grant@example.com', 'Contoso, Ltd.', 'Sales Lead', '03 Nov 2019'],
    ['Lena', 'Vogt', '', 'Northwind', 'Engineer, Platform', '28 Feb 2020'],
  ], { trailing: false }));
  write(D + 'messages.csv', csv([
    M9,
    ['2-YWFhYWFhYWEtZmljdGlvbmFsLTAwMDE=', '', 'Priya Raman', IN('priya-raman-77'), 'Maya Lindgren', '2021-04-02 09:15:00 UTC', '', 'Thanks for connecting!  Coffee next week?', 'INBOX'],
    ['2-YWFhYWFhYWEtZmljdGlvbmFsLTAwMDE=', '', 'Maya Lindgren', IN('maya-lindgren-4a1b2c'), 'Priya Raman', '2021-04-02 10:01:12 UTC', '', 'Sure - Tuesday works.', 'INBOX'],
    ['2-YmJiYmJiYmItZmljdGlvbmFsLTAwMDI=', 'Spring offsite', 'Theo Grant', IN('theogrant'), 'Maya Lindgren, Lena Vogt', '2021-04-20 16:00:00 UTC', '', 'Agenda attached', 'INBOX'],
    ['2-YmJiYmJiYmItZmljdGlvbmFsLTAwMDI=', 'Spring offsite', 'Lena Vogt', IN('lena-vogt'), 'Maya Lindgren, Theo Grant', '2021-04-20 16:30:00 UTC', '', 'Looks good', 'INBOX'],
    ['2-Y2NjY2NjY2MtZmljdGlvbmFsLTAwMDM=', '', 'LinkedIn Member', '', 'Maya Lindgren', '2021-05-01 08:00:00 UTC', '', 'Hi Maya, I came across your profile', 'INBOX'],
  ]));
  write(D + 'Invitations.csv', csv([
    ['From', 'To', 'Sent At', 'Message', 'Direction'],
    ['Maya Lindgren', 'Priya Raman', '3/12/21, 4:05 PM', '', 'OUTGOING'],
    ['Jonas Berg', 'Maya Lindgren', '5/10/21, 9:41 AM', 'Hi Maya, we met at the meetup.', 'INCOMING'],
  ]));
}

// ---- 2022: Complete archive, preamble, still no URL column, hidden rows,
//      9-column messages, endorsements without a URL column ----
{
  const D = 'Complete_LinkedInDataExport_09-18-2022/';
  write(D + 'Profile.csv', profile('Maya', 'Lindgren', 'Product Designer', 'Oslo, Norway'));
  write(D + 'Connections.csv', NOTES + csv([
    ['First Name', 'Last Name', 'Email Address', 'Company', 'Position', 'Connected On'],
    ['Priya', 'Raman', '', 'Fabrikam', 'Senior Data Analyst', '12 Mar 2021'],
    ['Ravi', 'Menon', '', 'Litware', 'CTO', '01 Jul 2022'],
    ['Jane', 'Doe, Ph.D.', '', 'Tailspin', 'Researcher', '15 Aug 2022'],
    ['', '', '', '', '', '07 Jun 2022'],
    ['', '', '', '', '', '19 Aug 2022'],
  ], { trailing: false }));
  write(D + 'messages.csv', csv([
    M9,
    ['2-ZGRkZGRkZGQtZmljdGlvbmFsLTAwMDQ=', 'Research sync', 'Ravi Menon', IN('ravimenon'), 'Maya Lindgren, Jane Doe, Ph.D.', '2022-08-20 11:00:00 UTC', '', 'Can we meet Friday?', 'INBOX'],
    ['2-ZGRkZGRkZGQtZmljdGlvbmFsLTAwMDQ=', 'Research sync', 'Jane Doe, Ph.D.', IN('janedoe-phd'), 'Maya Lindgren, Ravi Menon', '2022-08-20 11:20:00 UTC', '', 'Friday is fine', 'INBOX'],
    ['2-ZGRkZGRkZGQtZmljdGlvbmFsLTAwMDQ=', 'Research sync', 'Maya Lindgren', IN('maya-lindgren-4a1b2c'), 'Ravi Menon, Jane Doe, Ph.D.', '2022-08-20 12:00:00 UTC', '', 'Booked', 'INBOX'],
    ['2-ZWVlZWVlZWUtZmljdGlvbmFsLTAwMDU=', '', 'Priya Raman', IN('priya-raman-77'), 'Maya Lindgren', '2022-09-01 07:30:00 UTC', '', 'Congrats on the new role', 'ARCHIVE'],
  ]));
  write(D + 'Invitations.csv', csv([['From', 'To', 'Sent At', 'Message', 'Direction'], ['Maya Lindgren', 'Ravi Menon', '6/30/22, 8:12 PM', '', 'OUTGOING']]));
  write(D + 'Endorsement_Received_Info.csv', csv([
    ['Endorsement Date', 'Skill Name', 'Endorser First Name', 'Endorser Last Name', 'Endorsement Status'],
    ['2022/06/20 13:05:02 UTC', 'User Research', 'Priya', 'Raman', 'ACCEPTED'],
  ]));
}

// ---- Oct 2023: Basic archive, URL column, 10-column messages, 7-column
//      invitations, endorsements with a scheme-less URL, ARCHIVE/SPAM folders,
//      a sponsored (spinmail) row, header-only guide_messages.csv ----
{
  const D = 'Basic_LinkedInDataExport_10-21-2023/';
  write(D + 'Profile.csv', profile('Jordan', 'Pike', 'Engineering Manager', 'Lisbon, Portugal'));
  write(D + 'Connections.csv', NOTES + csv([
    ['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position', 'Connected On'],
    ['Ines', 'Okafor-Lindqvist', IN('ines-okafor-l-3b2a91'), '', 'Northwind Analytics, Inc.', 'Director of People Ops', '08 Feb 2023'],
    ['Tomás', 'Reyes', IN('tomasreyes'), 'tomas.reyes@example.org', 'Contoso', 'Engineer, Platform', '14 Nov 2019'],
    ['Wren', 'Hale, PhD', IN('wren-hale'), '', 'Fabrikam', 'Research Lead', '05 Mar 2021'],
    ['', '', '', '', '', '', '02 Oct 2023'],
  ], { trailing: false }));
  write(D + 'messages.csv', csv([
    M10,
    ['2-ZmZmZmZmZmYtZmljdGlvbmFsLTAwMDY=', '', 'Ines Okafor-Lindqvist', IN('ines-okafor-l-3b2a91'), 'Jordan Pike', IN('jordanpike'), '2023-06-01 14:03:22 UTC', '', 'Thanks for the intro  free Thursday?', 'INBOX'],
    ['2-ZmZmZmZmZmYtZmljdGlvbmFsLTAwMDY=', '', 'Jordan Pike', IN('jordanpike'), 'Ines Okafor-Lindqvist', IN('ines-okafor-l-3b2a91'), '2023-06-01 15:10:00 UTC', '', 'Thursday it is.', 'INBOX'],
    ['2-Z2dnZ2dnZ2ctZmljdGlvbmFsLTAwMDc=', 'Platform guild', 'Jordan Pike', IN('jordanpike'), 'Tomás Reyes, Wren Hale, PhD', IN('tomasreyes') + ',' + IN('wren-hale'), '2023-07-10 08:00:00 UTC', '', 'Kickoff on Friday', 'INBOX'],
    ['2-Z2dnZ2dnZ2ctZmljdGlvbmFsLTAwMDc=', 'Platform guild', 'Wren Hale, PhD', IN('wren-hale'), 'Jordan Pike, Tomás Reyes', IN('jordanpike') + ',' + IN('tomasreyes'), '2023-07-10 08:05:00 UTC', '', 'Works for me', 'ARCHIVE'],
    ['2-aGhoaGhoaGgtZmljdGlvbmFsLTAwMDg=', 'Grow your pipeline', 'Casey Morgan', '', 'Jordan Pike', IN('jordanpike'), '2023-08-01 10:00:00 UTC', '', SPIN + 'Hi %FIRSTNAME%,</p><p>Our <strong>webinar</strong> is free &amp; online.</p>', 'INBOX'],
    ['2-aWlpaWlpaWktZmljdGlvbmFsLTAwMDk=', '', 'LinkedIn Member', '', 'Jordan Pike', IN('jordanpike'), '2023-08-03 09:00:00 UTC', '', 'Quick question about your team', 'INBOX'],
    ['2-ampqampqamotZmljdGlvbmFsLTAwMTA=', '', 'Rex Dorn', IN('rex-dorn-crypto'), 'Jordan Pike', IN('jordanpike'), '2023-08-05 02:00:00 UTC', '', 'Guaranteed returns!!!', 'SPAM'],
  ]));
  write(D + 'guide_messages.csv', csv([M10]));
  write(D + 'Invitations.csv', csv([
    ['From', 'To', 'Sent At', 'Message', 'Direction', 'inviterProfileUrl', 'inviteeProfileUrl'],
    ['Jordan Pike', 'Ines Okafor-Lindqvist', '2/7/23, 2:37 PM', '', 'OUTGOING', IN('jordanpike'), IN('ines-okafor-l-3b2a91')],
    ['Ama Owusu', 'Jordan Pike', '10/2/23, 11:05 AM', '', 'INCOMING', IN('ama-owusu'), IN('jordanpike')],
  ]));
  write(D + 'Endorsement_Received_Info.csv', csv([
    ['Endorsement Date', 'Skill Name', 'Endorser First Name', 'Endorser Last Name', 'Endorser Public Url', 'Endorsement Status'],
    ['2023/06/20 13:05:02 UTC', 'Team Leadership', 'Tomás', 'Reyes', 'www.linkedin.com/in/tomasreyes', 'ACCEPTED'],
  ]));
}

// ---- Aug 2025: Basic archive, messages with ATTACHMENTS and IS MESSAGE DRAFT
//      (12 columns, no IS CONVERSATION DRAFT), more header-only *messages files ----
{
  const D = 'Basic_LinkedInDataExport_08-15-2025/';
  const H = [...M10, 'ATTACHMENTS', 'IS MESSAGE DRAFT'];
  write(D + 'Profile.csv', profile('Jordan', 'Pike', 'Engineering Manager', 'Lisbon, Portugal'));
  write(D + 'Connections.csv', NOTES + csv([
    ['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position', 'Connected On'],
    ['Ines', 'Okafor-Lindqvist', IN('ines-okafor-l-3b2a91'), '', 'Northwind Analytics, Inc.', 'Director of People Ops', '08 Feb 2023'],
    ['Kofi', 'Mensah', IN('kofi-mensah-1188'), '', 'Adatum', 'Designer', '30 Jul 2025'],
  ], { trailing: false }));
  write(D + 'messages.csv', csv([
    H,
    ['2-a2tra2tra2stZmljdGlvbmFsLTAwMTE=', '', 'Kofi Mensah', IN('kofi-mensah-1188'), 'Jordan Pike', IN('jordanpike'), '2025-08-01 09:00:00 UTC', '', 'Here are the mockups', 'INBOX', 'https://www.linkedin.com/dms/prv/image/v2/D4E06AQfictional1/messaging-image-720/0/1722500000000?e=1725000000&v=beta,https://www.linkedin.com/dms/prv/image/v2/D4E06AQfictional2/messaging-image-720/0/1722500000001?e=1725000000&v=beta', 'No'],
    ['2-a2tra2tra2stZmljdGlvbmFsLTAwMTE=', '', 'Jordan Pike', IN('jordanpike'), 'Kofi Mensah', IN('kofi-mensah-1188'), '2025-08-01 09:30:00 UTC', '', 'Love the second one', 'INBOX', '', 'No'],
    ['2-a2tra2tra2stZmljdGlvbmFsLTAwMTE=', '', 'Jordan Pike', IN('jordanpike'), 'Kofi Mensah', IN('kofi-mensah-1188'), '2025-08-02 18:00:00 UTC', '', 'half-written reply', 'INBOX', '', 'Yes'],
    ['2-bGxsbGxsbGwtZmljdGlvbmFsLTAwMTI=', '', 'Ines Okafor-Lindqvist', IN('ines-okafor-l-3b2a91'), 'Jordan Pike', IN('jordanpike'), '2025-08-10 12:00:00 UTC', '', 'Lunch soon?', 'INBOX', '', 'No'],
  ]));
  write(D + 'learning_coach_messages.csv', csv([M10]));
  write(D + 'learning_role_play_messages.csv', csv([M10]));
  write(D + 'coach_messages.csv', csv([M10]));
  write(D + 'Invitations.csv', csv([
    ['From', 'To', 'Sent At', 'Message', 'Direction', 'inviterProfileUrl', 'inviteeProfileUrl'],
    ['Jordan Pike', 'Kofi Mensah', '7/29/25, 6:15 PM', '', 'OUTGOING', IN('jordanpike'), IN('kofi-mensah-1188')],
  ]));
}

// ---- Mar 2026: Complete archive, messages.csv fully quoted (header too) with
//      real line breaks inside CONTENT (LF and CRLF), numbered Complete-only
//      files, LearningCoachMessages.csv, Notes.csv, Articles/ ----
{
  const D = 'Complete_LinkedInDataExport_03-09-2026/';
  write(D + 'Profile.csv', profile('Jordan', 'Pike', 'Engineering Manager', 'Lisbon, Portugal'));
  write(D + 'Connections.csv', NOTES + csv([
    ['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position', 'Connected On'],
    ['Ines', 'Okafor-Lindqvist', IN('ines-okafor-l-3b2a91'), '', 'Northwind Analytics, Inc.', 'Director of People Ops', '08 Feb 2023'],
    ['Kofi', 'Mensah', IN('kofi-mensah-1188'), '', 'Adatum', 'Lead Designer', '30 Jul 2025'],
    ['Zoë', 'Brandt', IN('zo%C3%AB-brandt'), '', 'Woodgrove', '"Chief" of Staff', '14 Jan 2026'],
    ['', '', '', '', '', '', '21 Feb 2026'],
  ], { trailing: false }));
  write(D + 'messages.csv', csvAllQuoted([
    [...M10, 'ATTACHMENTS'],
    ['2-bW1tbW1tbW0tZmljdGlvbmFsLTAwMTM=', '', 'Zoë Brandt', IN('zo%C3%AB-brandt'), 'Jordan Pike', IN('jordanpike'), '2026-02-01 08:00:00 UTC', '', 'Hi Jordan,\nthanks for the call.\n\nNotes below:\n- hiring plan\n- budget', 'INBOX', ''],
    ['2-bW1tbW1tbW0tZmljdGlvbmFsLTAwMTM=', '', 'Jordan Pike', IN('jordanpike'), 'Zoë Brandt', IN('zo%C3%AB-brandt'), '2026-02-01 09:15:00 UTC', '', 'Great, "next steps" agreed.\r\nTalk soon', 'INBOX', ''],
    ['2-bm5ubm5ubm4tZmljdGlvbmFsLTAwMTQ=', 'Design crit', 'Kofi Mensah', IN('kofi-mensah-1188'), 'Jordan Pike, Ines Okafor-Lindqvist, Zoë Brandt', [IN('jordanpike'), IN('ines-okafor-l-3b2a91'), IN('zo%C3%AB-brandt')].join(','), '2026-02-10 14:00:00 UTC', '', 'Round two,\nsame link', 'INBOX', ''],
    ['2-bm5ubm5ubm4tZmljdGlvbmFsLTAwMTQ=', 'Design crit', 'Ines Okafor-Lindqvist', IN('ines-okafor-l-3b2a91'), 'Kofi Mensah, Jordan Pike, Zoë Brandt', [IN('kofi-mensah-1188'), IN('jordanpike'), IN('zo%C3%AB-brandt')].join(','), '2026-02-10 14:20:00 UTC', '', 'Joining', 'INBOX', ''],
    ['2-b29vb29vb28tZmljdGlvbmFsLTAwMTU=', 'Your next role', 'LinkedIn Member', '', 'Jordan Pike', IN('jordanpike'), '2026-02-15 10:00:00 UTC', '', SPIN + 'Hi Jordan,</p><ul><li>Remote</li><li>Senior</li></ul>', 'INBOX', ''],
  ]));
  write(D + 'LearningCoachMessages.csv', 'No conversations found\n');
  write(D + 'Comments_34875879.csv', csv([['Date', 'Link', 'Message'], ['2026-01-05 10:00:00', 'https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000001', 'Great write-up']]));
  write(D + 'Notes.csv', csv([['Connection First Name', 'Connection Last Name', 'Connection Profile URL', 'Note', 'Created On', 'Edited On'], ['Kofi', 'Mensah', IN('kofi-mensah-1188'), 'met at design week', '2025-07-30 18:20:00 UTC', '']]));
  write(D + 'Invitations.csv', csv([
    ['From', 'To', 'Sent At', 'Message', 'Direction', 'inviterProfileUrl', 'inviteeProfileUrl'],
    ['Zoë Brandt', 'Jordan Pike', '1/14/26, 7:02 AM', '', 'INCOMING', IN('zo%C3%AB-brandt'), IN('jordanpike')],
  ]));
  write(D + 'Articles/Articles/a-fictional-article.html', '<html><head><title>A fictional article</title></head><body><p>Text</p></body></html>\n');
}
console.log('LinkedIn real-structure fixtures written to', HERE);
