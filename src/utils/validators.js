function intInRange(s, lo, hi) {
  const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

function floatInRange(s, lo, hi) {
  const n = parseFloat(String(s).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

// Parse weight with unit awareness. Accepts:
//   "78", "78.4", "78kg", "78 kg" -> kg
//   "180lbs", "180 lb", "180 pounds" -> converted to kg
//   "11st 4lb", "11st4" -> stones converted (rare but harmless)
// Returns kg as float, or null if out of [30, 300] kg range.
function parseWeightKg(s) {
  const t = String(s || '').trim().toLowerCase().replace(',', '.');
  if (!t) return null;
  let kg = null;
  const stoneM = t.match(/^(\d+(?:\.\d+)?)\s*st(?:ones?)?\s*(\d+(?:\.\d+)?)?\s*lb?s?$/);
  const lbsM   = t.match(/(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)\b/);
  const kgM    = t.match(/(\d+(?:\.\d+)?)\s*(?:kg|kilos?|kilograms?)\b/);
  if (stoneM) {
    kg = parseFloat(stoneM[1]) * 6.35029 + (parseFloat(stoneM[2] || '0')) * 0.45359237;
  } else if (lbsM) {
    kg = parseFloat(lbsM[1]) * 0.45359237;
  } else if (kgM) {
    kg = parseFloat(kgM[1]);
  } else {
    const num = parseFloat(t.replace(/[^\d.]/g, ''));
    if (Number.isFinite(num)) kg = num;
  }
  if (!Number.isFinite(kg)) return null;
  kg = +kg.toFixed(1);
  if (kg < 30 || kg > 300) return null;
  return kg;
}

// Parse height. Accepts:
//   "175", "175cm", "175 cm" -> cm
//   "5'10", "5ft10", "5 ft 10 in", "5'10\"" -> converted from feet+inches
//   "70in", "70 inches" -> inches
// Returns cm as int in [100, 230] or null.
function parseHeightCm(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return null;
  let cm = null;
  const ftIn = t.match(/(\d+)\s*(?:ft|')\s*(\d+(?:\.\d+)?)?\s*(?:in|"|inch|inches)?/);
  const inOnly = t.match(/^(\d+(?:\.\d+)?)\s*(?:in|inch|inches)\b/);
  const cmM = t.match(/(\d+(?:\.\d+)?)\s*cm\b/);
  if (ftIn && /[ft']/.test(t)) {
    const ft = parseFloat(ftIn[1]);
    const inches = parseFloat(ftIn[2] || '0');
    cm = ft * 30.48 + inches * 2.54;
  } else if (inOnly) {
    cm = parseFloat(inOnly[1]) * 2.54;
  } else if (cmM) {
    cm = parseFloat(cmM[1]);
  } else {
    const num = parseFloat(t.replace(/[^\d.]/g, ''));
    if (Number.isFinite(num)) cm = num;
  }
  if (!Number.isFinite(cm)) return null;
  cm = Math.round(cm);
  if (cm < 100 || cm > 230) return null;
  return cm;
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

module.exports = { intInRange, floatInRange, clamp, parseSex, parseGoal, parseWeightKg, parseHeightCm };
