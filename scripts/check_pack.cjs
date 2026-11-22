/* The page builds vocabularies in a Web Worker and rebuilds them with BPE.unpack(BPE.pack(json)).
   This checks that route gives exactly the vocabulary BPE.load(json) gives (the one check_encoder.mjs and
   check_hf.py verify): same bytes, text, lookup tables, and the same tokens for a set of strings.
   The packed data goes through a structured clone, as it does between threads.
   Usage:  node check_pack.cjs   (exit 1 on any difference) */
const fs = require('fs'), path = require('path'), v8 = require('v8');
const DOCS = path.join(__dirname, '..', 'docs');
const BPE = require(path.join(DOCS, 'bpe.js'));
const ENC = ['r50k_base', 'cl100k_base', 'o200k_base', 'llama3.1', 'qwen3', 'deepseek-v3', 'gemma3', 'mistral-v0.3'];
const TESTS = ['今天天气很好。The weather is nice today. 날씨가 좋다 — numéro 2024!', '龘齉爨靐 𠀀𠀁', '😀🎉 👍🏽 👨‍👩‍👧 🇨🇳', 'مرحبا بالعالم، كيف حالك؟', 'नमस्ते दुनिया', "def f(x):\n    return [ord(c) for c in x]\t# don't", '  leading spaces and nbsp ', '<|endoftext|> <s> </s> <bos>', 'Większość programów używa UTF-8.', ''];
const CHARS = [...'aé߿ࠀ一龘가あ𠀀😀\u0080‍▁'];
let bad = 0;
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
for (const e of ENC) {
  const j = JSON.parse(fs.readFileSync(path.join(DOCS, e + '.json'), 'utf8'));
  const A = BPE.load(j), B = BPE.unpack(v8.deserialize(v8.serialize(BPE.pack(j))));
  const mf = path.join(DOCS, e + '.merges.json');
  if (A.kind === 'sp') { const m = JSON.parse(fs.readFileSync(mf, 'utf8')); A.setMerges(m); B.setMerges(Int32Array.from(m)); }
  const errs = [];
  if (A.bytes.length !== B.bytes.length) errs.push('token count');
  for (let i = 0; i < A.bytes.length && errs.length < 3; i++) {
    if (!eq(Array.from(A.bytes[i]), Array.from(B.bytes[i]))) errs.push('bytes of #' + i);
    if (A.text[i] !== B.text[i]) errs.push('text of #' + i);
  }
  for (const k of ['ranks', 'pieceId', 'added']) {
    if (!A[k]) continue;
    if (A[k].size !== B[k].size) errs.push(k + ' size');
    else for (const [x, y] of A[k]) if (B[k].get(x) !== y) { errs.push(k + ' entry'); break; }
  }
  for (const t of TESTS) if (!eq(A.encode(t), B.encode(t))) errs.push('encode ' + JSON.stringify(t.slice(0, 20)));
  for (const c of CHARS) if (!eq(A.splitChar(c), B.splitChar(c))) errs.push('splitChar U+' + c.codePointAt(0).toString(16));
  for (const id of [0, 300, 5000, 20000, A.bytes.length - 1]) if (JSON.stringify(A.mergeTree(id)) !== JSON.stringify(B.mergeTree(id))) errs.push('mergeTree #' + id);
  console.log(e + ': ' + (errs.length ? 'DIFFERENT: ' + errs.join(', ') : 'identical after pack/unpack'));
  bad += errs.length;
}
process.exit(bad ? 1 : 0);
