// Regenerates src/names.json from the game page (public/index.html).
// Run this whenever you change the name list:  npm run names
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const file = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.test/', pretendToBeVisual: true });
const w = dom.window;

function done() {
  const DC = w.__dailyChain;
  if (!DC) throw new Error('Game hooks (window.__dailyChain) not found in public/index.html');
  const out = {
    names: DC.RECS.map(function (r) { return r.display; }),
    starters: DC.STARTERS.map(function (r) { return r.display; }),
    firstStart: 'Harmon Killebrew'
  };
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'names.json'), JSON.stringify(out));
  console.log('names.json written:', out.names.length, 'names,', out.starters.length, 'starters');
  process.exit(0);
}
if (w.document.readyState === 'complete') done(); else w.addEventListener('load', done);
