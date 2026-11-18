import type { createRenderer } from '../view/renderer.ts';
import type { loadGameResources } from '../services/resources.ts';
import type { NativeGraphics, CpcGraphics, SharpGraphics } from '../types/graphics.ts';
import { OPTIONAL_GRAPHICS } from '../constants/graphics.ts';

type Loaders = Awaited<ReturnType<typeof loadGameResources>>['optional'];
type OptionalMode = keyof Loaders;
interface OptionalGraphicsOptions {
    renderer: Pick<
        ReturnType<typeof createRenderer>,
        'setC64Graphics' | 'setCpcGraphics' | 'setSharpGraphics'
    >;
    loaders: Loaders;
    isDisposed(): boolean;
    onUnavailable(mode: OptionalMode): void;
}

export function createOptionalGraphicsInstaller({
    renderer,
    loaders,
    isDisposed,
    onUnavailable,
}: OptionalGraphicsOptions) {
    const installations = new Map<string, Promise<void>>();
    async function installBank(key: OptionalMode) {
        const data = await loaders[key]();
        if (isDisposed()) return;
        let installed = false;
        try {
            installed =
                key === 'c64'
                    ? renderer.setC64Graphics(data as NativeGraphics | undefined)
                    : key === 'cpc'
                      ? renderer.setCpcGraphics(data as CpcGraphics | undefined)
                      : renderer.setSharpGraphics(data as SharpGraphics | undefined);
        } catch {
            // Malformed optional data keeps the available fallback artwork.
        }
        if (!installed) onUnavailable(key);
    }
    function loadMode(mode: string) {
        const entry = OPTIONAL_GRAPHICS.find(([value]) => value === mode);
        if (!entry) return;
        const [key] = entry;
        let loading = installations.get(key);
        if (!loading) {
            loading = installBank(key);
            installations.set(key, loading);
        }
        return loading;
    }
    async function ensureGraphics(modes: readonly string[]) {
        await Promise.all(modes.map(loadMode));
    }
    return ensureGraphics;
}
