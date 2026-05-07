const { query } = require('../db');
const { uploadMealPhoto } = require('../services/s3');
const { analyzeMealPhoto, analyzeMealText } = require('../services/bedrock');
const { progressBar } = require('../utils/bars');
const { isActive } = require('../services/stripe');

async function getOrAskForActive(bot, chatId, user) {
  if (isActive(user)) return true;
  await bot.sendMessage(chatId,
    'Your subscription is not active. Use /paywall to subscribe and start logging meals.'
  );
  return false;
}

async function todayTotalKcal(userId) {
  const r = await query(
    `SELECT COALESCE(SUM(kcal),0) AS total
       FROM meals
      WHERE user_id = $1
        AND deleted_at IS NULL
        AND captured_at::date = CURRENT_DATE`,
    [userId]
  );
  return parseInt(r.rows[0].total, 10);
}

function buildReply(user, analysis, todayBefore) {
  const kcal = analysis.kcal_total;
  const todayAfter = todayBefore + kcal;
  const target = user.daily_target_kcal || 2000;
  const remaining = Math.max(0, target - todayAfter);
  const macroLine = `P${analysis.protein_g} C${analysis.carbs_g} F${analysis.fat_g}`;
  const conf = analysis.confidence === 'low' ? ' (low confidence)' : '';
  const bar = progressBar(todayAfter, target);
  const lines = [
    `Logged: ${kcal} kcal${conf}`,
    `Macros: ${macroLine}`,
    `Today: ${todayAfter}/${target}  ${bar}`,
    `Remaining: ${remaining} kcal`,
  ];
  if (analysis.observation) lines.push('— ' + analysis.observation);
  return lines.join('\n');
}

async function fetchPhotoBuffer(bot, fileId) {
  const link = await bot.getFileLink(fileId);
  const resp = await fetch(link);
  if (!resp.ok) throw new Error('photo fetch failed: ' + resp.status);
  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
}

async function handlePhoto(bot, msg, user) {
  const chatId = msg.chat.id;
  if (!await getOrAskForActive(bot, chatId, user)) return;

  const photos = msg.photo || [];
  const best = photos[photos.length - 1];
  if (!best) return;

  let buffer;
  try {
    buffer = await fetchPhotoBuffer(bot, best.file_id);
  } catch (e) {
    await bot.sendMessage(chatId, 'Could not download the photo. Try again.');
    return;
  }

  let analysis = null;
  for (let attempt = 0; attempt < 2 && !analysis; attempt++) {
    try { analysis = await analyzeMealPhoto(buffer); }
    catch (e) { console.error('[photo] analyze attempt', attempt + 1, e.message); }
  }
  if (!analysis || analysis.kcal_total === 0) {
    await bot.sendMessage(chatId,
      'Could not analyze that photo. Try a clearer shot, or send: /log <description> e.g. /log grilled chicken salad with olive oil.'
    );
    return;
  }

  let s3Key = null;
  try { s3Key = await uploadMealPhoto(user.id, buffer); }
  catch (e) { console.error('[photo] s3 upload failed:', e.message); }

  const todayBefore = await todayTotalKcal(user.id);
  await query(
    `INSERT INTO meals (user_id, photo_s3_key, source, kcal, protein_g, carbs_g, fat_g, foods_json, advice_text)
     VALUES ($1, $2, 'photo', $3, $4, $5, $6, $7::jsonb, $8)`,
    [user.id, s3Key, analysis.kcal_total, analysis.protein_g, analysis.carbs_g, analysis.fat_g,
     JSON.stringify(analysis.foods || []), analysis.observation]
  );
  await bot.sendMessage(chatId, buildReply(user, analysis, todayBefore));
}

async function handleManualLog(bot, msg, user, description) {
  const chatId = msg.chat.id;
  if (!await getOrAskForActive(bot, chatId, user)) return;
  if (!description || description.trim().length < 3) {
    await bot.sendMessage(chatId, 'Send: /log <food description>');
    return;
  }
  let analysis = null;
  try { analysis = await analyzeMealText(description); }
  catch (e) { console.error('[log] analyze failed:', e.message); }

  if (!analysis || analysis.kcal_total === 0) {
    await bot.sendMessage(chatId, 'Could not estimate that. Try a more specific description.');
    return;
  }
  const todayBefore = await todayTotalKcal(user.id);
  await query(
    `INSERT INTO meals (user_id, source, kcal, protein_g, carbs_g, fat_g, foods_json, advice_text)
     VALUES ($1, 'text', $2, $3, $4, $5, $6::jsonb, $7)`,
    [user.id, analysis.kcal_total, analysis.protein_g, analysis.carbs_g, analysis.fat_g,
     JSON.stringify(analysis.foods || []), analysis.observation]
  );
  await bot.sendMessage(chatId, buildReply(user, analysis, todayBefore));
}

module.exports = { handlePhoto, handleManualLog, todayTotalKcal };
