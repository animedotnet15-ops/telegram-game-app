// ============================================================
// Candy wallet storage.
// Simple JSON-file store, same tradeoffs as the old db.js:
// fine for testing/low traffic, swap for a real DB before scale
// (see README notes on concurrent JSON writes).
// ============================================================

const fs = require('fs');
const path = require('path');
const { todayKey, dayOfWeek, weekKey } = require('./dateUtils');
const { DAILY_LOGIN_REWARD, WEEKLY_RETENTION_RATE } = require('./rewards');

const FILE = path.join(__dirname, '..', 'wallet.json');
const MAX_HISTORY_PER_USER = 50; // keep the ledger small on disk

function load() {
  if (!fs.existsSync(FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf-8') || '{}');
  } catch (e) {
    return {};
  }
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function freshUser(name) {
  return {
    name: name || '',
    candies: 0,
    lastDailyClaim: null, // 'YYYY-MM-DD'
    lastWeekKey: null,
    history: [],
  };
}

function pushHistory(user, entry) {
  user.history.push({ ...entry, ts: new Date().toISOString() });
  if (user.history.length > MAX_HISTORY_PER_USER) {
    user.history = user.history.slice(-MAX_HISTORY_PER_USER);
  }
}

function initUser(userId, name) {
  const data = load();
  if (!data[userId]) {
    data[userId] = freshUser(name);
    save(data);
  }
  return data[userId];
}

/**
 * Reads the wallet, applying weekly decay first if a new week has
 * started. This is called lazily (on access) rather than via a cron
 * job, so it works correctly no matter when the process is running.
 */
function getWallet(userId) {
  const data = load();
  if (!data[userId]) data[userId] = freshUser();
  const user = data[userId];
  const changed = applyWeeklyResetIfNeeded(user);
  if (changed) save(data);
  return { userId, ...user };
}

function getCandies(userId) {
  return getWallet(userId).candies;
}

function applyWeeklyResetIfNeeded(user, now = new Date()) {
  const currentWeek = weekKey(now);
  if (user.lastWeekKey === currentWeek) return false; // no-op, already reset this week
  const before = user.candies;
  if (user.lastWeekKey !== null) {
    // Only decay if this isn't the user's very first wallet read.
    user.candies = Math.floor(user.candies * WEEKLY_RETENTION_RATE);
    if (before !== user.candies) {
      pushHistory(user, { type: 'weekly_reset', amount: user.candies - before, reason: 'weekly_decay' });
    }
  }
  user.lastWeekKey = currentWeek;
  return true;
}

function addCandies(userId, amount, reason) {
  if (amount <= 0) return getWallet(userId);
  const data = load();
  if (!data[userId]) data[userId] = freshUser();
  const user = data[userId];
  applyWeeklyResetIfNeeded(user);
  user.candies += amount;
  pushHistory(user, { type: 'credit', amount, reason });
  save(data);
  return { userId, ...user };
}

/**
 * @returns {{ok: boolean, reason?: string, wallet?: object}}
 */
function spendCandies(userId, amount, reason) {
  if (amount <= 0) return { ok: true, wallet: getWallet(userId) };
  const data = load();
  if (!data[userId]) data[userId] = freshUser();
  const user = data[userId];
  applyWeeklyResetIfNeeded(user);
  if (user.candies < amount) {
    save(data);
    return { ok: false, reason: 'insufficient_candies' };
  }
  user.candies -= amount;
  pushHistory(user, { type: 'debit', amount, reason });
  save(data);
  return { ok: true, wallet: { userId, ...user } };
}

/**
 * Grants today's daily-login reward if not already claimed today.
 * @returns {{granted: boolean, amount?: number, wallet?: object, reason?: string}}
 */
function claimDailyReward(userId, now = new Date()) {
  const data = load();
  if (!data[userId]) data[userId] = freshUser();
  const user = data[userId];
  applyWeeklyResetIfNeeded(user, now);

  const today = todayKey(now);
  if (user.lastDailyClaim === today) {
    save(data);
    return { ok: false, granted: false, reason: 'already_claimed' };
  }

  const amount = DAILY_LOGIN_REWARD[dayOfWeek(now)];
  user.candies += amount;
  user.lastDailyClaim = today;
  pushHistory(user, { type: 'credit', amount, reason: 'daily_login' });
  save(data);
  return { ok: true, granted: true, amount, wallet: { userId, ...user } };
}

function getLeaderboard(limit = 10) {
  const data = load();
  return Object.entries(data)
    .map(([userId, v]) => ({ userId, name: v.name, candies: v.candies }))
    .sort((a, b) => b.candies - a.candies)
    .slice(0, limit);
}

module.exports = {
  initUser,
  getWallet,
  getCandies,
  addCandies,
  spendCandies,
  claimDailyReward,
  getLeaderboard,
};
