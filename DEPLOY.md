# Deploy snapcal-bot

Quick path to live: EC2 t3.micro + RDS Postgres db.t3.micro + S3 bucket + Caddy for HTTPS.

## 1. AWS resources

```bash
# RDS
aws rds create-db-instance \
  --db-instance-identifier snapcal-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --master-username snapcal \
  --master-user-password '<pick-something-strong>' \
  --allocated-storage 20 \
  --storage-type gp3 \
  --backup-retention-period 7 \
  --publicly-accessible

# S3 bucket
aws s3 mb s3://snapcal-meals --region us-east-1
aws s3api put-public-access-block --bucket snapcal-meals \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# EC2 t3.micro Amazon Linux 2023, then SSH and:
sudo dnf install -y nodejs git
sudo npm install -g pm2
git clone https://github.com/carlosfalai/snapcal-bot.git
cd snapcal-bot
cp .env.example .env  # fill it
npm install
npm run migrate
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # follow the printed sudo command
```

## 2. Stripe

- Create product: "Snapcal Monthly" with a $17/mo recurring price.
- Copy the price id (`price_...`) → `STRIPE_PRICE_ID`.
- Create a webhook endpoint at `https://<your-domain>/billing/webhook` listening to:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- Copy the signing secret → `STRIPE_WEBHOOK_SECRET`.

## 3. Caddy reverse proxy (HTTPS)

`/etc/caddy/Caddyfile`:

```
snapcal.example.com {
  reverse_proxy localhost:3017
}
```

```bash
sudo dnf install -y caddy
sudo systemctl enable --now caddy
```

## 4. Bedrock access

Make sure the IAM user owning `AWS_ACCESS_KEY_ID` has:
- `bedrock:InvokeModel` on `us.anthropic.claude-haiku-4-5-20251001-v1:0`
- `s3:PutObject` on `snapcal-meals/*`

## 5. Smoke test

- `curl https://snapcal.example.com/health` → `{"ok":true}`
- DM the bot, run `/start`, complete onboarding, follow the Stripe link, pay with a test card.
- After webhook fires you should receive "Subscription active." in Telegram.
- Send a meal photo — bot should reply within a few seconds with kcal + macros + bar.
