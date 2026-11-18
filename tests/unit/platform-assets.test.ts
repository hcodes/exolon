import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { LAUNCH_CHOICES } from '../../src/utils/game-launch.ts';

const root = new URL('../../', import.meta.url);
test('all eight platform banners are saved runtime assets', async () => {
    assert.equal(LAUNCH_CHOICES.length, 8);
    for (const { image } of LAUNCH_CHOICES) {
        assert.match(image, /^\.\/assets\/images\//);
        await access(new URL('src/' + image.slice(2), root));
    }
});
test('saved native banners preserve their original extracted PNG bytes', async () => {
    const expected = {
        'zx-spectrum': '273a42ae56e9087c573b0b9859ef9fa2dc43fe5047ebc17e756de5ead1e98283',
        c64: '0ce503b505353667cc8b447f02edb97ddebd80782b731c3be75357104db8930a',
        'amstrad-cpc': '77b5c9ffd8b6da38b91c97f835035215d16f637cd451b1b9f2d5091c57195049',
        'sharp-mz800': 'd3ccbe91c018672b704dc534881d8ab7cadd9d63af65c28cd9e1c70721533019',
        'atari-st': '7d3355a2aeedf542a3f001d1cde9be3532d7c2c9132d33ee2f84f13e22836fd1',
    };
    for (const [platform, sha256] of Object.entries(expected)) {
        const bytes = await readFile(new URL(`src/assets/images/${platform}/loading.png`, root));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256, platform);
    }
});
