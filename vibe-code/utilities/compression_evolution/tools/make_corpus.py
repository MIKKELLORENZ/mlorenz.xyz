"""make_corpus.py — builds corpus/*.js and corpus_meta.js.

Every reference line on the score chart is MEASURED here, on the exact bytes the
page evolves against, with the real tool at its strongest ordinary setting. Nothing
is quoted from a paper. Re-run whenever a corpus file changes:

    python tools/make_corpus.py --src <folder with the source material>

Source material (all public domain / CC0, fetched once into --src):
  cat_original.jpg  https://commons.wikimedia.org/wiki/File:Cat_portrait_(Unsplash).jpg   (Anton Petrov, CC0)
  guitar22.wav      https://commons.wikimedia.org/wiki/File:Audio_files_of_spanish_guitar_chords_22.wav  (Wilfredor, CC0)
  meow.wav          https://commons.wikimedia.org/wiki/File:Meow_of_a_Siamese_cat_-_freemaster2.wav      (freemaster2, CC0)
  cantrbry/alice29.txt  https://corpus.canterbury.ac.nz/  (Lewis Carroll, public domain; the classic benchmark file)

Needs Pillow + numpy + ffmpeg on PATH. zstandard / brotli / pyppmd are optional:
a missing module just means that line is not drawn.
"""
import argparse, base64, bz2, io, json, lzma, math, os, subprocess, sys, tempfile, wave, zlib
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def ffmpeg(args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y'] + args, check=True)


def general_baselines(raw):
    out = []
    n = len(raw)
    c = Counter(raw)
    h = -sum(v / n * math.log2(v / n) for v in c.values())
    out.append(dict(id='entropy', name='Huffman-style (byte frequencies only)', bytes=int(math.ceil(h * n / 8)), family='bound',
                    how='zeroth-order entropy of the byte histogram: what any code that ignores context is limited to'))
    try:        # the real binary when there is one: "gzip -9" should mean gzip -9
        gz = subprocess.run(['gzip', '-9', '-n', '-c'], input=raw, stdout=subprocess.PIPE, check=True).stdout
        ver = subprocess.run(['gzip', '--version'], stdout=subprocess.PIPE).stdout.decode('ascii', 'replace').split('\n')[0].strip()
        out.append(dict(id='gzip', name='gzip -9', bytes=len(gz), family='general', how='%s, -9 (LZ77 + Huffman)' % ver))
    except Exception:
        out.append(dict(id='gzip', name='gzip -9', bytes=len(zlib.compress(raw, 9)) + 12, family='general', how='zlib %s level 9 + gzip framing (LZ77 + Huffman)' % zlib.ZLIB_RUNTIME_VERSION))
    out.append(dict(id='bzip2', name='bzip2 -9', bytes=len(bz2.compress(raw, 9)), family='general', how='Python bz2 level 9 (BWT + MTF + Huffman)'))
    out.append(dict(id='xz', name='xz -9e', bytes=len(lzma.compress(raw, preset=9 | lzma.PRESET_EXTREME)), family='general', how='Python lzma preset 9 extreme (LZMA2)'))
    try:
        import zstandard
        out.append(dict(id='zstd', name='zstd -19', bytes=len(zstandard.ZstdCompressor(level=19).compress(raw)), family='general', how='zstandard %s level 19' % zstandard.__version__))
    except ImportError:
        print('  (zstandard missing)')
    try:
        import brotli
        out.append(dict(id='brotli', name='brotli -q 11', bytes=len(brotli.compress(raw, quality=11, lgwin=24)), family='general', how='brotli quality 11, 16 MB window'))
    except ImportError:
        print('  (brotli missing)')
    try:
        import pyppmd
        enc = pyppmd.Ppmd7Encoder(6, 64 << 20)
        out.append(dict(id='ppmd', name='PPMd (7-Zip)', bytes=len(enc.encode(raw) + enc.flush()), family='general', how='PPMd variant H, order 6 — 7-Zip’s text method (context modelling)'))
    except ImportError:
        print('  (pyppmd missing)')
    return out


def image_baselines(raw, w, h):
    from PIL import Image
    im = Image.frombytes('RGB', (w, h), raw)
    out = []
    b = io.BytesIO(); im.save(b, 'PNG', optimize=True, compress_level=9)
    out.append(dict(id='png', name='PNG', bytes=b.tell(), family='image', how='Pillow, optimize, level 9 (row filters + deflate)'))
    b = io.BytesIO(); im.save(b, 'WEBP', lossless=True, quality=100, method=6)
    out.append(dict(id='webp', name='WebP lossless', bytes=b.tell(), family='image', how='libwebp via Pillow, lossless, method 6'))
    try:
        b = io.BytesIO(); im.save(b, 'JPEG2000', irreversible=False)
        out.append(dict(id='jp2', name='JPEG 2000 lossless', bytes=b.tell(), family='image', how='OpenJPEG via Pillow, reversible 5/3 wavelet'))
    except Exception as e:
        print('  (jpeg2000 failed: %s)' % e)
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, 'in.png'); im.save(src)
        for bid, name, args, ext, how in [
            ('jpegls', 'JPEG-LS', ['-c:v', 'jpegls', '-pix_fmt', 'rgb24', '-f', 'image2'], 'jls', 'ffmpeg jpegls (LOCO-I: MED predictor + Golomb codes)'),
            ('jxl', 'JPEG XL lossless', ['-c:v', 'libjxl', '-distance', '0', '-effort', '9'], 'jxl', 'libjxl via ffmpeg, distance 0, effort 9'),
            ('qoi', 'QOI', ['-c:v', 'qoi'], 'qoi', 'ffmpeg qoi ("quite OK image": byte-aligned, no entropy coder)'),
        ]:
            dst = os.path.join(td, 'o.' + ext)
            try:
                ffmpeg(['-i', src] + args + [dst])
                out.append(dict(id=bid, name=name, bytes=os.path.getsize(dst), family='image', how=how))
            except Exception as e:
                print('  (%s failed: %s)' % (bid, e))
    return out


def audio_baselines(raw, channels, rate):
    out = []
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, 'in.wav')
        with wave.open(src, 'wb') as w:
            w.setnchannels(channels); w.setsampwidth(2); w.setframerate(rate); w.writeframes(raw)
        for bid, name, args, ext, how in [
            ('flac', 'FLAC -8', ['-c:a', 'flac', '-compression_level', '12', '-exact_rice_parameters', '1', '-map_metadata', '-1'], 'flac', 'ffmpeg flac, compression level 12 (linear prediction + Rice codes)'),
            ('wavpack', 'WavPack', ['-c:a', 'wavpack', '-compression_level', '8', '-map_metadata', '-1'], 'wv', 'ffmpeg wavpack, level 8'),
            ('tta', 'TTA', ['-c:a', 'tta', '-map_metadata', '-1'], 'tta', 'ffmpeg tta (adaptive filters + Rice codes)'),
            ('alac', 'Apple Lossless', ['-c:a', 'alac', '-map_metadata', '-1'], 'm4a', 'ffmpeg alac'),
        ]:
            dst = os.path.join(td, 'o.' + ext)
            try:
                ffmpeg(['-i', src] + args + [dst])
                out.append(dict(id=bid, name=name, bytes=os.path.getsize(dst), family='audio', how=how))
            except Exception as e:
                print('  (%s failed: %s)' % (bid, e))
    return out


def emit(item, raw):
    os.makedirs(os.path.join(ROOT, 'corpus'), exist_ok=True)
    path = os.path.join(ROOT, 'corpus', item['id'] + '.js')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('/* generated by tools/make_corpus.py — %s, %d bytes, base64 */\n' % (item['title'], len(raw)))
        f.write('CE_CORPUS_DATA("%s", "%s");\n' % (item['id'], base64.b64encode(raw).decode('ascii')))
    item['bytes'] = len(raw)
    item['file'] = 'corpus/%s.js' % item['id']
    item['crc32'] = zlib.crc32(raw) & 0xffffffff
    item['baselines'].sort(key=lambda b: -b['bytes'])
    print('%-8s %9d bytes' % (item['id'], len(raw)))
    for b in item['baselines']:
        print('    %-40s %9d  %6.2f%%' % (b['name'], b['bytes'], 100.0 * b['bytes'] / len(raw)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    import numpy as np
    from PIL import Image
    only = set(filter(None, a.only.split(',')))
    meta_path = os.path.join(ROOT, 'corpus_meta.js')
    items = {}
    if only and os.path.exists(meta_path):
        txt = open(meta_path, encoding='utf-8').read()
        for it in json.loads(txt[txt.index('['):txt.rindex(']') + 1]):
            items[it['id']] = it

    def want(i):
        return not only or i in only

    if want('cat'):
        W, H = 736, 456
        im = Image.open(os.path.join(a.src, 'cat_original.jpg')).convert('RGB').resize((W, H), Image.LANCZOS)
        raw = np.asarray(im).tobytes()
        it = dict(id='cat', title='Cat photo', kind='image', width=W, height=H, channels=3,
                  blurb='A 736 × 456 photograph as raw 24-bit RGB — one megabyte of fur, whiskers and blurred background.',
                  credit='“Cat portrait” by Anton Petrov (Unsplash), CC0, via Wikimedia Commons — downscaled from 4000 × 2478.',
                  source='https://commons.wikimedia.org/wiki/File:Cat_portrait_(Unsplash).jpg',
                  baselines=general_baselines(raw) + image_baselines(raw, W, H))
        emit(it, raw); items['cat'] = it

    if want('alice'):
        raw = open(os.path.join(a.src, 'cantrbry', 'alice29.txt'), 'rb').read()
        it = dict(id='alice', title='Alice in Wonderland', kind='text',
                  blurb='alice29.txt from the Canterbury corpus — the file compression papers have been quoting since 1997.',
                  credit='Lewis Carroll, public domain. Canterbury corpus edition (alice29.txt).',
                  source='https://corpus.canterbury.ac.nz/descriptions/#cantrbry',
                  baselines=general_baselines(raw))
        emit(it, raw); items['alice'] = it

    if want('guitar'):
        tmp = os.path.join(a.src, '_guitar16.wav')
        ffmpeg(['-i', os.path.join(a.src, 'guitar22.wav'), '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', tmp])
        with wave.open(tmp) as w:
            raw = w.readframes(w.getnframes())
        it = dict(id='guitar', title='Guitar chord', kind='audio', channels=2, rate=44100, bits=16,
                  blurb='3.2 seconds of a Spanish guitar chord: raw 16-bit stereo PCM, 44.1 kHz, exactly what is on a CD.',
                  credit='“Audio files of spanish guitar chords 22” by Wilfredor, CC0, via Wikimedia Commons — resampled from 24-bit / 96 kHz.',
                  source='https://commons.wikimedia.org/wiki/File:Audio_files_of_spanish_guitar_chords_22.wav',
                  baselines=general_baselines(raw) + audio_baselines(raw, 2, 44100))
        emit(it, raw); items['guitar'] = it

    if want('meow'):
        with wave.open(os.path.join(a.src, 'meow.wav')) as w:
            assert w.getsampwidth() == 2 and w.getnchannels() == 1
            raw, rate = w.readframes(w.getnframes()), w.getframerate()
        it = dict(id='meow', title='Cat meow', kind='audio', channels=1, rate=rate, bits=16,
                  blurb='One and a half seconds of a Siamese cat, raw 16-bit mono PCM. Small enough that every header byte shows.',
                  credit='“Meow of a Siamese cat” by freemaster2, CC0, via Wikimedia Commons.',
                  source='https://commons.wikimedia.org/wiki/File:Meow_of_a_Siamese_cat_-_freemaster2.wav',
                  baselines=general_baselines(raw) + audio_baselines(raw, 1, rate))
        emit(it, raw); items['meow'] = it

    if want('code'):
        parts = []
        for fn in ['codec.js', 'genome.js', 'evolution.js', 'analyze.js', 'pool.js']:
            parts.append(open(os.path.join(ROOT, fn), 'rb').read().replace(b'\r\n', b'\n'))
        raw = b'\n'.join(parts)
        it = dict(id='code', title='This page’s own source', kind='text',
                  blurb='The JavaScript of the compressor and the genetic algorithm you are watching, fed to itself.',
                  credit='Snapshot of codec.js, genome.js, evolution.js, analyze.js and pool.js from this folder.',
                  source='', baselines=general_baselines(raw))
        emit(it, raw); items['code'] = it

    order = ['cat', 'alice', 'guitar', 'meow', 'code']
    out = [items[k] for k in order if k in items]
    with open(meta_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('/* generated by tools/make_corpus.py — sizes are measured, not quoted */\n')
        f.write('var CE_CORPUS_META = ' + json.dumps(out, indent=1, ensure_ascii=False) + ';\n')
        f.write('if (typeof module !== "undefined" && module.exports) module.exports = CE_CORPUS_META;\n')
    total = sum(os.path.getsize(os.path.join(ROOT, it['file'])) for it in out)
    print('corpus on disk: %.2f MB' % (total / 1e6))


if __name__ == '__main__':
    main()
