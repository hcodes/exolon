import type { ComponentChildren } from 'preact';
import { Modal } from '../Modal/index.tsx';
import './index.css';

export function HomePanel({ children }: { children: ComponentChildren }) {
    return (
        <Modal id="home-panel" class="home-panel" aria-label="Home" hidden>
            <div class="home-panel__content">{children}</div>
        </Modal>
    );
}
