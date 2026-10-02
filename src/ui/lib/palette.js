// Chart and graph colors, read from the CSS tokens so there is one source.
//
// The values live in assets/app.css (--cat-*, --seq-*, --div-*). They were
// derived from the site's ground (#071A2B) and accent family and run through
// the dataviz validator (lightness band, chroma floor, adjacent CVD and
// normal-vision separation, contrast against the ground); see the comment in
// app.css for the numbers. JS needs hex strings for WebGL and SVG export, so
// we read the computed tokens once at startup.
//
// Rules carried here so callers cannot get them wrong:
//  - categorical hues are assigned in fixed slot order to a FIXED ordering of
//    the categories (decided once per attribute over the whole dataset), so a
//    filter never repaints the survivors;
//  - more than 8 categories fold the tail into "Other", never a 9th hue;
//  - sequential is one hue, dark (near the ground) to light;
//  - diverging is two hues with a neutral midpoint.

import * as d3 from '../../../vendor/d3.js';

const FALLBACK = {
  cat: ['#13aa89', '#bb881a', '#9470cd', '#d36757', '#21a3bc', '#6ba04b', '#528ed9', '#c96598'],
  seq: ['#16594b', '#1f7d69', '#29a288', '#46c6aa', '#7be9cd', '#c5fcec'],
  div: ['#85b6e9', '#4e90d2', '#2a3a48', '#cf6b5b', '#e59c8f'],
  other: '#5b6f80',
  node: '#D8F2FF',
  edge: '#6FA79B',
  accent: '#6FD8BE',
  bg: '#071A2B',
  bgDeep: '#051521',
  text: '#F6FAFD',
  text2: '#C6D3DE',
  muted: '#9FB2C1',
};

let cache = null;

export function tokens() {
  if (cache) return cache;
  const out = structuredClone(FALLBACK);
  try {
    const cs = getComputedStyle(document.documentElement);
    const v = name => cs.getPropertyValue(name).trim();
    const cat = [1, 2, 3, 4, 5, 6, 7, 8].map(i => v(`--cat-${i}`));
    if (cat.every(Boolean)) out.cat = cat;
    const seq = [0, 1, 2, 3, 4, 5].map(i => v(`--seq-${i}`)).filter(Boolean);
    if (seq.length >= 5) out.seq = seq;
    const div = ['--div-neg-2', '--div-neg-1', '--div-mid', '--div-pos-1', '--div-pos-2'].map(v);
    if (div.every(Boolean)) out.div = div;
    for (const [k, name] of [['other', '--cat-other'], ['node', '--node'], ['edge', '--edge'], ['accent', '--accent'],
      ['bg', '--bg'], ['bgDeep', '--bg-deep'], ['text', '--text'], ['text2', '--text-2'], ['muted', '--text-muted']]) {
      const x = v(name); if (x) out[k] = x;
    }
  } catch { /* no DOM (tests): keep fallbacks */ }
  cache = out;
  return out;
}

// Category -> colour map. `values` must already be in the fixed order the
// caller wants (by size over the whole dataset, then name), so the mapping is
// decided once and reused by every filter state.
//
// `hues` caps the distinct hues: where any two groups can touch (the network
// map), only the first few slots stay apart under every color-vision
// deficiency, so the map passes hues: 5 and the rest share "Other".
export function categoricalScale(values, { hues = null } = {}) {
  const t = tokens();
  const map = new Map();
  const shown = hues != null ? values.slice(0, hues) : values.length > 8 ? values.slice(0, 7) : values.slice(0, 8);
  shown.forEach((v, i) => map.set(String(v), t.cat[i]));
  const folded = values.length > shown.length;
  return {
    color: v => map.get(String(v)) ?? t.other,
    entries: [...map.entries()].map(([value, color]) => ({ value, color })),
    folded,             // true when an "Other" swatch is needed
    otherColor: t.other,
  };
}

// Sequential: value in [lo, hi] -> colour along the one-hue ramp.
export function sequentialScale(lo, hi) {
  const t = tokens();
  const interp = d3.piecewise(d3.interpolateLab, t.seq);
  const span = hi - lo || 1;
  const f = v => (Number.isFinite(v) ? interp(Math.max(0, Math.min(1, (v - lo) / span))) : t.other);
  f.ramp = t.seq;
  f.domain = [lo, hi];
  return f;
}

// Diverging around a midpoint (0 by default), symmetric extent.
export function divergingScale(extent, mid = 0) {
  const t = tokens();
  const interp = d3.piecewise(d3.interpolateLab, t.div);
  const e = extent || 1;
  const f = v => (Number.isFinite(v) ? interp(Math.max(0, Math.min(1, ((v - mid) / e + 1) / 2))) : t.other);
  f.ramp = t.div;
  f.domain = [mid - e, mid + e];
  return f;
}

// Hex -> rgba() with alpha, for dimmed graph elements.
export function withAlpha(hex, a) {
  const c = d3.color(hex);
  if (!c) return hex;
  c.opacity = a;
  return c.formatRgb();
}

// Mix toward the ground: used to dim non-highlighted nodes without
// transparency (WebGL node programs blend poorly with many overlaps).
export function dim(hex, amount = 0.75) {
  return d3.interpolateLab(hex, tokens().bg)(amount);
}

// Mix colour a toward b by t (0 = a, 1 = b), in Lab.
export function mixTo(a, b, t) {
  return d3.color(d3.interpolateLab(a, b)(t)).formatHex();
}
