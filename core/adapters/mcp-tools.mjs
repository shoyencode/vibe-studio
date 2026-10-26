// Loopback MCP server of Vibe Studio: exposes Vibe Studio tools (vibe_studio_report, ask_user...) to a runtime that only
// accepts tools through MCP. One HTTP server per process, on 127.0.0.1 and a random port; each session gets its own
// secret path, and every request must carry the bearer token of the server. Nothing is reachable from the network.
import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

const BODY_LIMIT = 4 * 1024 * 1024;

const same = (a, b) => {
    const left = Buffer.from(String(a)), right = Buffer.from(String(b));
    return left.length === right.length && timingSafeEqual(left, right);
};

// Result of an Vibe Studio tool handler (text or { resultType: "failure", textResultForLlm }) as an MCP tool result.
export function toMcpResult(result) {
    if (result && typeof result === "object" && result.resultType === "failure") {
        return { content: [{ type: "text", text: String(result.textResultForLlm ?? "The tool failed.") }], isError: true };
    }
    const text = typeof result === "string" ? result : result === undefined ? "" : JSON.stringify(result);
    return { content: [{ type: "text", text }] };
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", chunk => {
            size += chunk.length;
            if (size > BODY_LIMIT) { reject(Object.assign(new Error("Request too large."), { status: 413 })); req.destroy(); return; }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

export class LoopbackTools {
    constructor({ name = "vibe_studio", version = "1.0.0", host = "127.0.0.1" } = {}) {
        this.name = name; this.version = version; this.host = host;
        this.token = randomBytes(32).toString("hex");
        this.routes = new Map();
        this.server = null; this.port = null; this.listening = null;
    }
    async start() {
        this.listening ??= new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => { void this.handle(req, res); });
            server.on("error", reject);
            server.listen(0, this.host, () => {
                this.server = server; this.port = server.address().port;
                server.unref();
                resolve();
            });
        }).catch(error => { this.listening = null; throw error; });
        await this.listening;
        return { port: this.port };
    }
    /**
     * Opens a route for one session. tools: [{ name, description, parameters, handler(input, { sessionId, toolName }) }].
     * The session id is often known only after the route is given to the runtime: set registration.sessionId later.
     */
    async register(tools, { sessionId = null } = {}) {
        await this.start();
        const secret = randomBytes(24).toString("hex");
        const registration = {
            name: this.name, sessionId, tools: new Map(tools.map(tool => [tool.name, tool])),
            url: `http://${this.host}:${this.port}/mcp/${secret}`,
            headers: { Authorization: `Bearer ${this.token}` },
            close: () => { this.routes.delete(secret); },
        };
        this.routes.set(secret, registration);
        return registration;
    }
    // MCP server entry of ACP session/new for a registration.
    static acpServer(registration) {
        return { type: "http", name: registration.name, url: registration.url,
            headers: Object.entries(registration.headers).map(([name, value]) => ({ name, value })) };
    }
    async handle(req, res) {
        const reply = (status, text, headers = {}) => {
            if (res.headersSent) return;
            res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...headers });
            res.end(text);
        };
        try {
            const match = /^\/mcp\/([a-f0-9]{48})\/?$/.exec(new URL(req.url, "http://localhost").pathname);
            const registration = match && this.routes.get(match[1]);
            const auth = String(req.headers.authorization || "");
            if (!registration || !same(auth, `Bearer ${this.token}`)) return reply(404, "Not found.");
            if (req.method !== "POST") return reply(405, "Method not allowed.", { Allow: "POST" });
            const raw = await readBody(req);
            let body;
            try { body = JSON.parse(raw); } catch { return reply(400, "Invalid JSON."); }
            const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
            const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
            const { ListToolsRequestSchema, CallToolRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
            // Stateless: a new MCP server per request, the route keeps the session.
            const server = new Server({ name: this.name, version: this.version }, { capabilities: { tools: {} } });
            server.setRequestHandler(ListToolsRequestSchema, async () => ({
                tools: [...registration.tools.values()].map(tool => ({
                    name: tool.name, description: tool.description || "",
                    inputSchema: tool.parameters && typeof tool.parameters === "object" ? tool.parameters : { type: "object", properties: {} },
                })),
            }));
            server.setRequestHandler(CallToolRequestSchema, async request => {
                const tool = registration.tools.get(request.params.name);
                if (!tool) return toMcpResult({ resultType: "failure", textResultForLlm: `Unknown tool: ${request.params.name}` });
                try {
                    return toMcpResult(await tool.handler(request.params.arguments || {}, { sessionId: registration.sessionId, toolName: tool.name }));
                } catch (error) {
                    return toMcpResult({ resultType: "failure", textResultForLlm: String(error?.message || error) });
                }
            });
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
            res.on("close", () => { void transport.close().catch(() => {}); void server.close().catch(() => {}); });
            await server.connect(transport);
            await transport.handleRequest(req, res, body);
        } catch (error) {
            reply(error?.status || 500, "Error.");
        }
    }
    async stop() {
        this.routes.clear();
        const server = this.server;
        this.server = null; this.port = null; this.listening = null;
        if (server) await new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); });
    }
}
