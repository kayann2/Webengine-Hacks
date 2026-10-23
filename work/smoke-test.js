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

vm.runInThisContext(fs.readFileSync("outputs/Webengine-Hacks/page-hook.js", "utf8"));

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

  const assert = require("assert/strict");
  const view = new DataView(instance.exports.memory.buffer);
  for (const [type,setter,address] of [["float32","setFloat32",256],["float64","setFloat64",512]]) {
    view[setter](address,124.5345314123,true);
    let result = await request("scan",{memoryId:1,type,value:"124,5"});
    assert(result.results.some(x=>x.address===address));
    view[setter](address,112.3456,true);
    await assert.rejects(request("nextScan",{value:"invalid"}));
    result = await request("nextScan",{value:"112.3"});
    assert(result.results.some(x=>x.address===address),type+" must keep original address");
    view[setter](address,124.5345,true);
    result = await request("scan",{memoryId:1,type,value:"124.50"});
    assert(!result.results.some(x=>x.address===address));
    view[setter](address,124.509,true);
    result = await request("scan",{memoryId:1,type,value:"124.50"});
    assert(result.results.some(x=>x.address===address));
    view[setter](address,124.51,true);
    result = await request("scan",{memoryId:1,type,value:"124.50"});
    assert(!result.results.some(x=>x.address===address),"Upper boundary excluded");
    view[setter](address,-124.5345,true);
    result = await request("scan",{memoryId:1,type,value:"-124,5"});
    assert(result.results.some(x=>x.address===address));
    view[setter](address,112.3,true);
    result = await request("scan",{memoryId:1,type,value:"112.3"});
    assert(result.results.some(x=>x.address===address),"Float32 representation boundary");
  }
  view.setInt32(1024,124,true); view.setFloat32(2048,124.5345,true);
  let result = await request("scan",{memoryId:1,type:"all",value:"124"});
  assert(result.results.some(x=>x.address===1024 && x.type==="int32"));
  assert(result.results.some(x=>x.address===2048 && x.type==="float32"));
  view.setFloat32(2048,112.345,true);
  result=await request("nextScan",{value:"112,3"});
  assert(result.results.some(x=>x.address===2048 && x.type==="float32"));
  assert(!result.results.some(x=>x.type==="int32"));
  view.setFloat32(2048,124.5345,true);
  view.setFloat64(4096,124.5789,true);
  result = await request("scan",{memoryId:1,type:"float",value:"124,5"});
  assert(result.results.some(x=>x.address===2048 && x.type==="float32"));
  assert(result.results.some(x=>x.address===4096 && x.type==="float64"));
  assert(result.results.every(x=>x.type.startsWith("float")));
  view.setFloat32(2048,112.345,true);
  view.setFloat64(4096,112.378,true);
  result = await request("nextScan",{value:"112.3"});
  assert(result.results.some(x=>x.address===2048));
  assert(result.results.some(x=>x.address===4096));
  result = await request("scan",{memoryId:1,type:"integer",value:"124"});
  assert(result.results.some(x=>x.address===1024 && x.type==="int32"));
  assert(result.results.every(x=>!x.type.startsWith("float")));
  console.log("Passed: prefix scans, grouped Integer/Float searches and Next Scan tracking.");

})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
