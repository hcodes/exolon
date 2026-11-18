import { useLayoutEffect } from 'preact/hooks';
import { createLanding } from '../../controllers/landing.ts';
import { FullscreenButton } from '../FullscreenButton/index.tsx';
import { PlatformPicker } from '../PlatformPicker/index.tsx';

export function PlatformLanding({
    preferred,
    onChoose,
    onMount,
}: {
    preferred: string;
    onChoose: (mode: string) => void;
    onMount?: () => void | (() => void);
}) {
    useLayoutEffect(() => {
        const disposeLayout = onMount?.();
        const dispose = createLanding({ document, window, preferred, onChoose });
        return () => {
            dispose();
            if (typeof disposeLayout === 'function') disposeLayout();
        };
    }, [preferred, onChoose, onMount]);
    return (
        <main class="game-app game-app_selecting">
            <FullscreenButton />
            <PlatformPicker />
        </main>
    );
}
