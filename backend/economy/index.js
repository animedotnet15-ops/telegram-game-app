// Game-facing economy API. server.js / game engines should only need
// to import from here, not reach into walletStore/rewards directly.

const wallet = require('./walletStore');
const rules = require('./rewards');

/**
 * Charges every player the Ludo entry fee. All-or-nothing: if any
 * player can't afford it, nobody is charged and the room shouldn't
 * be created.
 * @param {string[]} userIds
 * @returns {{ok: boolean, reason?: string, shortUserId?: string}}
 */
function chargeLudoEntryFee(userIds) {
  for (const id of userIds) {
    if (wallet.getCandies(id) < rules.LUDO_ENTRY_FEE) {
      return { ok: false, reason: 'insufficient_candies', shortUserId: id };
    }
  }
  for (const id of userIds) {
    wallet.spendCandies(id, rules.LUDO_ENTRY_FEE, 'ludo_entry_fee');
  }
  return { ok: true };
}

/**
 * Pays out a full Ludo match once every player has a final rank.
 * @param {Array<{userId: string, rank: number}>} results
 * @param {number} totalPlayers
 * @returns {Array<{userId: string, rank: number, amount: number}>}
 */
function settleLudoMatch(results, totalPlayers) {
  return results.map(({ userId, rank }) => {
    const amount = rules.ludoPayout(rank, totalPlayers);
    if (amount > 0) wallet.addCandies(userId, amount, `ludo_rank_${rank}`);
    return { userId, rank, amount };
  });
}

/**
 * @param {string} winnerUserId - the player who made the capturing move
 * @param {string} capturedPieceType - 'p'|'r'|'n'|'b'|'q'
 */
function awardChessCapture(winnerUserId, capturedPieceType) {
  const amount = rules.chessCaptureReward(capturedPieceType);
  if (amount > 0) wallet.addCandies(winnerUserId, amount, `chess_capture_${capturedPieceType}`);
  return amount;
}

function awardChessCheckmate(winnerUserId) {
  wallet.addCandies(winnerUserId, rules.CHESS_CHECKMATE_BONUS, 'chess_checkmate');
  return rules.CHESS_CHECKMATE_BONUS;
}

module.exports = {
  // storage passthrough
  initUser: wallet.initUser,
  getWallet: wallet.getWallet,
  getCandies: wallet.getCandies,
  claimDailyReward: wallet.claimDailyReward,
  getLeaderboard: wallet.getLeaderboard,
  // game-facing helpers
  chargeLudoEntryFee,
  settleLudoMatch,
  awardChessCapture,
  awardChessCheckmate,
  // rules re-exported for the frontend/UI to display (fees, time controls etc.)
  rules,
};
