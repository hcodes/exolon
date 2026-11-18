export interface NativeStaticShape {
    readonly address: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    /** True: index zero preserves the background. False: replace the whole rectangle. */
    readonly transparent: boolean;
    readonly resource: string;
}
export interface NativeScreen {
    readonly index: number;
    readonly stage: number;
    readonly source: number;
    readonly tiles: readonly number[];
    /** Initial background composites in native draw order; coordinates are display pixels. */
    readonly static: readonly NativeStaticShape[];
}
export interface NativeWorld {
    readonly width: number;
    readonly height: number;
    readonly screenWidth: number;
    readonly screenHeight: number;
    readonly screenCount: number;
    readonly worldYOffset: number;
    readonly solidTileRange: readonly [number, number];
    readonly screens: readonly NativeScreen[];
}
