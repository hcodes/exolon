import {
    ACESFilmicToneMapping,
    AmbientLight,
    BufferGeometry,
    Color,
    DirectionalLight,
    Float32BufferAttribute,
    FogExp2,
    Group,
    HemisphereLight,
    PerspectiveCamera,
    Points,
    PointsMaterial,
    Scene,
    SRGBColorSpace,
    WebGLRenderer,
} from 'three';
import type { GameState } from '../../../types/game.ts';
import { describeVrScene } from '../model/scene.ts';
import { createVrResources, solid } from './materials.ts';
import { createVrObject, disposeVrScreen } from './terrain.ts';
import { createVrHero } from './hero.ts';
import { createVrActors } from './entities.ts';
import { createVrMechanisms } from './mechanisms.ts';
import { createVrPanels } from './panels.ts';
import { createVrEffects } from './effects.ts';
import { createVrPresentation } from './presentation.ts';

export function createVrView(canvas: HTMLCanvasElement) {
    const renderer = new WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(canvas.ownerDocument.defaultView?.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.24;
    renderer.xr.enabled = true;
    const scene = new Scene();
    scene.background = new Color('#040b16');
    scene.fog = new FogExp2('#040b16', 0.075);
    const camera = new PerspectiveCamera(43, 1, 0.02, 40);
    const rig = new Group();
    rig.name = 'diorama';
    const presentation = createVrPresentation(rig, camera);
    scene.add(rig);
    const resources = createVrResources();
    const staticScene = new Group();
    staticScene.name = 'map';
    const hero = createVrHero(resources);
    const actors = createVrActors(resources);
    const mechanisms = createVrMechanisms(resources);
    const panels = createVrPanels(canvas.ownerDocument);
    const effects = createVrEffects(resources);
    rig.add(staticScene, hero.group, actors.group, mechanisms.group, effects.group, panels.group);
    // A deep open-front display base: it frames the level without covering play.
    const plinth = new Group();
    plinth.name = 'plinth';
    solid(plinth, resources.box, resources.dark, 0, -3.5, -2, 264, 7, 38);
    solid(plinth, resources.box, resources.metal, 0, 0, -2, 264, 1.2, 38);
    solid(plinth, resources.box, resources.cyan, 0, -3.5, 17.2, 252, 0.6, 0.7);
    for (const x of [-127, 127])
        solid(plinth, resources.box, resources.gold, x, -3.4, 17.5, 3, 4, 1);
    rig.add(plinth);
    const hemisphere = new HemisphereLight('#c3e9ff', '#152237', 2.5);
    const key = new DirectionalLight('#fff1d1', 3.5);
    key.position.set(-2, 4, 4);
    const rim = new DirectionalLight('#4dafff', 2.6);
    rim.position.set(3, 2, -2);
    scene.add(hemisphere, key, rim, new AmbientLight('#8ba1b5', 0.3));
    // Decorative stars have no gameplay role and intentionally use point sprites.
    const starGeometry = new BufferGeometry();
    const positions: number[] = [];
    let random = 581;
    for (let i = 0; i < 180; i++) {
        random = (Math.imul(random, 1664525) + 1013904223) | 0;
        const x = ((random >>> 0) % 1000) / 1000;
        random = (Math.imul(random, 1664525) + 1013904223) | 0;
        const y = ((random >>> 0) % 1000) / 1000;
        positions.push((x - 0.5) * 660, (y - 0.25) * 450, -90 - (i % 80));
    }
    starGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const starMaterial = new PointsMaterial({
        color: '#accce9',
        size: 0.004,
        sizeAttenuation: true,
    });
    rig.add(new Points(starGeometry, starMaterial));
    let previousScreen: GameState['screen'] | undefined;
    let previousKey = '';
    let destroyed = false;
    function recenter() {
        if (destroyed) return;
        presentation.recenter(renderer.xr.isPresenting ? renderer.xr.getCamera() : undefined);
    }
    return {
        renderer,
        scene,
        rig,
        camera,
        update(state: GameState, fraction: number, time: number) {
            if (destroyed) return;
            const key = `${state.destroyed.join(',')}:${state.objects
                .filter((object) => !object.active && [7, 8].includes(object.type))
                .map((object) => object.id)
                .join(',')}`;
            if (state.screen !== previousScreen || key !== previousKey) {
                const changedScreen = state.screen !== previousScreen;
                disposeVrScreen(staticScene);
                for (const item of describeVrScene(state).instances) {
                    // Mines are drawn by action 5 at the recovered floor surface.
                    if (item.family !== 'mine')
                        staticScene.add(createVrObject(item, state.world, resources));
                }
                if (changedScreen) {
                    actors.clear();
                }
                mechanisms.reset(state, staticScene);
                previousScreen = state.screen;
                previousKey = key;
            }
            hero.update(state, fraction, time);
            actors.update(state, fraction, time);
            mechanisms.update(state, time);
            effects.update(state, time);
            panels.update(state);
        },
        panel: panels.panel,
        pick: panels.pick,
        hover: panels.hover,
        recenter,
        setScale(value: number) {
            if (destroyed || !Number.isFinite(value)) return;
            presentation.setScale(value);
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            renderer.setAnimationLoop(null);
            disposeVrScreen(staticScene);
            panels.destroy();
            actors.clear();
            starGeometry.dispose();
            starMaterial.dispose();
            resources.dispose();
            scene.clear();
            renderer.dispose();
        },
    };
}
