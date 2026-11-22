# Byte Pair Lens

Interactive visualiser for how byte-level BPE tokenizers (GPT-2 / GPT-4 / GPT-4o) cut text into UTF-8 bytes and merges, with a vocabulary breakdown by script and a code-point coverage map for CJK.

Everything runs client-side. No build step, no server.

Live: https://ethanpany.github.io/byte-pair-lens/ (deployed automatically from `master`).

## Layout

```
docs/                 the website (deploy this folder as-is)
  index.html          single-file app: HTML + CSS + JS
  r50k_base.json      GPT-2/3 vocab (50,256 tokens)
  cl100k_base.json    GPT-4 vocab (100,256 tokens)
  o200k_base.json     GPT-4o vocab (199,998 tokens)
scripts/
  build_vocab.py      regenerates the JSON files from tiktoken .tiktoken vocab files
  check_encoder.mjs   asserts the in-browser BPE matches the reference encoder
HANDOFF.md            notes for whoever hosts / extends the site
```

## Run locally

Any static server works; `fetch()` of the JSON files needs http(s), not `file://`.

```
cd docs && python3 -m http.server 8000
# open http://localhost:8000
```

## Vocab JSON format

```json
{"name": "cl100k_base",
 "cats": ["single ASCII byte", "partial-UTF-8 / byte fragment", ...],
 "cat":  [0, 0, 0, ..., 12, 3],      // category index per token, by rank
 "tokens": ["IQ==", "Ig==", ...]}    // base64 of each token's raw bytes, by rank
```

Rank order is merge order, so `tokens[i]` is token id `i`.

## Regenerate / verify

```
cd scripts
npm install                      # pulls gpt-tokenizer, which bundles the .tiktoken files
python3 build_vocab.py node_modules/gpt-tokenizer/data ../docs
node check_encoder.mjs           # expect N/N match for all three
```

## What it shows

- **Byte map** (first tab): every Unicode character laid out by its UTF-8 bytes. Opens on the whole of Unicode, one square per 64 characters, with the main scripts outlined; click to zoom into a block where one square is one character. Blue = one whole token, grey = split into bytes. Hover for the exact split, click to pin.
- **Tokenize:** token strip with id and bytes for each token, byte fragments highlighted; the vocabulary by script; a searchable vocabulary with the merge tree of any token.
- **Coverage:** script × tokenizer table (every character, the 1,000 most frequent, tokens per character) with CSV export, and a frequency curve per script.
- **Compare:** the same text through up to four tokenizers.

## Vocabulary sources

| File | Tokenizer | Source | Licence |
|---|---|---|---|
| `r50k_base`, `cl100k_base`, `o200k_base` | OpenAI tiktoken | `gpt-tokenizer` npm package | MIT |
| `llama3.1` | Llama 3.1 | `meta-llama/Llama-3.1-8B` (byte-identical copy from `NousResearch/Meta-Llama-3.1-8B`) | Llama 3.1 Community License |
| `qwen3` | Qwen3 | `Qwen/Qwen3-8B` | Apache-2.0 |
| `deepseek-v3` | DeepSeek-V3 | `deepseek-ai/DeepSeek-V3` | DeepSeek model licence |
| `gemma3` | Gemma 3 | `google/gemma-3-4b-it` (byte-identical copy from `unsloth/gemma-3-4b-it`; all Gemma 3 sizes share this file) | Gemma Terms of Use |
| `mistral-v0.3` | Mistral v0.3 | `mistralai/Mistral-7B-v0.3` | Apache-2.0 |

Each vocab file's `source` field records the repo it was built from and a sha256 prefix of the `tokenizer.json`. When the official repo is gated, `build_hf_vocab.py` downloads a public copy and refuses it unless its git object id equals the official file's (the hub publishes that id even for gated repos). Check the Llama, Gemma and DeepSeek licence terms before redistributing.

## Licence

Code: MIT. The vocabulary files keep their own licences; copies and the required notices are in [`docs/licenses/`](docs/licenses/) (also served with the site):

- Llama 3.1: Llama 3.1 Community License ("Built with Llama" is shown in the page footer)
- Gemma 3: Gemma Terms of Use, including the use restrictions in Section 3.2
- DeepSeek-V3: DeepSeek License Agreement, including the use-based restrictions in Attachment A
- Qwen3, Mistral 7B v0.3: Apache-2.0
- Logos in `docs/logos.js`: Meta, Qwen, DeepSeek, Google and Mistral AI marks from [Simple Icons](https://simpleicons.org) (CC0-1.0); the marks belong to their owners and only identify each tokenizer.
- r50k_base, cl100k_base, o200k_base: from [tiktoken](https://github.com/openai/tiktoken) (MIT), redistributed via the `gpt-tokenizer` npm package
