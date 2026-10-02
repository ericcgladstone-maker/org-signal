// Number and date formatting shared by every view. Numbers are shown with as
// many significant digits as the measure can defend, not as many as a
// Float64 holds; dates are UTC unless the source says otherwise, because the
// model stores UTC ms.

export function fmtNum(v, { digits = 3 } = {}) {
  if (v == null || Number.isNaN(v)) return '–';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
  if (Number.isInteger(v) && Math.abs(v) < 1e7) return v.toLocaleString('en-US');
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1000) return Math.round(v).toLocaleString('en-US');
  if (a >= 1) return Number(v.toFixed(Math.max(0, digits - 1 - Math.floor(Math.log10(a))))).toString();
  if (a < 1e-6) return v.toExponential(1);
  return Number(v.toPrecision(digits)).toString();
}

export function fmtInt(v) {
  if (v == null || Number.isNaN(v)) return '–';
  return Math.round(v).toLocaleString('en-US');
}

export function fmtPct(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return '–';
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtP(p) {
  if (p == null || Number.isNaN(p)) return '–';
  if (p < 0.001) return 'p < 0.001';
  return `p = ${p.toFixed(3)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(t) {
  if (t == null || !Number.isFinite(t)) return 'unknown';
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function fmtDateTime(t) {
  if (t == null || !Number.isFinite(t)) return 'unknown time';
  const d = new Date(t);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${fmtDate(t)}, ${hh}:${mm} UTC`;
}

export function isoDay(t) {
  if (!Number.isFinite(t)) return '';
  return new Date(t).toISOString().slice(0, 10);
}

export function fmtRange(a, b) {
  if (!Number.isFinite(a) && !Number.isFinite(b)) return 'no timestamps';
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}

export function plural(n, one, many = `${one}s`) {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

export function fmtBytes(b) {
  if (!(b >= 0)) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

// Turn "inDegree" / "largest_component_share" into "In degree" / "Largest component share".
export function humanize(key) {
  return String(key)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, c => c.toUpperCase())
    .replace(/\b([A-Z])([a-z]+)/g, (m, a, b, i) => (i === 0 ? m : m.toLowerCase()));
}
