function intInRange(s, lo, hi) {
  const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

function floatInRange(s, lo, hi) {
  const n = parseFloat(String(s).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

function clamp(s, max = 500) {
  if (typeof s !== 'string') return '';
  return s.slice(0, max).replace(/[<>{}]/g, '');
}

function parseSex(s) {
  const t = String(s || '').trim().toLowerCase();
  if (['m', 'male', 'man', 'h', 'homme'].includes(t)) return 'm';
  if (['f', 'female', 'woman', 'femme'].includes(t)) return 'f';
  return null;
}

function parseGoal(s) {
  const t = String(s || '').trim().toLowerCase();
  if (['lose', 'cut', 'down', 'weight loss'].some(k => t.includes(k))) return 'lose';
  if (['gain', 'bulk', 'up'].some(k => t.includes(k))) return 'gain';
  if (['maintain', 'hold', 'stay'].some(k => t.includes(k))) return 'maintain';
  return null;
}

module.exports = { intInRange, floatInRange, clamp, parseSex, parseGoal };
