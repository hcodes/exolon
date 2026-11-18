import classNames from 'classnames';
import type { JSX } from 'preact';
import './index.css';

export type InputProps = JSX.IntrinsicElements['input'];

export function Input({ class: className = '', ...props }: InputProps) {
    return <input {...props} class={classNames('input', className)} />;
}
