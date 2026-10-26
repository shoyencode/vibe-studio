const backgroundRoutes = new Set(["/projects", "/snapshot", "/conversation", "/app/logs", "/updates"]);

// Windows owns the animation; no estimated percentage or rendering loop is needed.
export class TaskbarActivity {
    constructor(window, platform = process.platform) {
        this.window = window;
        this.platform = platform;
        this.operations = 0;
        this.running = false;
        this.visible = false;
        this.timer = null;
    }
    begin(route) {
        if (this.disposed || backgroundRoutes.has(route)) return () => {};
        this.operations++;
        this.sync();
        let finished = false;
        return () => {
            if (finished || this.disposed) return;
            finished = true;
            this.operations--;
            this.sync();
        };
    }
    setRunning(running) { if (!this.disposed) { this.running = running; this.sync(); } }
    sync() {
        if (this.platform !== "win32") return;
        if (this.operations || this.running) {
            if (!this.visible && !this.timer) this.timer = setTimeout(() => {
                this.timer = null;
                const win = this.window();
                if (!win || win.isDestroyed()) return;
                win.setProgressBar(2, { mode: "indeterminate" });
                this.visible = true;
            }, 200);
        } else {
            clearTimeout(this.timer); this.timer = null;
            const win = this.window();
            if (this.visible && win && !win.isDestroyed()) win.setProgressBar(-1);
            this.visible = false;
        }
    }
    dispose() {
        this.operations = 0; this.running = false;
        this.sync();
        clearTimeout(this.timer); this.timer = null;
        this.disposed = true;
    }
}
