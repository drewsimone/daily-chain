// End-to-end API test against `wrangler dev --local` (http://127.0.0.1:8787).
// Uses the real game engine (jsdom) to build valid chains, then checks the server accepts/rejects correctly.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.test/', pretendToBeVisual: true });
const w = dom.window;
let fails = 0;
function ok(c, m) { if (!c) { fails++; console.log('FAIL:', m); } else console.log('ok  :', m); }
const EPOCH = Date.UTC(2026, 8, 30), DAY = 86400000;
const issueNow = () => Math.floor((Date.now() - EPOCH) / DAY) + 1;
function dateOf(issue) { const t = new Date(EPOCH + (issue - 1) * DAY); return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0'); }
let dev = 0; const newDev = () => 'test-device-' + String(++dev).padStart(8, '0') + '-' + Math.random().toString(36).slice(2, 10);
async function post(body) { const r = await fetch(BASE + '/api/score', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }); return { s: r.status, j: await r.json() }; }
async function get(p, h) { const r = await fetch(BASE + p, { headers: h }); return { s: r.status, j: await r.json() }; }

(async () => {
  if (w.document.readyState !== 'complete') await new Promise((r) => w.addEventListener('load', r));
  const DC = w.__dailyChain;
  const issue = issueNow();
  const start = DC.pickStart('daily-chain-' + dateOf(issue), issue === 1);
  function chain(n, wantFlips) {
    const G = DC.newGame('daily', dateOf(issue), start);
    for (let i = 0; i < n; i++) {
      const pool = DC.RECS.filter((r) => !G.used[r.id] && DC.fits(G, r));
      const pick = (wantFlips && i % 3 === 1 ? pool.find((r) => r.rev) : null) || pool.find((r) => !r.rev);
      DC.accept(G, pick);
    }
    return { names: G.chain.map((c) => c.rec.display), pts: DC.points(G), flips: DC.flips(G) };
  }

  const a = chain(12, true);
  let r = await post({ issue, nick: 'Drew', device: newDev(), names: a.names });
  ok(r.s === 200 && r.j.ok, 'valid chain accepted (server computed the same start name as the client)');
  ok(r.j.me && r.j.me.points === a.pts && r.j.me.flips === a.flips, 'server points/flips match the client engine: ' + a.pts + '/' + a.flips);

  const devA = newDev();
  const b = chain(20, true);
  r = await post({ issue, nick: 'Tiger Fan', device: devA, names: b.names });
  ok(r.s === 200 && r.j.me.rank === 1 && r.j.total === 2, 'higher score ranks #1 (' + JSON.stringify(r.j.me) + ')');
  r = await post({ issue, nick: 'Other Name', device: devA, names: b.names });
  ok(r.s === 409 && r.j.error === 'already_posted', 'same device cannot post twice');
  r = await post({ issue, nick: 'tiger  fan', device: newDev(), names: a.names });
  ok(r.s === 409 && r.j.error === 'nick_taken', 'nickname already taken (case/space-insensitive)');

  const bad = a.names.slice(); bad[2] = 'Tom Hanks';
  r = await post({ issue, nick: 'Cheater1', device: newDev(), names: bad });
  ok(r.s === 400 && r.j.error === 'bad_chain', 'letter-rule break rejected: ' + r.j.message);
  r = await post({ issue, nick: 'Cheater2', device: newDev(), names: [a.names[0], a.names[0]] });
  ok(r.s === 400, 'repeat rejected: ' + r.j.message);
  r = await post({ issue, nick: 'Cheater3', device: newDev(), names: ['Not A Real Person'] });
  ok(r.s === 400 && /Unknown/.test(r.j.message), 'unknown name rejected');
  const long = chain(46, false);
  r = await post({ issue, nick: 'Cheater4', device: newDev(), names: long.names });
  ok(r.s === 400, 'over-long chain rejected (46 names)');
  r = await post({ issue, nick: 'Cheater5', device: newDev(), names: [] });
  ok(r.s === 400, 'empty chain rejected');

  for (const nick of ['f u c k', 'Sh1t', 'x', 'a'.repeat(17), 'www.site.com', '<b>hi</b>', 'Nazi Dude']) {
    r = await post({ issue, nick, device: newDev(), names: a.names });
    ok(r.s === 400 && r.j.error === 'bad_nick', 'bad nickname rejected: "' + nick + '"');
  }
  r = await post({ issue: issue + 5, nick: 'Future', device: newDev(), names: a.names });
  ok(r.s === 400 && r.j.error === 'bad_issue', 'far-future issue rejected');
  r = await post({ issue: 1, nick: 'Past', device: newDev(), names: a.names });
  ok(r.s === 400 && r.j.error === 'bad_issue', 'old issue rejected');
  r = await post({ issue, nick: 'NoDevice', device: 'x', names: a.names });
  ok(r.s === 400, 'bad device id rejected');
  r = await fetch(BASE + '/api/score', { method: 'POST', body: 'not json' }); ok(r.status === 400, 'non-JSON body rejected');

  // chain valid for the NEXT day's puzzle (timezones ahead of UTC)
  const issue2 = issue + 1;
  const start2 = DC.pickStart('daily-chain-' + dateOf(issue2), false);
  const G2 = DC.newGame('daily', dateOf(issue2), start2);
  for (let i = 0; i < 5; i++) { const p = DC.RECS.find((x) => !G2.used[x.id] && DC.fits(G2, x) && !x.rev); DC.accept(G2, p); }
  r = await post({ issue: issue2, nick: 'EarlyBird', device: newDev(), names: G2.chain.map((c) => c.rec.display) });
  ok(r.s === 200, 'tomorrow\'s puzzle accepted for players ahead of UTC');
  // a chain built from a different day's start name must fail (only testable when the two start letters differ)
  if (start.last !== start2.last) {
    r = await post({ issue, nick: 'Mixup', device: newDev(), names: G2.chain.map((c) => c.rec.display) });
    ok(r.s === 400, 'chain from a different day\'s start name rejected');
  } else console.log('skip: both days start with the same letter');

  // leaderboard + "you"
  r = await get('/api/leaderboard?issue=' + issue + '&device=' + devA);
  ok(r.s === 200 && r.j.entries[0].nick === 'Tiger Fan' && r.j.entries[0].you === true && r.j.me.rank === 1, 'leaderboard order + you flag');
  ok(r.j.entries.length === 2 && r.j.entries[1].nick === 'Drew', 'second place is Drew');
  r = await get('/api/leaderboard?issue=999');
  ok(r.s === 400, 'unknown issue board rejected');

  // admin
  r = await get('/api/admin/list?issue=' + issue);
  ok(r.s === 401, 'admin list requires token');
  r = await get('/api/admin/list?issue=' + issue, { authorization: 'Bearer testtoken123' });
  ok(r.s === 200 && r.j.rows.length === 2, 'admin list with token');
  const id = r.j.rows[1].id;
  let d = await fetch(BASE + '/api/admin/delete?id=' + id, { method: 'POST' }); ok(d.status === 401, 'admin delete requires token');
  d = await fetch(BASE + '/api/admin/delete?id=' + id, { method: 'POST', headers: { authorization: 'Bearer testtoken123' } }); ok(d.status === 200, 'admin delete works');
  r = await get('/api/leaderboard?issue=' + issue);
  ok(r.j.total === 1, 'deleted entry gone');

  // rate limit per IP (10 per issue); we already posted 2 successes + early bird on other issue; add more
  let limited = false;
  for (let i = 0; i < 12 && !limited; i++) { const x = await post({ issue, nick: 'Bulk' + i + 'x', device: newDev(), names: a.names }); if (x.s === 429) limited = true; }
  ok(limited, 'per-IP rate limit triggers');
  const home = await fetch(BASE + '/'); const t = await home.text();
  ok(home.status === 200 && /Daily Chain/.test(t), 'game page is served');
  console.log(fails ? fails + ' FAILURES' : 'ALL API CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})();
