require('dotenv').config();
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { Telegraf } = require('telegraf');
const { Chess } = require('chess.js');

const economy = require('./economy');
const LudoGame = require('./games/ludoGame');

const BOT_TOKEN = process.env.BOT_TOKEN;
const FRONTEND_URL = process.env.FRONTEND_URL || '*';
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN missing. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const app = express();
app.use(express.json());
app.get('/', (req, res) => res.send('Telegram Game Backend is running.'));
app.get('/health', (req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: FRONTEND_URL } });

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  ctx.reply('Welcome! Tap below to play Ludo or Chess and win candies 🍬.', {
    reply_markup: {
      inline_keyboard: [[{ text: '🎮 Play Games', web_app: { url: FRONTEND_URL } }]],
    },
  });
});

bot.command('points', (ctx) => {
  const userId = String(ctx.from.id);
  const candies = economy.getCandies(userId);
  ctx.reply(`🍬 Your candies: ${candies}`);
});

bot.command('leaderboard', (ctx) => {
  const top = economy.getLeaderboard(10);
  if (top.length === 0) return ctx.reply('No games played yet.');
  const lines = top.map((u, i) => `${i + 1}. ${u.name || u.userId} — ${u.candies} 🍬`);
  ctx.reply(['🏆 Leaderboard', ...lines].join('\n'));
});

bot.launch().then(() => console.log('Bot launched'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// ---- Telegram WebApp initData verification ----
// This proves the request really came from Telegram for a real user,
// so nobody can fake points by calling the server directly.
function verifyInitData(initData) {
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');

    const pairs = [];
    for (const [key, value] of urlParams.entries()) pairs.push(`${key}=${value}`);
    pairs.sort();
    const dataCheckString = pairs.join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (computedHash !== hash) return null;

    const userStr = urlParams.get('user');
    return userStr ? JSON.parse(userStr) : null;
  } catch (e) {
    return null;
  }
}

// ---- Matchmaking + game rooms ----
const queues = { chess: [], ludo: [] };
const rooms = {}; // roomId -> room state

io.on('connection', (socket) => {
  socket.on('auth', (initData) => {
    const user = verifyInitData(initData);
    if (!user) {
      socket.emit('auth_error', 'Invalid Telegram data. Open this app from Telegram.');
      return;
    }
    socket.userId = String(user.id);
    socket.userName = user.first_name || 'Player';
    economy.initUser(socket.userId, socket.userName);
    socket.emit('auth_success', { user, wallet: economy.getWallet(socket.userId) });
  });

  socket.on('get_wallet', () => {
    if (!socket.userId) return;
    socket.emit('wallet_update', economy.getWallet(socket.userId));
  });

  socket.on('claim_daily_reward', () => {
    if (!socket.userId) return;
    const result = economy.claimDailyReward(socket.userId);
    socket.emit('daily_reward_result', result);
    if (result.granted) socket.emit('wallet_update', result.wallet);
  });

  socket.on('get_leaderboard', () => {
    socket.emit('leaderboard_update', economy.getLeaderboard(10));
  });

  socket.on('join_queue', ({ game }) => {
    if (!socket.userId) return socket.emit('auth_error', 'Not authenticated yet.');
    if (!['chess', 'ludo'].includes(game)) return;
    if (queues[game].some((s) => s.id === socket.id)) return;
    queues[game].push(socket);
    socket.emit('queue_joined', { game });
    tryMatch(game);
  });

  socket.on('leave_queue', ({ game }) => {
    if (!queues[game]) return;
    queues[game] = queues[game].filter((s) => s.id !== socket.id);
  });

  // ---- Chess events ----
  socket.on('chess_move', ({ roomId, from, to, promotion }) => {
    const room = rooms[roomId];
    if (!room || room.type !== 'chess') return;
    if (room.turn !== socket.userId) return socket.emit('invalid_move', 'Not your turn');

    let move;
    try {
      move = room.chess.move({ from, to, promotion: promotion || 'q' });
    } catch (e) {
      move = null;
    }
    if (!move) return socket.emit('invalid_move', 'Illegal move');

    let captureCandies = 0;
    if (move.captured) {
      captureCandies = economy.awardChessCapture(socket.userId, move.captured);
    }

    const opponent = room.players.find((p) => p.userId !== socket.userId);
    room.turn = opponent.userId;

    io.to(roomId).emit('chess_update', {
      fen: room.chess.fen(),
      lastMove: { from, to },
      turn: room.turn,
      capturedPiece: move.captured || null,
      captureCandies,
    });

    if (room.chess.isGameOver()) {
      let winnerId = null;
      if (room.chess.isCheckmate()) {
        winnerId = socket.userId;
        economy.awardChessCheckmate(winnerId);
      }
      endGame(roomId, winnerId, room.players.map((p) => p.userId));
    }
  });

  // ---- Ludo events ----
  socket.on('ludo_roll', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.type !== 'ludo') return;
    if (room.game.currentTurnUserId() !== socket.userId) return;

    const result = room.game.rollDice();
    io.to(roomId).emit('ludo_dice', result);

    if (!room.game.hasValidMoves()) {
      const next = room.game.nextTurn();
      io.to(roomId).emit('ludo_turn', { turn: next });
    }
  });

  socket.on('ludo_move', ({ roomId, tokenIndex }) => {
    const room = rooms[roomId];
    if (!room || room.type !== 'ludo') return;
    if (room.game.currentTurnUserId() !== socket.userId) return;

    const result = room.game.moveToken(socket.userId, tokenIndex);
    if (!result.ok) return socket.emit('invalid_move', result.reason);

    io.to(roomId).emit('ludo_update', room.game.getState());

    if (result.winnerId) {
      endGame(roomId, result.winnerId, room.players);
    } else {
      const next = room.game.nextTurn();
      io.to(roomId).emit('ludo_turn', { turn: next });
    }
  });

  socket.on('disconnect', () => {
    for (const g of ['chess', 'ludo']) {
      queues[g] = queues[g].filter((s) => s.id !== socket.id);
    }
  });
});

function tryMatch(game) {
  while (queues[game].length >= 2) {
    const s1 = queues[game].shift();
    const s2 = queues[game].shift();
    const roomId = `${game}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    s1.join(roomId);
    s2.join(roomId);

    if (game === 'chess') {
      const chess = new Chess();
      rooms[roomId] = {
        type: 'chess',
        chess,
        players: [
          { socketId: s1.id, userId: s1.userId, color: 'w' },
          { socketId: s2.id, userId: s2.userId, color: 'b' },
        ],
        turn: s1.userId,
      };
      s1.emit('match_found', { roomId, game, color: 'w', opponent: s2.userName, fen: chess.fen(), turn: s1.userId });
      s2.emit('match_found', { roomId, game, color: 'b', opponent: s1.userName, fen: chess.fen(), turn: s1.userId });
    } else if (game === 'ludo') {
      const entryResult = economy.chargeLudoEntryFee([s1.userId, s2.userId]);
      if (!entryResult.ok) {
        const short = entryResult.shortUserId === s1.userId ? s1 : s2;
        const other = short === s1 ? s2 : s1;
        short.emit('queue_error', `You need ${economy.rules.LUDO_ENTRY_FEE} 🍬 to play Ludo.`);
        short.leave(roomId);
        other.leave(roomId);
        queues[game].unshift(other); // put the eligible player back in queue
        continue;
      }
      const ludoGame = new LudoGame([s1.userId, s2.userId]);
      rooms[roomId] = { type: 'ludo', game: ludoGame, players: [s1.userId, s2.userId] };
      const state = ludoGame.getState();
      s1.emit('match_found', { roomId, game, opponent: s2.userName, state, turn: ludoGame.currentTurnUserId(), entryFee: economy.rules.LUDO_ENTRY_FEE });
      s2.emit('match_found', { roomId, game, opponent: s1.userName, state, turn: ludoGame.currentTurnUserId(), entryFee: economy.rules.LUDO_ENTRY_FEE });
    }
  }
}

function endGame(roomId, winnerId, participantIds) {
  const room = rooms[roomId];
  if (!room) return;

  let payouts = [];
  if (room.type === 'ludo' && winnerId) {
    // 2-player match: winner = rank 1, the other player = last place.
    const loserId = participantIds.find((id) => id !== winnerId);
    const results = [{ userId: winnerId, rank: 1 }];
    if (loserId) results.push({ userId: loserId, rank: 2 });
    payouts = economy.settleLudoMatch(results, results.length);
  } else if (room.type === 'chess' && winnerId) {
    // Checkmate bonus was already credited in the chess_move handler.
    payouts = [{ userId: winnerId, rank: 1, amount: economy.rules.CHESS_CHECKMATE_BONUS }];
  }

  if (winnerId) {
    const winnerPayout = payouts.find((p) => p.userId === winnerId);
    const newTotal = economy.getCandies(winnerId);
    bot.telegram
      .sendMessage(winnerId, `🏆 You won! +${winnerPayout ? winnerPayout.amount : 0} 🍬. Total: ${newTotal}`)
      .catch(() => {});
  }
  io.to(roomId).emit('game_over', { winnerId, payouts });
  delete rooms[roomId];
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
