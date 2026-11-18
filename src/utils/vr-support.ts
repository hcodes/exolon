// Capability discovery must stay independent of the VR application and Three.js.
export async function canUseVr({
    modern,
    secure,
    xr,
    hasWebGl2,
}: {
    modern: boolean;
    secure: boolean;
    xr?: { isSessionSupported?: (mode: 'immersive-vr') => Promise<boolean> };
    hasWebGl2(): boolean;
}): Promise<boolean> {
    if (!modern || !secure || typeof xr?.isSessionSupported !== 'function') return false;
    try {
        return (await xr.isSessionSupported('immersive-vr')) && hasWebGl2();
    } catch {
        return false;
    }
}
