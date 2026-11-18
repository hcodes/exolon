import globals from 'globals';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
    { ignores: ['dist/**', '.cache/**', 'originals/**'] },
    { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    { files: ['src/entries/boot.ts'], rules: { 'no-var': 'off' } },
    {
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
];
