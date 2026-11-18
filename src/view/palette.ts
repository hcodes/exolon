// Spectrum attributes select a hue family; these ramps give the new vector
// surfaces depth without replacing the recovered ink colours with grey metal.
const NORMAL = [
    ['#435264', '#263345', '#172435', '#0a1422', '#02060c'],
    ['#c9d8ff', '#6685ff', '#365bdd', '#253694', '#111c48'],
    ['#ffd3d1', '#ff6472', '#e3334b', '#a51d3e', '#390e27'],
    ['#ffd0fb', '#f36be9', '#cc3bd0', '#89249b', '#310e44'],
    ['#d0ffb9', '#7eec53', '#38c84a', '#218143', '#103a2d'],
    ['#cbffff', '#69e9ee', '#28c5d5', '#1c829f', '#103449'],
    ['#ffffcb', '#f1e95b', '#d6c832', '#978324', '#39311a'],
    ['#ffffff', '#e9f1eb', '#c6d4cf', '#7e9b9d', '#2d485b'],
];
const BRIGHT = [
    NORMAL[0],
    ['#e3eaff', '#85a2ff', '#4c76ff', '#3149c2', '#142359'],
    ['#ffe1d5', '#ff8790', '#ff394b', '#bc2250', '#480f32'],
    ['#ffe2ff', '#ff91f5', '#fa4de9', '#ab2dbc', '#421451'],
    ['#e3ffc3', '#a4ff67', '#54ed43', '#23a747', '#103e30'],
    ['#e2ffff', '#91ffff', '#43e7ed', '#1b9fb7', '#103e51'],
    ['#ffffe0', '#fff98c', '#f5eb48', '#b7a12a', '#423a1a'],
    ['#ffffff', '#f5fffb', '#e0efeb', '#a2bdc1', '#36596a'],
];

export function decodeSpectrumAttribute(attribute: number) {
    const byte = attribute & 255;
    return {
        ink: byte & 7,
        paper: (byte >> 3) & 7,
        bright: Boolean(byte & 64),
        flash: Boolean(byte & 128),
    };
}

export function spectrumPalette(attribute: number) {
    const decoded = decodeSpectrumAttribute(attribute);
    const [highlight, light, base, shade, deep] = (decoded.bright ? BRIGHT : NORMAL)[decoded.ink];
    return {
        ...decoded,
        highlight,
        light,
        base,
        shade,
        deep,
        surface: [light, base, shade],
        sphere: [highlight, base, shade, deep],
    };
}

export function dominantAttribute(tiles: { color?: number; ink?: boolean }[] = [], fallback = 71) {
    const counts = new Map();
    for (const tile of tiles) {
        if (typeof tile.color !== 'number' || tile.ink === false) continue;
        const attribute = tile.color & 127;
        counts.set(attribute, (counts.get(attribute) || 0) + 1);
    }
    let selected = fallback,
        maximum = 0;
    for (const [attribute, count] of counts) {
        if (count > maximum || (count === maximum && Boolean(attribute & 64))) {
            maximum = count;
            selected = attribute;
        }
    }
    return selected;
}
