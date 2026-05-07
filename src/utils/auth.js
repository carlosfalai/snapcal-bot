const crypto = require('crypto');

function hash(s) {
  return crypto.createHash('sha256').update(String(s).trim()).digest('hex');
}

function normalizePhone(s) {
  return String(s || '').replace(/[^0-9]/g, '');
}

const loginAttempts = new Map();
const LOGIN_LOCKOUT_MINUTES = 15;
const MAX_LOGIN_ATTEMPTS = 5;

function checkLoginRate(telegramId) {
  const r = loginAttempts.get(telegramId);
  if (!r) return { allowed: true };
  const elapsed = (Date.now() - r.lastAttempt) / 60000;
  if (elapsed > LOGIN_LOCKOUT_MINUTES) { loginAttempts.delete(telegramId); return { allowed: true }; }
  if (r.count >= MAX_LOGIN_ATTEMPTS) {
    return { allowed: false, waitMinutes: Math.ceil(LOGIN_LOCKOUT_MINUTES - elapsed) };
  }
  return { allowed: true };
}

function recordLoginAttempt(telegramId, success) {
  if (success) { loginAttempts.delete(telegramId); return; }
  const r = loginAttempts.get(telegramId) || { count: 0, lastAttempt: 0 };
  r.count++;
  r.lastAttempt = Date.now();
  loginAttempts.set(telegramId, r);
}

module.exports = { hash, normalizePhone, checkLoginRate, recordLoginAttempt };
