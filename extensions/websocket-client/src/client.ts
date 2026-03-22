import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  type AgentFile,
  type AgentSummary,
  type AuditLogEntry,
  type ConfigUpdateResult,
  type ConnectParams,
  type EventFrame,
  type HelloOk,
  type RequestFrame,
  type ResponseFrame,
  type TransactionResult,
  type VersionInfo,
  WebSocketClientError,
  ErrorCodes,
  PROTOCOL_VERSION,
} from "./protocol/types.js";

export interface ClientOptions {
  url?: string;
  token?: string;
  password?: string;
  deviceToken?: string;
  bootstrapToken?: string;
  role?: string;
  scopes?: string[];
  clientId?: string;
  clientDisplayName?: string;
  clientVersion?: string;
  platform?: string;
  deviceFamily?: string;
  mode?: string;
  instanceId?: string;
  connectTimeoutMs?: number;
  maxRetries?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  onConnect?: () => void;
  onDisconnect?: (code: number, reason: string) => void;
  onError?: (error: Error) => void;
  onEvent?: (event: string, payload: unknown) => void;
  onLog?: (entry: AuditLogEntry) => void;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const DEFAULT_OPTIONS = {
  url: "ws://127.0.0.1:18789",
  role: "operator",
  scopes: ["operator.admin"],
  clientId: "websocket-client",
  clientDisplayName: "WebSocket Client",
  clientVersion: "1.0.0",
  platform: process.platform,
  deviceFamily: "server",
  mode: "backend",
  connectTimeoutMs: 10000,
  maxRetries: 3,
  initialRetryDelayMs: 1000,
  maxRetryDelayMs: 30000,
};

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private opts: Required<ClientOptions>;
  private pendingRequests = new Map<string, PendingRequest>();
  private connected = false;
  private helloOk: HelloOk | null = null;
  private connId: string | null = null;
  private retryCount = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private lastEventSeq: number | null = null;
  private versionHistory = new Map<string, VersionInfo[]>();
  private transactionCache = new Map<string, { timestamp: number; results: ConfigUpdateResult[] }>();
  private auditLog: AuditLogEntry[] = [];

  constructor(options: ClientOptions = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...options } as Required<ClientOptions>;
  }

  async connect(): Promise<void> {
    if (this.connected || this.closed) {
      return;
    }

    return new Promise((resolve, reject) => {
      const url = this.opts.url;
      const timeout = this.opts.connectTimeoutMs;

      this.logAudit({
        timestamp: Date.now(),
        operation: "connect",
        target: url,
        result: "pending",
      });

      this.ws = new WebSocket(url, {
        handshakeTimeout: timeout,
      });

      this.connectTimer = setTimeout(() => {
        if (!this.connected) {
          this.ws?.close();
          reject(new WebSocketClientError(
            ErrorCodes.CONNECTION_FAILED,
            `Connection timeout after ${timeout}ms`
          ));
        }
      }, timeout);

      this.ws.on("open", () => {
        this.opts.onConnect?.();
      });

      this.ws.on("message", (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on("close", (code, reason) => {
        const reasonStr = reason.toString();
        this.connected = false;
        this.helloOk = null;
        this.opts.onDisconnect?.(code, reasonStr);

        this.logAudit({
          timestamp: Date.now(),
          operation: "disconnect",
          target: this.opts.url,
          result: code === 1000 ? "success" : "failure",
          details: { code, reason: reasonStr },
        });

        if (!this.closed) {
          this.scheduleReconnect();
        }
      });

      this.ws.on("error", (error) => {
        this.opts.onError?.(error);

        this.logAudit({
          timestamp: Date.now(),
          operation: "connect",
          target: this.opts.url,
          result: "failure",
          error: error.message,
        });

        if (!this.connected) {
          clearTimeout(this.connectTimer!);
          reject(new WebSocketClientError(
            ErrorCodes.CONNECTION_FAILED,
            error.message
          ));
        }
      });
    });
  }

  private handleMessage(data: string): void {
    try {
      const parsed = JSON.parse(data);

      if (parsed.type === "event") {
        const event = parsed as EventFrame;
        this.handleEvent(event);
        return;
      }

      if (parsed.type === "res") {
        const response = parsed as ResponseFrame;
        this.handleResponse(response);
        return;
      }
    } catch (error) {
      console.error("Failed to parse message:", error);
    }
  }

  private handleEvent(event: EventFrame): void {
    if (event.event === "connect.challenge") {
      this.sendConnect();
      return;
    }

    if (event.seq !== undefined) {
      this.lastEventSeq = event.seq;
    }

    this.opts.onEvent?.(event.event, event.payload);
  }

  private handleResponse(response: ResponseFrame): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(response.id);

    if (response.ok) {
      pending.resolve(response.payload);
    } else {
      const error = response.error || { code: "UNKNOWN", message: "Unknown error" };
      pending.reject(new WebSocketClientError(
        error.code as any,
        error.message,
        error.details,
        error.retryable
      ));
    }
  }

  private sendConnect(): void {
    const nonce = randomUUID();
    const params: ConnectParams = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: this.opts.clientId,
        displayName: this.opts.clientDisplayName,
        version: this.opts.clientVersion,
        platform: this.opts.platform,
        deviceFamily: this.opts.deviceFamily,
        mode: this.opts.mode,
        instanceId: this.opts.instanceId,
      },
      role: this.opts.role,
      scopes: this.opts.scopes,
      auth: {
        token: this.opts.token,
        password: this.opts.password,
        deviceToken: this.opts.deviceToken,
        bootstrapToken: this.opts.bootstrapToken,
      },
    };

    this.sendRequest("connect", params).then((payload) => {
      this.helloOk = payload as HelloOk;
      this.connId = this.helloOk.server.connId;
      this.connected = true;
      this.retryCount = 0;
      clearTimeout(this.connectTimer!);

      this.logAudit({
        timestamp: Date.now(),
        operation: "authenticate",
        target: this.opts.url,
        result: "success",
        operator: this.opts.role,
      });
    }).catch((error) => {
      this.connected = false;
      clearTimeout(this.connectTimer!);
      throw error;
    });
  }

  private async sendRequest(method: string, params?: unknown): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new WebSocketClientError(
        ErrorCodes.CONNECTION_FAILED,
        "WebSocket is not connected"
      );
    }

    const id = randomUUID();

    return new Promise((resolve, reject) => {
      const frame: RequestFrame = { type: "req", id, method, params };

      this.pendingRequests.set(id, { resolve, reject });

      this.ws!.send(JSON.stringify(frame));

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new WebSocketClientError(
            ErrorCodes.INVALID_REQUEST,
            `Request timeout: ${method}`
          ));
        }
      }, 30000);
    });
  }

  private scheduleReconnect(): void {
    if (this.closed || this.retryCount >= this.opts.maxRetries) {
      return;
    }

    const delay = Math.min(
      this.opts.initialRetryDelayMs * Math.pow(2, this.retryCount),
      this.opts.maxRetryDelayMs
    );

    this.retryCount++;

    this.opts.onLog?.({
      timestamp: Date.now(),
      operation: "reconnect",
      target: this.opts.url,
      result: "pending",
      details: { attempt: this.retryCount, delay },
    });

    this.retryTimer = setTimeout(() => {
      this.connect().catch((error) => {
        this.opts.onError?.(error);
      });
    }, delay);
  }

  private logAudit(entry: AuditLogEntry): void {
    this.auditLog.push(entry);
    this.opts.onLog?.(entry);
  }

  disconnect(): void {
    this.closed = true;
    this.retryCount = this.opts.maxRetries;

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }

    if (this.ws) {
      this.ws.close(1000, "Client disconnected");
    }

    this.pendingRequests.forEach(({ reject }) => {
      reject(new WebSocketClientError(
        ErrorCodes.CONNECTION_FAILED,
        "Connection closed"
      ));
    });
    this.pendingRequests.clear();

    this.logAudit({
      timestamp: Date.now(),
      operation: "disconnect",
      target: this.opts.url,
      result: "success",
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConnectionId(): string | null {
    return this.connId;
  }

  getAvailableMethods(): string[] {
    return this.helloOk?.features.methods || [];
  }

  getVersionHistory(path: string): VersionInfo[] {
    return this.versionHistory.get(path) || [];
  }

  getAuditLog(): AuditLogEntry[] {
    return [...this.auditLog];
  }

  async listAgents(): Promise<AgentSummary[]> {
    const payload = await this.sendRequest("agents.list", {}) as { agents: AgentSummary[] };
    return payload.agents;
  }

  async getAgentFile(agentId: string, filePath: string): Promise<AgentFile> {
    const result = await this.sendRequest("agents.files.get", {
      agentId,
      path: filePath,
    }) as AgentFile;

    return result;
  }

  async setAgentFile(
    agentId: string,
    filePath: string,
    content: string,
    options?: { transaction?: boolean; description?: string }
  ): Promise<ConfigUpdateResult> {
    const transactionId = options?.transaction ? randomUUID() : undefined;

    try {
      const result = await this.sendRequest("agents.files.set", {
        agentId,
        path: filePath,
        content,
        transactionId,
      }) as { success: boolean; version?: number; error?: string };

      const updateResult: ConfigUpdateResult = {
        success: result.success,
        path: filePath,
        version: result.version,
        error: result.error,
      };

      if (result.success) {
        const versionInfo: VersionInfo = {
          version: result.version || 1,
          timestamp: Date.now(),
          operation: options?.description ? "update" : "update",
          checksum: this.computeChecksum(content),
        };
        const history = this.versionHistory.get(filePath) || [];
        history.push(versionInfo);
        this.versionHistory.set(filePath, history);

        this.logAudit({
          timestamp: Date.now(),
          operation: "config.update",
          target: `${agentId}/${filePath}`,
          result: "success",
          details: { version: result.version, transactionId },
        });
      } else {
        this.logAudit({
          timestamp: Date.now(),
          operation: "config.update",
          target: `${agentId}/${filePath}`,
          result: "failure",
          error: result.error,
          details: { transactionId },
        });
      }

      return updateResult;
    } catch (error) {
      const errorResult: ConfigUpdateResult = {
        success: false,
        path: filePath,
        error: error instanceof Error ? error.message : String(error),
      };

      this.logAudit({
        timestamp: Date.now(),
        operation: "config.update",
        target: `${agentId}/${filePath}`,
        result: "failure",
        error: error instanceof Error ? error.message : String(error),
        details: { transactionId },
      });

      return errorResult;
    }
  }

  async updateConfigAtomic(
    updates: Array<{ agentId: string; filePath: string; content: string }>,
    description?: string
  ): Promise<TransactionResult> {
    const transactionId = randomUUID();
    const results: ConfigUpdateResult[] = [];
    let rolledBack = false;

    for (const update of updates) {
      const result = await this.setAgentFile(
        update.agentId,
        update.filePath,
        update.content,
        { transaction: true, description }
      );
      results.push(result);

      if (!result.success && !rolledBack) {
        rolledBack = true;
        for (const prevUpdate of results) {
          if (prevUpdate.success) {
            await this.revertConfig(prevUpdate.path);
          }
        }
      }
    }

    const transactionResult: TransactionResult = {
      transactionId,
      success: results.every((r) => r.success),
      results,
      rolledBack,
    };

    this.transactionCache.set(transactionId, {
      timestamp: Date.now(),
      results,
    });

    return transactionResult;
  }

  private async revertConfig(path: string): Promise<void> {
    const history = this.versionHistory.get(path);
    if (!history || history.length < 2) {
      return;
    }

    const previousVersion = history[history.length - 2];
    const currentContent = await this.getCurrentConfigContent(path);

    await this.setAgentFile("default", path, currentContent);
  }

  private async getCurrentConfigContent(path: string): Promise<string> {
    try {
      const file = await this.getAgentFile("default", path);
      return file.content;
    } catch {
      return "";
    }
  }

  private computeChecksum(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  async retryUpdate(
    updateFn: () => Promise<ConfigUpdateResult>,
    maxRetries: number = 3
  ): Promise<ConfigUpdateResult> {
    let lastError: ConfigUpdateResult | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const result = await updateFn();

      if (result.success) {
        return result;
      }

      if (!result.retryable) {
        return result;
      }

      lastError = result;

      if (attempt < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return lastError!;
  }

  async getVersion(path: string): Promise<number> {
    const history = this.versionHistory.get(path);
    if (!history || history.length === 0) {
      return 0;
    }
    return history[history.length - 1].version;
  }

  async rollback(path: string, targetVersion: number): Promise<ConfigUpdateResult> {
    const history = this.versionHistory.get(path);
    if (!history) {
      return {
        success: false,
        path,
        error: "No version history found",
      };
    }

    const targetEntry = history.find((v) => v.version === targetVersion);
    if (!targetEntry) {
      return {
        success: false,
        path,
        error: `Version ${targetVersion} not found`,
      };
    }

    try {
      const currentContent = await this.getCurrentConfigContent(path);

      const result = await this.setAgentFile("default", path, currentContent, {
        description: `rollback to version ${targetVersion}`,
      });

      if (result.success) {
        const versionInfo: VersionInfo = {
          version: result.version || targetVersion + 1,
          timestamp: Date.now(),
          operation: "rollback",
        };
        history.push(versionInfo);

        this.logAudit({
          timestamp: Date.now(),
          operation: "config.rollback",
          target: path,
          result: "success",
          details: { targetVersion, newVersion: result.version },
        });
      }

      return result;
    } catch (error) {
      return {
        success: false,
        path,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export default WebSocketClient;
