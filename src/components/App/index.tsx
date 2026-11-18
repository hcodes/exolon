import { ScreenNavigation } from '../ScreenNavigation/index.tsx';
import { FullscreenButton } from '../FullscreenButton/index.tsx';
import { HomeButton } from '../HomeButton/index.tsx';
import './index.css';
import { useLayoutEffect } from 'preact/hooks';
import { createApplication } from '../../controllers/application.ts';
import { GameViewport } from '../GameViewport/index.tsx';
import { PlatformPicker } from '../PlatformPicker/index.tsx';
import { Footer } from '../Footer/index.tsx';
import { GamepadHint } from '../GamepadHint/index.tsx';

export function App({
    onMount,
    skipPlatformPicker = false,
    audioContext,
    onChooseAmiga,
    onChooseAtariSt,
    onChooseClassic,
    onPlatforms,
}: {
    onMount?: () => void | (() => void);
    skipPlatformPicker?: boolean;
    audioContext?: AudioContext;
    onChooseAmiga?: () => void;
    onChooseAtariSt?: () => void;
    onChooseClassic?: (mode?: string) => void;
    onPlatforms?: () => void;
}) {
    useLayoutEffect(() => {
        const disposeLayout = onMount?.();
        const application = createApplication({
            skipPlatformPicker,
            audioContext,
            document,
            window,
            onChooseAmiga,
            onChooseAtariSt,
            onChooseClassic,
            onPlatforms,
        });
        void application.start();
        return () => {
            application.destroy();
            if (typeof disposeLayout === 'function') disposeLayout();
        };
    }, [
        onMount,
        onChooseAmiga,
        onChooseAtariSt,
        onChooseClassic,
        onPlatforms,
        skipPlatformPicker,
        audioContext,
    ]);
    return (
        <main class="game-app game-app_selecting" data-ui="preact">
            <FullscreenButton />
            <HomeButton />
            <ScreenNavigation />
            <PlatformPicker />
            <GameViewport />
            <Footer />
            <GamepadHint />
        </main>
    );
}
