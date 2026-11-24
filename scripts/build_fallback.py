"""Build the fallback web fonts in docs/fonts/fb/ and their index docs/fallback.json.

The page uses system fonts for everything outside Latin. Where a reader's system has no glyph
(rare Han extensions, historic scripts, emoji) the map showed boxes. This script cuts open
fonts into small slices, one or more per Unicode block, so the page can register and download
only the slices a given machine is missing (see `Fallback` in docs/index.html).

Usage:  python3 build_fallback.py <noto_ttf_dir> <plangothic_dir> <node_modules>
          noto_ttf_dir     *-Regular.ttf from github.com/notofonts/notofonts.github.io (fonts/*/unhinted/ttf),
                           plus NotoEmoji-Regular.ttf: github.com/google/fonts ofl/notoemoji, instanced at wght 400
                           (outline emoji: colour emoji fonts do not draw in every browser)
          plangothic_dir   PlangothicP1-Regular.ttf, PlangothicP2-Regular.ttf (branch `build` of
                           github.com/Fitzgerald-Porthmouth-Koenigsegg/Plangothic_Project)
          node_modules     with @fontsource/noto-sans-sc installed
        python3 build_fallback.py --check    (index and files agree; exit 1 otherwise)

Needs: pip install fonttools brotli
"""
import hashlib, json, re, shutil, sys, unicodedata
from pathlib import Path

ROOT = Path(__file__).parent.parent / 'docs'
OUT = ROOT / 'fonts' / 'fb'
INDEX = ROOT / 'fallback.json'
SLICE = 1024           # code points per slice in large blocks
SKIP = {'Basic Latin', 'Latin-1 Supplement', 'Private Use Area', 'High Surrogates', 'High Private Use Surrogates',
        'Low Surrogates', 'Supplementary Private Use Area-A', 'Supplementary Private Use Area-B', 'Specials', 'Tags',
        'Variation Selectors', 'Variation Selectors Supplement'}
HAN_BMP = {'CJK Unified Ideographs', 'CJK Unified Ideographs Extension A'}  # served by the Noto Sans SC slices


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


def build(noto_dir, plan_dir, node_modules):
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
        out = OUT / f'{name}.woff2'
        subset.save_font(f, str(out), opt)
        f.close()
        slices.append({'f': out.name, 'v': digest(out), 'g': group, 'r': runs(cps)})
        n_out += 1

    for lo, hi, bname in blocks():
        if bname in SKIP or bname in HAN_BMP:
            continue
        slug = re.sub(r'[^a-z0-9]+', '-', bname.lower()).strip('-')
        left = set(range(lo, hi + 1))
        k = 0
        while True:
            best = max(order, key=lambda n: len(fonts[n][1] & left))   # max keeps the first of equals: `order`
            got = sorted(fonts[best][1] & left)
            if not got:
                break
            for i in range(0, len(got), SLICE):
                emit(f'{slug}-{k}', best, got[i:i + SLICE], bname)
                k += 1
            left -= set(got)
        if k == 0:
            missing.append(bname)

    # ready-made slices for CJK Unified Ideographs and Extension A
    nm = Path(node_modules) / '@fontsource' / 'noto-sans-sc'
    for fname, cps in sorted(css_ranges((nm / '400.css').read_text()).items()):
        cps = sorted(cp for cp in cps if 0x2E80 <= cp <= 0x9FFF or 0xF900 <= cp <= 0xFFEF)
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
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    build(*sys.argv[1:])
