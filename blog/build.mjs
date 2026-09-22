// Blog builder for mlorenz.xyz. No dependencies; Node 18 or newer.
//
//     node blog/build.mjs
//
// Writing a post
//   1. Make a folder in blog/, e.g. blog/2_my_next_post/. The folder name
//      becomes the address: mlorenz.xyz/blog/2_my_next_post/
//   2. Put a post.md in it that starts with a header:
//        ---
//        title: My next post
//        date: 2026-10-01
//        description: One or two sentences for search results and previews.
//        image: cover.jpg        (optional: card and link-preview picture)
//        draft: true             (optional: left out until you remove it)
//        ---
//   3. Write ordinary Markdown below it. "## Clue 1: Some title" shows
//      "Clue 1" as a small grey label above the heading. Put each picture on
//      a line of its own, ![What the picture shows](photo.jpg "Optional
//      caption"), as a JPEG about 1600 px wide. A smaller copy saved next to
//      it as photo-1024.jpg is picked up automatically for phones. A "##"
//      section with exactly one picture is laid out with its text beside the
//      picture, the sides alternating down the page.
//   4. Run the command above from anywhere. It writes the post's index.html,
//      blog/index.html, blog/feed.xml, the "Latest writing" card on the home
//      page and the blog entries in sitemap.xml, and prints what changed.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOG = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(BLOG);
const SITE = 'https://mlorenz.xyz';
const AUTHOR = 'Mikkel Lorenz';
const BLOG_INTRO = 'Notes on physics, biology and code, and the places they meet.';
const WORDS_PER_MINUTE = 230;

const warnings = [];
const warn = msg => warnings.push(msg);

// ── Text helpers ─────────────────────────────────────────────────

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const attr = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Curly quotes, apostrophes, dashes and ellipses. Runs on text only, never
// on code, URLs or attributes.
function typography(s) {
    return s
        .replace(/\.\.\./g, '…')
        .replace(/---/g, '—')
        .replace(/--/g, '–')
        .replace(/(^|[\s([{—–-])"(?=\S)/g, '$1“')
        .replace(/"/g, '”')
        .replace(/(^|[\s([{—–-])'(?=\S)/g, '$1‘')
        .replace(/'/g, '’');
}

function text(s) {
    // Hard line break: two trailing spaces or a backslash before the newline.
    return s.split(/ {2,}\n|\\\n/)
        .map(part => esc(typography(part.replace(/\n/g, ' '))))
        .join('<br>');
}

const INLINE = String.raw`(\x60+)([^\x60]|[^\x60][\s\S]*?[^\x60])\1(?!\x60)` +
    String.raw`|!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)` +
    String.raw`|\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)` +
    String.raw`|\*\*(?=\S)([\s\S]*?\S)\*\*` +
    String.raw`|(?<![\w*])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?![\w*])` +
    String.raw`|(?<![\w_])_(?=[^\s_])([\s\S]*?[^\s_])_(?![\w_])`;

function inline(s) {
    const re = new RegExp(INLINE, 'g');   // fresh per call: this recurses
    let out = '', last = 0, m;
    while ((m = re.exec(s))) {
        out += text(s.slice(last, m.index));
        if (m[1]) {
            out += `<code>${esc(m[2])}</code>`;
        } else if (m[0][0] === '!') {
            out += `<img src="${attr(m[4])}" alt="${attr(m[3])}" loading="lazy" decoding="async">`;
        } else if (m[7] !== undefined) {
            const external = /^https?:/i.test(m[7]);
            out += `<a href="${attr(m[7])}"${m[8] ? ` title="${attr(m[8])}"` : ''}${external ? ' rel="noopener"' : ''}>${inline(m[6])}</a>`;
        } else if (m[9] !== undefined) {
            out += `<strong>${inline(m[9])}</strong>`;
        } else {
            out += `<em>${inline(m[10] ?? m[11])}</em>`;
        }
        last = re.lastIndex;
    }
    return out + text(s.slice(last));
}

function plain(md) {
    return md
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[*_`>#]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function slugify(s, used) {
    let base = plain(s).toLowerCase()
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'section';
    let id = base, n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    return id;
}

function formatDate(iso) {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
    });
}

function rfc822(iso) {
    return new Date(iso + 'T08:00:00Z').toUTCString();
}

// ── Images ───────────────────────────────────────────────────────

// Pixel size from the file header (JPEG and PNG), so every <img> reserves
// its space and the page never jumps while pictures load.
function readSize(file) {
    const b = readFileSync(file);
    if (b.length > 24 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') {
        return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
        let o = 2;
        while (o + 9 < b.length) {
            if (b[o] !== 0xff) { o++; continue; }
            const marker = b[o + 1];
            if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { o += 2; continue; }
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                return { width: b.readUInt16BE(o + 7), height: b.readUInt16BE(o + 5) };
            }
            o += 2 + b.readUInt16BE(o + 2);
        }
    }
    return null;
}

// Size, and a srcset built from any smaller copies named photo-1024.jpg etc.
function imageInfo(dir, src, name) {
    if (/^(https?:)?\/\//i.test(src)) return { srcs: [] };
    const file = join(dir, src);
    if (!existsSync(file)) {
        warn(`${name}: ${src} is referenced but not in the folder`);
        return { srcs: [] };
    }
    const size = readSize(file);
    const ext = extname(src);
    const stem = src.slice(0, -ext.length);
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const variant = new RegExp(`^${escaped}-(\\d+)${ext.replace('.', '\\.')}$`);
    const set = readdirSync(dir)
        .filter(f => variant.test(f))
        .map(f => ({ src: f, size: readSize(join(dir, f)) }))
        .filter(v => v.size);
    if (size) set.push({ src, size });
    set.sort((a, b) => a.size.width - b.size.width);
    return { size, srcs: set.map(v => v.src), srcset: set.length > 1 ? set.map(v => `${v.src} ${v.size.width}w`) : null };
}

// An <img> whose paths are relative to `prefix` (the post folder, as seen
// from the page it appears on).
function imgTag(info, src, { prefix = '', alt = '', sizes, eager = false } = {}) {
    const parts = [`src="${attr(prefix + src)}"`];
    if (info.srcset) parts.push(`srcset="${attr(info.srcset.map(s => prefix + s).join(', '))}"`, `sizes="${sizes}"`);
    if (info.size) parts.push(`width="${info.size.width}" height="${info.size.height}"`);
    parts.push(`alt="${attr(alt)}"`, eager ? 'fetchpriority="high"' : 'loading="lazy"', 'decoding="async"');
    return `<img ${parts.join(' ')}>`;
}

// ── Markdown ─────────────────────────────────────────────────────

const FIGURE_SIZES = '(max-width: 1028px) calc(100vw - 40px), 980px';
const SPREAD_SIZES = '(max-width: 734px) calc(100vw - 40px), (max-width: 1068px) 680px, 640px';

function heading(level, raw, ctx) {
    // "Clue 1: Time slows down" -> small label "Clue 1" above the heading.
    const m = raw.match(/^([^:]{1,24}):\s+(.+)$/);
    const title = m ? m[2] : raw;
    const kicker = m ? `<span class="kicker">${inline(m[1])}<span class="sr-only">:</span></span>` : '';
    return `<h${level} id="${slugify(title, ctx.ids)}">${kicker}${inline(title)}</h${level}>`;
}

function markdown(md, ctx) {
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    let lede = !ctx.nested;            // the opening paragraph, if nothing precedes it
    let i = 0;

    const flush = () => {
        if (!para.length) return;
        out.push(`<p${lede ? ' class="lede"' : ''}>${inline(para.join('\n'))}</p>`);
        para = [];
        lede = false;
    };
    const block = html => { flush(); lede = false; out.push(html); };

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        let m;
        if (!trimmed) { flush(); i++; continue; }

        if ((m = line.match(/^(```|~~~)\s*([\w+-]*)/))) {
            const code = [];
            i++;
            while (i < lines.length && !lines[i].startsWith(m[1])) code.push(lines[i++]);
            i++;
            block(`<pre><code${m[2] ? ` class="language-${attr(m[2])}"` : ''}>${esc(code.join('\n'))}</code></pre>`);
            continue;
        }
        if ((m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/))) {
            block(heading(Math.min(6, Math.max(2, m[1].length)), m[2], ctx));
            i++;
            continue;
        }
        if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
            block('<hr>');
            i++;
            continue;
        }
        if ((m = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/))) {
            const [, alt, src, caption] = m;
            if (!alt) warn(`${ctx.name}: ${src} has no description; screen readers will skip it`);
            const info = imageInfo(ctx.dir, src, ctx.name);
            ctx.images.push(...info.srcs);
            const img = imgTag(info, src, { alt, sizes: FIGURE_SIZES, eager: ctx.figures++ === 0 });
            block(`<figure>${img}${caption ? `<figcaption>${inline(caption)}</figcaption>` : ''}</figure>`);
            i++;
            continue;
        }
        if (/^>/.test(line)) {
            const quote = [];
            while (i < lines.length && /^>/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
            block(`<blockquote>${markdown(quote.join('\n'), { ...ctx, nested: true })}</blockquote>`);
            continue;
        }
        if (!para.length && (m = line.match(/^\s*([-*+]|\d+[.)])\s+/))) {
            const ordered = /\d/.test(m[1]);
            const items = [];
            while (i < lines.length && lines[i].trim()) {
                const item = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
                if (item) items.push(item[2]);
                else items[items.length - 1] += '\n' + lines[i].trim();
                i++;
            }
            const tag = ordered ? 'ol' : 'ul';
            block(`<${tag}>${items.map(t => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
            continue;
        }
        para.push(line);
        i++;
    }
    flush();
    return (ctx.nested ? out : spreads(out)).join('\n');
}

// A section (a ## heading and what follows, up to the next heading or ---)
// with exactly one picture becomes a spread: the text beside the picture,
// sides alternating down the page. The heading stays first in the source, so
// narrow screens read heading, picture, text.
function spreads(blocks) {
    const out = [];
    let flip = false;
    for (let i = 0; i < blocks.length;) {
        if (!blocks[i].startsWith('<h2')) {
            out.push(blocks[i++]);
            continue;
        }
        let j = i + 1;
        while (j < blocks.length && !blocks[j].startsWith('<h2') && blocks[j] !== '<hr>') j++;
        const section = blocks.slice(i, j);
        const figures = section.filter(b => b.startsWith('<figure'));
        i = j;
        if (figures.length !== 1) {
            out.push(...section);
            continue;
        }
        const figure = figures[0].replace(`sizes="${FIGURE_SIZES}"`, `sizes="${SPREAD_SIZES}"`);
        const body = section.slice(1).filter(b => b !== figures[0]);
        const parts = [section[0], figure];
        if (body.length) parts.push(`<div class="spread-body">\n${indent(body.join('\n'), 4)}\n</div>`);
        out.push(`<div class="spread${flip ? ' spread-flip' : ''}">\n${indent(parts.join('\n'), 4)}\n</div>`);
        flip = !flip;
    }
    return out;
}

// ── Posts ────────────────────────────────────────────────────────

function frontMatter(raw, name) {
    const m = raw.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
    if (!m) {
        warn(`${name}: post.md has no --- header, so the folder name is used as the title`);
        return { meta: {}, body: raw };
    }
    const meta = {};
    for (const line of m[1].split(/\r?\n/)) {
        const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/);
        if (kv) meta[kv[1].toLowerCase()] = kv[2].replace(/^(["'])(.*)\1$/, '$2');
    }
    return { meta, body: m[2] };
}

function loadPosts() {
    const posts = [];
    for (const name of readdirSync(BLOG).sort()) {
        const dir = join(BLOG, name);
        const file = join(dir, 'post.md');
        if (!statSync(dir).isDirectory() || !existsSync(file)) continue;
        const { meta, body } = frontMatter(readFileSync(file, 'utf8'), name);
        if (/^(true|yes)$/i.test(meta.draft || '')) {
            console.log(`  draft    ${name} (not published)`);
            continue;
        }
        if (/\{[{%]/.test(body)) warn(`${name}: "{{" or "{%" in post.md can break the GitHub Pages (Jekyll) build`);
        let date = meta.date;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
            date = statSync(file).mtime.toISOString().slice(0, 10);
            warn(`${name}: no "date: YYYY-MM-DD" in the header, using ${date}`);
        }
        const words = plain(body).split(' ').filter(Boolean).length;
        posts.push({
            name, dir, date, body,
            title: meta.title || name.replace(/^\d+[_-]/, '').replace(/[_-]+/g, ' '),
            description: meta.description || plain(body).split(/(?<=[.?!])\s/).slice(0, 2).join(' '),
            cover: meta.image || (body.match(/!\[[^\]]*\]\(([^)\s]+)/) || [])[1] || null,
            minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
            href: `${encodeURI(name)}/`,
            url: `${SITE}/blog/${encodeURI(name)}/`
        });
    }
    return posts.sort((a, b) => b.date.localeCompare(a.date) || b.name.localeCompare(a.name));
}

const coverInfo = post => post.cover && !/^(https?:)?\/\//i.test(post.cover)
    ? imageInfo(post.dir, post.cover, post.name)
    : { srcs: [] };

const coverUrl = post => !post.cover ? `${SITE}/assets/profile.jpg`
    : /^https?:/i.test(post.cover) ? post.cover : post.url + encodeURI(post.cover);

const postMeta = post =>
    `<time datetime="${post.date}">${formatDate(post.date)}</time> \u00B7 ${post.minutes} min read`;

// ── Page chrome (keep in step with index.html, consultancy/ and 404.html) ──

const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap';

function indent(s, n) {
    const pad = ' '.repeat(n);
    return s.split('\n').map(l => (l.trim() ? pad + l : '')).join('\n');
}

// Links name index.html outright: a bare folder link only works on a web
// server, and opened from disk it shows a file listing instead of the page.
function page({ root, title, ogTitle = title, description, url, image, type = 'website', current, body, ld }) {
    const nav = [['blog/index.html', 'Blog'], ['vibe-code/index.html', 'Vibe Code'], ['consultancy/index.html', 'Consultancy']]
        .map(([href, label]) => {
            const here = current === href ? ` aria-current="${type === 'article' ? 'true' : 'page'}"` : '';
            return `                <a href="${root}${href}"${here}>${label}</a>`;
        })
        .join('\n');
    const json = ld ? `\n    <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${attr(description)}">
    <meta name="author" content="${AUTHOR}">
    <link rel="canonical" href="${attr(url)}">
    <meta property="og:type" content="${type}">
    <meta property="og:site_name" content="${AUTHOR}">
    <meta property="og:url" content="${attr(url)}">
    <meta property="og:title" content="${attr(ogTitle)}">
    <meta property="og:description" content="${attr(description)}">
    <meta property="og:image" content="${attr(image)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="theme-color" content="#000000">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <link rel="alternate" type="application/rss+xml" title="${AUTHOR} \u2014 Blog" href="${root}blog/feed.xml">
    <script>document.documentElement.classList.add('js');setTimeout(function(){if(!window.siteReady)document.documentElement.classList.remove('js')},3000)</script>
    <link rel="stylesheet" href="${root}css/style.css">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="${FONTS}" media="print" onload="this.media='all'">
    <noscript><link rel="stylesheet" href="${FONTS}"></noscript>${json}
</head>
<body>
    <!-- Generated by blog/build.mjs. Edit post.md and run it again. -->
    <a class="skip-link" href="#main">Skip to content</a>

    <nav class="navbar" aria-label="Main">
        <div class="container">
            <a class="logo" href="${root}index.html">Mikkel Lorenz</a>
            <div class="nav-items">
${nav}
            </div>
        </div>
    </nav>

${body}

    <footer class="footer">
        <div class="container footer-inner">
            <p>&copy; <span data-year>${new Date().getFullYear()}</span> ${AUTHOR}</p>
            <ul class="footer-links">
                <li><a href="mailto:mikkelvind@gmail.com">Email</a></li>
                <li><a href="https://github.com/MIKKELLORENZ" target="_blank" rel="noopener">GitHub</a></li>
                <li><a href="https://www.linkedin.com/in/mikkel-lorenz-67b0a636/" target="_blank" rel="noopener">LinkedIn</a></li>
                <li><a href="${root}blog/feed.xml">RSS</a></li>
            </ul>
        </div>
    </footer>

    <script src="${root}js/main.js" defer></script>
</body>
</html>
`;
}

// ── Pages ────────────────────────────────────────────────────────

// The large card: newest post on the blog index and on the home page.
function card(post, { prefix, level, eager = false }) {
    const img = post.cover
        ? imgTag(coverInfo(post), post.cover, { prefix, sizes: '(max-width: 1068px) calc(100vw - 40px), 660px', eager })
        : '';
    return `<a class="post-feature" href="${prefix}index.html">
    <div class="post-feature-media">${img}</div>
    <div class="post-feature-body">
        <p class="post-meta">${postMeta(post)}</p>
        <h${level} class="title-2">${inline(post.title)}</h${level}>
        <p class="excerpt">${inline(post.description)}</p>
        <span class="link-more">Read the post</span>
    </div>
</a>`;
}

// One line in the list of older posts.
function row(post, prefix) {
    const img = post.cover
        ? imgTag(coverInfo(post), post.cover, { prefix, sizes: '(max-width: 734px) calc(100vw - 40px), 280px' })
        : '';
    return `<li>
    <a class="post-row" href="${prefix}index.html">
        <div class="post-row-media">${img}</div>
        <div>
            <p class="post-meta">${postMeta(post)}</p>
            <h2>${inline(post.title)}</h2>
            <p>${inline(post.description)}</p>
        </div>
    </a>
</li>`;
}

function renderPost(post, newer, older) {
    const ctx = { name: post.name, dir: post.dir, ids: new Set(), images: [], figures: 0 };
    const html = markdown(post.body, ctx);
    const links = [];
    if (older) links.push(`<a class="link-more" href="../${older.href}index.html">Older: ${inline(older.title)}</a>`);
    if (newer) links.push(`<a class="link-more" href="../${newer.href}index.html">Newer: ${inline(newer.title)}</a>`);
    const body = `    <main id="main" class="article">
        <article>
            <header class="article-head">
                <p class="article-meta"><a href="../index.html">Blog</a> · ${postMeta(post)}</p>
                <h1 class="article-title">${inline(post.title)}</h1>
            </header>
            <div class="prose">
${indent(html, 16)}
            </div>
        </article>
        <footer class="article-foot">
            <div class="article-foot-inner">
                <a class="link-more link-back" href="../index.html">All posts</a>${links.map(l => '\n                ' + l).join('')}
            </div>
        </footer>
    </main>`;
    const out = page({
        root: '../../',
        title: `${typography(post.title)} — ${AUTHOR}`,
        ogTitle: typography(post.title),
        description: typography(post.description),
        url: post.url,
        image: coverUrl(post),
        type: 'article',
        current: 'blog/index.html',
        body,
        ld: {
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            headline: typography(post.title),
            description: typography(post.description),
            datePublished: post.date,
            image: coverUrl(post),
            url: post.url,
            mainEntityOfPage: post.url,
            author: { '@type': 'Person', name: AUTHOR, url: `${SITE}/` }
        }
    });
    return { html: out, used: new Set([...ctx.images, ...coverInfo(post).srcs]) };
}

function renderIndex(posts) {
    const [first, ...rest] = posts;
    const featured = first
        ? card(first, { prefix: first.href, level: 2, eager: true })
        : '<p class="headline quiet">Nothing published yet.</p>';
    const list = rest.length
        ? `\n<ol class="post-list">\n${indent(rest.map(p => row(p, p.href)).join('\n'), 4)}\n</ol>`
        : '';
    const body = `    <main id="main">
        <header class="page-head container">
            <h1 class="page-title">Blog</h1>
            <p class="headline">${esc(BLOG_INTRO)}</p>
        </header>
        <section class="container" aria-label="Posts">
${indent(featured + list, 12)}
            <p class="blog-foot"><a href="feed.xml">Subscribe with RSS</a></p>
        </section>
    </main>`;
    return page({
        root: '../',
        title: `Blog — ${AUTHOR}`,
        description: BLOG_INTRO,
        url: `${SITE}/blog/`,
        image: first ? coverUrl(first) : `${SITE}/assets/profile.jpg`,
        current: 'blog/index.html',
        body
    });
}

function renderFeed(posts) {
    const items = posts.slice(0, 20).map(p => `    <item>
      <title>${esc(typography(p.title))}</title>
      <link>${p.url}</link>
      <guid isPermaLink="true">${p.url}</guid>
      <pubDate>${rfc822(p.date)}</pubDate>
      <description>${esc(typography(p.description))}</description>
    </item>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${AUTHOR} — Blog</title>
    <link>${SITE}/blog/</link>
    <description>${esc(BLOG_INTRO)}</description>
    <language>en</language>
    <lastBuildDate>${rfc822(posts[0] ? posts[0].date : '2026-01-01')}</lastBuildDate>
    <atom:link href="${SITE}/blog/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

// ── Output ───────────────────────────────────────────────────────

const changed = [];

function write(path, content) {
    if (existsSync(path) && readFileSync(path, 'utf8') === content) return;
    writeFileSync(path, content);
    changed.push(path.slice(ROOT.length + 1).replace(/\\/g, '/'));
}

// Replace what sits between two marker comments, keeping the indentation.
function inject(file, start, end, content) {
    const path = join(ROOT, file);
    if (!existsSync(path)) return warn(`${file} not found`);
    const s = readFileSync(path, 'utf8');
    const a = s.indexOf(start), b = s.indexOf(end);
    if (a < 0 || b < a) return warn(`${file}: markers ${start} / ${end} not found, left alone`);
    const lineStart = s.lastIndexOf('\n', b) + 1;
    const pad = s.slice(lineStart, b).length;
    write(path, s.slice(0, a + start.length) + '\n' + (content ? indent(content, pad) + '\n' : '') + s.slice(lineStart));
}

// Big files in a post folder that the post never shows still get published.
function checkUnused(post, used) {
    for (const f of readdirSync(post.dir)) {
        if (f === 'post.md' || f === 'index.html' || used.has(f)) continue;
        const size = statSync(join(post.dir, f)).size;
        if (size > 200 * 1024) {
            warn(`${post.name}: ${f} (${(size / 1048576).toFixed(1)} MB) is not used by the post but would be published if committed`);
        }
    }
}

const posts = loadPosts();
posts.forEach((post, i) => {
    const { html, used } = renderPost(post, posts[i - 1], posts[i + 1]);
    write(join(post.dir, 'index.html'), html);
    checkUnused(post, used);
});
write(join(BLOG, 'index.html'), renderIndex(posts));
write(join(BLOG, 'feed.xml'), renderFeed(posts));
inject('index.html', '<!-- blog:latest:start -->', '<!-- blog:latest:end -->',
    posts[0] ? card(posts[0], { prefix: `blog/${posts[0].href}`, level: 3 }) : '');
inject('sitemap.xml', '<!-- blog:posts:start -->', '<!-- blog:posts:end -->',
    posts.map(p => `<url>\n  <loc>${p.url}</loc>\n  <lastmod>${p.date}</lastmod>\n</url>`).join('\n'));

console.log(`${posts.length} post${posts.length === 1 ? '' : 's'}: ${posts.map(p => p.name).join(', ') || 'none'}`);
console.log(changed.length ? `wrote ${changed.join(', ')}` : 'everything already up to date');
for (const w of warnings) console.warn(`  note: ${w}`);
