# Webengine Hacks

A Chrome / Edge extension for inspecting WebAssembly memory with a draggable in-page panel.

**Status: testing / experimental.** This program is still in the testing phase.
Bugs and compatibility issues may occur; features and behavior can change.

## Install or update
1. Extract the ZIP.
2. Open chrome://extensions (or edge://extensions).
3. Enable Developer mode and choose Load unpacked.
4. Select the extension folder. For an existing installation, replace the files and click Reload on the extension card.
5. Reload the game page, then click the extension icon. Select Open floating panel for the draggable view.

## Use
Drag the panel by its header or use the corner buttons. Minimize it with the dash button.
Choose ENG (default) or PT in the header; the preference is saved.
Choose a memory and numeric type, enter the current value, and select First Scan.
Change the value in the game, enter its new value, and choose Next Scan to narrow the candidates.
Edit a result and press its arrow button to write the value.
Values refresh every 500 milliseconds. Focused fields and unsaved edits are preserved.

## Implementation
- popup.js opens reliably from the toolbar and selects a frame with detected memory.
- page-hook.js captures WASM memory allocations and synchronous/asynchronous instances.
- bridge.js provides the panel, language selection, dragging, live reads and memory commands.
- The panel uses a separate iframe document to isolate text input from game keyboard listeners.
- The popup and floating panel are two views of one extension; install only outputs/Webengine-Hacks.

## Limits
Float searches match the decimal prefix you enter, without a tolerance setting.
Dot and comma are accepted. 124.5 matches 124.534531; 124.50 matches
124.509 but excludes 124.534531. Trailing zeros therefore matter.
A search for 124 includes floats from 124 up to (but excluding) 125.
Negative prefixes work the same way in magnitude. Integer types match exactly.
Float32 boundaries are converted to Float32 to account for binary representation.
All numeric types searches Int8/16/32, Uint8/16/32 and Float32/64 together.
Next Scan keeps the original memory/type/address candidates and compares their
current values against the newly entered prefix. It does not search new addresses.
This implements decimal-prefix behavior, not every Cheat Engine feature:
strings, byte patterns, 64-bit integers and pointer scans are not supported.

Only exposed or intercepted memory can be inspected; worker-only memory is not supported.
A first scan is aligned to the selected type and retains at most 5,000 matches.
Large scans can briefly block the page. Refresh intervals are best effort.
The panel moves within its game frame, not outside the browser window.
Use on applications you own or have permission to inspect.

## Validation
The local smoke test verifies memory capture, scanning and writes.
Actual Unity keyboard handling, dragging and live UI behavior require browser testing with the target build.
