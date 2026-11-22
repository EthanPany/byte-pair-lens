/* Byte Pair Lens tokenizer engine. Shared by the page (global `BPE`) and the Node checks (require).
   Supports two families, both verified against the reference encoders (scripts/check_*.{mjs,py}):
   - "bytelevel": byte-level BPE (tiktoken r50k/cl100k/o200k, Llama 3.1, Qwen3, DeepSeek-V3).
       Merge rank = token id (true for tiktoken and for every byte-level tokenizer.json we ship).
   - "sp": SentencePiece-style BPE with byte fallback (Gemma 3, Mistral v0.3).
       Merges over characters, ranked by the merges list; unknown symbols fall back to <0xNN> bytes.
   Vocab files: {name, kind?, cats, cat, tokens (base64 raw bytes) | pieces (strings), pre?, added?}.
   The three original tiktoken files have no `kind`/`pre`; their settings are built in below. */
(function (root) {
  'use strict';

  // tiktoken pre-tokeniser patterns (copied from tiktoken). Older files rely on these.
  const TIKTOKEN = {
    r50k_base: String.raw`'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+`,
    cl100k_base: String.raw`(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+`,
    o200k_base: String.raw`[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n\/]*|\s*[\r\n]+|\s+(?!\S)|\s+`,
  };

  const utf8 = new TextEncoder();
  const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }) // ignoreBOM: keep a leading U+FEFF, some tokens start with one;

  function b64ToBytes(s) {
    const b = atob(s);
    const a = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  }
  // bytes[i..j) as a latin1 string: a cheap Map key for a byte sequence
  function key(bytes, i, j) {
    let s = '';
    for (let k = i; k < j; k++) s += String.fromCharCode(bytes[k]);
    return s;
  }
  function hex(b) {
    return Array.from(b, x => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  }
  function decodeOrNull(b) {
    try { return strict.decode(b); } catch (e) { return null; }
  }
  // SentencePiece piece -> raw bytes: "<0xE6>" is one byte, "▁" is a space
  function pieceBytes(p) {
    if (/^<0x[0-9A-F]{2}>$/.test(p)) return new Uint8Array([parseInt(p.slice(3, 5), 16)]);
    return utf8.encode(p.replace(/▁/g, ' '));
  }
  // Split each piece by each regex in turn, keeping the gaps (HF "Isolated" behaviour).
  function pretokenize(text, regexes) {
    let pieces = [text];
    for (const re of regexes) {
      const out = [];
      for (const p of pieces) {
        let last = 0;
        re.lastIndex = 0;
        for (const m of p.matchAll(re)) {
          if (m.index > last) out.push(p.slice(last, m.index));
          out.push(m[0]);
          last = m.index + m[0].length;
        }
        if (last < p.length) out.push(p.slice(last));
      }
      pieces = out;
    }
    return pieces;
  }
  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
  }

  // P (optional) is the output of pack(): the byte tables and decoded text already worked out in a worker,
  // so the page only has to index them. Everything after the tables is the same code either way.
  function load(j, P) {
    const kind = j.kind || 'bytelevel';
    const pre = j.pre || { splits: [TIKTOKEN[j.name]], ignoreMerges: true };
    const V = { name: j.name, kind, cats: j.cats, cat: j.cat, pre };

    if (kind === 'sp') {
      V.pieces = j.pieces;
      V.bytes = P ? views(P) : j.pieces.map(pieceBytes);
      V.pieceId = new Map();
      j.pieces.forEach((p, i) => { if (!V.pieceId.has(p)) V.pieceId.set(p, i); });
      V.mergeRank = null; // filled by setMerges(); only needed to encode text
    } else {
      V.bytes = P ? views(P) : j.tokens.map(b64ToBytes);
      V.ranks = new Map();
      if (P) P.keys.forEach((k, i) => { if (!V.ranks.has(k)) V.ranks.set(k, i); });
      else V.bytes.forEach((b, i) => { const k = key(b, 0, b.length); if (!V.ranks.has(k)) V.ranks.set(k, i); });
    }
    V.text = P ? P.text : V.bytes.map(decodeOrNull);
    V.splitRes = (pre.splits || []).map(s => new RegExp(s, 'gu'));

    // added tokens (special and not) are matched in the raw text before anything else
    V.added = new Map();
    for (const [content, id] of j.added || []) V.added.set(content, id);
    V.addedRe = V.added.size
      ? new RegExp([...V.added.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|'), 'gu')
      : null;

    // The merges table is large (Gemma 3: half a million pairs), so it is indexed on first use.
    let mergeFlat = null, mergeRank = null;
    Object.defineProperty(V, 'mergeRank', {
      get() {
        if (!mergeRank && mergeFlat) {
          mergeRank = new Map();
          for (let r = 0, k = 0; k < mergeFlat.length; r++, k += 2) {
            const mk = mergeFlat[k] * 524288 + mergeFlat[k + 1];
            if (!mergeRank.has(mk)) mergeRank.set(mk, r);
          }
        }
        return mergeRank;
      },
      set(v) { mergeRank = v; },
    });
    V.setMerges = flat => { mergeFlat = flat; mergeRank = null; };
    V.encode = str => encode(V, str);
    // Tokens for one bare character: its UTF-8 bytes (or the character, for "sp") merged by BPE,
    // with no normalisation, no pre-tokenisation and no leading '▁'. Used by the byte map, so map
    // numbers don't depend on Mistral's start-of-text prefix.
    // How token `id` was built: replay BPE on its own bytes (or characters, for "sp") and record each
    // merge. Returns a binary tree {id, left, right} with leaves {id} (bytes/characters), or null when
    // the token is not reachable by merges (special/added tokens, byte-fallback pieces).
    V.mergeTree = id => mergeTree(V, id);
    V.splitChar = ch => (V.kind === 'sp' ? bpeSp(V, ch) : bpeBytes(V, utf8.encode(ch)));
    return V;
  }

  // byte-level BPE on one piece: merge the lowest-rank adjacent pair until none is left
  function bpeBytes(V, bytes) {
    const parts = [];
    for (let i = 0; i < bytes.length; i++) parts.push([i, i + 1]);
    while (parts.length > 1) {
      let best = -1;
      let bestRank = Infinity;
      for (let i = 0; i < parts.length - 1; i++) {
        const r = V.ranks.get(key(bytes, parts[i][0], parts[i + 1][1]));
        if (r !== undefined && r < bestRank) { bestRank = r; best = i; }
      }
      if (best < 0) break;
      parts.splice(best, 2, [parts[best][0], parts[best + 1][1]]);
    }
    return parts.map(([a, b]) => V.ranks.get(key(bytes, a, b)));
  }

  // SentencePiece-style BPE on one piece: merge characters by merges-list rank, then byte fallback
  function bpeSp(V, piece) {
    const syms = Array.from(piece);
    const ids = syms.map(s => V.pieceId.get(s));
    while (syms.length > 1) {
      let best = -1;
      let bestRank = Infinity;
      for (let i = 0; i < syms.length - 1; i++) {
        if (ids[i] === undefined || ids[i + 1] === undefined) continue;
        const r = V.mergeRank.get(ids[i] * 524288 + ids[i + 1]);
        if (r !== undefined && r < bestRank) { bestRank = r; best = i; }
      }
      if (best < 0) break;
      const merged = syms[best] + syms[best + 1];
      syms.splice(best, 2, merged);
      ids.splice(best, 2, V.pieceId.get(merged));
    }
    const out = [];
    syms.forEach((s, i) => {
      if (ids[i] !== undefined) { out.push(ids[i]); return; }
      for (const b of utf8.encode(s)) out.push(V.pieceId.get('<0x' + b.toString(16).toUpperCase().padStart(2, '0') + '>'));
    });
    return out;
  }

  // atStart: this segment begins at offset 0 of the input (Metaspace "first" only prefixes there)
  function mergeTree(V, id) {
    let nodes;
    if (V.kind === 'sp') {
      if (!V.mergeRank) return null;
      const p = V.pieces[id];
      nodes = Array.from(p).map(c => ({ id: V.pieceId.get(c), s: c }));
      if (nodes.some(n => n.id === undefined)) return null;
      while (nodes.length > 1) {
        let best = -1, bestRank = Infinity;
        for (let i = 0; i < nodes.length - 1; i++) {
          const r = V.mergeRank.get(nodes[i].id * 524288 + nodes[i + 1].id);
          if (r !== undefined && r < bestRank) { bestRank = r; best = i; }
        }
        if (best < 0) return null;
        const s = nodes[best].s + nodes[best + 1].s;
        nodes.splice(best, 2, { id: V.pieceId.get(s), s, left: nodes[best], right: nodes[best + 1], rank: bestRank });
      }
    } else {
      const b = V.bytes[id];
      nodes = Array.from(b, (x, i) => ({ id: V.ranks.get(key(b, i, i + 1)), a: i, e: i + 1 }));
      while (nodes.length > 1) {
        let best = -1, bestRank = Infinity;
        for (let i = 0; i < nodes.length - 1; i++) {
          const r = V.ranks.get(key(b, nodes[i].a, nodes[i + 1].e));
          if (r !== undefined && r < bestRank) { bestRank = r; best = i; }
        }
        if (best < 0) return null;
        nodes.splice(best, 2, { id: bestRank, a: nodes[best].a, e: nodes[best + 1].e, left: nodes[best], right: nodes[best + 1] });
      }
    }
    return nodes[0] && nodes[0].id === id ? nodes[0] : null;
  }

  function encodeSegment(V, s, atStart) {
    const ids = [];
    const pre = V.pre;
    if (pre.normalizer === 'NFC') s = s.normalize('NFC');
    if (V.kind === 'sp') {
      if (!V.mergeRank) throw new Error(V.name + ': merges not loaded');
      if (pre.replaceSpace) s = s.replace(/ /g, '▁');
      if (pre.prepend === 'first' && atStart && !s.startsWith('▁')) s = '▁' + s;
      const pieces = V.splitRes.length ? pretokenize(s, V.splitRes) : [s];
      for (const p of pieces) ids.push(...bpeSp(V, p));
      return ids;
    }
    for (const p of pretokenize(s, V.splitRes)) {
      const b = utf8.encode(p);
      if (pre.ignoreMerges) {
        const direct = V.ranks.get(key(b, 0, b.length));
        if (direct !== undefined) { ids.push(direct); continue; }
      }
      ids.push(...bpeBytes(V, b));
    }
    return ids;
  }

  function encode(V, str) {
    if (!V.addedRe) return encodeSegment(V, str, true);
    const ids = [];
    let last = 0;
    for (const m of str.matchAll(V.addedRe)) {
      if (m.index > last) ids.push(...encodeSegment(V, str.slice(last, m.index), last === 0));
      ids.push(V.added.get(m[0]));
      last = m.index + m[0].length;
    }
    if (last < str.length) ids.push(...encodeSegment(V, str.slice(last), last === 0));
    return ids;
  }

  // token i's bytes as a view into one shared buffer
  function views(P) {
    const out = new Array(P.off.length - 1);
    for (let i = 0; i < out.length; i++) out[i] = P.flat.subarray(P.off[i], P.off[i + 1]);
    return out;
  }
  // Build a vocabulary and flatten its tables into plain data that can be handed to another thread:
  // {meta (the file without its token list), flat + off (all token bytes), text, keys (byte-level only)}.
  function pack(j) {
    const V = load(j), n = V.bytes.length, off = new Uint32Array(n + 1);
    let tot = 0;
    for (let i = 0; i < n; i++) { off[i] = tot; tot += V.bytes[i].length; }
    off[n] = tot;
    const flat = new Uint8Array(tot);
    for (let i = 0; i < n; i++) flat.set(V.bytes[i], off[i]);
    const meta = {};
    for (const k in j) if (k !== 'tokens') meta[k] = j[k];
    return { meta, flat, off, text: V.text, keys: V.kind === 'sp' ? null : V.bytes.map(b => key(b, 0, b.length)) };
  }
  const unpack = P => load(P.meta, P);

  const api = { load, pack, unpack, hex, key, utf8, TIKTOKEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BPE = api;

  // Loaded as a Web Worker (new Worker('bpe.js')): read a vocabulary the page has already saved in Cache
  // Storage, parse and build it here, and send the tables back, so the page never freezes on a big file.
  if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
    root.onmessage = async ev => {
      const { id, cacheName, vocab, merges } = ev.data;
      try {
        const store = await caches.open(cacheName);
        const get = async u => { const r = await store.match(u); if (!r) throw new Error('not in cache: ' + u); return r.json(); };
        const [j, m] = await Promise.all([get(vocab), merges ? get(merges) : null]);
        const P = pack(j), mergesFlat = m ? Int32Array.from(m) : null;
        root.postMessage({ id, P, merges: mergesFlat }, [P.flat.buffer, P.off.buffer].concat(mergesFlat ? [mergesFlat.buffer] : []));
      } catch (e) {
        root.postMessage({ id, error: String((e && e.message) || e) });
      }
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
