import classNames from 'classnames';
import type { JSX } from 'preact';
import './index.css';

type ButtonProps = JSX.IntrinsicElements['button'] & { variant?: 'primary' | 'secondary' };

export function Button({ variant = 'primary', class: className = '', ...props }: ButtonProps) {
    return <button {...props} class={classNames('button', `button_${variant}`, className)} />;
}
