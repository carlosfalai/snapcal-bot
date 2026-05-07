# snapcal-bot

Telegram bot. Snap a meal, see your day. $17/month.

## What it does

- User sends a meal photo. Claude Haiku (via AWS Bedrock) returns foods, portion estimates, kcal, macros, and one neutral observation.
- Tracks daily total vs personal target (Mifflin-St Jeor TDEE - 500 / TDEE / TDEE + 300).
- `/today` — today total + ASCII progress bar + remaining vs goal.
- `/week` — 7-day mini bar chart, weekly average, today vs average.
- `/stats` — BMI, TDEE, current weight, streak, total meals tracked.
- `/log <description>` — text-only fallback when a photo won't work.
- Voice notes — same as `/log` (TODO: wire to AWS Transcribe).
- `/weight <kg>` — log current weight (drives BMI updates and goals).
- `/pause <days>` — pause daily summaries for vacation.
- Daily summary push at 21:00 user-local, opt-out via `/pause`.

Not marketed as an AI nutritionist. The observation is factual and never prescriptive.

## Stack

- Node.js 20, `node-telegram-bot-api`
- AWS RDS Postgres (or any Postgres)
- AWS S3 for meal photos
- AWS Bedrock — `us.anthropic.claude-haiku-4-5-20251001-v1:0`
- Stripe Checkout + webhook for the $17/mo subscription
- Express server hosting the webhook + a health endpoint
- ASCII text bars (no headless canvas — keeps the bot lean)
- PM2 for process management on EC2

## Setup

1. `cp .env.example .env` and fill it.
2. Provision Postgres (RDS recommended). Run `npm run migrate`.
3. Create a Stripe Product with a $17/month recurring price. Put the price id in `STRIPE_PRICE_ID`.
4. Create the S3 bucket from `S3_BUCKET`. Block public access; meals stay private.
5. `npm install`
6. `pm2 start ecosystem.config.js && pm2 save`
7. Reverse-proxy `PUBLIC_BASE_URL` to your EC2 instance (Caddy or nginx) and route `/billing/webhook` to the bot's port. Add the matching webhook signing secret to `STRIPE_WEBHOOK_SECRET`.

## Telegram bot best practices

This repo follows the rules captured in
[carlosfalai/telegram-bot-best-practices](https://github.com/carlosfalai/telegram-bot-best-practices) —
polling configuration, 429/ECONNRESET recovery, EADDRINUSE retry, single-instance lock,
group-chat protection, login rate limiting, hashed PINs, defensive AI parsing, schema discipline.

## License

MIT.
