import { createHash } from 'node:crypto';
import { rolldown } from 'rolldown';
import {
    legacyGameEntries,
    legacyConfig,
    legacyGameConfig,
    legacyGlobals,
} from '../../rolldown.config.mjs';
import { compileEs5 } from './es5.mjs';
import { buildVersions } from './versioning.mjs';

async function generateScript(options, name, development, externalPreact = false) {
    const bundle = await rolldown(options);
    try {
        const { output } = await bundle.generate({
            format: 'iife',
            codeSplitting: false,
            name,
            globals: externalPreact ? legacyGlobals : {},
            generatedCode: { preset: 'es5' },
        });
        const script = output.find((item) => item.type === 'chunk');
        if (!script) throw new Error('Missing legacy JavaScript for ' + name);
        return await compileEs5(script.code, { development });
    } finally {
        await bundle.close();
    }
}

export async function legacyArtifacts({ development = false } = {}) {
    /** @type {Map<string, string>} */
    const files = new Map();
    /** @type {Record<string, string>} */
    const chunks = {};
    for (const game of Object.keys(legacyGameEntries)) {
        const registryName = game === 'atari-st' ? 'atari' : game;
        const registered = await generateScript(
            legacyGameConfig(game),
            `__reexLegacy.games.${registryName}`,
            development,
            true,
        );
        const hash = createHash('sha256').update(registered).digest('hex').slice(0, 12);
        const name = `${game}-${hash}.js`;
        files.set(name, registered);
        chunks[registryName] = './legacy/' + name + '?v=' + (await buildVersions()).code;
    }
    files.set('game.js', await generateScript(legacyConfig({ chunks }), 'ReexLegacy', development));
    return { files, chunks };
}
