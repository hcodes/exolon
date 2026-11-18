import classNames from 'classnames';
import { versionAssetUrl } from '../../services/asset-url.ts';
import { LAUNCH_CHOICES } from '../../utils/game-launch.ts';
import './index.css';

export function PlatformPicker() {
    return (
        <section id="platform-picker" class="platform-picker" aria-labelledby="platform-heading">
            <header class="platform-picker__header">
                <canvas class="platform-picker__stars" aria-hidden="true" />
                <span class="platform-picker__flyby" aria-hidden="true">
                    <span class="platform-picker__ship-flight">
                        <img
                            class="platform-picker__ship-exhaust"
                            src={versionAssetUrl('assets/images/shared/pixel-ship-exhaust.svg')}
                            width={80}
                            height={12}
                            alt=""
                            draggable={false}
                        />
                        <span class="platform-picker__ship-engine-light" />
                        <img
                            class="platform-picker__ship"
                            src={versionAssetUrl('assets/images/shared/pixel-ship.svg')}
                            width={80}
                            height={12}
                            alt=""
                            draggable={false}
                        />
                        <span class="platform-picker__ship-beacon" />
                    </span>
                </span>
                <h1 id="platform-heading" class="platform-picker__heading">
                    EXOLONOMANIA
                </h1>
                <p class="platform-picker__description">Choose your platform</p>
            </header>
            <nav class="platform-picker__banners" aria-label="Choose platform and start music">
                {LAUNCH_CHOICES.map(({ mode, query, name, image }) => (
                    <a
                        key={mode}
                        class={classNames(
                            'platform-picker__banner',
                            `platform-picker__banner_${mode}`,
                            { 'platform-picker__banner_disabled': mode === 'vr' },
                        )}
                        data-platform={mode}
                        draggable={false}
                        href={
                            mode === 'vr'
                                ? undefined
                                : mode === 'amiga' || mode === 'atari-st'
                                  ? `?game=${mode}`
                                  : `?graphics=${query}`
                        }
                        aria-disabled="true"
                        role={mode === 'vr' ? 'link' : undefined}
                        tabIndex={mode === 'vr' ? -1 : undefined}
                        title={mode === 'vr' ? 'Checking VR support…' : undefined}
                        aria-label={`Choose ${name} and start music`}
                    >
                        <span class="platform-picker__artwork">
                            <img
                                class="platform-picker__image"
                                draggable={false}
                                src={versionAssetUrl(image)}
                                alt={`${name} loading screen`}
                                width={320}
                                height={240}
                            />
                        </span>
                        <span class="platform-picker__name">
                            <span class="platform-picker__mark" aria-hidden="true" />
                            {name}
                        </span>
                    </a>
                ))}
            </nav>
            <p id="platform-status" class="platform-picker__status" role="status">
                Loading platforms…
            </p>
        </section>
    );
}
