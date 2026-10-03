# Daily Chain: game + nickname leaderboard

One Cloudflare Worker serves the game page (`public/index.html`) and a small API (`src/worker.js`) backed by a D1 database. Everything fits in Cloudflare's free tier for a small launch.

## What is in here

| File | What it does |
|---|---|
| `public/index.html` | The game. Shows the leaderboard automatically when the API exists, hides it when it does not. |
| `src/worker.js` | The API: `GET /api/leaderboard`, `POST /api/score`, plus two admin routes. |
| `src/names.json` | The name list the server uses to check scores. Generated from the game page. |
| `schema.sql` | The database table. |
| `wrangler.jsonc` | Cloudflare project settings. You paste your database id here once. |
| `test/` | Automated tests (API and in-browser). |

## One-time setup (about 20 minutes)

You need a free Cloudflare account and Node.js (the "LTS" download from nodejs.org).

1. Unzip this folder and open a terminal inside it.
2. `npm install`
3. `npx wrangler login` (opens your browser to approve access)
4. `npx wrangler d1 create daily-chain`
   Copy the `database_id` it prints into `wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_DATABASE_ID`.
5. `npm run db:init` (creates the scores table in your real database)
6. `npm run deploy`
   It prints a link like `https://daily-chain.YOURNAME.workers.dev`. Open it and play a round.
7. `npx wrangler secret put ADMIN_TOKEN`
   Type a long random password when asked. You will use it to remove bad entries. (Do this after the first deploy so the Worker already exists.)

## Put it on your own domain

Cloudflare dashboard: Workers & Pages > `daily-chain` > Settings > Domains & Routes > Add > Custom domain, then enter your domain. The domain's DNS must be on Cloudflare (it is automatic if you bought it there). If you already attached the domain to a Pages project, remove it from that project first.

## Updating the game

Edit `public/index.html`, then run `npm run deploy`. If you changed the name list, `deploy` regenerates `src/names.json` for you; the server must always have the same list as the page.

## Removing a bad entry

List today's entries (replace the domain and token):

    curl -H "Authorization: Bearer YOUR_TOKEN" "https://YOUR-DOMAIN/api/admin/list"

Delete one by its id:

    curl -X POST -H "Authorization: Bearer YOUR_TOKEN" "https://YOUR-DOMAIN/api/admin/delete?id=123"

## How scores are checked

- The browser sends the list of names. The server replays it: every name must be in the list, each must start with the previous name's last letter, no repeats, starting from that day's start name. Points are recomputed on the server.
- One score per device per day, one use of each nickname per day, at most 10 scores per network per day.
- Nicknames: 2 to 16 characters, letters, numbers, spaces, dots, dashes, underscores, with a basic profanity filter (edit `BAD_STEMS` in `src/worker.js`).
- Chains are capped at 45 names.

Limits to know about: the server cannot see how long a round took, so someone who knows enough names can post a long valid chain without playing in 60 seconds. The 45-name cap limits how far that goes. If cheating becomes a problem, the next step is a server-issued round start token.

## What data is stored (for your privacy policy)

Nickname, score, the list of names in the chain, a random device id from the player's browser, and a one-way hash of their IP address that is different for each day. No emails, no accounts.

## Local testing

    npm run db:init:local
    npm run dev                  # http://127.0.0.1:8787
    node test/api.test.js        # needs .dev.vars with ADMIN_TOKEN=testtoken123
    python3 test/e2e.py          # needs Playwright

