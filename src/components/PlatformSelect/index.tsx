import { LAUNCH_CHOICES } from '../../utils/game-launch.ts';
import { Select } from '../Select/index.tsx';
import './index.css';

export function PlatformSelect({
    value,
    onChoose,
}: {
    value?: string;
    onChoose?: (mode: string) => void;
}) {
    return (
        <label class="platform-select">
            Version
            <Select
                id="graphics-mode"
                class="platform-select__control"
                aria-label="Version"
                value={value}
                onChange={onChoose ? (event) => onChoose(event.currentTarget.value) : undefined}
            >
                <option value="retro">ZX Spectrum</option>
                <option value="c64">Commodore 64</option>
                <option value="cpc">Amstrad CPC</option>
                <option value="sharp-mz800">Sharp MZ-800</option>
                {LAUNCH_CHOICES.filter(({ mode }) => mode === 'amiga' || mode === 'atari-st').map(
                    ({ mode, name }) => (
                        <option value={mode}>{name}</option>
                    ),
                )}
                <option value="gameboy">Game Boy</option>
                <option value="gameboy-color">Game Boy Color</option>
                <hr />
                <option value="remastered">Remastered</option>
                <hr />
                <option value="split">Split</option>
            </Select>
            <span
                id="platform-launch-status"
                class="platform-select__status"
                role="status"
                aria-live="polite"
                hidden
            />
        </label>
    );
}
