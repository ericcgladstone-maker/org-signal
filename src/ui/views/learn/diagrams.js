// Tiny static figures for the five core ideas in Learn (degree, betweenness,
// closeness, clustering, constraint). Concept drawings, not data: one person
// in focus wears the first categorical color (--cat-1), everyone else the
// site's node ink, ties the edge ink; a tie that matters is drawn in --cat-1
// at 2px, a missing tie dashed. Text stays in ink tokens. Each figure has a
// text equivalent (aria-label plus the caption), so nothing is read from
// color alone.

import { html } from '../../../../vendor/preact.js';

const R = 6;   // node radius (12px marks)
const RF = 8;  // the person in focus

function Fig({ label, caption, children, h = 130 }) {
  return html`<figure class="learn-fig">
    <svg viewBox=${`0 0 240 ${h}`} role="img" aria-label=${label}>${children}</svg>
    <figcaption>${caption}</figcaption>
  </figure>`;
}

const tie = ([x1, y1], [x2, y2], kind = '') => html`<line x1=${x1} y1=${y1} x2=${x2} y2=${y2} class=${`lf-tie${kind ? ` lf-tie--${kind}` : ''}`} />`;
const node = ([x, y], focus = false) => html`<circle cx=${x} cy=${y} r=${focus ? RF : R} class=${focus ? 'lf-node lf-node--focus' : 'lf-node'} />`;
const text = ([x, y], s, anchor = 'middle') => html`<text x=${x} y=${y} text-anchor=${anchor} class="lf-text">${s}</text>`;

function Degree() {
  const c = [120, 66], a = [60, 26], b = [180, 26], d = [60, 106], e = [180, 106], f = [226, 66];
  return html`<${Fig} label="One person tied to four others; the others have one or two ties." caption="The person in the middle has 4 contacts (degree 4). Count the lines that touch a person.">
    ${tie(c, a)}${tie(c, b)}${tie(c, d)}${tie(c, e)}${tie(b, f)}
    ${[a, b, d, e, f].map(p => node(p))}${node(c, true)}
    ${text([120, 94], '4')}${text([46, 30], '1', 'end')}${text([180, 12], '2')}${text([46, 110], '1', 'end')}${text([194, 110], '1', 'start')}${text([226, 88], '1')}
  </${Fig}>`;
}

function Betweenness() {
  const l1 = [26, 30], l2 = [26, 102], l3 = [70, 66], m = [120, 66], r1 = [170, 66], r2 = [214, 30], r3 = [214, 102];
  return html`<${Fig} label="Two triangles joined only through one person in the middle." caption="Every shortest route between the two sides passes through the person in the middle: the highest betweenness, with only 2 contacts.">
    ${tie(l1, l2)}${tie(l1, l3)}${tie(l2, l3)}${tie(r1, r2)}${tie(r1, r3)}${tie(r2, r3)}
    ${tie(l3, m, 'key')}${tie(m, r1, 'key')}
    ${[l1, l2, l3, r1, r2, r3].map(p => node(p))}${node(m, true)}
  </${Fig}>`;
}

function Closeness() {
  const xs = [30, 75, 120, 165, 210];
  const lab = ['1/2', '1', '', '1', '1/2'];
  return html`<${Fig} h=${110} label="A path of five people; the middle one is one step from two people and two steps from two." caption="Harmonic closeness of the middle person: (1/2 + 1 + 1 + 1/2) / 4 = 0.75. Each number is 1 / distance from the middle.">
    ${xs.slice(1).map((x, i) => tie([xs[i], 55], [x, 55]))}
    ${xs.map((x, i) => node([x, 55], i === 2))}
    ${xs.map((x, i) => (lab[i] ? text([x, 85], lab[i]) : ''))}
  </${Fig}>`;
}

function Clustering() {
  const c = [120, 106], a = [56, 40], b = [120, 20], d = [184, 40];
  return html`<${Fig} label="A person with three contacts; two of the three possible ties among the contacts exist, one is missing." caption="2 of the 3 possible ties among this person's contacts exist (the dashed one does not): clustering 2/3 = 0.67.">
    ${tie(c, a)}${tie(c, b)}${tie(c, d)}
    ${tie(a, b, 'key')}${tie(b, d, 'key')}${tie(a, d, 'missing')}
    ${[a, b, d].map(p => node(p))}${node(c, true)}
  </${Fig}>`;
}

function Constraint() {
  const left = { e: [62, 104], a: [22, 46], b: [62, 22], c: [102, 46] };
  const right = { e: [178, 104], a: [138, 46], b: [178, 22], c: [218, 46] };
  const ego = g => html`${tie(g.e, g.a)}${tie(g.e, g.b)}${tie(g.e, g.c)}`;
  return html`<${Fig} h=${150} label="Left: a person whose three contacts all know each other. Right: a person whose three contacts do not know each other." caption="Left, closed: the contacts all know each other, so constraint is high and effective size low. Right, brokering: the contacts do not know each other, so constraint is low and effective size is 3.">
    ${ego(left)}${tie(left.a, left.b, 'key')}${tie(left.b, left.c, 'key')}${tie(left.a, left.c, 'key')}
    ${ego(right)}
    ${[left.a, left.b, left.c, right.a, right.b, right.c].map(p => node(p))}${node(left.e, true)}${node(right.e, true)}
    ${text([62, 140], 'closed')}${text([178, 140], 'brokering')}
  </${Fig}>`;
}

export const DIAGRAMS = { degree: Degree, betweenness: Betweenness, closeness: Closeness, clustering: Clustering, constraint: Constraint };
