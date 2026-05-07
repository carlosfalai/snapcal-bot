// Create Stripe product + $17/mo recurring price for Fotocal.
const fs = require('fs');
const ENV = fs.readFileSync('C:/Users/Carlos Faviel Font/.claude/.env', 'utf8');
const KEY = ENV.match(/^STRIPE_SECRET_KEY=([^\r\n]+)/m)[1].trim();

const Stripe = require('stripe');
const stripe = new Stripe(KEY);

(async () => {
  // Idempotent: search by metadata
  const existing = await stripe.products.search({ query: "metadata['app']:'fotocal'" });
  let product = existing.data[0];
  if (!product) {
    product = await stripe.products.create({
      name: 'Fotocal Monthly',
      description: 'Photo-based calorie tracking. Snap a meal, see your day.',
      metadata: { app: 'fotocal' },
    });
    console.log('product created:', product.id);
  } else {
    console.log('product exists:', product.id);
  }

  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 10 });
  let price = prices.data.find(p =>
    p.unit_amount === 1700 && p.currency === 'usd' &&
    p.recurring?.interval === 'month'
  );
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: 1700,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { app: 'fotocal' },
    });
    console.log('price created:', price.id);
  } else {
    console.log('price exists:', price.id);
  }
  console.log('\nSTRIPE_PRICE_ID=' + price.id);
})().catch(e => { console.error('stripe setup failed:', e.message); process.exit(1); });
