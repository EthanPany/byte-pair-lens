"""Build the fallback web fonts in docs/fonts/fb/ and their index docs/fallback.json.

The page uses system fonts for everything outside Latin. Where a reader's system has no glyph
(rare Han extensions, historic scripts, emoji) the map showed boxes. This script cuts open
fonts into small slices, one or more per Unicode block, so the page can register and download
only the slices a given machine is missing (see `Fallback` in docs/index.html).

Usage:  python3 build_fallback.py <noto_ttf_dir> <plangothic_dir> <node_modules> <extra_dir>
          noto_ttf_dir     *-Regular.ttf from github.com/notofonts/notofonts.github.io (fonts/*/unhinted/ttf),
                           plus NotoEmoji-Regular.ttf: github.com/google/fonts ofl/notoemoji, instanced at wght 400
                           (outline emoji: colour emoji fonts do not draw in every browser)
          plangothic_dir   PlangothicP1-Regular.ttf, PlangothicP2-Regular.ttf (branch `build` of
                           github.com/Fitzgerald-Porthmouth-Koenigsegg/Plangothic_Project)
          node_modules     with @fontsource/noto-sans-sc installed (web slices of the common Han characters)
          extra_dir        fonts that only fill what the ones above leave open, in this order:
                           NotoSansCJKsc-Regular.otf (github.com/notofonts/noto-cjk, Sans/OTF/SimplifiedChinese): the
                           rest of CJK Unified Ideographs and Extension A, CJK symbols, box drawing;
                           NewGardiner.ttf (github.com/nederhof/newgardiner, fonts/): Egyptian Hieroglyphs Extended-A
        python3 build_fallback.py --check    (index and files agree; exit 1 otherwise)

Needs: pip install fonttools brotli
"""
import hashlib, json, re, shutil, sys, unicodedata
from pathlib import Path

ROOT = Path(__file__).parent.parent / 'docs'
OUT = ROOT / 'fonts' / 'fb'
INDEX = ROOT / 'fallback.json'
SLICE = 1024           # code points per slice in large blocks
HEAVY = 80_000         # a slice over this many bytes is cut in two (and again), so a slow line shows rows sooner; 64 code points at least
SKIP = {'Basic Latin', 'Latin-1 Supplement', 'Private Use Area', 'High Surrogates', 'High Private Use Surrogates',
        'Low Surrogates', 'Supplementary Private Use Area-A', 'Supplementary Private Use Area-B', 'Tags',
        'Variation Selectors', 'Variation Selectors Supplement'}
RENAME = {'NewGardiner': 'TOFU Fallback Hieroglyphs'}  # Reserved Font Name: a cut-down copy must not carry it
EXTRA = ['NotoSansCJKsc-Regular.otf', 'NewGardiner.ttf']  # in extra_dir; used only for code points nothing else has


def blocks():
    s = (ROOT / 'bytemap.js').read_text()
    body = s[s.index('const UBLOCKS = ['):s.index('// <<< UBLOCKS')]
    return [(int(a, 16), int(b, 16), n) for a, b, n in re.findall(r'\[0x([0-9A-F]+),0x([0-9A-F]+),"([^"]+)"\]', body)]


def runs(cps):
    """Sorted code points -> flat [start, length, ...]."""
    out = []
    for cp in cps:
        if out and out[-2] + out[-1] == cp:
            out[-1] += 1
        else:
            out += [cp, 1]
    return out


def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()[:10]


def css_ranges(css):
    """@fontsource css -> {file name: [code points]}."""
    out = {}
    for face in re.findall(r'@font-face\s*{(.*?)}', css, flags=re.S):
        f = re.search(r'url\(\./files/([^)]+\.woff2)\)', face)
        r = re.search(r'unicode-range:\s*([^;]+);', face)
        if not f or not r:
            continue
        cps = []
        for part in r[1].split(','):
            a, _, b = part.strip()[2:].partition('-')
            cps += range(int(a, 16), int(b or a, 16) + 1)
        out[f[1]] = cps
    return out


def build(noto_dir, plan_dir, node_modules, extra_dir):
    from fontTools.ttLib import TTFont
    from fontTools import subset

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    fonts = {}  # name -> (path, cmap set)
    for p in sorted(Path(noto_dir).glob('*-Regular.ttf')) + sorted(Path(plan_dir).glob('Plangothic*-Regular.ttf')):
        t = TTFont(p, lazy=True)
        fonts[p.stem.replace('-Regular', '')] = (p, set(t.getBestCmap()))
        t.close()
    # Sans before Serif, script fonts before the catch-alls, so the look stays consistent
    order = sorted(fonts, key=lambda n: (n in ('NotoSans', 'NotoSerif'), n.startswith('Plangothic'), 'Serif' in n, n))
    extra = []
    for fn in EXTRA:
        p = Path(extra_dir) / fn
        t = TTFont(p, lazy=True)
        fonts[p.stem.replace('-Regular', '')] = (p, set(t.getBestCmap()))
        extra.append(p.stem.replace('-Regular', ''))
        t.close()
    # the ready-made Noto Sans SC slices come first for the characters they hold (copied at the end)
    nm = Path(node_modules) / '@fontsource' / 'noto-sans-sc'
    sc = {fname: sorted(cp for cp in cps if 0x2E80 <= cp <= 0x9FFF or 0xF900 <= cp <= 0xFFEF)
          for fname, cps in sorted(css_ranges((nm / '400.css').read_text()).items())}
    sc_has = set().union(*map(set, sc.values()))
    slices, missing, n_out = [], [], 0

    def emit(name, src, cps, group):
        nonlocal n_out
        path, cmap = fonts[src]
        # the page draws a combining mark on a dotted circle; both must come from one font or the pair is a box
        if 0x25CC in cmap and 0x25CC not in cps and any(unicodedata.category(chr(cp))[0] == 'M' for cp in cps):
            cps = sorted(cps + [0x25CC])
        opt = subset.Options()
        opt.flavor = 'woff2'
        opt.layout_features = ['*']
        opt.notdef_outline = False
        opt.name_IDs = [1, 2]
        opt.hinting = False
        opt.desubroutinize = True
        f = subset.load_font(str(path), opt)
        s = subset.Subsetter(opt)
        s.populate(unicodes=cps)
        s.subset(f)
        if src in RENAME:
            for rec in f['name'].names:
                if rec.nameID in (1, 3, 4, 6, 16):
                    rec.string = RENAME[src] if rec.nameID != 6 else RENAME[src].replace(' ', '')
        out = OUT / f'{name}.woff2'
        subset.save_font(f, str(out), opt)
        f.close()
        if out.stat().st_size > HEAVY and len(cps) >= 128:
            out.unlink()
            return False
        slices.append({'f': out.name, 'v': digest(out), 'g': group, 'r': runs(cps)})
        n_out += 1
        return True

    for lo, hi, bname in blocks():
        if bname in SKIP:
            continue
        slug = re.sub(r'[^a-z0-9]+', '-', bname.lower()).strip('-')
        left = set(range(lo, hi + 1)) - sc_has
        k = 0
        for pool in (order, extra):   # the extra fonts only see what the first pool left open
            while True:
                best = max(pool, key=lambda n: len(fonts[n][1] & left))   # max keeps the first of equals
                got = sorted(fonts[best][1] & left)
                if not got:
                    break
                todo = [got[i:i + SLICE] for i in range(0, len(got), SLICE)]
                while todo:
                    part = todo.pop(0)
                    if emit(f'{slug}-{k}', best, part, bname):
                        k += 1
                    else:
                        h = len(part) // 2
                        todo[:0] = [part[:h], part[h:]]
                left -= set(got)
        if k == 0 and not (set(range(lo, hi + 1)) & sc_has):
            missing.append(bname)

    # ready-made slices for CJK Unified Ideographs and Extension A
    for fname, cps in sc.items():
        if not cps:
            continue
        out = OUT / fname.replace('-400-normal', '')
        shutil.copy(nm / 'files' / fname, out)
        slices.append({'f': out.name, 'v': digest(out), 'g': 'CJK Unified Ideographs', 'r': runs(cps)})
        n_out += 1

    INDEX.write_text(json.dumps({'slices': slices}, separators=(',', ':')) + '\n')
    size = sum(p.stat().st_size for p in OUT.glob('*.woff2'))
    print(f'{n_out} slices, {size / 1e6:.1f} MB in {OUT.relative_to(ROOT.parent)}; index {INDEX.stat().st_size / 1e3:.0f} kB')
    print(f'{len(missing)} blocks with no font: ' + ', '.join(missing))


def check():
    idx = json.loads(INDEX.read_text())['slices']
    bad = [s['f'] for s in idx if not (OUT / s['f']).exists() or digest(OUT / s['f']) != s['v']]
    extra = sorted({p.name for p in OUT.glob('*.woff2')} - {s['f'] for s in idx})
    print(f'fallback: {len(idx)} slices' + (' ok' if not bad and not extra else f'; changed or missing {bad[:5]}; not in index {extra[:5]}'))
    sys.exit(1 if bad or extra else 0)


if __name__ == '__main__':
    if '--check' in sys.argv:
        check()
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    build(*sys.argv[1:])
