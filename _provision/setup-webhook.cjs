// Create the Stripe webhook endpoint pointing at the live HTTPS URL.
const fs = require('fs');
const ENV = fs.readFileSync('C:/Users/Carlos Faviel Font/.claude/.env', 'utf8');
const KEY = ENV.match(/^STRIPE_SECRET_KEY=([^\r\n]+)/m)[1].trim();
const Stripe = require('stripe');
const stripe = new Stripe(KEY);

const URL = process.argv[2] || 'https://fotocal.54-162-29-157.nip.io/billing/webhook';
const EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
];

(async () => {
  // Stripe's webhookEndpoints.list does NOT return `secret`. To guarantee we
  // always have a usable signing secret, delete any matching endpoint and recreate.
  const list = await stripe.webhookEndpoints.list({ limit: 100 });
  for (const w of list.data) {
    if (w.url === URL && w.metadata?.app === 'fotocal') {
      await stripe.webhookEndpoints.del(w.id);
      console.log('removed prior endpoint:', w.id);
    }
  }
  const ep = await stripe.webhookEndpoints.create({
    url: URL,
    enabled_events: EVENTS,
    description: 'Fotocal bot subscription events',
    metadata: { app: 'fotocal' },
  });
  console.log('webhook created:', ep.id);
  console.log('SIGNING_SECRET=' + ep.secret);
})().catch(e => { console.error('webhook setup failed:', e.message); process.exit(1); });
