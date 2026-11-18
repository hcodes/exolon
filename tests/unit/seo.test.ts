import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const canonical = 'https://hcodes.github.io/exolon/';

test('HTML publishes consistent canonical, search and social metadata', async () => {
    const html = await readFile(new URL('../../src/index.html', import.meta.url), 'utf8');
    const meta = (name: string) => {
        const tag = html.match(
            new RegExp(`<meta\\s+(?:name|property)="${name}"\\s+content="([^"]+)"\\s*/?>`),
        );
        assert.ok(tag, `Missing metadata: ${name}`);
        return tag[1].replaceAll('&amp;', '&');
    };
    assert.match(html, /<html lang="en"(?:\s[^>]*)?>/);
    assert.match(html, /<title>Exolon.*Play Online/);
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}" />`));
    assert.equal(meta('og:url'), canonical);
    assert.equal(meta('og:type'), 'website');
    assert.equal(meta('og:description'), meta('description'));
    assert.equal(meta('twitter:description'), meta('description'));
    assert.equal(meta('twitter:title'), meta('og:title'));
    assert.equal(meta('twitter:card'), 'summary_large_image');
    assert.equal(meta('twitter:image'), meta('og:image'));
    assert.equal(new URL(meta('og:image')).origin, new URL(canonical).origin);
    assert.equal(meta('og:image:width'), '1200');
    assert.equal(meta('og:image:height'), '630');
    assert.ok(meta('og:image:alt').includes('Exolon'));
    assert.match(meta('robots'), /index, follow/);
    const script = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(script, 'Missing game structured data');
    const game = JSON.parse(script[1]);
    assert.equal(game['@context'], 'https://schema.org');
    assert.equal(game['@type'], 'VideoGame');
    assert.equal(game.name, 'Exolon');
    assert.equal(game.url, canonical);
    assert.equal(game.image, meta('og:image'));
    assert.equal(game.description, meta('description'));
    assert.equal(game.gamePlatform, 'Web browser');
    assert.equal(game.isAccessibleForFree, true);
    assert.equal(game.aggregateRating, undefined, 'Do not invent reviews');
    assert.match(html, /<noscript\s*>[\s\S]*JavaScript[\s\S]*<\/noscript\s*>/);
});
