(() => {
  "use strict";

  const CHANNEL = "wasm-memory-inspector-v1";
  const pending = new Map();
  let sequence = 0;
  let overlayHost = null;

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.channel !== CHANNEL || event.data?.direction !== "from-page") return;
    const entry = pending.get(event.data.requestId);
    if (!entry) return;
    pending.delete(event.data.requestId);
    clearTimeout(entry.timer);
    if (event.data.ok) entry.resolve(event.data.data);
    else entry.reject(new Error(event.data.error || "Falha na página."));
  });

  function callPage(action, payload) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${++sequence}`;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("A página não respondeu. Recarregue-a com a extensão ativada."));
      }, 10000);
      pending.set(requestId, { resolve, reject, timer });
      window.postMessage({ channel: CHANNEL, direction: "to-page", requestId, action, payload }, "*");
    });
  }

  function makeOverlay() {
    if (overlayHost) return overlayHost;
    overlayHost = document.createElement("div");
    overlayHost.id = "wasm-memory-inspector-overlay-host";
    overlayHost.style.cssText = "position:fixed;z-index:2147483647;top:16px;right:16px;width:330px;pointer-events:auto;";
    (document.fullscreenElement || document.documentElement).append(overlayHost);
    const frame = document.createElement("iframe");
    frame.title = "Webengine Hacks";
    frame.style.cssText = "width:100%;height:560px;border:0;display:block;border-radius:13px";
    overlayHost.append(frame);
    frame.contentDocument.body.style.margin = "0";
    const root = frame.contentDocument.body.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .box { overflow:hidden; border:1px solid #303946; border-radius:13px; background:#0d1218; color:#ecf2f7; box-shadow:0 16px 46px rgba(0,0,0,.46); font:12px Inter,system-ui,sans-serif; }
        .head { display:flex; align-items:center; gap:8px; min-height:42px; padding:8px 9px 8px 12px; background:#141b23; cursor:move; user-select:none; touch-action:none; }
        .grip { color:#43d8a3; font-weight:900; letter-spacing:-2px; }
        .title { flex:1; font-size:13px; font-weight:800; }
        .head button { width:28px; height:26px; padding:0; border:1px solid #34404e; border-radius:7px; background:#1c2530; color:#b9c4cf; cursor:pointer; }
        .body { padding:12px; }
        .message { min-height:17px; margin:0 0 9px; color:#93a1af; line-height:1.4; }
        .message.error { color:#ff8793; }
        label { display:block; margin:0 0 4px; color:#aab5c0; font-size:9px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
        select,input { width:100%; height:34px; padding:0 8px; border:1px solid #303b48; border-radius:8px; outline:none; background:#10171f; color:#edf3f7; font:12px system-ui,sans-serif; }
        select:focus,input:focus { border-color:#43d8a3; }
        .fields { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:9px; }
        .actions { display:grid; grid-template-columns:1.2fr 1fr auto; gap:6px; margin-top:10px; }
        .actions button,.refresh { height:33px; padding:0 9px; border:1px solid #34404e; border-radius:8px; background:#1a232d; color:#e6ecf1; font-size:11px; font-weight:750; cursor:pointer; }
        .actions .primary { border-color:#43d8a3; background:#43d8a3; color:#062119; }
        button:disabled { opacity:.4; cursor:not-allowed; }
        .summary { display:flex; justify-content:space-between; margin:12px 1px 6px; color:#b7c1cb; font-weight:750; }
        .results { max-height:180px; overflow:auto; border:1px solid #252f3a; border-radius:9px; background:#0a1016; }
        .empty { padding:22px 12px; color:#6f7c89; text-align:center; }
        .result { display:grid; grid-template-columns:96px 1fr 31px; gap:6px; align-items:center; padding:6px 7px; border-bottom:1px solid #212a34; }
        .result:last-child { border:0; }
        .addr { color:#43d8a3; font:10px Consolas,monospace; }
        .result input { height:29px; font:11px Consolas,monospace; }
        .result button { width:31px; height:29px; padding:0; border:1px solid #34404e; border-radius:7px; background:#1b2530; color:#fff; cursor:pointer; }
        .refresh { width:100%; margin-top:7px; background:transparent; color:#9aa7b3; }
        .positions { display:flex; gap:5px; align-items:center; margin-top:8px; color:#74818e; font-size:10px; }
        .positions span { margin-right:auto; }
        .positions button { width:25px; height:22px; padding:0; border:1px solid #2a3440; border-radius:6px; background:#121922; color:#8e9aa6; cursor:pointer; }
        .box.minimized .body { display:none; }
      </style>
      <section class="box">
        <div class="head">
          <span class="grip">⠿</span><span class="title">WASM Memory</span>
          <button class="min" title="Minimize">—</button><button class="close" title="Close">×</button>
        </div>
        <div class="body">
          <p class="message">Looking for Unity/WASM memory…</p>
          <label>Memória</label><select class="memory" disabled><option>Nenhuma memória</option></select>
          <div class="fields"><div><label>Tipo</label><select class="type"><option value="all">All / Todos</option><option value="integer">Integers / Inteiros</option><option value="float">Float</option></select></div><div><label>Valor</label><input class="value" type="text" inputmode="decimal" placeholder="Ex.: 100"></div></div>
          <div class="actions"><button class="scan primary" disabled>Nova busca</button><button class="next" disabled>Filtrar</button><button class="clear" disabled>Limpar</button></div>
          <div class="summary"><span>Resultados</span><span class="count">0</span></div>
          <div class="results"><div class="empty">Matching addresses appear here.</div></div>
          <button class="refresh" disabled>Atualizar valores</button>
          <div class="positions"><span>Arraste pelo topo ou alinhe:</span><button data-pos="tl" title="Superior esquerdo">↖</button><button data-pos="tr" title="Superior direito">↗</button><button data-pos="bl" title="Inferior esquerdo">↙</button><button data-pos="br" title="Inferior direito">↘</button></div>
        </div>
      </section>`;

    const q = (selector) => root.querySelector(selector);
    const ui = { box:q(".box"), head:q(".head"), message:q(".message"), memory:q(".memory"), type:q(".type"), value:q(".value"), scan:q(".scan"), next:q(".next"), clear:q(".clear"), count:q(".count"), results:q(".results"), refresh:q(".refresh") };
    let hasResults = false;
    let polling = false;
    const timer = setInterval(async () => {
      if (!overlayHost?.isConnected) { clearInterval(timer); return; }
      if (!hasResults || polling || ui.scan.disabled) return;
      polling = true;
      try {
        const result = await callPage("refresh");
        if (!ui.scan.disabled) {
          const inputs = ui.results.querySelectorAll("input");
          result.results.forEach((item, i) => {
            if (inputs[i] && root.activeElement !== inputs[i] && !inputs[i].dataset.dirty) inputs[i].value = String(item.value);
          });
        }
      } catch (_) { /* Retry on the next tick. */ } finally { polling = false; }
    }, 500);
    const lang = document.createElement("select");
    lang.style.cssText = "width:70px;height:28px";
    lang.innerHTML = '<option value="en">ENG</option><option value="pt">PT</option>';
    ui.head.insertBefore(lang, q(".min"));
    const labels = {
      ".scan":["First Scan","Primeira busca"], ".next":["Next Scan","Próxima busca"],
      ".clear":["Reset","Limpar"], ".refresh":["Refresh now","Atualizar agora"],
      ".positions span":["Drag the header or align:","Arraste pelo topo ou alinhe:"],
      ".summary span":["Results","Resultados"]
    };
    const localize = () => {
      const index = lang.value === "pt" ? 1 : 0;
      Object.entries(labels).forEach(([selector, texts]) => { q(selector).textContent = texts[index]; });
      root.querySelectorAll(".fields label, .body > label:not(:has(input))").forEach((el,i) => { el.textContent = (index ? ["Memória","Tipo","Valor"] : ["Memory","Type","Value"])[i]; });
    };
    lang.onchange = () => { localize(); chrome.storage.local.set({language:lang.value}); };
    chrome.storage.local.get("language").then(saved => { lang.value=saved.language === "pt"?"pt":"en"; localize(); });
    localize();

    const message = (text, error = false) => { ui.message.textContent = lang.value === "en" ? ({"Procurando memória Unity/WASM…":"Looking for Unity/WASM memory…","Nenhuma memória":"No memory","Os endereços aparecem aqui.":"Matching addresses appear here.","Nenhum endereço encontrado.":"No matching addresses.","Informe um valor para buscar.":"Enter a value to scan.","Varrendo memória…":"Scanning memory…","Filtrando…":"Next scan…","5.000+ resultados. Use Filtrar.":"5,000+ results. Use Next Scan.","Busca limpa.":"Scan reset.","Valores atualizados.":"Values refreshed.","Gravar":"Write","Minimizar":"Minimize","Fechar":"Close"}[text] || text.replace(" resultado(s)."," result(s).").replace(" memória(s) detectada(s)."," memory buffer(s) detected.").replace("Gravado em ","Written at ").replace("Nenhuma memória neste quadro. Se o jogo usa Web Worker, este build pode não ser acessível.","No memory found. Reload after the game loads; worker memory is not supported.")) : text; ui.message.className = `message${error ? " error" : ""}`; };
    const busy = (state) => { ui.scan.disabled = state || !ui.memory.value; ui.next.disabled = state || !hasResults; ui.clear.disabled = state || !hasResults; ui.refresh.disabled = state || !hasResults; };
    const render = (items, truncated = false) => {
      hasResults = items.length > 0;
      ui.count.textContent = truncated ? `${items.length}+` : String(items.length);
      ui.results.replaceChildren();
      if (!items.length) {
        const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "Nenhum endereço encontrado."; ui.results.append(empty);
      } else {
        for (const item of items) {
          const row = document.createElement("div"); row.className = "result";
          const addr = document.createElement("span"); addr.className = "addr"; addr.title=item.type; addr.textContent = `0x${item.address.toString(16).toUpperCase().padStart(8,"0")} · ${item.type}`;
          const input = document.createElement("input"); input.type = "text"; input.inputMode = "decimal"; input.step = "any"; input.value = String(item.value); input.oninput=()=>{input.dataset.dirty="1";};
          const write = document.createElement("button"); write.textContent = "↵"; write.title = "Gravar";
          write.onclick = async () => { write.disabled = true; try { const r = await callPage("write", { memoryId:item.memoryId,address:item.address,type:item.type,value:input.value }); input.value = String(r.value); delete input.dataset.dirty; message(`Gravado em ${addr.textContent}.`); } catch (e) { message(e.message,true); } finally { write.disabled = false; } };
          row.append(addr,input,write); ui.results.append(row);
        }
      }
      busy(false);
    };
    const perform = async (action) => {
      if (!ui.value.value.trim()) { message("Informe um valor para buscar.",true); return; }
      busy(true); message(action === "scan" ? "Varrendo memória…" : "Filtrando…");
      try { const payload = action === "scan" ? { memoryId:ui.memory.value,type:ui.type.value,value:ui.value.value } : { value:ui.value.value }; const r = await callPage(action,payload); render(r.results,r.truncated); message(r.truncated ? "5.000+ resultados. Use Filtrar." : `${r.results.length} resultado(s).`); } catch(e) { message(e.message,true); busy(false); }
    };
    ui.scan.onclick = () => perform("scan"); ui.next.onclick = () => perform("nextScan");
    ui.value.onkeydown = (e) => { if (e.key === "Enter") perform(hasResults ? "nextScan" : "scan"); };
    ui.clear.onclick = async () => { await callPage("reset"); hasResults=false; render([]); message("Busca limpa."); };
    ui.refresh.onclick = async () => { busy(true); try { const r=await callPage("refresh"); render(r.results); message("Valores atualizados."); } catch(e) { message(e.message,true); busy(false); } };
    q(".close").onclick = () => { overlayHost.remove(); overlayHost = null; };
    q(".min").onclick = () => { ui.box.classList.toggle("minimized"); frame.style.height = ui.box.classList.contains("minimized") ? "44px" : "560px"; };

    const clamp = (left,top) => ({ left:Math.max(0,Math.min(left,window.innerWidth-overlayHost.offsetWidth)), top:Math.max(0,Math.min(top,window.innerHeight-overlayHost.offsetHeight)) });
    const place = (left,top,save=true) => { const p=clamp(left,top); overlayHost.style.left=`${p.left}px`; overlayHost.style.top=`${p.top}px`; overlayHost.style.right="auto"; overlayHost.style.bottom="auto"; if(save) chrome.storage.local.set({ wasmInspectorPosition:p }); };
    let drag = null;
    ui.head.addEventListener("pointerdown", (e) => { if (e.target.closest("button,select")) return; const rect=overlayHost.getBoundingClientRect(); drag={x:e.clientX,y:e.clientY}; ui.head.setPointerCapture(e.pointerId); });
    ui.head.addEventListener("pointermove", (e) => { if(drag) place(overlayHost.getBoundingClientRect().left+e.clientX-drag.x,overlayHost.getBoundingClientRect().top+e.clientY-drag.y,false); });
    ui.head.addEventListener("pointerup", (e) => { if(!drag) return; drag=null; ui.head.releasePointerCapture(e.pointerId); const rect=overlayHost.getBoundingClientRect(); place(rect.left,rect.top,true); });
    root.querySelectorAll("[data-pos]").forEach((button) => button.onclick=()=>{ const gap=14; const x=button.dataset.pos.endsWith("r")?window.innerWidth-overlayHost.offsetWidth-gap:gap; const y=button.dataset.pos.startsWith("b")?window.innerHeight-overlayHost.offsetHeight-gap:gap; place(x,y,true); });

    (async () => {
      try {
        const status = await callPage("status");
        if (!status.memories.length) { message("Nenhuma memória neste quadro. Se o jogo usa Web Worker, este build pode não ser acessível.",true); return; }
        ui.memory.replaceChildren();
        for (const mem of status.memories) { const option=document.createElement("option"); option.value=String(mem.id); option.textContent=`${mem.label} · ${(mem.bytes/1048576).toFixed(1)} MB`; ui.memory.append(option); }
        ui.memory.disabled=false; ui.scan.disabled=false; message(`${status.memories.length} memória(s) detectada(s).`);
      } catch(e) { message(e.message,true); }
    })();
    chrome.storage.local.get("wasmInspectorPosition").then(({wasmInspectorPosition:p})=>{ if(p) place(p.left,p.top,false); });
    return overlayHost;
  }

  function mountOverlay() {
    try { makeOverlay(); }
    catch (error) {
      overlayHost?.remove();
      overlayHost = null;
      throw error;
    }
  }

  document.addEventListener("fullscreenchange", () => {
    if (!overlayHost) return;
    // Reparenting an iframe destroys its document and event handlers.
    overlayHost.remove();
    overlayHost = null;
    mountOverlay();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== "wasm-memory-inspector") return;
    if (message.action === "toggleOverlay") {
      callPage("status").then((status) => {
        mountOverlay();
        sendResponse({ ok: true, data: { memories: status.memories.length } });
      }).catch((error) => sendResponse({ ok:false,error:error.message }));
      return true;
    }
    callPage(message.action, message.payload || {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
