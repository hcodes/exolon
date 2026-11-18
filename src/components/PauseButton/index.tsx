import classNames from 'classnames';
import type { JSX } from 'preact';
import { Button } from '../Button/index.tsx';
import './index.css';

export type PauseButtonVariant = 'default' | 'amiga';
export type PauseButtonProps = Omit<JSX.IntrinsicElements['button'], 'id'> & {
    variant?: PauseButtonVariant;
};

export function PauseButton({
    variant = 'default',
    class: className = '',
    children = 'Pause',
    ...props
}: PauseButtonProps) {
    return (
        <Button
            id="pause"
            type="button"
            variant="secondary"
            aria-pressed="false"
            disabled
            hidden
            {...props}
            class={classNames(
                'pause-button',
                { 'pause-button_amiga': variant === 'amiga' },
                className,
            )}
        >
            {children}
        </Button>
    );
}
