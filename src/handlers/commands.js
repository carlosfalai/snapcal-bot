const { query } = require('../db');
const { progressBar, weekChart } = require('../utils/bars');
const { bmi, bmiLabel } = require('../utils/bmi');
const { currentStreak } = require('../utils/streak');
const { createCheckoutSession, isActive } = require('../services/stripe');
const { todayTotalKcal } = require('./photo');
const { floatInRange } = require('../utils/validators');

function persistentKeyboard() {
  return {
    keyboard: [
      [{ text: 'Today' }, { text: 'Week' }],
      [{ text: 'Stats' }, { text: 'Log Weight' }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

async function showToday(bot, chatId, user) {
  const total = await todayTotalKcal(user.id);
  const target = user.daily_target_kcal || 2000;
  const remaining = Math.max(0, target - total);
  const r = await query(
    `SELECT COALESCE(SUM(protein_g),0) p, COALESCE(SUM(carbs_g),0) c, COALESCE(SUM(fat_g),0) f, COUNT(*) n
       FROM meals WHERE user_id = $1 AND deleted_at IS NULL AND captured_at::date = CURRENT_DATE`,
    [user.id]
  );
  const m = r.rows[0];
  const bar = progressBar(total, target);
  await bot.sendMessage(chatId,
    `Today: ${total}/${target} kcal\n${bar}\n` +
    `Remaining: ${remaining} kcal\n` +
    `Macros: P${m.p} C${m.c} F${m.f}\n` +
    `Meals logged: ${m.n}`,
    { reply_markup: persistentKeyboard() }
  );
}

async function showWeek(bot, chatId, user) {
  const r = await query(
    `WITH days AS (
       SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day')::date AS d
     )
     SELECT d, COALESCE((SELECT SUM(kcal) FROM meals
                          WHERE user_id = $1 AND deleted_at IS NULL
                            AND captured_at::date = d), 0)::int AS kcal
       FROM days ORDER BY d`,
    [user.id]
  );
  const days = r.rows.map(row => row.kcal);
  const target = user.daily_target_kcal || 2000;
  const avg = Math.round(days.reduce((a, b) => a + b, 0) / 7);
  const today = days[days.length - 1];
  const delta = today - avg;
  const trend = delta === 0 ? 'on average' : (delta > 0 ? `+${delta} above average` : `${delta} below average`);
  await bot.sendMessage(chatId,
    `7-day intake\n${weekChart(days, target)}\n` +
    `Average: ${avg} kcal/day\nToday: ${trend}`,
    { reply_markup: persistentKeyboard() }
  );
}

async function showStats(bot, chatId, user) {
  const wRes = await query(
    `SELECT weight_kg, recorded_at FROM weights WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
    [user.id]
  );
  const w = wRes.rows[0]?.weight_kg || user.weight_kg;
  const b = bmi({ weight_kg: w, height_cm: user.height_cm });
  const streak = await currentStreak(user.id);
  const meals = await query(`SELECT COUNT(*) n FROM meals WHERE user_id = $1 AND deleted_at IS NULL`, [user.id]);
  await bot.sendMessage(chatId,
    `Profile\n` +
    `  Weight: ${w} kg\n` +
    `  Height: ${user.height_cm} cm\n` +
    `  Age: ${user.age}\n` +
    `  Goal: ${user.goal}\n` +
    `BMI: ${b ?? 'n/a'} (${bmiLabel(b) || 'n/a'})\n` +
    `Daily target: ${user.daily_target_kcal} kcal (TDEE ${user.tdee})\n` +
    `Streak: ${streak} day${streak === 1 ? '' : 's'}\n` +
    `Meals tracked: ${meals.rows[0].n}`,
    { reply_markup: persistentKeyboard() }
  );
}

async function logWeightStart(bot, chatId) {
  await bot.sendMessage(chatId, 'Send your current weight in kg (e.g. 78.4).', { reply_markup: persistentKeyboard() });
}

async function logWeightValue(bot, chatId, user, text) {
  const w = floatInRange(text, 30, 300);
  if (w == null) {
    await bot.sendMessage(chatId, 'Send weight in kg between 30 and 300.');
    return false;
  }
  await query('INSERT INTO weights (user_id, weight_kg) VALUES ($1, $2)', [user.id, w]);
  await query('UPDATE users SET weight_kg = $1, updated_at = NOW() WHERE id = $2', [w, user.id]);
  await bot.sendMessage(chatId, `Weight logged: ${w} kg.`, { reply_markup: persistentKeyboard() });
  return true;
}

async function showHelp(bot, chatId) {
  await bot.sendMessage(chatId,
    'Snapcal commands\n' +
    '  Send a meal photo — I estimate kcal and macros\n' +
    '  /log <description> — text-only meal entry\n' +
    '  /today — today total\n' +
    '  /week — last 7 days\n' +
    '  /stats — profile + streak\n' +
    '  /weight <kg> — log your current weight\n' +
    '  /pause <days> — quiet mode for vacation\n' +
    '  /paywall — subscription link\n' +
    '  /cancel — exit current step\n',
    { reply_markup: persistentKeyboard() }
  );
}

async function pauseUser(bot, chatId, user, days) {
  const n = parseInt(days, 10);
  if (!Number.isFinite(n) || n < 1 || n > 60) {
    await bot.sendMessage(chatId, 'Use /pause <days> with 1-60.');
    return;
  }
  const until = new Date(Date.now() + n * 86400000);
  await query('UPDATE users SET paused_until = $1, updated_at = NOW() WHERE id = $2', [until, user.id]);
  await bot.sendMessage(chatId, `Paused daily summaries for ${n} days. Resume by sending /resume.`);
}

async function resumeUser(bot, chatId, user) {
  await query('UPDATE users SET paused_until = NULL, updated_at = NOW() WHERE id = $1', [user.id]);
  await bot.sendMessage(chatId, 'Resumed.');
}

async function showPaywall(bot, chatId, user) {
  if (isActive(user)) {
    await bot.sendMessage(chatId, 'Subscription is active.');
    return;
  }
  const url = await createCheckoutSession({ id: user.id, telegram_id: user.telegram_id });
  await bot.sendMessage(chatId, `Subscribe ($17/month): ${url}`);
}

module.exports = {
  persistentKeyboard, showToday, showWeek, showStats, logWeightStart, logWeightValue,
  showHelp, pauseUser, resumeUser, showPaywall,
};
