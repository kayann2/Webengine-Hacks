# Webengine Hacks

A Chrome / Edge extension for inspecting WebAssembly memory with a draggable in-page panel.

## Install or update
1. Extract the ZIP.
2. Open chrome://extensions (or edge://extensions).
3. Enable Developer mode and choose Load unpacked.
4. Select the extension folder. For an existing installation, replace the files and click Reload on the extension card.
5. Reload the game page, then click the extension icon.

## Use
Drag the panel by its header or use the corner buttons. Minimize it with the dash button.
Choose ENG (default) or PT in the header; the preference is saved.
Choose a memory and numeric type, enter the current value, and select First Scan.
Change the value in the game, enter its new value, and choose Next Scan to narrow the candidates.
Edit a result and press its arrow button to write the value.
Values refresh every 500 milliseconds. Focused fields and unsaved edits are preserved.

## Implementation
- background.js selects a frame with detected memory and opens its panel.
- page-hook.js captures WASM memory allocations and synchronous/asynchronous instances.
- bridge.js provides the panel, language selection, dragging, live reads and memory commands.
- The panel uses a separate iframe document to isolate text input from game keyboard listeners.
- Legacy popup files remain in the package but are no longer the action entry point.

## Limits
Only exposed or intercepted memory can be inspected; worker-only memory is not supported.
A first scan is aligned to the selected type and retains at most 5,000 matches.
Large scans can briefly block the page. Refresh intervals are best effort.
The panel moves within its game frame, not outside the browser window.
Use on applications you own or have permission to inspect.

## Validation
The local smoke test verifies memory capture, scanning and writes.
Actual Unity keyboard handling, dragging and live UI behavior require browser testing with the target build.
