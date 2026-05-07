const Stripe = require('stripe');
const cfg = require('../config');
const { query } = require('../db');

const stripe = new Stripe(cfg.STRIPE_SECRET_KEY);

async function createCheckoutSession(user) {
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: cfg.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: cfg.PUBLIC_BASE_URL + '/billing/success?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: cfg.PUBLIC_BASE_URL + '/billing/cancel',
    client_reference_id: user.id,
    metadata: { user_id: user.id, telegram_id: String(user.telegram_id) },
    subscription_data: { metadata: { user_id: user.id, telegram_id: String(user.telegram_id) } },
  });
  return session.url;
}

async function handleWebhook(rawBody, signature) {
  const event = stripe.webhooks.constructEvent(rawBody, signature, cfg.STRIPE_WEBHOOK_SECRET);
  const obj = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed': {
      // Persist the customer link only; status comes from subscription.* events
      // so we don't accidentally overwrite a 'trialing' status with 'active'.
      const userId = obj.client_reference_id || obj.metadata?.user_id;
      const customerId = obj.customer;
      if (userId && customerId) {
        await query(
          'UPDATE users SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2',
          [customerId, userId]
        );
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const userId = obj.metadata?.user_id;
      if (userId) {
        const status = obj.status; // active, past_due, canceled, unpaid, trialing
        const periodEnd = obj.current_period_end ? new Date(obj.current_period_end * 1000) : null;
        await query(
          'UPDATE users SET subscription_status = $1, subscription_period_end = $2, updated_at = NOW() WHERE id = $3',
          [status, periodEnd, userId]
        );
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const userId = obj.metadata?.user_id;
      if (userId) {
        await query(
          'UPDATE users SET subscription_status = $1, updated_at = NOW() WHERE id = $2',
          ['canceled', userId]
        );
      }
      break;
    }
    case 'invoice.payment_failed': {
      // Invoice metadata isn't reliable; fetch the subscription to read its metadata.
      let userId = obj.subscription_details?.metadata?.user_id || null;
      if (!userId && obj.subscription) {
        try {
          const sub = await stripe.subscriptions.retrieve(obj.subscription);
          userId = sub?.metadata?.user_id || null;
        } catch (e) {
          console.error('[stripe] retrieve subscription failed:', e.message);
        }
      }
      if (userId) {
        await query(
          'UPDATE users SET subscription_status = $1, updated_at = NOW() WHERE id = $2',
          ['past_due', userId]
        );
      }
      break;
    }
    default:
      break;
  }
  return { received: true, type: event.type };
}

function isActive(user) {
  return user && (user.subscription_status === 'active' || user.subscription_status === 'trialing');
}

module.exports = { createCheckoutSession, handleWebhook, isActive };
