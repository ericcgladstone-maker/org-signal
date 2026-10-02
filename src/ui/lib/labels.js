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
