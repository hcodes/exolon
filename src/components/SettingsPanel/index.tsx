import type { ComponentChildren } from 'preact';
import { Modal } from '../Modal/index.tsx';
import { ModalCard } from '../ModalCard/index.tsx';
import { Button } from '../Button/index.tsx';
import { Checkbox } from '../Checkbox/index.tsx';
import { SettingsGroup } from '../SettingsGroup/index.tsx';
import './index.css';

export function SettingsPanel({ children }: { children: ComponentChildren }) {
    return (
        <Modal id="settings-panel" class="settings-panel" aria-labelledby="settings-title" hidden>
            <ModalCard
                class="settings-panel__card"
                heading="Settings"
                headingId="settings-title"
                closeId="settings-close"
                closeLabel="Close settings"
                actions={
                    <Button id="settings-dismiss" type="button" data-modal-close>
                        Close
                    </Button>
                }
            >
                {children}
                <SettingsGroup label="Display">
                    <label class="settings-panel__fps-choice">
                        <Checkbox id="show-fps" class="settings-panel__fps-checkbox" />
                        Show FPS
                    </label>
                </SettingsGroup>
            </ModalCard>
        </Modal>
    );
}
