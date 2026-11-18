import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { inspectTap, parseTap } from './tap.mjs';
import { relocateGame, recoverWorld, browserWorld } from './world.mjs';

const [file, output] = process.argv.slice(2);
if (!file) {
    console.error('Usage: npm run recovery:inspect -- /path/to/EXOLON.TAP [output-directory]');
    process.exitCode = 1;
} else {
    try {
        const bytes = await readFile(file);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        console.log(JSON.stringify({ sha256, blocks: inspectTap(bytes) }, null, 2));
        if (output) {
            if (sha256 !== '31537fa52ce1e197c129a80d4e4e1efefceff58726471a0d5a571add45ab5f77') {
                throw new Error('Unsupported TAP revision; inspect its loader before recovery');
            }
            const blocks = parseTap(bytes);
            const memory = relocateGame(blocks[7].payload);
            const world = recoverWorld(memory);
            const directory = resolve(output);
            await mkdir(directory, { recursive: true });
            await writeFile(join(directory, 'world.json'), JSON.stringify(world));
            await writeFile(
                join(directory, 'browser-world.json'),
                JSON.stringify(browserWorld(world)),
            );
            await writeFile(join(directory, 'memory.bin'), memory);
            const firstScreen = world.screens[0];
            await writeFile(
                join(directory, 'screen.json'),
                JSON.stringify({
                    ...firstScreen,
                    tiles: firstScreen.tiles.map((tile) =>
                        tile
                            ? {
                                  collision: tile.collision,
                                  block: tile.block,
                                  instance: tile.instance,
                              }
                            : null,
                    ),
                }),
            );
            console.log(`Recovered ${world.screens.length} screen layouts into ${directory}`);
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
