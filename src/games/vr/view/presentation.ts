import { Vector3 } from 'three';
import type { Camera, Group, PerspectiveCamera } from 'three';

const PIXEL_METRES = 2.4 / 256;
const VIEW_ANGLE = 0.14;

// Presentation changes never alter the classic model or collision plane.
export function createVrPresentation(rig: Group, camera: PerspectiveCamera) {
    let scale = 1;
    const viewer = new Vector3();
    const forward = new Vector3();
    function setScale(value: number) {
        if (!Number.isFinite(value)) return;
        scale = Math.max(0.65, Math.min(1.5, value));
        const unit = PIXEL_METRES * scale;
        rig.scale.set(unit, unit, unit * 2);
    }
    function recenter(head?: Camera) {
        if (head) {
            head.getWorldPosition(viewer);
            head.getWorldDirection(forward);
            forward.y = 0;
            if (forward.lengthSq() < 0.01) forward.set(0, 0, -1);
            forward.normalize();
            rig.position.copy(viewer).addScaledVector(forward, 1.85);
            rig.position.y = viewer.y - 1.2 * scale;
            rig.rotation.set(0, Math.atan2(-forward.x, -forward.z) + VIEW_ANGLE, 0);
        } else {
            rig.position.set(0, 0.16, 0);
            rig.rotation.set(0, VIEW_ANGLE, 0);
            camera.fov = 55;
            camera.position.set(0, 1.52, 3.9);
            camera.lookAt(0, 1.52, 0);
            camera.updateProjectionMatrix();
        }
        rig.updateMatrixWorld(true);
    }
    setScale(1);
    recenter();
    return { setScale, recenter };
}
