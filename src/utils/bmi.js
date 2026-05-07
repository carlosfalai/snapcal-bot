// Mifflin-St Jeor TDEE + daily calorie target.
// Activity factor default: 1.3 (sedentary office). Goal-adjusted target:
//   lose:    TDEE - 500 (clamped to >= 1200 women / 1500 men)
//   maintain: TDEE
//   gain:    TDEE + 300

function bmr({ weight_kg, height_cm, age, sex }) {
  const w = parseFloat(weight_kg), h = parseFloat(height_cm), a = parseInt(age, 10);
  if (!isFinite(w) || !isFinite(h) || !isFinite(a)) return null;
  if (sex === 'm' || sex === 'male') return 10 * w + 6.25 * h - 5 * a + 5;
  return 10 * w + 6.25 * h - 5 * a - 161;
}

function tdee(profile, activityFactor = 1.3) {
  const b = bmr(profile);
  if (b == null) return null;
  return Math.round(b * activityFactor);
}

function dailyTarget(profile) {
  const t = tdee(profile);
  if (t == null) return null;
  const floor = (profile.sex === 'm' || profile.sex === 'male') ? 1500 : 1200;
  if (profile.goal === 'lose')   return Math.max(floor, t - 500);
  if (profile.goal === 'gain')   return t + 300;
  return t;
}

function bmi({ weight_kg, height_cm }) {
  const w = parseFloat(weight_kg), h = parseFloat(height_cm) / 100;
  if (!isFinite(w) || !isFinite(h) || h <= 0) return null;
  return +(w / (h * h)).toFixed(1);
}

function bmiLabel(value) {
  if (value == null) return null;
  if (value < 18.5) return 'underweight';
  if (value < 25)   return 'healthy';
  if (value < 30)   return 'overweight';
  return 'obese';
}

module.exports = { bmr, tdee, dailyTarget, bmi, bmiLabel };
