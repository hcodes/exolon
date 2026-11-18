// Keep applications behind independent import boundaries; VR is modern-only.
export const supportsVrGame = true;
// The build versions this URL. Keeping it opaque to import analysis prevents
// other engines from owning the separately registered VR entry's graph.
const vrEntry = /* @vr-entry */ './runtime/vr.js';
export function loadClassicGame(): Promise<typeof import('../components/App/index.tsx')> {
    return import('../components/App/index.tsx');
}
export function loadAmigaGame(): Promise<typeof import('../components/AmigaGame/index.tsx')> {
    return import('../components/AmigaGame/index.tsx');
}
export function loadAtariGame(): Promise<typeof import('../components/AtariGame/index.tsx')> {
    return import('../components/AtariGame/index.tsx');
}
export async function loadVrGame(): Promise<typeof import('../components/VrGame/index.tsx')> {
    const address = new URL(vrEntry, document.baseURI);
    const module: typeof import('../components/VrGame/index.tsx') & { buildId: string } =
        await import(address.href);
    const expectedBuild = address.searchParams.get('v');
    if (expectedBuild && module.buildId !== expectedBuild)
        throw new Error('The VR application was updated. Reload the page to continue.');
    return module;
}
