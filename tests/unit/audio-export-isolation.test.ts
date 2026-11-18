import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { encodeTrace as encodeCpcTrace } from '../../tools/audio/cpc.mjs';
import { encodeTrace as encodeSharpTrace } from '../../tools/audio/sharp.mjs';

async function runtimeHashes(platform: string) {
    const directory = new URL(`../../src/audio/${platform}/`, import.meta.url);
    const files = (await readdir(directory)).filter((file) => /\.(wav|m4a)$/.test(file));
    return Promise.all(
        files.map(async (file) => [
            file,
            createHash('sha256')
                .update(await readFile(new URL(file, directory)))
                .digest('hex'),
        ]),
    );
}

for (const [tool, platform] of [
    ['c64', 'c64'],
    ['cpc', 'cpc'],
    ['sharp', 'sharp-mz800'],
]) {
    test(`${tool} CLI --output keeps music, effects and metadata isolated from checked-in runtime assets`, async () => {
        const temporary = await mkdtemp(join(tmpdir(), `reex-${tool}-isolated-`));
        const output = join(temporary, 'output');
        const before = await runtimeHashes(platform);
        await mkdir(output);
        try {
            const reference = JSON.parse(
                await readFile(
                    new URL(`../../originals/audio/${platform}/render.json`, import.meta.url),
                    'utf8',
                ),
            ) as { recordings: { name: string; file: string }[] };
            const args = ['--output', output];
            if (tool === 'c64') {
                const renderer = join(temporary, 'renderer');
                await mkdir(renderer);
                // Exercise the real CLI and WAV writes with a deliberately small
                // offline CPU/SID fixture rather than an external emulator.
                await writeFile(
                    join(renderer, 'mos6510.js'),
                    `
                    jsSID.MOS6510 = class {
                        constructor(memory) { this.memory = memory; }
                        cpuParse() {}
                        cpuJSR() {
                            this.memory[0x7e28] = this.memory[0x7e31] = this.memory[0x7e3a] = 0;
                        }
                    };
                `,
                );
                await writeFile(
                    join(renderer, 'tinysid.js'),
                    `
                    jsSID.TinySID = class {
                        generateIntoBuffer(length, samples, offset) {
                            samples.fill(0.125, offset, offset + length);
                        }
                    };
                `,
                );
                args.push('--jssid', renderer);
            } else {
                // Traces-only export needs no original CPU or long music render.
                // Every named output still travels through the actual CLI writer.
                await writeFile(join(output, 'audio-engine.bin'), Buffer.from([0]));
                if (tool === 'sharp')
                    await writeFile(join(output, 'sn-tone-converter.bin'), Buffer.from([0]));
                for (const recording of reference.recordings) {
                    const extension = tool === 'cpc' ? 'ayr' : 'snr';
                    const trace =
                        tool === 'cpc'
                            ? encodeCpcTrace([[0, 7, 255]], 1000)
                            : encodeSharpTrace([[0, 0x9f]], 1000);
                    await writeFile(join(output, `${recording.name}.${extension}`), trace);
                }
                args.push('--traces-only');
            }
            await promisify(execFile)(process.execPath, [
                '--experimental-strip-types',
                fileURLToPath(new URL(`../../tools/audio/${tool}.mjs`, import.meta.url)),
                ...args,
            ]);
            const render = JSON.parse(await readFile(join(output, 'render.json'), 'utf8')) as {
                recordings: { file: string; sha256: string }[];
            };
            assert.deepEqual(
                render.recordings.map(({ file }) => file),
                reference.recordings.map(({ file }) => file),
            );
            for (const recording of render.recordings) {
                assert.equal(
                    createHash('sha256')
                        .update(await readFile(join(output, recording.file)))
                        .digest('hex'),
                    recording.sha256,
                );
            }
            assert.deepEqual(await runtimeHashes(platform), before);
            assert.deepEqual(
                (await readdir(temporary)).sort(),
                tool === 'c64' ? ['output', 'renderer'] : ['output'],
            );
        } finally {
            await rm(temporary, { recursive: true, force: true });
        }
    });
}
