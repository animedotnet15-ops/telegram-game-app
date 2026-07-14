// Date helpers used by the daily-login and weekly-reset logic.
// All calculations use UTC so behavior doesn't depend on server timezone.

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function dayOfWeek(date = new Date()) {
  return date.getUTCDay(); // 0 = Sunday ... 6 = Saturday
}

// Returns a stable key identifying "this week", anchored to the most
// recent Sunday (inclusive). Two dates in the same Sun-Sat week always
// produce the same key.
function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // rewind to Sunday
  return todayKey(d);
}

module.exports = { todayKey, dayOfWeek, weekKey };
