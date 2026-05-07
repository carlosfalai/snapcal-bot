const fs = require('fs');
const express = require('express');
const cfg = require('./config');
const { handleWebhook } = require('./services/stripe');
const { bot, registerCommands } = require('./bot');
const { query } = require('./db');

const PID_FILE = '.snapcal.pid';

function killStaleInstance() {
  if (!fs.existsSync(PID_FILE)) return;
  try {
    const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (oldPid && oldPid !== process.pid) {
      try { process.kill(oldPid, 0); } catch { return; }
      console.log(`[startup] killing stale instance PID ${oldPid}`);
      try { process.kill(oldPid, 'SIGTERM'); } catch {}
      const start = Date.now();
      while (Date.now() - start < 3000) {
        try { process.kill(oldPid, 0); } catch { break; }
      }
    }
  } catch {}
}

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
process.on('SIGTERM', () => { try { fs.unlinkSync(PID_FILE); } catch {} process.exit(0); });
process.on('SIGINT',  () => { try { fs.unlinkSync(PID_FILE); } catch {} process.exit(0); });

killStaleInstance();
fs.writeFileSync(PID_FILE, String(process.pid));

const app = express();

app.get('/health', (req, res) => res.json({ ok: true }));

// Stripe webhook MUST receive raw body
app.post('/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const result = await handleWebhook(req.body, sig);
    // Notify user if their subscription just activated
    if (result.type === 'checkout.session.completed') {
      try {
        const evt = JSON.parse(req.body.toString());
        const tg = evt?.data?.object?.metadata?.telegram_id;
        if (tg) {
          await bot.sendMessage(tg, 'Subscription active. Send a meal photo to start logging.');
        }
      } catch {}
    }
    res.json(result);
  } catch (e) {
    console.error('[webhook] error:', e.message);
    res.status(400).send('webhook error: ' + e.message);
  }
});

app.use(express.json());

app.get('/billing/success', (req, res) => {
  res.send('Thanks. Return to Telegram — your subscription is being activated.');
});
app.get('/billing/cancel', (req, res) => {
  res.send('Subscription cancelled. Return to Telegram and use /paywall when you are ready.');
});

const server = app.listen(cfg.PORT, () => {
  console.log(`[server] listening on :${cfg.PORT}`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] port ${cfg.PORT} in use — retrying in 3s`);
    setTimeout(() => {
      server.close(() => server.listen(cfg.PORT));
    }, 3000);
  } else {
    console.error('[server] error:', err.message);
  }
});

(async () => {
  await registerCommands();
  console.log('[bot] polling started');
})().catch((e) => { console.error('[startup] failed:', e); process.exit(1); });

// Daily summary push at 21:00 user-local. Runs hourly, sends to users whose local hour is 21.
async function pushDailySummaries() {
  try {
    const r = await query(
      `SELECT id, telegram_id, daily_target_kcal, timezone
         FROM users
        WHERE subscription_status IN ('active','trialing')
          AND daily_summary_enabled = TRUE
          AND (paused_until IS NULL OR paused_until < NOW())`
    );
    for (const u of r.rows) {
      const tz = u.timezone || 'America/Toronto';
      const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: tz, hour: '2-digit', hour12: false }), 10);
      if (hour !== 21) continue;
      const today = await query(
        `SELECT COALESCE(SUM(kcal),0)::int total, COUNT(*) n
           FROM meals WHERE user_id = $1 AND deleted_at IS NULL AND captured_at::date = (CURRENT_DATE AT TIME ZONE $2)::date`,
        [u.id, tz]
      );
      const t = today.rows[0];
      if (t.n === 0) continue;
      const target = u.daily_target_kcal || 2000;
      try {
        await bot.sendMessage(u.telegram_id, `Daily wrap: ${t.total}/${target} kcal — ${t.n} meal(s) logged.`);
      } catch (e) { /* user blocked or chat not found */ }
    }
  } catch (e) { console.error('[summary] error:', e.message); }
}
setInterval(pushDailySummaries, 60 * 60 * 1000);
