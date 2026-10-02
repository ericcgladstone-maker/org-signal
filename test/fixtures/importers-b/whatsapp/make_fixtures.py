# Generates the synthetic WhatsApp fixtures (fake names). Run: python3 make_fixtures.py
# Invisible characters are written as escapes so the source stays readable.
import zipfile
LRM, NNBSP, NBSP, BOM, FSI, PDI = '‎', ' ', ' ', '﻿', '⁨', '⁩'

# 1. iOS group, 2024+ style (system notices carry the group name or the affected
#    person as author), d/m/y 24h with seconds. Zipped as iOS does.
ios = '\n'.join([
    BOM + f'[04/03/25, 14:00:00] Project Falcon: {LRM}Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them.',
    f'[04/03/25, 14:00:01] Project Falcon: {LRM}You created the group "Project Falcon".',
    f'[04/03/25, 14:00:02] Priya Nandakumar: {LRM}You added Priya Nandakumar.',
    f'[04/03/25, 14:05:09] Priya Nandakumar: Draft is in the shared folder',
    f'[04/03/25, 14:06:11] Marcus Oyelaran: {LRM}Image omitted',
    f'{LRM}[04/03/25, 14:06:12] Priya Nandakumar: {LRM}<attached: 00000012-PHOTO-2025-03-04-14-06-12.jpg>',
    f'[04/03/25, 14:07:30] Marcus Oyelaran: Agenda:',
    '1. budget',
    '2. hiring: next week',
    f'[04/03/25, 14:08:00] Marcus Oyelaran: Moved to 3pm {LRM}<This message was edited.>',
    f'[04/03/25, 14:09:00] Marcus Oyelaran: @{FSI}Priya Nandakumar{PDI} can you check?',
    f'[04/03/25, 14:10:00] ~{NNBSP}Dana: hi all, @{FSI}~{NNBSP}Ghost Person{PDI} too',
    f'[05/03/25, 09:00:00] Priya Nandakumar: {LRM}This message was deleted.',
    f'[13/03/25, 18:30:45] Dana: {LRM}Dana left',
    f'[13/03/25, 18:31:00] Marcus Oyelaran: Missed voice call. Tap to call back',
]) + '\n'
with zipfile.ZipFile('WhatsApp Chat - Project Falcon.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('_chat.txt', ios.encode('utf-8'))
    z.writestr('00000012-PHOTO-2025-03-04-14-06-12.jpg', b'\xff\xd8\xff')
    z.writestr('__MACOSX/._chat.txt', b'junk')

# 2. Android one-to-one, m/d/yy 12h with U+202F before AM/PM, CRLF line ends.
android = '\r\n'.join([
    '3/14/25, 9:00' + NNBSP + 'AM - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them. Tap to learn more.',
    '3/14/25, 9:01' + NNBSP + 'AM - Leo Brandt: morning',
    '3/14/25, 12:15' + NNBSP + 'PM - Marcus Oyelaran: <Media omitted>',
    '3/14/25, 12:16' + NNBSP + 'PM - Marcus Oyelaran: ' + LRM + 'IMG-20250314-WA0003.jpg (file attached)',
    'caption for the photo',
    '3/14/25, 12:30' + NNBSP + 'AM - Leo Brandt: late one',
    'second line',
    '2016-04-29 10:30:00',
    '3/15/25, 1:05' + NNBSP + 'PM - Leo Brandt: <media omitted>',
    '3/15/25, 1:06' + NNBSP + 'PM - Leo Brandt: You deleted this message',
]) + '\r\n'
open('WhatsApp Chat with Marcus Oyelaran.txt', 'w', encoding='utf-8', newline='').write(android)

# 3. Android Spanish group, d/m/yyyy 12h with 'p. m.' (NBSP between p. and m.),
#    authorless system lines.
es = '\n'.join([
    '04/03/2025, 2:05 p.' + NBSP + 'm. - Alex Ruiz creó el grupo "Equipo"',
    '04/03/2025, 2:05 p.' + NBSP + 'm. - Alex Ruiz added Sara Gil, Tomás Vidal and Ines Mora',
    '04/03/2025, 2:06 p. m. - Alex Ruiz: Hola',
    '04/03/2025, 2:07 p. m. - Sara Gil: Listo',
    '05/03/2025, 12:30 a. m. - Tomás Vidal: tarde',
    '20/03/2025, 11:00 a. m. - Ines Mora left',
    '20/03/2025, 11:01 a. m. - Alex Ruiz removed Sara Gil',
    '20/03/2025, 11:02 a. m. - Pablo Ortiz joined using this group\'s invite link',
    '20/03/2025, 11:03 a. m. - +44 7700 900123: hola',
    '20/03/2025, 11:04 a. m. - Alex Ruiz: bienvenido @447700900123',
]) + '\n'
open('WhatsApp Chat with Equipo.txt', 'w', encoding='utf-8').write(es)
