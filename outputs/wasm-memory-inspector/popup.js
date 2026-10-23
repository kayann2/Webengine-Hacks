"use strict";

const elements = {
  statusDot: document.querySelector("#statusDot"),
  message: document.querySelector("#message"),
  overlay: document.querySelector("#overlay"),
  memory: document.querySelector("#memory"),
  type: document.querySelector("#type"),
  value: document.querySelector("#value"),
  scan: document.querySelector("#scan"),
  next: document.querySelector("#next"),
  reset: document.querySelector("#reset"),
  refresh: document.querySelector("#refresh"),
  count: document.querySelector("#count"),
  results: document.querySelector("#results")
};

let activeTabId;
let hasResults = false;

function setMessage(text, kind = "") {
  elements.message.textContent = text;
  elements.message.className = `message ${kind}`.trim();
}

function setBusy(busy) {
  elements.scan.disabled = busy || !elements.memory.value;
  elements.next.disabled = busy || !hasResults;
  elements.reset.disabled = busy || !hasResults;
  elements.refresh.disabled = busy || !hasResults;
}

async function call(action, payload = {}) {
  if (!activeTabId) throw new Error("Aba ativa não encontrada.");
  const response = await chrome.tabs.sendMessage(activeTabId, {
    target: "wasm-memory-inspector",
    action,
    payload
  });
  if (!response?.ok) throw new Error(response?.error || "Não foi possível comunicar com a página.");
  return response.data;
}

async function callAllFrames(action, payload = {}) {
  if (!activeTabId) throw new Error("Aba ativa não encontrada.");
  const frames = await chrome.webNavigation.getAllFrames({ tabId: activeTabId });
  const settled = await Promise.allSettled(frames.map(async ({ frameId }) => {
    const response = await chrome.tabs.sendMessage(activeTabId, {
      target: "wasm-memory-inspector",
      action,
      payload
    }, { frameId });
    if (!response?.ok) throw new Error(response?.error || "Quadro sem resposta.");
    return { frameId, data: response.data };
  }));
  return settled.filter((item) => item.status === "fulfilled").map((item) => item.value);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderResults(items, truncated = false) {
  hasResults = items.length > 0;
  elements.count.textContent = truncated ? `${items.length}+` : String(items.length);
  elements.results.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Nenhum endereço corresponde ao valor informado.";
    elements.results.append(empty);
  } else {
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "result";

      const address = document.createElement("span");
      address.className = "address";
      address.textContent = `0x${item.address.toString(16).toUpperCase().padStart(8, "0")}`;
      address.title = `Memória ${item.memoryId} · ${item.type}`;

      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.value = String(item.value);
      input.setAttribute("aria-label", `Valor no endereço ${address.textContent}`);

      const write = document.createElement("button");
      write.textContent = "↵";
      write.title = "Gravar valor";
      write.addEventListener("click", async () => {
        write.disabled = true;
        try {
          const result = await call("write", {
            memoryId: item.memoryId,
            address: item.address,
            type: item.type,
            value: input.value
          });
          input.value = String(result.value);
          setMessage(`Valor gravado em ${address.textContent}.`);
        } catch (error) {
          setMessage(error.message, "error");
        } finally {
          write.disabled = false;
        }
      });

      row.append(address, input, write);
      fragment.append(row);
    }
    elements.results.append(fragment);
  }
  setBusy(false);
}

async function perform(action) {
  const value = elements.value.value.trim();
  if (!value) {
    setMessage("Informe um valor para buscar.", "error");
    elements.value.focus();
    return;
  }
  setBusy(true);
  setMessage(action === "scan" ? "Varrendo a memória…" : "Filtrando resultados…");
  try {
    const payload = action === "scan"
      ? { memoryId: elements.memory.value, type: elements.type.value, value }
      : { value };
    const result = await call(action, payload);
    renderResults(result.results, result.truncated);
    setMessage(result.truncated
      ? "Mais de 5.000 resultados. Altere o valor e use Filtrar."
      : `${result.results.length} resultado(s) encontrado(s).`);
  } catch (error) {
    setMessage(error.message, "error");
    setBusy(false);
  }
}

elements.scan.addEventListener("click", () => perform("scan"));
elements.next.addEventListener("click", () => perform("nextScan"));
elements.overlay.addEventListener("click", async () => {
  try {
    const responses = await callAllFrames("toggleOverlay");
    const detected = responses.reduce((sum, item) => sum + (item.data.memories || 0), 0);
    if (!detected) {
      setMessage("Nenhuma memória detectada em nenhum quadro. O jogo pode estar usando Web Worker.", "error");
      return;
    }
    window.close();
  } catch (error) {
    setMessage("Não foi possível abrir o painel. Recarregue a página.", "error");
  }
});
elements.value.addEventListener("keydown", (event) => {
  if (event.key === "Enter") perform(hasResults ? "nextScan" : "scan");
});

elements.reset.addEventListener("click", async () => {
  setBusy(true);
  try {
    await call("reset");
    hasResults = false;
    elements.count.textContent = "0";
    elements.results.innerHTML = '<div class="empty">Os endereços encontrados aparecem aqui.</div>';
    setMessage("Busca limpa.");
  } catch (error) {
    setMessage(error.message, "error");
  }
  setBusy(false);
});

elements.refresh.addEventListener("click", async () => {
  setBusy(true);
  try {
    const result = await call("refresh");
    renderResults(result.results, false);
    setMessage("Valores atualizados.");
  } catch (error) {
    setMessage(error.message, "error");
    setBusy(false);
  }
});

(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || "")) {
      throw new Error("Abra uma página HTTP ou HTTPS para usar o inspetor.");
    }
    activeTabId = tab.id;
    const status = await call("status");
    elements.statusDot.className = "status-dot ok";

    if (!status.memories.length) {
      const frameStatuses = await callAllFrames("status");
      const detected = frameStatuses.reduce((sum, item) => sum + (item.data.memories?.length || 0), 0);
      setMessage(detected
        ? `${detected} memória(s) encontrada(s) no jogo. Use o painel móvel.`
        : "Nenhuma memória WASM detectada. Recarregue a página após instalar a extensão.");
      return;
    }

    elements.memory.replaceChildren();
    for (const memory of status.memories) {
      const option = document.createElement("option");
      option.value = String(memory.id);
      option.textContent = `${memory.label} · ${formatBytes(memory.bytes)}`;
      elements.memory.append(option);
    }
    elements.memory.disabled = false;
    elements.scan.disabled = false;
    setMessage(`${status.memories.length} memória(s) WASM detectada(s).`);
  } catch (error) {
    elements.statusDot.className = "status-dot error";
    setMessage(error.message || "Recarregue a página e tente novamente.", "error");
  }
})();
