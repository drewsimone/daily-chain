// Daily Chain leaderboard API (Cloudflare Worker + D1).
// Static files (the game) are served by the assets binding; only /api/* reaches this code.
import DATA from './names.json';

const EPOCH = Date.UTC(2026, 8, 30); // issue #1, must match the game
const DAY = 86400000;
const MAX_NAMES = 45;       // hard cap on chain length we accept (60-second round)
const MAX_PER_IP = 10;      // submissions per IP per issue
const BOARD_LIMIT = 25;

/* ---------- name matching (mirrors the game page) ---------- */
const SUFFIX = { jr: 1, sr: 1, ii: 1, iii: 1, iv: 1 };
function tokens(s) {
  s = String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/['’`.]/g, '').replace(/[^a-z\s]/g, ' ');
  const t = s.split(/\s+/).filter(Boolean);
  while (t.length > 1 && SUFFIX[t[t.length - 1]]) t.pop();
  return t;
}
function keysFor(v) {
  const t = tokens(v), keys = [t.join(' ')];
  const t2 = t.filter((x) => x.length > 1);
  if (t2.length >= 2 && t2.length < t.length) keys.push(t2.join(' '));
  return keys;
}

// The "last name" is the last word of the display string (ignoring Jr/Sr/II/III/IV).
// The next name must start with its first letter. Mirrors lastWord() in the game page.
function lastWordInitial(display, t) {
  const words = display.match(/\S+/g) || [];
  while (words.length > 1 && SUFFIX[tokens(words[words.length - 1]).join('')]) words.pop();
  const lw = words[words.length - 1] || '';
  for (let j = 0; j < lw.length; j++) {
    const ch = lw.charAt(j).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/^[a-z]$/.test(ch)) return ch;
  }
  return t[t.length - 1][0];
}

let MAP = null, STARTERS = null, FIRST = null;
function init() {
  if (MAP) return;
  MAP = Object.create(null);
  let id = 0;
  const addName = (display) => {
    const t = tokens(display);
    if (!t.length) return null;
    const k0 = t.join(' ');
    let rec = MAP[k0];
    if (!rec) {
      const ch = lastWordInitial(display, t);
      rec = { id: id++, display, first: t[0][0], last: ch, rev: t[0][0] === ch };
    }
    keysFor(display).forEach((k) => { if (k && !MAP[k]) MAP[k] = rec; });
    return rec;
  };
  DATA.names.forEach(addName);
  STARTERS = DATA.starters.map((d) => MAP[tokens(d).join(' ')]).filter(Boolean);
  FIRST = MAP[tokens(DATA.firstStart).join(' ')];
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function dateOfIssue(issue) {
  const t = new Date(EPOCH + (issue - 1) * DAY);
  return t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate());
}
function startFor(issue) {
  if (issue === 1) return FIRST;
  return STARTERS[hashStr('daily-chain-' + dateOfIssue(issue)) % STARTERS.length];
}
function serverIssue(now) { return Math.floor((now - EPOCH) / DAY) + 1; }

/* ---------- nickname rules ---------- */
const BAD_STEMS = [
  'fuck', 'shit', 'cunt', 'bitch', 'dick', 'cock', 'pussy', 'whore', 'slut', 'bastard', 'asshole', 'wank',
  'nigg', 'nazi', 'hitler', 'rape', 'rapist', 'fagg', 'retard', 'twat', 'jizz', 'cum', 'tits', 'penis', 'vagina',
  'porn', 'kkk', 'molest', 'pedo'
];
function nickKey(n) {
  return n.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function nickProblem(raw) {
  if (typeof raw !== 'string') return 'Pick a nickname.';
  const n = raw.replace(/\s+/g, ' ').trim();
  if (n.length < 2 || n.length > 16) return 'Nickname must be 2 to 16 characters.';
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.\-]*$/.test(n)) return 'Use letters, numbers, spaces, dots, dashes or underscores.';
  const leet = n.toLowerCase().replace(/0/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/[4@]/g, 'a').replace(/[5$]/g, 's').replace(/7/g, 't').replace(/[^a-z]/g, '');
  for (const s of BAD_STEMS) if (leet.includes(s)) return 'Please pick a different nickname.';
  if (/(https?|www|\.com|\.net|\.org|\.gg)/i.test(n)) return 'No links in nicknames.';
  return null;
}
function cleanNick(raw) { return raw.replace(/\s+/g, ' ').trim(); }

/* ---------- helpers ---------- */
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }
  });
}
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function validIssue(n, now) {
  const cur = serverIssue(now);
  return Number.isInteger(n) && n >= 1 && n >= cur - 1 && n <= cur + 1;
}

/* Replays a submitted chain. Returns { error } or { points, names, flips, display[] }. */
export function replay(issue, list) {
  init();
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_NAMES) return { error: 'That chain length is not valid.' };
  const start = startFor(issue);
  if (!start) return { error: 'No puzzle for that day.' };
  const used = new Set([start.id]);
  let prev = start, points = 0, flips = 0;
  const display = [];
  for (const raw of list) {
    if (typeof raw !== 'string' || raw.length > 60) return { error: 'Bad name in chain.' };
    const rec = MAP[tokens(raw).join(' ')];
    if (!rec) return { error: 'Unknown name in chain: ' + raw.slice(0, 40) };
    if (used.has(rec.id)) return { error: 'Repeated name in chain.' };
    if (rec.first !== prev.last) return { error: 'Chain breaks the letter rule.' };
    used.add(rec.id);
    points += rec.rev ? 2 : 1;
    if (rec.rev) flips++;
    display.push(rec.display);
    prev = rec;
  }
  return { points, names: list.length, flips, display };
}

/* ---------- handlers ---------- */
async function getBoard(env, issue, deviceId) {
  const rows = (await env.DB.prepare(
    'SELECT nick, points, names, flips, device FROM scores WHERE issue = ?1 ORDER BY points DESC, names DESC, created_at ASC, id ASC LIMIT ?2'
  ).bind(issue, BOARD_LIMIT).all()).results || [];
  const total = (await env.DB.prepare('SELECT COUNT(*) AS c FROM scores WHERE issue = ?1').bind(issue).first()).c;
  const entries = rows.map((r, i) => ({ rank: i + 1, nick: r.nick, points: r.points, names: r.names, flips: r.flips, you: !!deviceId && r.device === deviceId }));
  let me = null;
  if (deviceId) {
    const mine = await env.DB.prepare('SELECT nick, points, names, flips, created_at, id FROM scores WHERE issue = ?1 AND device = ?2').bind(issue, deviceId).first();
    if (mine) {
      const better = (await env.DB.prepare(
        'SELECT COUNT(*) AS c FROM scores WHERE issue = ?1 AND (points > ?2 OR (points = ?2 AND names > ?3) OR (points = ?2 AND names = ?3 AND (created_at < ?4 OR (created_at = ?4 AND id < ?5))))'
      ).bind(issue, mine.points, mine.names, mine.created_at, mine.id).first()).c;
      me = { rank: better + 1, nick: mine.nick, points: mine.points, names: mine.names, flips: mine.flips };
    }
  }
  return { issue, total, entries, me };
}

async function handleScore(request, env, now) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 6000) return json({ error: 'too_large', message: 'Request too large.' }, 413);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_json', message: 'Bad request.' }, 400); }
  const issue = Number(body && body.issue);
  if (!validIssue(issue, now)) return json({ error: 'bad_issue', message: 'That puzzle is not open for scores.' }, 400);
  const device = body && body.device;
  if (typeof device !== 'string' || !/^[A-Za-z0-9\-]{16,64}$/.test(device)) return json({ error: 'bad_device', message: 'Bad request.' }, 400);
  const problem = nickProblem(body && body.nick);
  if (problem) return json({ error: 'bad_nick', message: problem }, 400);
  const nick = cleanNick(body.nick), nk = nickKey(nick);
  if (nk.length < 2) return json({ error: 'bad_nick', message: 'Nickname must have at least 2 letters or numbers.' }, 400);

  const r = replay(issue, body.names);
  if (r.error) return json({ error: 'bad_chain', message: r.error }, 400);

  const existing = await env.DB.prepare('SELECT id FROM scores WHERE issue = ?1 AND device = ?2').bind(issue, device).first();
  if (existing) return json({ error: 'already_posted', message: 'You already posted a score for this puzzle.', ...(await getBoard(env, issue, device)) }, 409);

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const ipHash = (await sha256Hex('dc|' + issue + '|' + ip)).slice(0, 32);
  const perIp = (await env.DB.prepare('SELECT COUNT(*) AS c FROM scores WHERE issue = ?1 AND ip_hash = ?2').bind(issue, ipHash).first()).c;
  if (perIp >= MAX_PER_IP) return json({ error: 'rate_limited', message: 'Too many scores from this network today.' }, 429);

  try {
    await env.DB.prepare(
      'INSERT INTO scores (issue, nick, nick_key, device, ip_hash, points, names, flips, chain, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)'
    ).bind(issue, nick, nk, device, ipHash, r.points, r.names, r.flips, JSON.stringify(r.display), now).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) {
      const dev = await env.DB.prepare('SELECT id FROM scores WHERE issue = ?1 AND device = ?2').bind(issue, device).first();
      if (dev) return json({ error: 'already_posted', message: 'You already posted a score for this puzzle.', ...(await getBoard(env, issue, device)) }, 409);
      return json({ error: 'nick_taken', message: 'That nickname is already on today\'s board. Try another.' }, 409);
    }
    return json({ error: 'server', message: 'Could not save your score. Try again.' }, 500);
  }
  return json({ ok: true, ...(await getBoard(env, issue, device)) });
}

function adminOk(request, env) {
  const h = request.headers.get('authorization') || '';
  return !!env.ADMIN_TOKEN && h === 'Bearer ' + env.ADMIN_TOKEN;
}

export default {
  async fetch(request, env) {
    init();
    const url = new URL(request.url);
    const now = Date.now();
    const p = url.pathname;
    try {
      if (p === '/api/leaderboard' && request.method === 'GET') {
        const issue = Number(url.searchParams.get('issue'));
        if (!validIssue(issue, now)) return json({ error: 'bad_issue', message: 'Unknown puzzle.' }, 400);
        const dev = url.searchParams.get('device');
        const device = dev && /^[A-Za-z0-9\-]{16,64}$/.test(dev) ? dev : null;
        return json(await getBoard(env, issue, device));
      }
      if (p === '/api/score' && request.method === 'POST') return await handleScore(request, env, now);

      if (p === '/api/admin/list' && request.method === 'GET') {
        if (!adminOk(request, env)) return json({ error: 'unauthorized' }, 401);
        const issue = Number(url.searchParams.get('issue') || serverIssue(now));
        const rows = (await env.DB.prepare('SELECT id, nick, points, names, flips, created_at FROM scores WHERE issue = ?1 ORDER BY points DESC, names DESC LIMIT 200').bind(issue).all()).results;
        return json({ issue, rows });
      }
      if (p === '/api/admin/delete' && request.method === 'POST') {
        if (!adminOk(request, env)) return json({ error: 'unauthorized' }, 401);
        const id = Number(url.searchParams.get('id'));
        if (!Number.isInteger(id)) return json({ error: 'bad_id' }, 400);
        const res = await env.DB.prepare('DELETE FROM scores WHERE id = ?1').bind(id).run();
        return json({ ok: true, deleted: res.meta ? res.meta.changes : undefined });
      }
      return json({ error: 'not_found' }, 404);
    } catch (e) {
      return json({ error: 'server', message: 'Something went wrong.' }, 500);
    }
  }
};
