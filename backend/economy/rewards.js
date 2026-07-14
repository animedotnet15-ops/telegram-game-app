// ============================================================
// Candy economy rules (pure functions — no DB access here).
// Keeping this separate from db.js makes the payout math easy
// to unit test and easy to tune without touching storage code.
// ============================================================

const CANDY = '🍬';

// ---- Ludo ----
const LUDO_ENTRY_FEE = 50;

// Placement payouts. Ranks are 1 = winner, going down to last place.
// "Last place" always gets the LUDO_LAST_PLACE_PAYOUT, regardless of
// how many players were in the room (2, 3, or 4).
const LUDO_RANK_PAYOUT = {
  1: 40,
  2: 30,
  3: 20,
};
const LUDO_LAST_PLACE_PAYOUT = 5;

/**
 * @param {number} rank - finishing position, 1-based (1 = winner)
 * @param {number} totalPlayers - how many players were in the match (2-4)
 * @returns {number} candies awarded for that placement
 */
function ludoPayout(rank, totalPlayers) {
  if (!Number.isInteger(rank) || !Number.isInteger(totalPlayers)) return 0;
  if (rank < 1 || rank > totalPlayers) return 0;
  if (rank === totalPlayers) return LUDO_LAST_PLACE_PAYOUT; // last place, any player count
  return LUDO_RANK_PAYOUT[rank] || 0;
}

// ---- Chess ----
// No entry fee for chess — it's reward-per-action instead.
const CHESS_CAPTURE_REWARD = {
  p: 1, // pawn
  r: 3, // rook
  n: 4, // knight
  b: 5, // bishop
  q: 8, // queen
  // king can't be captured
};
const CHESS_CHECKMATE_BONUS = 50;

const CHESS_TIME_CONTROLS_MINUTES = [5, 10, 15]; // player-customizable

/**
 * @param {string} pieceType - single-letter piece code as used by chess.js
 *   ('p','r','n','b','q'), case-insensitive
 */
function chessCaptureReward(pieceType) {
  if (!pieceType) return 0;
  return CHESS_CAPTURE_REWARD[pieceType.toLowerCase()] || 0;
}

// ---- Weekly login rewards (Sun=0 ... Sat=6) ----
const DAILY_LOGIN_REWARD = [10, 5, 5, 5, 5, 5, 10];

// ---- Weekly candy decay ----
// At the start of each new week, players keep only 20% of their
// candies (i.e. lose 80%).
const WEEKLY_RETENTION_RATE = 0.2;

module.exports = {
  CANDY,
  LUDO_ENTRY_FEE,
  LUDO_RANK_PAYOUT,
  LUDO_LAST_PLACE_PAYOUT,
  ludoPayout,
  CHESS_CAPTURE_REWARD,
  CHESS_CHECKMATE_BONUS,
  CHESS_TIME_CONTROLS_MINUTES,
  chessCaptureReward,
  DAILY_LOGIN_REWARD,
  WEEKLY_RETENTION_RATE,
};
