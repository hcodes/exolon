import '../compat/legacy-polyfills.ts';
import '../index.css';
import { installLegacyLayout } from '../compat/legacy-runtime.ts';
import { installLegacyBridge } from '../compat/legacy-bridge.ts';
import { mountGame } from '../controllers/bootstrap.tsx';

installLegacyBridge();
mountGame({ onMount: () => installLegacyLayout(window) });
