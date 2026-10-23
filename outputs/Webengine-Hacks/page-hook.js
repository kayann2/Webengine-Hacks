(() => {
  "use strict";

  if (window.__wasmMemoryInspectorInstalled) return;
  Object.defineProperty(window, "__wasmMemoryInspectorInstalled", {
    value: true,
    configurable: false,
    enumerable: false
  });

  const CHANNEL = "wasm-memory-inspector-v1";
  const NativeMemory = WebAssembly.Memory;
  const NativeInstance = WebAssembly.Instance;
  const memories = new Map();
  const known = new WeakMap();
  let nextMemoryId = 1;
  let scanResults = [];

  const typeInfo = {
    int8: { size: 1, getter: "getInt8", setter: "setInt8" },
    uint8: { size: 1, getter: "getUint8", setter: "setUint8" },
    int16: { size: 2, getter: "getInt16", setter: "setInt16" },
    uint16: { size: 2, getter: "getUint16", setter: "setUint16" },
    int32: { size: 4, getter: "getInt32", setter: "setInt32" },
    uint32: { size: 4, getter: "getUint32", setter: "setUint32" },
    float32: { size: 4, getter: "getFloat32", setter: "setFloat32" },
    float64: { size: 8, getter: "getFloat64", setter: "setFloat64" }
  };

  function registerMemory(memory, label = "WASM memory") {
    if (!(memory instanceof NativeMemory)) return;
    if (known.has(memory)) return;
    const id = nextMemoryId++;
    known.set(memory, id);
    memories.set(id, { id, label, memory });
  }

  function visit(value, label, seen = new WeakSet()) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return;
    if (seen.has(value)) return;
    seen.add(value);
    if (value instanceof NativeMemory) {
      registerMemory(value, label);
      return;
    }
    for (const key of Object.keys(value)) {
      try {
        visit(value[key], `${label}.${key}`, seen);
      } catch (_) {
        // Alguns objetos de host possuem getters que lançam exceções.
      }
    }
  }

  function captureResult(result, imports) {
    visit(imports, "import");
    const instance = result instanceof NativeInstance ? result : result?.instance;
    if (instance) visit(instance.exports, "export");
    return result;
  }

  // Unity pode alocar memória diretamente ou instanciar um módulo de forma
  // síncrona. Os proxies preservam o comportamento nativo e apenas registram
  // as referências criadas.
  try {
    WebAssembly.Memory = new Proxy(NativeMemory, {
      construct(target, args, newTarget) {
        const memory = Reflect.construct(target, args, newTarget === WebAssembly.Memory ? target : newTarget);
        registerMemory(memory, "allocated memory");
        return memory;
      }
    });
  } catch (_) {
    // Alguns navegadores podem tornar a propriedade somente leitura.
  }

  try {
    WebAssembly.Instance = new Proxy(NativeInstance, {
      construct(target, args, newTarget) {
        const instance = Reflect.construct(target, args, newTarget === WebAssembly.Instance ? target : newTarget);
        captureResult(instance, args[1]);
        return instance;
      }
    });
  } catch (_) {
    // O caminho assíncrono abaixo continua disponível.
  }

  const nativeInstantiate = WebAssembly.instantiate.bind(WebAssembly);
  WebAssembly.instantiate = async function (source, imports) {
    return captureResult(await nativeInstantiate(source, imports), imports);
  };

  if (typeof WebAssembly.instantiateStreaming === "function") {
    const nativeInstantiateStreaming = WebAssembly.instantiateStreaming.bind(WebAssembly);
    WebAssembly.instantiateStreaming = async function (source, imports) {
      return captureResult(await nativeInstantiateStreaming(source, imports), imports);
    };
  }

  function parseValue(raw, type) {
    const text = String(raw).trim().replace(",", ".");
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error("Enter a decimal number (dot or comma).");
    const value = Number(text);
    if (!Number.isFinite(value)) throw new Error("Informe um valor numérico válido.");
    if (!type.startsWith("float") && !Number.isInteger(value)) {
      throw new Error("O tipo selecionado exige um número inteiro.");
    }
    return value;
  }

  function matcher(raw, type) {
    const expected = parseValue(raw, "float64");
    if (!type.startsWith("float")) return actual => Number.isInteger(expected) && actual === expected;
    const text = String(raw).trim().replace(",", ".");
    const decimals = (text.split(".")[1] || "").length;
    const step = 10 ** -decimals;
    const magnitude = Math.abs(expected);
    const negative = text.startsWith("-");
    const convert = type === "float32" ? Math.fround : value => value;
    const lower = convert(magnitude);
    const upper = convert(magnitude + step);
    if (lower === upper) return actual => actual === convert(expected);
    return actual => Number.isFinite(actual) &&
      (negative ? actual <= 0 : actual >= 0) &&
      Math.abs(actual) >= lower && Math.abs(actual) < upper;
  }

  function read(record, address, type) {
    const info = typeInfo[type];
    if (!info) throw new Error("Tipo de dado inválido.");
    const view = new DataView(record.memory.buffer);
    if (address < 0 || address + info.size > view.byteLength) {
      throw new Error("Endereço fora da memória.");
    }
    return view[info.getter](address, true);
  }

  function listMemories() {
    return [...memories.values()].map(({ id, label, memory }) => ({
      id,
      label,
      bytes: memory.buffer.byteLength,
      pages: memory.buffer.byteLength / 65536
    }));
  }

  function initialScan(memoryId, type, rawValue) {
    const record = memories.get(Number(memoryId));
    if (!record) throw new Error("Memory not found. Reload the game.");
    const types = type === "all" ? Object.keys(typeInfo)
      : type === "integer" ? Object.keys(typeInfo).filter(key => !key.startsWith("float"))
      : type === "float" ? ["float32", "float64"]
      : [type];
    if (types.some(key => !typeInfo[key])) throw new Error("Invalid numeric type.");
    const checks = types.map(key => ({type:key, ...typeInfo[key], matches:matcher(rawValue,key)}));
    const view = new DataView(record.memory.buffer);
    const results = [];
    const MAX_RESULTS = 5000;
    // Walk addresses first so All Types does not fill the limit with only one type.
    outer: for (let address = 0; address < view.byteLength; address++) {
      for (const check of checks) {
        if (address % check.size || address + check.size > view.byteLength) continue;
        const value = view[check.getter](address,true);
        if (check.matches(value)) {
          results.push({memoryId:record.id,address,type:check.type,value});
          if (results.length >= MAX_RESULTS) break outer;
        }
      }
    }
    scanResults = results;
    return {results, truncated:results.length >= MAX_RESULTS};
  }

  function nextScan(rawValue) {
    if (!scanResults.length) throw new Error("Run First Scan first.");
    const checks = new Map();
    for (const item of scanResults) {
      if (!checks.has(item.type)) checks.set(item.type,matcher(rawValue,item.type));
    }
    scanResults = scanResults.filter(item => {
      try {
        item.value = read(memories.get(item.memoryId),item.address,item.type);
        return checks.get(item.type)(item.value);
      } catch (_) { return false; }
    });
    return {results:scanResults,truncated:false};
  }

  function refreshResults() {
    scanResults = scanResults.filter((item) => {
      try {
        item.value = read(memories.get(item.memoryId), item.address, item.type);
        return true;
      } catch (_) {
        return false;
      }
    });
    return { results: scanResults, truncated: false };
  }

  function writeValue(memoryId, address, type, rawValue) {
    const record = memories.get(Number(memoryId));
    if (!record) throw new Error("Memória não encontrada.");
    const info = typeInfo[type];
    if (!info) throw new Error("Tipo de dado inválido.");
    const value = parseValue(rawValue, type);
    const numericAddress = Number(address);
    const view = new DataView(record.memory.buffer);
    if (!Number.isInteger(numericAddress) || numericAddress < 0 || numericAddress + info.size > view.byteLength) {
      throw new Error("Endereço inválido ou fora da memória.");
    }
    view[info.setter](numericAddress, value, true);
    return { value: view[info.getter](numericAddress, true) };
  }

  async function handle(action, payload) {
    switch (action) {
      case "status": return { installed: true, memories: listMemories() };
      case "scan": return initialScan(payload.memoryId, payload.type, payload.value);
      case "nextScan": return nextScan(payload.value);
      case "refresh": return refreshResults();
      case "reset": scanResults = []; return { results: [] };
      case "write": return writeValue(payload.memoryId, payload.address, payload.type, payload.value);
      default: throw new Error("Comando desconhecido.");
    }
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.data?.channel !== CHANNEL || event.data?.direction !== "to-page") return;
    const { requestId, action, payload = {} } = event.data;
    try {
      const data = await handle(action, payload);
      window.postMessage({ channel: CHANNEL, direction: "from-page", requestId, ok: true, data }, "*");
    } catch (error) {
      window.postMessage({
        channel: CHANNEL,
        direction: "from-page",
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }, "*");
    }
  });
})();
