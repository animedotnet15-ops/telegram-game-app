# Telegram Mini App — Ludo & Chess with Points

Monorepo with `frontend/` (Telegram Mini App UI) and `backend/` (server + bot + game logic + points).

## What's included
- Chess: online 1v1, moves validated with `chess.js`, real-time via Socket.io.
- Ludo: simplified but working online 1v1 (52-cell shared track, roll 6 to leave base, capture opponents).
- Candy 🍬 economy, stored server-side, bot commands `/points` and `/leaderboard` read the same wallet data:
  - **Ludo**: 50 🍬 entry fee per player, charged when the match starts. Payout by finishing rank: 1st = 40, 2nd = 30, 3rd = 20, last place = 5 (regardless of player count — currently wired for 2-player matches; 3/4-player ranking needs the multiplayer Ludo engine, which is the next phase).
  - **Chess**: no entry fee. Capture rewards — pawn 1, rook 3, knight 4, bishop 5, queen 8 🍬 — plus a 50 🍬 bonus for delivering checkmate.
  - **Daily login rewards**: Sun 10, Mon–Fri 5 each, Sat 10 🍬. Claimed once per UTC day via the `claim_daily_reward` socket event.
  - **Weekly reset**: at the start of each new week (UTC, Sunday-anchored) every player's candy balance is cut to 20% of what it was (an 80% reduction). Applied lazily whenever a wallet is read, no cron job needed.
  - All economy logic lives in `backend/economy/` (`rewards.js` = pure rules/constants, `walletStore.js` = persistence + ledger, `index.js` = game-facing helpers). `backend/wallet.json` is the JSON-file store (swap for a real DB before real traffic, same caveat as before).
- Telegram auth: the backend verifies Telegram's `initData` (HMAC signature) so candies can't be faked by calling the server directly.

## 1. Create your Telegram bot

1. Open Telegram and search for **@BotFather** (the official bot for creating bots).
2. Send `/newbot`.
3. Give it a display name (e.g. `Game Zone`), then a username ending in `bot` (e.g. `game_zone_bot`).
4. BotFather replies with a **bot token** — a long string like `123456789:AAExampleTokenHere`. Copy it and keep it private (never commit it to GitHub).

You now have a bot, but it has no backend or website connected yet — that's the rest of this guide.

## 2. Run the backend locally (optional, but good to test first)

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:
```
BOT_TOKEN=your_token_here
FRONTEND_URL=http://localhost:5173   # update after frontend is deployed
PORT=3000
```

```bash
npm start
```

You should see `Server running on port 3000` and `Bot launched` in the terminal.

## 3. Run the frontend locally (optional)

`frontend/` has no build step — it's plain HTML/CSS/JS.

Open `frontend/app.js` and set:
```js
const BACKEND_URL = 'http://localhost:3000';
```

Serve it with any static server:
```bash
cd frontend
npx serve .
```

## 4. Push your code to GitHub

Both deployment platforms below pull from a GitHub repo, so do this first:
```bash
git init
git add .
git commit -m "Initial commit"
```
Create a new repository on GitHub, then:
```bash
git remote add origin https://github.com/your-username/your-repo.git
git branch -M main
git push -u origin main
```

## 5. Deploy the backend

You only need **one** of these (Railway.app or Render.com) — pick whichever you prefer, both are free to start.

### Option A: Railway.app

1. Go to [railway.app](https://railway.app) and sign in with GitHub.
2. Click **New Project → Deploy from GitHub repo** → select your repo.
3. Railway auto-detects Node.js. Click into the service, go to **Settings**:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Go to the **Variables** tab and add:
   - `BOT_TOKEN` = your bot token from step 1
   - `FRONTEND_URL` = leave a placeholder like `http://localhost:5173` for now — you'll update it in step 7
   - Railway sets `PORT` automatically, no need to add it.
5. Click **Deploy**. Once it's live, go to **Settings → Networking → Generate Domain** to get a public URL like `https://your-app.up.railway.app`. Copy it.

### Option B: Render.com

1. Go to [render.com](https://render.com) and sign in with GitHub.
2. Click **New → Web Service** → select your repo.
3. Configure:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free is fine to start.
4. Under **Environment**, add:
   - `BOT_TOKEN` = your bot token
   - `FRONTEND_URL` = placeholder for now
   - `PORT` is auto-set by Render, no need to add it.
5. Click **Create Web Service**. Once deployed, copy the URL Render gives you, e.g. `https://your-app.onrender.com`.

> Note: on Render's free tier the server sleeps after inactivity and takes ~30s to wake up on the next request — fine for testing, upgrade to a paid tier for production.

## 6. Deploy the frontend

Again, pick **one**: Vercel or Netlify.

### Option A: Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub.
2. Click **Add New → Project** → select your repo.
3. Configure:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Other (it's plain static HTML/JS, no build step).
   - **Build Command**: leave empty
   - **Output Directory**: `.`
4. Before deploying, edit `frontend/app.js` locally:
   ```js
   const BACKEND_URL = 'https://your-app.up.railway.app'; // or your Render URL
   ```
   Commit and push this change.
5. Click **Deploy**. Copy the resulting URL, e.g. `https://your-app.vercel.app`.

### Option B: Netlify

1. Go to [netlify.com](https://netlify.com) and sign in with GitHub.
2. Click **Add new site → Import an existing project** → select your repo.
3. Configure:
   - **Base directory**: `frontend`
   - **Build command**: leave empty
   - **Publish directory**: `frontend` (or `.` relative to the base directory)
4. Same as above — make sure `frontend/app.js` has the correct `BACKEND_URL` pointing at your deployed backend, committed and pushed before deploying.
5. Click **Deploy site**. Copy the resulting URL, e.g. `https://your-app.netlify.app`.

## 7. Link everything together

This is the step that makes the bot actually open your website as a Mini App.

1. **Update the backend's `FRONTEND_URL`**: go back to Railway/Render → your service → Environment Variables → set `FRONTEND_URL` to your Vercel/Netlify URL from step 6 → redeploy (Railway/Render usually redeploy automatically when you change env vars, or click **Redeploy** manually).
2. **Connect the bot to the website**:
   - Message **@BotFather** on Telegram.
   - Send `/mybots` → select your bot → **Bot Settings → Menu Button**.
   - Send the menu button text (e.g. `Play Games`) then your frontend URL (e.g. `https://your-app.vercel.app`).
   - *(Alternative)*: send `/newapp` to BotFather instead, to register it as a full Telegram Mini App with its own icon/short name — recommended if you want it discoverable, not just a menu button.
3. That's it — the bot now has a button that opens your deployed website inside Telegram, and your website talks to your deployed backend over Socket.io.

## 8. Test it end-to-end

1. Open your bot in Telegram (search its username, or use the link BotFather gave you).
2. Tap **Start**, then tap the menu button (or "🎮 Play Games").
3. The Mini App should load, show "Connecting...", then your name and candy balance.
4. Pick Chess or Ludo → open the same bot from a **second Telegram account** to get matched and play a full game.
5. Check `/points` and `/leaderboard` as bot commands too — they should reflect the same candy data.

If the Mini App gets stuck on "Connecting...", double-check:
- `BACKEND_URL` in `frontend/app.js` matches your live backend URL exactly (including `https://`).
- `FRONTEND_URL` env var on the backend matches your live frontend URL (this affects CORS).
- Your bot token is correct and hasn't been regenerated in BotFather since you set it.



## Notes & next steps
- **Storage**: `backend/economy/walletStore.js` uses a simple JSON file (`backend/wallet.json`). Fine for testing; switch to MongoDB/PostgreSQL before real traffic (concurrent writes to a JSON file aren't safe at scale).
- **Ludo rules**: simplified (no exact-roll-to-finish, no home column stretch) so the multiplayer logic stays easy to follow. You can extend `backend/games/ludoGame.js` for full classic rules.
- **Security**: never trust candy amounts sent from the frontend — this backend always recalculates winners and rewards server-side and verifies Telegram's `initData` signature before touching the wallet.
- **Scaling matchmaking/rooms**: currently stored in memory (`rooms` object in `server.js`). If you deploy multiple backend instances, move this to Redis.

