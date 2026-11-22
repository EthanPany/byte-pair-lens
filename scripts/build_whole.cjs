/* docs/whole.json: for every shipped tokenizer, which code points are one whole token, plus which code
   points are assigned characters. The byte map draws from this file alone, so it appears before any
   vocabulary has been downloaded or built. Produced with docs/bytemap.js, the code check_map.py verifies.

   Usage:  node build_whole.cjs           (rerun after changing any vocabulary, then build_manifest.py)
           node build_whole.cjs --check   (exit 1 if docs/whole.json is stale)
   Format: {assigned:[start,len,...], whole:{enc:[start,len,...]}}: runs of consecutive code points. */
const fs = require('fs'), path = require('path');
const DOCS = path.join(__dirname, '..', 'docs');
const BPE = require(path.join(DOCS, 'bpe.js')); globalThis.BPE = BPE;
const ByteMap = require(path.join(DOCS, 'bytemap.js'));
const ENC = ['r50k_base', 'cl100k_base', 'o200k_base', 'llama3.1', 'qwen3', 'deepseek-v3', 'gemma3', 'mistral-v0.3'];
const utf8 = new TextEncoder();

function runs(test) {
  const out = []; let start = -1;
  for (let cp = 0; cp <= 0x110000; cp++) {
    const on = cp < 0x110000 && !(cp >= 0xD800 && cp <= 0xDFFF) && test(cp);
    if (on && start < 0) start = cp;
    if (!on && start >= 0) { out.push(start, cp - start); start = -1; }
  }
  return out;
}
const isAssigned = cp => !ByteMap.NONCHAR.test(String.fromCodePoint(cp));
const out = { assigned: runs(isAssigned), whole: {} };
const count = r => { let n = 0; for (let i = 1; i < r.length; i += 2) n += r[i]; return n; };
for (const e of ENC) {
  const V = BPE.load(JSON.parse(fs.readFileSync(path.join(DOCS, e + '.json'), 'utf8')));
  const keys = ByteMap.vocabKeys(V);
  out.whole[e] = runs(cp => { if (!isAssigned(cp)) return false; const b = utf8.encode(String.fromCodePoint(cp)); return keys.has(BPE.key(b, 0, b.length)); });
  const O = ByteMap.overviewData(V);
  if (count(out.whole[e]) !== O.totW || count(out.assigned) !== O.totA) { console.error(`${e}: mismatch with bytemap.js overview (${count(out.whole[e])} vs ${O.totW})`); process.exit(1); }
  console.log(`${e}: ${O.totW.toLocaleString()} of ${O.totA.toLocaleString()} whole, ${out.whole[e].length / 2} runs`);
}
const text = JSON.stringify(out), file = path.join(DOCS, 'whole.json');
if (process.argv.includes('--check')) {
  const ok = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text;
  console.log(ok ? 'whole.json up to date' : 'whole.json is stale; run node build_whole.cjs');
  process.exit(ok ? 0 : 1);
}
fs.writeFileSync(file, text);
console.log(`wrote ${file} (${(text.length / 1024).toFixed(0)} KB)`);
