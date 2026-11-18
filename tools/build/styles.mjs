import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import autoprefixer from 'autoprefixer';

/** Extract component imports without injecting styles or leaving CSS imports in browser JS. */
export function stylesPlugin({ entry, additionalEntries = [], fileName = 'index.css' }) {
    const styles = new Map();
    const entryIds = [];
    return {
        name: 'component-styles',
        async buildStart() {
            for (const file of [entry, ...additionalEntries]) {
                const id = (await this.resolve(path.resolve(file)))?.id;
                if (!id) this.error('Cannot resolve stylesheet entry: ' + file);
                entryIds.push(id);
            }
        },
        async load(id) {
            if (!id.endsWith('.css')) return null;
            const css = await readFile(id, 'utf8');
            // Parse here so malformed source fails the build with its original file path.
            styles.set(id, postcss.parse(css, { from: id }));
            return { code: '', moduleType: 'js', moduleSideEffects: false };
        },
        async generateBundle() {
            const visited = new Set(),
                output = postcss.root();
            const visit = (id) => {
                if (visited.has(id)) return;
                visited.add(id);
                if (styles.has(id)) {
                    output.append(styles.get(id).clone().nodes);
                    return;
                }
                const module = this.getModuleInfo(id);
                for (const dependency of [
                    ...(module?.importedIds || []),
                    ...(module?.dynamicallyImportedIds || []),
                ])
                    visit(dependency);
            };
            for (const id of entryIds) visit(id);
            if (output.nodes.length) {
                // Resolve Browserslist from the project, even for external entry fixtures or another cwd.
                const css = await postcss([autoprefixer()]).process(output, {
                    from: fileURLToPath(new URL('../../src/index.css', import.meta.url)),
                    to: fileName,
                    map: false,
                });
                for (const warning of css.warnings()) this.warn(warning.toString());
                this.emitFile({
                    type: 'asset',
                    fileName,
                    source: css.css + '\n',
                });
            }
        },
    };
}
