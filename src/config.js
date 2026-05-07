require('dotenv').config();

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

module.exports = {
  TELEGRAM_BOT_TOKEN: need('TELEGRAM_BOT_TOKEN'),

  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  AWS_ACCESS_KEY_ID: need('AWS_ACCESS_KEY_ID'),
  AWS_SECRET_ACCESS_KEY: need('AWS_SECRET_ACCESS_KEY'),
  S3_BUCKET: need('S3_BUCKET'),
  BEDROCK_HAIKU_MODEL: process.env.BEDROCK_HAIKU_MODEL || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',

  DATABASE_URL: need('DATABASE_URL'),

  STRIPE_SECRET_KEY: need('STRIPE_SECRET_KEY'),
  STRIPE_WEBHOOK_SECRET: need('STRIPE_WEBHOOK_SECRET'),
  STRIPE_PRICE_ID: need('STRIPE_PRICE_ID'),
  PUBLIC_BASE_URL: need('PUBLIC_BASE_URL'),

  PORT: parseInt(process.env.PORT || '3017', 10),
  ADMIN_TELEGRAM_ID: process.env.ADMIN_TELEGRAM_ID || null,

  // Comma-separated Telegram user IDs that bypass the paywall (dev/owner accounts).
  DEV_TELEGRAM_IDS: (process.env.DEV_TELEGRAM_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean).map(s => parseInt(s, 10)).filter(Number.isFinite),
};
