const { query } = require('../db');
const { hash, normalizePhone, checkLoginRate, recordLoginAttempt } = require('../utils/auth');
const { intInRange, floatInRange, parseSex, parseGoal } = require('../utils/validators');
const { tdee, dailyTarget, bmi, bmiLabel } = require('../utils/bmi');
const { createCheckoutSession } = require('../services/stripe');

const STEPS = ['phone', 'pin', 'pin_confirm', 'weight', 'height', 'age', 'sex', 'goal', 'paywall'];

async function getPending(telegramId) {
  const r = await query('SELECT * FROM auth_pending WHERE telegram_id = $1', [telegramId]);
  return r.rows[0] || null;
}

async function setPending(telegramId, step, data) {
  await query(
    `INSERT INTO auth_pending (telegram_id, step, data_json, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (telegram_id) DO UPDATE
       SET step = EXCLUDED.step, data_json = EXCLUDED.data_json, updated_at = NOW()`,
    [telegramId, step, JSON.stringify(data || {})]
  );
}

async function clearPending(telegramId) {
  await query('DELETE FROM auth_pending WHERE telegram_id = $1', [telegramId]);
}

async function getUserByTelegramId(telegramId) {
  const r = await query(
    `SELECT id, telegram_id, weight_kg, height_cm, age, sex, goal, tdee, daily_target_kcal,
            stripe_customer_id, subscription_status, subscription_period_end, paused_until,
            daily_summary_enabled, timezone
       FROM users WHERE telegram_id = $1`,
    [telegramId]
  );
  return r.rows[0] || null;
}

async function startOnboarding(bot, chatId, telegramId) {
  const user = await getUserByTelegramId(telegramId);
  if (user) {
    await bot.sendMessage(chatId, 'Welcome back. Send a meal photo or use the menu.');
    return;
  }
  await setPending(telegramId, 'phone', {});
  await bot.sendMessage(chatId,
    'Welcome to Snapcal. Snap a meal, see your day.\n\n' +
    'First: send your phone number (digits only, e.g. 5141234567).'
  );
}

async function handleMessage(bot, msg) {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const text = (msg.text || '').trim();
  const pending = await getPending(telegramId);
  if (!pending) return false;

  const data = pending.data_json || {};
  const step = pending.step;

  if (step === 'phone') {
    const digits = normalizePhone(text);
    if (digits.length < 7 || digits.length > 15) {
      await bot.sendMessage(chatId, 'That does not look like a phone number. Try again with digits only.');
      return true;
    }
    data.phone_hash = hash(digits);
    await setPending(telegramId, 'pin', data);
    await bot.sendMessage(chatId, 'Now choose a 4-digit PIN. Send 4 digits.');
    return true;
  }

  if (step === 'pin') {
    if (!/^\d{4}$/.test(text)) {
      await bot.sendMessage(chatId, 'PIN must be exactly 4 digits.');
      return true;
    }
    try { await bot.deleteMessage(chatId, msg.message_id); } catch {}
    data.pin_hash = hash(text);
    await setPending(telegramId, 'pin_confirm', data);
    await bot.sendMessage(chatId, 'Confirm your PIN — send the same 4 digits again.');
    return true;
  }

  if (step === 'pin_confirm') {
    if (!/^\d{4}$/.test(text)) {
      await bot.sendMessage(chatId, 'PIN must be exactly 4 digits.');
      return true;
    }
    try { await bot.deleteMessage(chatId, msg.message_id); } catch {}
    if (hash(text) !== data.pin_hash) {
      await bot.sendMessage(chatId, 'PINs do not match. Send your 4-digit PIN again.');
      data.pin_hash = null;
      await setPending(telegramId, 'pin', data);
      return true;
    }
    await setPending(telegramId, 'weight', data);
    await bot.sendMessage(chatId, 'Your weight in kg (e.g. 78.5).');
    return true;
  }

  if (step === 'weight') {
    const w = floatInRange(text, 30, 300);
    if (w == null) { await bot.sendMessage(chatId, 'Send weight in kg between 30 and 300.'); return true; }
    data.weight_kg = w;
    await setPending(telegramId, 'height', data);
    await bot.sendMessage(chatId, 'Your height in cm (e.g. 175).');
    return true;
  }

  if (step === 'height') {
    const h = intInRange(text, 100, 230);
    if (h == null) { await bot.sendMessage(chatId, 'Send height in cm between 100 and 230.'); return true; }
    data.height_cm = h;
    await setPending(telegramId, 'age', data);
    await bot.sendMessage(chatId, 'Your age in years.');
    return true;
  }

  if (step === 'age') {
    const a = intInRange(text, 14, 100);
    if (a == null) { await bot.sendMessage(chatId, 'Send age between 14 and 100.'); return true; }
    data.age = a;
    await setPending(telegramId, 'sex', data);
    await bot.sendMessage(chatId, 'Sex for calorie calculation: m or f.');
    return true;
  }

  if (step === 'sex') {
    const s = parseSex(text);
    if (!s) { await bot.sendMessage(chatId, 'Send m or f.'); return true; }
    data.sex = s;
    await setPending(telegramId, 'goal', data);
    await bot.sendMessage(chatId, 'Goal: lose, maintain, or gain.');
    return true;
  }

  if (step === 'goal') {
    const g = parseGoal(text);
    if (!g) { await bot.sendMessage(chatId, 'Send lose, maintain, or gain.'); return true; }
    data.goal = g;
    const t = tdee(data);
    const target = dailyTarget(data);
    const b = bmi(data);
    const ins = await query(
      `INSERT INTO users (telegram_id, phone_hash, pin_hash, weight_kg, height_cm, age, sex, goal, tdee, daily_target_kcal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (telegram_id) DO UPDATE SET
         phone_hash = EXCLUDED.phone_hash,
         pin_hash = EXCLUDED.pin_hash,
         weight_kg = EXCLUDED.weight_kg,
         height_cm = EXCLUDED.height_cm,
         age = EXCLUDED.age,
         sex = EXCLUDED.sex,
         goal = EXCLUDED.goal,
         tdee = EXCLUDED.tdee,
         daily_target_kcal = EXCLUDED.daily_target_kcal,
         updated_at = NOW()
       RETURNING id`,
      [telegramId, data.phone_hash, data.pin_hash, data.weight_kg, data.height_cm,
       data.age, data.sex, data.goal, t, target]
    );
    const userId = ins.rows[0].id;
    const checkoutUrl = await createCheckoutSession({ id: userId, telegram_id: telegramId });
    await setPending(telegramId, 'paywall', { user_id: userId });
    await bot.sendMessage(chatId,
      `Profile saved.\n` +
      `BMI: ${b ?? 'n/a'} (${bmiLabel(b) || 'n/a'})\n` +
      `Daily target: ${target} kcal\n` +
      `TDEE: ${t} kcal\n\n` +
      `To start logging, activate your subscription ($17/month):\n${checkoutUrl}\n\n` +
      `Once payment is confirmed I will message you here.`
    );
    return true;
  }

  if (step === 'paywall') {
    await bot.sendMessage(chatId, 'Waiting for your subscription to activate. After paying, you can send a meal photo.');
    return true;
  }

  return false;
}

module.exports = { startOnboarding, handleMessage, getUserByTelegramId, clearPending };
