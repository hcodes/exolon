/** Source formats are documented in the adjacent provenance.json. */
export type NativeRgb = readonly [number, number, number];
export interface NativeShape {
    readonly address: number;
    readonly width: number;
    readonly height: number;
    /** Row-major palette indices; index zero is transparent for masked native blits. */
    readonly frames: readonly (readonly number[])[];
}
export interface NativeTextRecord {
    readonly address: number;
    readonly x: number;
    readonly y: number;
    readonly text: string;
    readonly ink?: number;
}
export interface NativeGraphics {
    readonly asciiFont?: readonly (readonly number[])[];
    readonly text: Readonly<Record<string, readonly NativeTextRecord[]>>;
    readonly highScores: readonly { readonly name: string; readonly score: number }[];
    /** Menu palette. Gameplay selects stagePalettes[screen.stage]. */
    readonly palette: readonly NativeRgb[];
    readonly stagePalettes: readonly (readonly NativeRgb[])[];
    readonly stageTileSets: readonly number[];
    /** Names in resources for the four six-frame enemy animation families in each stage. */
    readonly stageFlyers: readonly (readonly string[])[];
    readonly resources: Readonly<Record<string, NativeShape>>;
    /** Two sets of 256 native 8×8 tiles, each as 64 row-major palette indices. */
    readonly tilesets: readonly (readonly (readonly number[])[])[];
    /** Packed MSB-first rows: A-Z, period, 0-9, star, blank. Each glyph is eight bytes. */
    readonly font: readonly (readonly number[])[];
    /** Decimal digits zero through nine, seven packed MSB-first row bytes per glyph. */
    readonly hudFont: readonly (readonly number[])[];
    readonly title: {
        readonly width: number;
        readonly height: number;
        readonly pixels: readonly number[];
        readonly palette: readonly NativeRgb[];
    };
}
