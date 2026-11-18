import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { versionAssetUrl } from '../../src/services/asset-url.ts';
import { readVersions, versionModuleImports } from '../../tools/build/versioning.mjs';

const versions = { 'audio/c64/shot.wav': 'abc123', 'audio/c64/title.m4a': 'def456' };
test('asset versions preserve subpaths, query parameters, fragments and source identity', () => {
    assert.equal(
        versionAssetUrl('./audio/c64/shot.wav', versions),
        './audio/c64/shot.wav?v=abc123',
    );
    assert.equal(
        versionAssetUrl('https://example.test/reex/audio/c64/title.m4a?x=1&v=old#loop', versions),
        'https://example.test/reex/audio/c64/title.m4a?x=1&v=def456#loop',
    );
    assert.equal(
        versionAssetUrl(new URL('https://example.test/reex/audio/c64/shot.wav'), versions),
        'https://example.test/reex/audio/c64/shot.wav?v=abc123',
    );
    assert.equal(versionAssetUrl('./unknown.wav?x=1#loop', versions), './unknown.wav?x=1#loop');
    assert.equal(
        versionAssetUrl('./audio/c64/shot.wav?v=abc123', versions),
        './audio/c64/shot.wav?v=abc123',
    );
});
test('module import versioning covers static and delayed edges without changing ordinary strings', () => {
    const code =
        'import "./polyfill.js";import{a}from"./a.js";export{b}from"../b.js";const f=()=>import("./game.js");const text="./keep.js";';
    assert.equal(
        versionModuleImports(code, 'build123'),
        'import "./polyfill.js?v=build123";import{a}from"./a.js?v=build123";export{b}from"../b.js?v=build123";const f=()=>import("./game.js?v=build123");const text="./keep.js";',
    );
});
test('build versions are deterministic and changed media retains unrelated media hashes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'reex-versions-'));
    try {
        await mkdir(path.join(directory, 'src/audio'), { recursive: true });
        await mkdir(path.join(directory, 'dist/audio'), { recursive: true });
        await writeFile(path.join(directory, 'src/main.ts'), 'const value=1;');
        await writeFile(path.join(directory, 'dist/audio/a.wav'), 'one');
        await writeFile(path.join(directory, 'dist/audio/b.wav'), 'two');
        const first = await readVersions(directory);
        assert.deepEqual(await readVersions(directory), first);
        assert.notEqual((await readVersions(directory, { development: true })).code, first.code);
        await writeFile(path.join(directory, 'src/main.ts'), 'const value=2;');
        const changedCode = await readVersions(directory);
        assert.notEqual(changedCode.code, first.code);
        assert.deepEqual(changedCode.assets, first.assets);
        await writeFile(path.join(directory, 'dist/audio/a.wav'), 'three');
        const changedMedia = await readVersions(directory);
        assert.notEqual(changedMedia.assets['audio/a.wav'], first.assets['audio/a.wav']);
        assert.equal(changedMedia.assets['audio/b.wav'], first.assets['audio/b.wav']);
        assert.notEqual(changedMedia.code, changedCode.code);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
