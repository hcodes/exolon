import classNames from 'classnames';
import type { ComponentChildren } from 'preact';
import './index.css';

export function SettingsGroup({
    label,
    alignEnd = false,
    children,
}: {
    label: string;
    alignEnd?: boolean;
    children: ComponentChildren;
}) {
    return (
        <fieldset class={classNames('settings-group', { 'settings-group_end': alignEnd })}>
            <legend class="settings-group__legend">{label}</legend>
            <div class="settings-group__body">{children}</div>
        </fieldset>
    );
}
