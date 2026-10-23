const fs = require("fs");
const vm = require("vm");

const listeners = [];
global.window = {
  addEventListener(type, callback) {
    if (type === "message") listeners.push(callback);
  },
  postMessage(data) {
    for (const callback of listeners) callback({ source: window, data });
  }
};

vm.runInThisContext(fs.readFileSync("outputs/wasm-memory-inspector/page-hook.js", "utf8"));

function request(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const requestId = `test-${Math.random()}`;
    const callback = (event) => {
      if (event.data?.direction !== "from-page" || event.data?.requestId !== requestId) return;
      event.data.ok ? resolve(event.data.data) : reject(new Error(event.data.error));
    };
    listeners.push(callback);
    window.postMessage({
      channel: "wasm-memory-inspector-v1",
      direction: "to-page",
      requestId,
      action,
      payload
    });
  });
}

(async () => {
  const bytes = Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x05, 0x03, 0x01, 0x00, 0x01,
    0x07, 0x0a, 0x01, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00
  ]);
  const { instance } = await WebAssembly.instantiate(bytes);
  new DataView(instance.exports.memory.buffer).setInt32(128, 123456, true);

  const status = await request("status");
  if (status.memories.length !== 1) throw new Error("Memory capture failed");

  const scan = await request("scan", { memoryId: 1, type: "int32", value: 123456 });
  if (!scan.results.some((item) => item.address === 128)) throw new Error("Scan failed");

  await request("write", { memoryId: 1, address: 128, type: "int32", value: 654321 });
  if (new DataView(instance.exports.memory.buffer).getInt32(128, true) !== 654321) {
    throw new Error("Write failed");
  }

  console.log("Smoke test passed: capture, scan and write are working.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
