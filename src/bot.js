const TelegramBot = require('node-telegram-bot-api');
const cfg = require('./config');
const { query } = require('./db');
const { startOnboarding, handleMessage: handleOnboardingMsg, getUserByTelegramId } = require('./handlers/onboarding');
const { handlePhoto, handleManualLog } = require('./handlers/photo');
const cmds = require('./handlers/commands');
const { isActive } = require('./services/stripe');

const bot = new TelegramBot(cfg.TELEGRAM_BOT_TOKEN, {
  polling: { interval: 300, autoStart: true, params: { timeout: 30 } },
});

let pollingRestartTimer = null;
function schedulePollingRestart(waitMs, reason) {
  if (pollingRestartTimer) { clearTimeout(pollingRestartTimer); pollingRestartTimer = null; }
  console.error(`[polling] ${reason} — resuming in ${waitMs / 1000}s`);
  pollingRestartTimer = setTimeout(() => {
    pollingRestartTimer = null;
    bot.startPolling().catch(e => console.error('[polling] restart failed:', e?.message));
  }, waitMs);
  bot.stopPolling().catch(() => {});
}

bot.on('polling_error', (err) => {
  const msg = err?.message || '';
  if (msg.includes('429')) {
    const m = msg.match(/retry after (\d+)/i);
    const wait = m ? parseInt(m[1], 10) * 1000 : 10000;
    schedulePollingRestart(wait, '429');
    return;
  }
  if (msg.includes('EFATAL') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT')) {
    schedulePollingRestart(5000, 'network error');
    return;
  }
  if (msg.includes('409')) {
    console.error('[polling] 409 — another instance polling, exiting');
    process.exit(1);
  }
  console.error('[polling] error:', msg);
});

bot.on('error', (err) => console.error('[bot] error:', err?.message));

// Group-chat protection — never allow PIN typing in groups
bot.on('message', async (msg, next) => {
  if (msg.chat?.type !== 'private') {
    if (msg.text?.startsWith('/')) {
      try { await bot.sendMessage(msg.chat.id, 'Snapcal works in private messages only. DM me.'); } catch {}
    }
    return;
  }
});

// In-flight: track "log weight" prompt state in-memory (short-lived)
const awaitingWeight = new Map();

bot.onText(/^\/start$/, async (msg) => {
  if (msg.chat?.type !== 'private') return;
  await startOnboarding(bot, msg.chat.id, msg.from.id);
});

bot.onText(/^\/help$/, async (msg) => {
  if (msg.chat?.type !== 'private') return;
  await cmds.showHelp(bot, msg.chat.id);
});

bot.onText(/^\/today$/i, async (msg) => {
  const user = await ensureUser(msg);
  if (!user) return;
  await cmds.showToday(bot, msg.chat.id, user);
});

bot.onText(/^\/week$/i, async (msg) => {
  const user = await ensureUser(msg);
  if (!user) return;
  await cmds.showWeek(bot, msg.chat.id, user);
});

bot.onText(/^\/stats$/i, async (msg) => {
  const user = await ensureUser(msg);
  if (!user) return;
  await cmds.showStats(bot, msg.chat.id, user);
});

bot.onText(/^\/weight(?:\s+(.+))?$/i, async (msg, m) => {
  const user = await ensureUser(msg);
  if (!user) return;
  const arg = (m[1] || '').trim();
  if (arg) {
    await cmds.logWeightValue(bot, msg.chat.id, user, arg);
  } else {
    awaitingWeight.set(msg.from.id, true);
    await cmds.logWeightStart(bot, msg.chat.id);
  }
});

bot.onText(/^\/log\s+(.+)$/i, async (msg, m) => {
  const user = await ensureUser(msg);
  if (!user) return;
  await handleManualLog(bot, msg, user, m[1]);
});

bot.onText(/^\/pause(?:\s+(\d+))?$/i, async (msg, m) => {
  const user = await ensureUser(msg);
  if (!user) return;
  await cmds.pauseUser(bot, msg.chat.id, user, m[1] || '7');
});

bot.onText(/^\/resume$/i, async (msg) => {
  const user = await ensureUser(msg);
  if (!user) return;
  await cmds.resumeUser(bot, msg.chat.id, user);
});

bot.onText(/^\/paywall$/i, async (msg) => {
  const user = await getUserByTelegramId(msg.from.id);
  if (!user) { await bot.sendMessage(msg.chat.id, 'Use /start first.'); return; }
  await cmds.showPaywall(bot, msg.chat.id, user);
});

bot.onText(/^\/cancel$/i, async (msg) => {
  awaitingWeight.delete(msg.from.id);
  await query('DELETE FROM auth_pending WHERE telegram_id = $1', [msg.from.id]);
  await bot.sendMessage(msg.chat.id, 'Cancelled. Use /help.');
});

// Photo handler
bot.on('photo', async (msg) => {
  if (msg.chat?.type !== 'private') return;
  const user = await ensureUser(msg);
  if (!user) return;
  await handlePhoto(bot, msg, user);
});

// Plain-text catch-all (after specific handlers)
bot.on('message', async (msg) => {
  if (msg.chat?.type !== 'private') return;
  const text = (msg.text || '').trim();
  if (!text || text.startsWith('/')) return;

  // Onboarding flow takes precedence
  const consumed = await handleOnboardingMsg(bot, msg);
  if (consumed) return;

  // Persistent-keyboard taps
  const lc = text.toLowerCase();
  if (lc === 'today')      { const u = await ensureUser(msg); if (u) await cmds.showToday(bot, msg.chat.id, u); return; }
  if (lc === 'week')       { const u = await ensureUser(msg); if (u) await cmds.showWeek(bot, msg.chat.id, u); return; }
  if (lc === 'stats')      { const u = await ensureUser(msg); if (u) await cmds.showStats(bot, msg.chat.id, u); return; }
  if (lc === 'log weight') {
    const u = await ensureUser(msg); if (!u) return;
    awaitingWeight.set(msg.from.id, true);
    await cmds.logWeightStart(bot, msg.chat.id);
    return;
  }

  // Awaiting weight value?
  if (awaitingWeight.has(msg.from.id)) {
    const u = await ensureUser(msg); if (!u) return;
    const ok = await cmds.logWeightValue(bot, msg.chat.id, u, text);
    if (ok) awaitingWeight.delete(msg.from.id);
    return;
  }

  // Otherwise treat as a quick text-meal log
  const user = await getUserByTelegramId(msg.from.id);
  if (user) {
    await handleManualLog(bot, msg, user, text);
    return;
  }
  await bot.sendMessage(msg.chat.id, 'Use /start to set up Snapcal.');
});

async function ensureUser(msg) {
  const user = await getUserByTelegramId(msg.from.id);
  if (!user) {
    await bot.sendMessage(msg.chat.id, 'Use /start to set up Snapcal first.');
    return null;
  }
  return user;
}

async function registerCommands() {
  try {
    await bot.setMyCommands([
      { command: 'start',   description: 'Create your account' },
      { command: 'today',   description: 'Today total' },
      { command: 'week',    description: 'Last 7 days' },
      { command: 'stats',   description: 'Profile and streak' },
      { command: 'weight',  description: 'Log your current weight' },
      { command: 'log',     description: 'Log a meal by description' },
      { command: 'pause',   description: 'Pause daily summaries' },
      { command: 'resume',  description: 'Resume daily summaries' },
      { command: 'paywall', description: 'Subscription link' },
      { command: 'cancel',  description: 'Cancel current step' },
      { command: 'help',    description: 'Show all commands' },
    ]);
  } catch (e) {
    console.error('[bot] setMyCommands failed:', e.message);
  }
}

module.exports = { bot, registerCommands };
