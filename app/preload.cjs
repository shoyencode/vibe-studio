const { contextBridge, ipcRenderer, webUtils } = require("electron");

const channels = new Set(["vibe-studio:refresh", "vibe-studio:conversation", "vibe-studio:request", "vibe-studio:alert", "vibe-studio:goto", "vibe-studio:costs"]);

contextBridge.exposeInMainWorld("vibeStudio", {
    call: (route, input) => ipcRenderer.invoke("vibe-studio:call", route, input),
    importFiles: async files => {
        if (files.length > 10) throw new Error("10 files maximum");
        const items = [];
        for (const file of files) {
            if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name}: 25 MB maximum`);
            const filePath = webUtils.getPathForFile(file);
            items.push(filePath ? { path: filePath } : { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
        }
        return ipcRenderer.invoke("vibe-studio:files", items);
    },
    on: (channel, listener) => {
        if (!channels.has(channel)) return () => {};
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on(channel, handler);
        return () => ipcRenderer.removeListener(channel, handler);
    },
});
