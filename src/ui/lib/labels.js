// Geometry for the network map's labels and layout, kept free of the DOM
// and of sigma so it can be tested in Node.

// Rotate a force layout so its long axis runs along the canvas's long side.
// Force layouts have no meaningful orientation, and sigma fits the bounding
// box preserving aspect, so an unrotated layout used under half of a wide
// canvas. Returns rotated copies.
export function orientLayout(x, y, wide) {
  const n = x.length;
  if (n < 3) return { x, y };
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // angle of the principal axis
  const rot = (wide ? 0 : Math.PI / 2) - theta;
  const c = Math.cos(rot), s = Math.sin(rot);
  const X = new Float32Array(n), Y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; X[i] = dx * c - dy * s; Y[i] = dx * s + dy * c; }
  return { x: X, y: Y };
}

// How many labels to place: everyone in a small network; otherwise the 8
// largest (4 on a phone), more as the reader zooms in, and a dozen more for
// the neighbors of a selection.
export function labelBudget({ n, width, ratio, focus }) {
  if (n <= 30) return Infinity;
  const base = width < 600 ? 4 : 8;
  const zoom = Math.min(6, Math.max(1, 1 / (ratio || 1)));
  return Math.round(base * zoom) + (focus ? 12 : 0);
}

export function overlaps(a, list, pad = 2) {
  for (const b of list) if (a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y) return true;
  return false;
}

// Where to name each group on the map: not the mean of all its members (a
// group spread over the map would be named in the middle of someone else's
// cluster) but the mean of its members in the densest 3x3 block of a grid
// laid over the layout, where most of the group actually sits. keyOf(i)
// gives node i's group ('' or null for none). Returns [{ key, x, y, n }],
// n being the whole group's size, largest first.
export function groupAnchors(x, y, keyOf, { grid = 24 } = {}) {
  const n = x.length;
  if (!n) return [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { if (x[i] < x0) x0 = x[i]; if (x[i] > x1) x1 = x[i]; if (y[i] < y0) y0 = y[i]; if (y[i] > y1) y1 = y[i]; }
  const sx = (x1 - x0) / grid || 1, sy = (y1 - y0) / grid || 1;
  const cellOf = i => Math.min(grid - 1, Math.floor((x[i] - x0) / sx)) * grid + Math.min(grid - 1, Math.floor((y[i] - y0) / sy));
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const k = keyOf(i);
    if (k == null || k === '') continue;
    let g = groups.get(k);
    if (!g) groups.set(k, g = { n: 0, cells: new Map() });
    g.n++;
    const c = cellOf(i);
    g.cells.set(c, (g.cells.get(c) || 0) + 1);
  }
  const best = new Map();
  for (const [k, g] of groups) {
    let top = -1, at = 0;
    for (const c of g.cells.keys()) {
      const cx = Math.floor(c / grid), cy = c % grid;
      let s = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const X = cx + dx, Y = cy + dy;
        if (X >= 0 && Y >= 0 && X < grid && Y < grid) s += g.cells.get(X * grid + Y) || 0;
      }
      if (s > top || (s === top && c < at)) { top = s; at = c; }
    }
    best.set(k, { cx: Math.floor(at / grid), cy: at % grid, sx: 0, sy: 0, m: 0 });
  }
  for (let i = 0; i < n; i++) {
    const k = keyOf(i);
    const b = k == null || k === '' ? null : best.get(k);
    if (!b) continue;
    const c = cellOf(i);
    if (Math.abs(Math.floor(c / grid) - b.cx) <= 1 && Math.abs((c % grid) - b.cy) <= 1) { b.sx += x[i]; b.sy += y[i]; b.m++; }
  }
  return [...groups.entries()].map(([key, g]) => { const b = best.get(key); return { key, x: b.sx / b.m, y: b.sy / b.m, n: g.n }; })
    .sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// Small or hand-drawn maps (L5): every person keeps their name, so a group's
// name (or community number) goes on the edge of the group, not on a member.
// members: [{ x, y, r }] in viewport pixels for one group. Returns the
// candidate spots for a w x h label in order of preference: centered above
// the group's top member, below its bottom member, left of its leftmost and
// right of its rightmost. The caller takes the first that fits.
export function hullEdgeSpots(members, w, h, gap = 6) {
  if (!members.length) return [];
  let top = members[0], bottom = members[0], left = members[0], right = members[0];
  let cx = 0, cy = 0;
  for (const m of members) {
    cx += m.x; cy += m.y;
    if (m.y - m.r < top.y - top.r) top = m;
    if (m.y + m.r > bottom.y + bottom.r) bottom = m;
    if (m.x - m.r < left.x - left.r) left = m;
    if (m.x + m.r > right.x + right.r) right = m;
  }
  cx /= members.length; cy /= members.length;
  return [
    { x: cx - w / 2, y: top.y - top.r - gap - h, w, h },
    { x: cx - w / 2, y: bottom.y + bottom.r + gap, w, h },
    { x: left.x - left.r - gap - w, y: cy - h / 2, w, h },
    { x: right.x + right.r + gap, y: cy - h / 2, w, h },
  ];
}

// When people's names win over group names: the map labels everyone (30 or
// fewer people) or the layout is as drawn.
export function namesFirst(n, drawn) {
  return !!drawn || n <= 30;
}
