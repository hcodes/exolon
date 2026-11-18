import {
    BoxGeometry,
    CylinderGeometry,
    SphereGeometry,
    TorusGeometry,
    Mesh,
    MeshStandardMaterial,
} from 'three';
import type { BufferGeometry, Group, Material } from 'three';

export function createVrResources() {
    const geometries: BufferGeometry[] = [];
    const materials = new Map<string, MeshStandardMaterial>();
    function geometry<T extends BufferGeometry>(value: T): T {
        geometries.push(value);
        return value;
    }
    const box = geometry(new BoxGeometry(1, 1, 1));
    const sphere = geometry(new SphereGeometry(1, 16, 12));
    const cylinder = geometry(new CylinderGeometry(1, 1, 1, 12));
    const cone = geometry(new CylinderGeometry(0, 1, 1, 12));
    const ring = geometry(new TorusGeometry(1, 0.12, 6, 24));
    function material(color: string, metal = 0.35, glow = false, vertexColors = false) {
        const key = `${color}:${metal}:${glow}:${vertexColors}`;
        let result = materials.get(key);
        if (!result) {
            result = new MeshStandardMaterial({
                color,
                metalness: metal,
                roughness: metal > 0.5 ? 0.36 : 0.7,
                emissive: glow ? color : '#000000',
                emissiveIntensity: glow ? 1.35 : 0,
                vertexColors,
            });
            materials.set(key, result);
        }
        return result;
    }
    return {
        box,
        sphere,
        cylinder,
        cone,
        ring,
        geometry,
        material,
        cream: material('#eee5c6', 0.24),
        white: material('#d8e8e5', 0.6),
        metal: material('#607d8b', 0.75),
        dark: material('#142536', 0.65),
        visor: material('#10283d', 0.9),
        gold: material('#cfb05b', 0.7),
        cyan: material('#53dfed', 0.3, true),
        red: material('#ff635f', 0.25, true),
        green: material('#6bd891', 0.3, true),
        purple: material('#c06aff', 0.3, true),
        dispose() {
            for (const item of geometries) item.dispose();
            for (const item of materials.values()) item.dispose();
            geometries.length = 0;
            materials.clear();
        },
    };
}
export type VrResources = ReturnType<typeof createVrResources>;

export function solid(
    parent: Group,
    geometry: BufferGeometry,
    material: Material,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    name = '',
) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    mesh.name = name;
    parent.add(mesh);
    return mesh;
}
