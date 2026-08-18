/**
 * Minimal MCP client over the "Streamable HTTP" transport (MCP spec 2025-03-26).
 *
 * Built specifically for the public Microsoft Learn MCP server
 * (https://learn.microsoft.com/api/mcp) — no auth required. Follows the
 * server's published "Building a Custom Client" guidance: tools are
 * discovered dynamically via tools/list rather than hardcoded, so this
 * keeps working if Microsoft changes tool names/schemas later.
 *
 * This is intentionally minimal: one request/response round trip per call,
 * no persistent server-push stream. That's sufficient for a search-then-answer
 * flow like this app's.
 */

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

const PROTOCOL_VERSION = "2025-03-26";

export class McpClient {
  private url: string;
  private sessionId: string | null = null;
  private nextId = 1;
  private initialized = false;

  constructor(url: string) {
    this.url = url;
  }

  private async post(body: unknown, expectResponse: boolean): Promise<JsonRpcResponse | null> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    if (!expectResponse) {
      // Notifications get no body back (202/204 typically).
      return null;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`MCP server returned ${res.status}: ${text.slice(0, 300)}`);
    }

    const contentType = res.headers.get("content-type") || "";
    const raw = await res.text();

    if (contentType.includes("application/json")) {
      return JSON.parse(raw) as JsonRpcResponse;
    }

    if (contentType.includes("text/event-stream")) {
      // Parse SSE: find the last "data: {...}" chunk, which carries the JSON-RPC message.
      const events = raw
        .split("\n\n")
        .map((chunk) =>
          chunk
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("")
        )
        .filter(Boolean);

      for (const evt of events.reverse()) {
        try {
          const parsed = JSON.parse(evt);
          if (parsed.jsonrpc === "2.0") return parsed as JsonRpcResponse;
        } catch {
          // skip non-JSON keepalive lines
        }
      }
      throw new Error("MCP server returned an SSE stream with no parseable JSON-RPC message.");
    }

    throw new Error(`Unexpected MCP response content-type: ${contentType || "(none)"}`);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const id = this.nextId++;
    const initRes = await this.post(
      {
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "d365-trainer", version: "1.0.0" },
        },
      },
      true
    );

    if (initRes?.error) {
      throw new Error(`MCP initialize failed: ${initRes.error.message}`);
    }

    // Required notification after initialize, per MCP handshake.
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, false);
    this.initialized = true;
  }

  async listTools(): Promise<McpTool[]> {
    await this.initialize();
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: "2.0", id, method: "tools/list", params: {} }, true);
    if (res?.error) throw new Error(`MCP tools/list failed: ${res.error.message}`);
    return (res?.result?.tools || []) as McpTool[];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    await this.initialize();
    const id = this.nextId++;
    const res = await this.post(
      { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } },
      true
    );
    if (res?.error) throw new Error(`MCP tools/call(${name}) failed: ${res.error.message}`);

    const content = res?.result?.content;
    if (!Array.isArray(content)) return "";

    // Tool results are an array of content blocks; join any text blocks.
    return content
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text)
      .join("\n");
  }
}
