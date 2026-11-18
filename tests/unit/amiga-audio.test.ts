import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseAmigaTitleBank, renderAmigaTitle } from '../../tools/audio/amiga/replay.ts';
import { encodeAmigaWave } from '../../tools/audio/amiga.mjs';

function bankFixture() {
    const bank = new Uint8Array(660 + 1024 + 8);
    const data = new DataView(bank.buffer);
    data.setUint32(0, 8);
    bank.set(new TextEncoder().encode('Fixture'), 80);
    data.setUint16(102, 3);
    data.setUint16(104, 64);
    data.setUint16(106, 4);
    data.setUint16(108, 2);
    bank[530] = 1;
    data.setUint16(660, 100);
    bank[662] = 0x13;
    bank.set([12, 23, 34, 45, 64, 192, 32, 224], 660 + 1024);
    return bank;
}

test('Amiga parser preserves the custom sample prefix and driver initialization behavior', () => {
    const source = bankFixture();
    const song = parseAmigaTitleBank(source);
    assert.equal(song.instruments[0]!.name, 'Fixture');
    assert.equal(song.instruments[0]!.sourceOffset, 1684);
    assert.equal(song.instruments[0]!.initialBytes, 6);
    assert.equal(song.instruments[0]!.loopStart, 4);
    assert.equal(song.instruments[0]!.loopBytes, 4);
    assert.deepEqual(Array.from(song.instruments[0]!.data), [0, 0, 0, 0, 64, 192, 32, 224]);
    assert.equal(source[1684], 12, 'source bytes remain untouched');
    assert.equal(song.rows[0]![0]!.period, 100);
    assert.equal(song.rows[0]![0]!.instrument, 1);
    assert.equal(song.rows[0]![0]!.effect, 3);
    assert.equal(song.rows.length, 64);
    assert.throws(() => parseAmigaTitleBank(source.subarray(0, -1)), /sample/i);
    source[662] = 0x1f;
    assert.throws(() => parseAmigaTitleBank(source), /effect/i);
});

test('Amiga PCM render follows Paula sample loops, volume and original stereo wiring', () => {
    const song = parseAmigaTitleBank(bankFixture());
    const render = renderAmigaTitle(song, {
        sampleRate: 1000,
        paulaClock: 100000,
        tickSeconds: 0.001,
    });
    assert.equal(render.frames, 384);
    assert.equal(render.durationSeconds, 0.384);
    assert.deepEqual(
        Array.from(render.samples.subarray(0, 20)),
        [0, 0, 0, 0, 0, 0, 0, 0, 8192, 0, -8192, 0, 8192, 0, -8192, 0, 4096, 0, -4096, 0],
    );
    assert.throws(() => renderAmigaTitle(song, { sampleRate: 0 }), /sample rate/i);
});

test('preserved Amiga title bank has the original score, sample names and CIA timing', async () => {
    const bank = await readFile(
        new URL('../../originals/audio/amiga/title-bank.bin', import.meta.url),
    );
    const song = parseAmigaTitleBank(bank);
    assert.deepEqual(song.orders, [0, 1, 2, 1, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(
        song.instruments.slice(0, 6).map((item) => item.name),
        ['moog1', 'Sdrum1', 'Strings2', 'HiClose', 'Moog7', 'bdrum1'],
    );
    assert.equal(song.rows.length, 704);
    const manifest = JSON.parse(
        await readFile(
            new URL('../../originals/audio/amiga/provenance.json', import.meta.url),
            'utf8',
        ),
    );
    assert.equal(manifest.timerLatch, 0x3b88);
    assert.equal(manifest.durationSeconds, (704 * 6 * 15241) / 709379);
    assert.deepEqual(manifest.playbackContexts, ['title', 'gameplay']);
    assert.equal(
        manifest.originalDriver.gameplayInitialize,
        '0x957c calls 0xa016 -> pointer 0x5da00',
    );
    assert.equal(manifest.originalDriver.effectDispatcher, '0xa040: RTS (0x4e75)');
    const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash(bank), '18d696dbbcc0d2952a7b2a4b57149757c2f67f17b5b8a41bfa585cfb7aa3491c');
    const engine = await readFile(
        new URL('../../originals/audio/amiga/audio-engine.bin', import.meta.url),
    );
    assert.equal(hash(engine), '42530b83183cb6d2f59f8b991cf330a1b21a5b826e19addd4ed5769dd95c96b2');
    assert.equal(hash(engine), manifest.driverSha256);
    assert.equal(engine.readUInt32BE(0x586), 0x5e4f0);
    const lifecycle = await readFile(
        new URL('../../originals/audio/amiga/music-lifecycle.bin', import.meta.url),
    );
    assert.equal(hash(lifecycle), manifest.lifecycleSha256);
    // $9578 restores the title CIA rate; $957c starts the same driver.
    assert.equal(lifecycle.subarray(8, 18).toString('hex'), '6100000861000a984e75');
    assert.equal(lifecycle.readUInt16BE(0x2a + 0x72), 0x4e75);
    const wave = await readFile(new URL('../../originals/audio/amiga/title.wav', import.meta.url));
    assert.equal(wave.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wave.readUInt16LE(22), 2);
    assert.equal(wave.readUInt32LE(24), 22050);
    assert.equal(wave.readUInt32LE(40), 2001095 * 4);
    assert.equal(hash(wave), manifest.wavSha256);
    const rendered = renderAmigaTitle(song);
    assert.equal(hash(encodeAmigaWave(rendered.samples, rendered.sampleRate)), manifest.wavSha256);
    assert.ok(rendered.samples.some((value) => Math.abs(value) > 1000));
});
