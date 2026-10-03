import sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8787/"
OUT = sys.argv[2] if len(sys.argv) > 2 else "."
NEXT = """() => {
  const DC = window.__dailyChain, G = DC.getGame();
  const pool = DC.RECS.filter(r => !G.used[r.id] && DC.fits(G, r));
  const want = G.chain.length === 2 || G.chain.length === 5;
  return ((want ? pool.find(r => r.rev) : null) || pool.find(r => !r.rev)).display;
}"""
import random
RUN = str(random.randint(100,999))
NICK1 = "Drew" + RUN
NICK2 = "Night Owl " + RUN
fails = 0
def ok(c, m):
    global fails
    print(("ok  : " if c else "FAIL: ") + m)
    if not c: fails += 1

with sync_playwright() as p:
    b = p.chromium.launch()
    for scheme in ("light", "dark"):
        ctx = b.new_context(viewport={"width": 400, "height": 900}, color_scheme=scheme)
        pg = ctx.new_page()
        pg.goto(BASE); pg.wait_for_function("window.__dailyChain", timeout=20000)
        pg.evaluate("localStorage.clear()"); pg.reload(); pg.wait_for_function("window.__dailyChain", timeout=20000); pg.wait_for_timeout(300)
        pg.click("#startBtn"); pg.wait_for_timeout(150)
        for i in range(9):
            nm = pg.evaluate(NEXT); pg.fill("#guess", nm); pg.press("#guess", "Enter"); pg.wait_for_timeout(40)
        pts = pg.inner_text("#points")
        pg.evaluate("(() => { const t = Date.now(); window.__dailyChain.setClock(() => t + 61000); })()")
        pg.wait_for_timeout(700)
        ok(pg.is_visible("#lbEnd") and pg.is_visible("#lbNick"), scheme + ": nickname box shown after the round")
        pg.screenshot(path=f"{OUT}/lb-end-form-{scheme}.png", full_page=True)
        pg.fill("#lbNick", NICK1 if scheme == "light" else NICK2)
        pg.click("#lbForm button"); pg.wait_for_timeout(800)
        txt = pg.inner_text("#lbEnd")
        ok("You are #" in txt and (NICK1 in txt or NICK2 in txt), scheme + ": posted and ranked -> " + txt.replace("\n", " | ")[:110])
        ok(pg.is_hidden("#lbNick"), scheme + ": form replaced after posting")
        pg.screenshot(path=f"{OUT}/lb-end-posted-{scheme}.png", full_page=True)
        # reload: state restored and still shows rank
        pg.reload(); pg.wait_for_timeout(900)
        ok("You are #" in pg.inner_text("#lbEnd"), scheme + ": after reload the posted rank is remembered")
        pg.click("#lbBox summary"); pg.wait_for_timeout(200)
        ok(pg.is_visible("#lbPage .lb-list"), scheme + ": leaderboard list opens")
        ow = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        ok(ow == 0, scheme + f": no horizontal overflow ({ow})")
        pg.locator("#lbBox").scroll_into_view_if_needed()
        pg.screenshot(path=f"{OUT}/lb-page-{scheme}.png", full_page=True)
        # practice mode hides leaderboard
        pg.click("#btnPractice"); pg.wait_for_timeout(200)
        ok(pg.is_hidden("#lbBox"), scheme + ": leaderboard hidden in practice")
        ctx.close()
    # nickname rejection shown in UI
    ctx = b.new_context(viewport={"width": 400, "height": 900}); pg = ctx.new_page()
    pg.goto(BASE); pg.wait_for_function("window.__dailyChain", timeout=20000); pg.evaluate("localStorage.clear()"); pg.reload(); pg.wait_for_function("window.__dailyChain", timeout=20000); pg.wait_for_timeout(300)
    pg.click("#startBtn")
    for i in range(3):
        nm = pg.evaluate(NEXT); pg.fill("#guess", nm); pg.press("#guess", "Enter"); pg.wait_for_timeout(40)
    pg.evaluate("(() => { const t = Date.now(); window.__dailyChain.setClock(() => t + 61000); })()"); pg.wait_for_timeout(700)
    pg.fill("#lbNick", "Sh1t"); pg.click("#lbForm button"); pg.wait_for_timeout(600)
    ok("different nickname" in pg.inner_text("#lbEnd").lower(), "bad nickname message shown")
    pg.fill("#lbNick", NICK1); pg.click("#lbForm button"); pg.wait_for_timeout(600)
    ok("already on today" in pg.inner_text("#lbEnd").lower() or "taken" in pg.inner_text("#lbEnd").lower() or "already" in pg.inner_text("#lbEnd").lower(), "duplicate nickname message shown: " + pg.inner_text("#lbEnd").replace("\n"," | ")[:140])
    ctx.close()
    # no backend (file://): leaderboard silently absent
    ctx = b.new_context(viewport={"width": 400, "height": 900}); pg = ctx.new_page()
    pg.goto("file:///home/claude/daily-chain-site/public/index.html"); pg.wait_for_function("window.__dailyChain", timeout=20000); pg.wait_for_timeout(300)
    pg.click("#startBtn")
    for i in range(3):
        nm = pg.evaluate(NEXT); pg.fill("#guess", nm); pg.press("#guess", "Enter"); pg.wait_for_timeout(40)
    pg.evaluate("(() => { const t = Date.now(); window.__dailyChain.setClock(() => t + 61000); })()"); pg.wait_for_timeout(900)
    ok(pg.is_hidden("#lbBox") and pg.locator("#lbEnd").count() == 1 and pg.is_hidden("#lbEnd"), "no backend: leaderboard hidden, game still works")
    ok(pg.is_visible("#copy"), "no backend: share button still there")
    ctx.close()
    b.close()
print("FAILURES: %d" % fails if fails else "ALL E2E CHECKS PASSED")
