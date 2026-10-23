chrome.action.onClicked.addListener(async tab => {
  const frames = await chrome.webNavigation.getAllFrames({tabId:tab.id}) || [];
  const statuses = await Promise.all(frames.map(async ({frameId}) => {
    try {
      const r = await chrome.tabs.sendMessage(tab.id, {target:"wasm-memory-inspector",action:"status"}, {frameId});
      return r?.ok && r.data.memories.length ? frameId : null;
    } catch { return null; }
  }));
  const target = statuses.find(id => id !== null) ?? 0;
  await chrome.tabs.sendMessage(tab.id, {target:"wasm-memory-inspector",action:"toggleOverlay"}, {frameId:target}).catch(() => {});
});
