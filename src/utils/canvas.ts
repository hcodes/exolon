import { SCREEN_WIDTH, SCREEN_HEIGHT } from '../constants/game.ts';

export function canvasPoint(
    box: Pick<DOMRect, 'width' | 'height' | 'left' | 'top'>,
    clientX: number,
    clientY: number,
    image: { width: number; height: number } = { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
) {
    const width = Math.min(box.width, (box.height * image.width) / image.height);
    if (width <= 0) return null;
    const height = (width * image.height) / image.width;
    return {
        x: ((clientX - box.left - (box.width - width) / 2) * SCREEN_WIDTH) / width,
        y: ((clientY - box.top - (box.height - height) / 2) * SCREEN_HEIGHT) / height,
        width,
    };
}
