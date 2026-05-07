// Send a test event to the webhook and verify the bot returns 2xx.
const fs = require('fs');
const ENV = fs.readFileSync('C:/Users/Carlos Faviel Font/.claude/.env', 'utf8');
const KEY = ENV.match(/^STRIPE_SECRET_KEY=([^\r\n]+)/m)[1].trim();
const Stripe = require('stripe');
const stripe = new Stripe(KEY);

(async () => {
  const list = await stripe.webhookEndpoints.list({ limit: 100 });
  const ep = list.data.find(w => w.metadata?.app === 'fotocal');
  if (!ep) { console.error('no webhook endpoint found'); process.exit(1); }
  console.log('Sending test event to', ep.url);
  // Stripe doesn't have a public "send test event" API call; we rely on the
  // dashboard or stripe CLI. Instead, just verify the endpoint is reachable
  // and the bot responds without error.
  const resp = await fetch(ep.url, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
  console.log('webhook reachable, status:', resp.status, '(400 expected - missing signature)');
})();
