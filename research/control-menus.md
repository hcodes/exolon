# Original control menus

Checked against recovered source bytes and existing extracted graphics, 21.11.2026. No new historical assets were created or altered. Local recovered RAM is research input only; the browser executes TypeScript.

| Platform | Menu / definition / input evidence | Original choices and defaults |
| --- | --- | --- |
| ZX | ESL `exmenu7991.asm:menuLoop`, `menu_redefine_key.asm`, `menu_highlight_control.asm`, `utils_keys2.asm`, `utils_keys3.asm` | Start / Define / Keyboard / Interface 2 / Kempston. Keyboard; O P Q A M. |
| C64 | RAM menu $0846/$0878, definition $10FE, messages $12CB, highlight $135E, defaults $2067, scan/table $3949/$3971 | Start / Define / Keyboard / Joystick Port 1 / Joystick Port 2. Keyboard; O P Q A M. |
| CPC | RAM menu $0136/$0159, definition $02B4, message $0428, gameplay scan $0D20, getter $39F7, matrix $3A25 | Start / Define only. O P Q A Space. No independent keyboard/joystick selection. |
| Sharp Datelsoft | canonical unpacked RAM menu $6DA1/$6DDD, definition $6FAB, message $7095, keyboard buffer $708B, controls $7B72, highlight $6F90 → $3176 | Start / Define / Keyboard / Cursor / Joystick. Cursor (active_control $7B97 = 1). Keyboard O P Q A M. |

Source provenance is preserved in `src/assets/graphics/{zx-spectrum,c64,amstrad-cpc,sharp-mz800}/`. Sharp canonical unpacked input SHA-256 is `108ee5352b0eaf8c809f55c6624265e8c55b35a73534206a0d390f3ed322f78f`; a separate `datelsoft-ram.bin` research snapshot lacks support routines in $31xx and must not be used to infer them. ZX source attribution/licensing remains Raffaele Cecco / Sergey Erokhin, CC BY-SA 3.0; C64/CPC/Sharp attribution is unchanged in asset manifests.

All four definitions request LEFT, RIGHT, JUMP, DUCK, FIRE at x7, rows9/11/13/15/17, answers at x15. Heading x7,y6: `SELECT KEY FOR....`, C64 `SELECT KEYS FOR....`. They wait for key release, allow duplicate bindings, and select Keyboard where device choices exist. ZX selected control uses attribute $47 at x11 through24, row15+2*mode. C64 routine $135E changes the same fourteen cells to $1F; its final port digit lies outside that source highlight. Sharp highlights eight characters at x11, rows15/17/19 (VRAM $92CF/$954F/$97CF). CPC has no mode highlight. The original menu artwork already exists in the repository; previous runtime row filters were removed.

CPC getter $39F7 scans all ten matrix rows, including joystick directions/FIRE/FIRE2. It can redefine joystick inputs, but default scan $0D20 does not merge them automatically. Browser directional/FIRE gamepad definitions are an adaptation of that matrix capability, not an invented third menu option. Sharp Cursor routines $7B22/$330E use cursor keys and Space/Break; browser Space is supported, Escape remains navigation. Interface 2 browser digit mapping is 6 left,7 right,9 jump,8 duck,0 fire.

Amiga `resources.json.text.menu` credits Martin J. Bysh, Guido Henkel, G.P. Felix and J.D. Rogers, then `press fire to start`; Atari ST credits Martin J. Bysh, Gary P. Felix and J. Dave Rogers, then `PRESS FIRE TO START`. Neither recovered title menu contains device choices. Their original pages remain unchanged by this task, as requested. Invented Game Boy/Color use an explicitly adapted ZX control menu. Remastered uses a direct-start title without control selection, per the updated user requirement of 22.11.2026.

## Browser behavior (updated user requirement, 21.11.2026)

The user confirmed keeping original menu names. Runtime menus retain the original source tiles, device names, positions and highlights. The source facts above describe historical hardware; browser input remains the existing keyboard, touch/pointer buttons and standard Gamepad API, available together for every menu selection. Amiga/ST retain their original pages.

Define Keys changes keyboard bindings only on ZX/C64/CPC/Sharp, where the original menu supports it. Original action order, key-release waits, duplicate assignments and atomic completion are preserved. Standard gamepad bindings and touch buttons remain independent of the defined keyboard keys. The CPC original joystick-matrix capability is not exposed as browser gamepad redefinition. Selecting Interface2/Kempston/Cursor/Joystick does not replace browser keyboard keys or require a particular pad index. Gamepad API keeps automatic controller selection, haptics, release gating and disconnect pause; Joystick Port2 remains a historical menu label even with a single connected pad.

The source Sharp default Cursor highlight is retained, with the same current keyboard/gamepad/touch support as every other choice. Completed keyboard definitions survive device-menu choices and are scoped to the platform/application session. Split follows its left platform. Escape/TV Back, focus loss, overlays and graphics selection changes discard partial definitions.

Digits, Enter/Space/rebound FIRE, gamepad confirmation, row taps and footer Controls are browser conveniences. C64 retains the original fourteen-cell highlight. Original source assets and research captures remain unchanged. No electrical interface or CPU is emulated.

Tests: `tests/unit/control-menu.test.ts`, `tests/unit/gamepad.test.ts`, `tests/unit/canvas.test.ts`, `tests/browser/control-menu.ts`, `tests/browser/start-menu.ts`. Run `npm test`, then `npm run check:browser -- --control-menu-only`. Playwright checks browser engines and ES5 compatibility, not physical computers/TVs/iPods.

Original infinite-lives codes and their platform-specific confirmation behavior are restored separately from ordinary bindings; see [original cheat evidence](original-cheats.md). ZORBA is recognized after the final release on ZX/CPC/Sharp only, including the effective left Split platform.
