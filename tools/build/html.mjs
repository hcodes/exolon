// Render the existing picker at build time; no SSR code enters the browser bundle.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createElement } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { PlatformPicker } from '../../.cache/build/platform-picker.mjs';
import { contentVersion } from './versioning.mjs';
import { createSocialPreview } from './social-preview.mjs';

const output = new URL('../../dist/', import.meta.url);
const index = new URL('index.html', output);
const html = await readFile(index, 'utf8');
const marker = '<!-- platform-picker-prerender -->';
if (html.split(marker).length !== 2) throw Error('Expected one platform picker HTML marker');
const canonical = html.match(/<link rel="canonical" href="([^"]+)"/u)?.[1];
if (!canonical || new URL(canonical).protocol !== 'https:')
    throw Error('Expected an absolute HTTPS canonical URL');
const picker = renderToString(
    createElement('main', { class: 'game-app game-app_selecting' }, createElement(PlatformPicker)),
);
await writeFile(index, await versionHtml(html.replace(marker, () => picker)));
await writeFile(
    new URL('sitemap.xml', output),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>${canonical.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</loc></url>
</urlset>
`,
);
const social = new URL('assets/images/shared/social/', output);
await mkdir(social, { recursive: true });
await writeFile(new URL('exolon.png', social), await createSocialPreview(output));

async function versionHtml(html) {
    const urls = [
        ...new Set(
            [...html.matchAll(/(?:src|href)="(\.\/[^"?#]+)(?:\?[^"#]*)?"/g)].map(
                (match) => match[1],
            ),
        ),
    ];
    for (const url of urls) {
        if (url === './llms.txt') continue;
        const version = contentVersion(await readFile(new URL(url, output)));
        html = html.replaceAll('"' + url + '"', '"' + url + '?v=' + version + '"');
    }
    return html;
}
