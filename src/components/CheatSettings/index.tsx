import { Checkbox } from '../Checkbox/index.tsx';
import { SettingsGroup } from '../SettingsGroup/index.tsx';
import './index.css';

export function CheatSettings() {
    return (
        <SettingsGroup label="CHEAT MODE">
            <div class="cheat-settings" id="cheat-settings">
                <div class="cheat-settings__content">
                    <p id="cheat-description" class="cheat-settings__description">
                        Changes apply immediately. High scores are saved locally.
                    </p>
                    <div class="cheat-settings__options">
                        <label class="cheat-settings__option">
                            <Checkbox
                                class="cheat-settings__checkbox"
                                disabled
                                data-cheat="infiniteLives"
                            />{' '}
                            Infinite lives
                        </label>
                        <label class="cheat-settings__option">
                            <Checkbox
                                class="cheat-settings__checkbox"
                                disabled
                                data-cheat="infiniteRockets"
                            />{' '}
                            Infinite rockets
                        </label>
                        <label class="cheat-settings__option">
                            <Checkbox
                                class="cheat-settings__checkbox"
                                disabled
                                data-cheat="infiniteAmmo"
                            />{' '}
                            Infinite ammo
                        </label>
                        <label class="cheat-settings__option">
                            <Checkbox
                                class="cheat-settings__checkbox"
                                disabled
                                data-cheat="invulnerable"
                            />{' '}
                            Invulnerability
                        </label>
                        <label class="cheat-settings__option">
                            <Checkbox
                                class="cheat-settings__checkbox"
                                disabled
                                data-cheat="levelSelection"
                            />{' '}
                            Show screen selection buttons
                        </label>
                        <label class="cheat-settings__option">
                            <Checkbox
                                class="cheat-settings__checkbox"
                                disabled
                                data-cheat="retryLevel"
                            />{' '}
                            Retry the current screen after Game Over
                        </label>
                    </div>
                </div>
            </div>
        </SettingsGroup>
    );
}
