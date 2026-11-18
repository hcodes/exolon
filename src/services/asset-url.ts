// Filled from saved build outputs; direct source consumers keep their original URLs.
const assetVersions: Readonly<Record<string, string>> = /* @asset-versions */ {};

export function versionAssetUrl(
    value: string | URL,
    versions: Readonly<Record<string, string>> = assetVersions,
): string {
    const original = String(value);
    const hashIndex = original.indexOf('#');
    const fragment = hashIndex < 0 ? '' : original.slice(hashIndex);
    const address = hashIndex < 0 ? original : original.slice(0, hashIndex);
    const queryIndex = address.indexOf('?');
    const pathname = queryIndex < 0 ? address : address.slice(0, queryIndex);
    const key = Object.keys(versions).find(
        (file) => pathname === file || pathname.endsWith('/' + file),
    );
    if (!key) return original;
    const query = new URLSearchParams(queryIndex < 0 ? '' : address.slice(queryIndex + 1));
    query.set('v', versions[key]);
    return pathname + '?' + query.toString() + fragment;
}
