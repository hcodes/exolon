import {
    CanvasTexture,
    Group,
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    Raycaster,
    SRGBColorSpace,
} from 'three';
import type { Vector3 } from 'three';
import type { GameState } from '../../../types/game.ts';

interface Action {
    id: string;
    label: string;
}

export function createVrPanels(document: Document) {
    const group = new Group();
    group.name = 'panels';
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 720;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The VR interface requires Canvas 2D text support.');
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const geometry = new PlaneGeometry(240, 120);
    const material = new MeshBasicMaterial({ map: texture, transparent: true, depthTest: false });
    const menu = new Mesh(geometry, material);
    menu.name = 'menu-panel';
    menu.position.set(0, 226, 18);
    menu.renderOrder = 3;
    group.add(menu);
    menu.visible = false;
    const hudCanvas = document.createElement('canvas');
    hudCanvas.width = 1280;
    hudCanvas.height = 100;
    const hudContext = hudCanvas.getContext('2d');
    if (!hudContext) throw new Error('The VR HUD requires Canvas 2D text support.');
    const hudTexture = new CanvasTexture(hudCanvas);
    hudTexture.colorSpace = SRGBColorSpace;
    const hudMaterial = new MeshBasicMaterial({ map: hudTexture, transparent: true });
    const hudGeometry = new PlaneGeometry(256, 20);
    const hud = new Mesh(hudGeometry, hudMaterial);
    hud.name = 'hud';
    hud.position.set(0, -17, 14);
    group.add(hud);
    let hudKey = '';
    let currentTitle = '';
    let currentLines: readonly string[] = [];
    let currentActions: readonly Action[] = [];
    let hoveredActions: readonly string[] = [];
    let layoutHeight = 512;
    let actionTop = 0;
    let actionHeight = 0;
    const raycaster = new Raycaster();
    function panel(title: string, lines: readonly string[], actions: readonly Action[]) {
        currentTitle = title;
        currentLines = lines;
        currentActions = actions;
        hoveredActions = [];
        draw();
    }
    function draw() {
        const title = currentTitle,
            lines = currentLines,
            actions = currentActions;
        menu.visible = Boolean(title || lines.length || actions.length);
        if (!menu.visible) return;
        const spacing = Math.min(38, 150 / Math.max(1, lines.length));
        actionTop = Math.max(160, 125 + lines.length * spacing);
        const panelHeight = Math.max(256, Math.min(720, actionTop + actions.length * 54 + 20));
        // CanvasTexture storage is immutable after its first WebGL upload.
        // Keep the backing bitmap fixed while fitting each virtual menu into it.
        layoutHeight = panelHeight;
        menu.scale.y = panelHeight / 512;
        menu.position.y = 184 + (60 * panelHeight) / 512;
        context!.setTransform(1, 0, 0, 1, 0, 0);
        context!.clearRect(0, 0, canvas.width, canvas.height);
        context!.setTransform(1, 0, 0, canvas.height / panelHeight, 0, 0);
        context!.fillStyle = 'rgba(5, 17, 31, 0.94)';
        context!.fillRect(2, 2, 1020, panelHeight - 4);
        context!.strokeStyle = '#47778e';
        context!.lineWidth = 3;
        context!.strokeRect(3, 3, 1018, panelHeight - 6);
        context!.fillStyle = '#91e8ed';
        context!.fillRect(3, 3, 1018, 4);
        context!.textAlign = 'center';
        context!.textBaseline = 'middle';
        context!.font = '700 48px Trebuchet MS, Arial, sans-serif';
        context!.fillStyle = '#f9edcb';
        context!.fillText(title.toUpperCase(), 512, 58, 960);
        context!.font = '26px Trebuchet MS, Arial, sans-serif';
        context!.fillStyle = '#c4d8e2';
        lines.forEach((line, index) => context!.fillText(line, 512, 115 + index * spacing, 960));
        actionHeight = Math.min(54, (panelHeight - 20 - actionTop) / Math.max(1, actions.length));
        for (const [index, action] of actions.entries()) {
            const y = actionTop + index * actionHeight;
            const hovered = hoveredActions.includes(action.id);
            context!.fillStyle = hovered ? '#346b79' : '#1d4057';
            context!.fillRect(140, y + 3, 744, actionHeight - 6);
            context!.strokeStyle = hovered ? '#a4f5db' : '#477e96';
            context!.lineWidth = hovered ? 3 : 1;
            context!.strokeRect(140, y + 3, 744, actionHeight - 6);
            context!.fillStyle = '#efffff';
            context!.font = '600 26px Trebuchet MS, Arial, sans-serif';
            context!.fillText(action.label, 512, y + actionHeight / 2, 710);
        }
        texture.needsUpdate = true;
    }
    return {
        group,
        panel,
        hover(ids: readonly string[]) {
            const next = currentActions
                .filter((action) => ids.includes(action.id))
                .map((action) => action.id);
            if (
                next.length === hoveredActions.length &&
                next.every((id, index) => id === hoveredActions[index])
            )
                return;
            hoveredActions = next;
            draw();
        },
        update(state: GameState) {
            const key = `${state.ammo}:${state.grenades}:${state.score}:${state.lives}:${state.stage}:${state.level}`;
            if (key === hudKey) return;
            hudKey = key;
            hudContext!.clearRect(0, 0, 1280, 100);
            hudContext!.fillStyle = '#081827';
            hudContext!.fillRect(0, 0, 1280, 100);
            hudContext!.fillStyle = '#3d6a80';
            hudContext!.fillRect(0, 0, 1280, 2);
            hudContext!.textAlign = 'center';
            hudContext!.textBaseline = 'middle';
            const labels = ['AMMO', 'ROCKETS', 'SCORE', 'LIVES', 'ZONE'];
            const values = [
                state.ammo,
                state.grenades,
                String(state.score).padStart(6, '0'),
                state.lives,
                `${state.stage} / ${state.level}`,
            ];
            for (let i = 0; i < 5; i++) {
                hudContext!.font = '17px Trebuchet MS, Arial, sans-serif';
                hudContext!.fillStyle = '#8babbc';
                hudContext!.fillText(labels[i], 128 + i * 256, 26);
                hudContext!.font = '700 34px Trebuchet MS, Arial, sans-serif';
                hudContext!.fillStyle = i === 2 ? '#ffe6a5' : '#dcfbf6';
                hudContext!.fillText(String(values[i]), 128 + i * 256, 64);
            }
            hudTexture.needsUpdate = true;
        },
        pick(origin: Vector3, direction: Vector3) {
            if (!menu.visible || !direction.lengthSq()) return undefined;
            group.updateWorldMatrix(true, true);
            raycaster.set(origin, direction.clone().normalize());
            const hit = raycaster.intersectObject(menu)[0];
            if (!hit?.uv || hit.uv.x < 140 / 1024 || hit.uv.x > 884 / 1024) return undefined;
            const y = (1 - hit.uv.y) * layoutHeight;
            const index = Math.floor((y - actionTop) / actionHeight);
            return index >= 0 && index < currentActions.length
                ? currentActions[index].id
                : undefined;
        },
        destroy() {
            geometry.dispose();
            material.dispose();
            texture.dispose();
            hudGeometry.dispose();
            hudMaterial.dispose();
            hudTexture.dispose();
            group.clear();
        },
    };
}
