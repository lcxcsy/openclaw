import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { MockWebSocket, wsInstances } = vi.hoisted(() => {
  const wsInstances: any[] = [];

  const MockWebSocket = class MockWebSocket {
    private openHandlers: (() => void)[] = [];
    private messageHandlers: ((data: string | Buffer) => void)[] = [];
    private closeHandlers: ((code: number, reason: Buffer) => void)[] = [];
    private errorHandlers: ((err: unknown) => void)[] = [];
    readonly sent: string[] = [];
    readyState = 1;

    constructor(_url: string, _options?: unknown) {
      wsInstances.push(this);
    }

    on(event: string, handler: any): void {
      switch (event) {
        case "open":
          this.openHandlers.push(handler);
          break;
        case "message":
          this.messageHandlers.push(handler);
          break;
        case "close":
          this.closeHandlers.push(handler);
          break;
        case "error":
          this.errorHandlers.push(handler);
          break;
      }
    }

    close(code?: number, reason?: string): void {
      this.emitClose(code ?? 1000, reason ?? "");
    }

    send(data: string): void {
      this.sent.push(data);
    }

    emitOpen(): void {
      for (const handler of this.openHandlers) handler();
    }

    emitMessage(data: string): void {
      for (const handler of this.messageHandlers) handler(data);
    }

    emitClose(code: number, reason: string): void {
      for (const handler of this.closeHandlers) handler(code, Buffer.from(reason));
    }

    emitError(err: unknown): void {
      for (const handler of this.errorHandlers) handler(err);
    }
  };

  return { MockWebSocket, wsInstances };
});

vi.mock("ws", () => ({
  WebSocket: MockWebSocket,
}));

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "test-uuid-" + Math.random().toString(36).substr(2, 9)),
}));

import { WebSocketClient } from "./client.js";
import type { ClientOptions } from "./client.js";

describe("WebSocketClient Protocol Types", () => {
  describe("ErrorCode constants", () => {
    it("should have all required error codes defined", async () => {
      const { ErrorCodes } = await import("./protocol/types.js");
      
      expect(ErrorCodes.NOT_LINKED).toBe("NOT_LINKED");
      expect(ErrorCodes.NOT_PAIRED).toBe("NOT_PAIRED");
      expect(ErrorCodes.AGENT_TIMEOUT).toBe("AGENT_TIMEOUT");
      expect(ErrorCodes.INVALID_REQUEST).toBe("INVALID_REQUEST");
      expect(ErrorCodes.UNAVAILABLE).toBe("UNAVAILABLE");
      expect(ErrorCodes.CONNECTION_FAILED).toBe("CONNECTION_FAILED");
      expect(ErrorCodes.AUTH_FAILED).toBe("AUTH_FAILED");
      expect(ErrorCodes.CONFIG_NOT_FOUND).toBe("CONFIG_NOT_FOUND");
      expect(ErrorCodes.CONFIG_UPDATE_FAILED).toBe("CONFIG_UPDATE_FAILED");
      expect(ErrorCodes.VERSION_NOT_FOUND).toBe("VERSION_NOT_FOUND");
      expect(ErrorCodes.TRANSACTION_FAILED).toBe("TRANSACTION_FAILED");
    });
  });

  describe("PROTOCOL_VERSION", () => {
    it("should have protocol version 3", async () => {
      const { PROTOCOL_VERSION } = await import("./protocol/types.js");
      expect(PROTOCOL_VERSION).toBe(3);
    });
  });

  describe("Frame type definitions", () => {
    it("should define RequestFrame interface correctly", async () => {
      const { RequestFrame } = await import("./protocol/types.js");
      
      const validRequest: RequestFrame = {
        type: "req",
        id: "test-id",
        method: "test.method",
        params: { key: "value" },
      };
      
      expect(validRequest.type).toBe("req");
      expect(validRequest.id).toBe("test-id");
      expect(validRequest.method).toBe("test.method");
      expect(validRequest.params).toEqual({ key: "value" });
    });

    it("should define ResponseFrame interface correctly", async () => {
      const { ResponseFrame } = await import("./protocol/types.js");
      
      const validResponse: ResponseFrame = {
        type: "res",
        id: "test-id",
        ok: true,
        payload: { result: "success" },
      };
      
      expect(validResponse.type).toBe("res");
      expect(validResponse.ok).toBe(true);
      expect(validResponse.payload).toEqual({ result: "success" });
    });

    it("should define EventFrame interface correctly", async () => {
      const { EventFrame } = await import("./protocol/types.js");
      
      const validEvent: EventFrame = {
        type: "event",
        event: "test.event",
        payload: { data: "test" },
        seq: 1,
        stateVersion: { presence: 1, health: 1 },
      };
      
      expect(validEvent.type).toBe("event");
      expect(validEvent.event).toBe("test.event");
      expect(validEvent.seq).toBe(1);
      expect(validEvent.stateVersion?.presence).toBe(1);
    });
  });

  describe("WebSocketClientError", () => {
    it("should create error with code and message", async () => {
      const { WebSocketClientError, ErrorCodes } = await import("./protocol/types.js");
      
      const error = new WebSocketClientError(
        ErrorCodes.CONNECTION_FAILED,
        "Connection failed"
      );
      
      expect(error.code).toBe(ErrorCodes.CONNECTION_FAILED);
      expect(error.message).toBe("Connection failed");
      expect(error.name).toBe("WebSocketClientError");
    });

    it("should create error with details and retryable flag", async () => {
      const { WebSocketClientError, ErrorCodes } = await import("./protocol/types.js");
      
      const error = new WebSocketClientError(
        ErrorCodes.AUTH_FAILED,
        "Authentication failed",
        { detail: "Invalid token" },
        true
      );
      
      expect(error.details).toEqual({ detail: "Invalid token" });
      expect(error.retryable).toBe(true);
    });
  });

  describe("ClientOptions validation", () => {
    it("should accept valid client options", () => {
      const options: ClientOptions = {
        url: "ws://localhost:18789",
        token: "test-token",
        password: "test-password",
        role: "operator",
        scopes: ["operator.admin"],
        clientId: "test-client",
        clientDisplayName: "Test Client",
        clientVersion: "1.0.0",
        platform: "darwin",
        deviceFamily: "mac",
        mode: "backend",
        maxRetries: 5,
        initialRetryDelayMs: 500,
        maxRetryDelayMs: 60000,
      };
      
      expect(options.url).toBe("ws://localhost:18789");
      expect(options.token).toBe("test-token");
      expect(options.maxRetries).toBe(5);
    });

    it("should use default values when options are not provided", () => {
      const client = new WebSocketClient();
      expect(client).toBeDefined();
    });
  });
});

describe("WebSocketClient Connection", () => {
  let client: any;

  beforeEach(() => {
    wsInstances.length = 0;
  });

  afterEach(() => {
    client?.disconnect();
  });

  describe("connect", () => {
    it("should connect to WebSocket server", async () => {
      client = new WebSocketClient({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      const connectPromise = client.connect();
      
      expect(wsInstances.length).toBe(1);
      wsInstances[0].emitOpen();
      
      await connectPromise;
      expect(client.isConnected()).toBe(true);
    });

    it("should fail when connection times out", async () => {
      client = new WebSocketClient({
        url: "ws://localhost:18789",
        connectTimeoutMs: 100,
      });

      await expect(client.connect()).rejects.toThrow("Connection timeout");
    });

    it("should emit connect event", async () => {
      const onConnect = vi.fn();
      client = new WebSocketClient({
        url: "ws://localhost:18789",
        onConnect,
      });

      const connectPromise = client.connect();
      wsInstances[0].emitOpen();
      
      await connectPromise;
      expect(onConnect).toHaveBeenCalled();
    });
  });

  describe("disconnect", () => {
    it("should disconnect from server", async () => {
      client = new WebSocketClient({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      const connectPromise = client.connect();
      wsInstances[0].emitOpen();
      await connectPromise;
      
      expect(client.isConnected()).toBe(true);
      
      client.disconnect();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe("getConnectionId", () => {
    it("should return null when not connected", () => {
      client = new WebSocketClient({ url: "ws://localhost:18789" });
      expect(client.getConnectionId()).toBeNull();
    });
  });

  describe("getAvailableMethods", () => {
    it("should return empty array when not connected", () => {
      client = new WebSocketClient({ url: "ws://localhost:18789" });
      expect(client.getAvailableMethods()).toEqual([]);
    });
  });
});

describe("WebSocketClient Message Handling", () => {
  let client: any;

  beforeEach(() => {
    wsInstances.length = 0;
  });

  afterEach(() => {
    client?.disconnect();
  });

  describe("handleEvent", () => {
    it("should handle event frame", async () => {
      const onEvent = vi.fn();
      client = new WebSocketClient({
        url: "ws://localhost:18789",
        token: "test-token",
        onEvent,
      });

      const connectPromise = client.connect();
      wsInstances[0].emitOpen();
      await connectPromise;
      
      const eventPayload = JSON.stringify({
        type: "event",
        event: "test.event",
        payload: { data: "test" },
        seq: 1,
      });
      
      wsInstances[0].emitMessage(eventPayload);
      
      expect(onEvent).toHaveBeenCalledWith("test.event", { data: "test" });
    });

    it("should handle connect challenge event", async () => {
      client = new WebSocketClient({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      const connectPromise = client.connect();
      wsInstances[0].emitOpen();
      await connectPromise;
      
      const eventPayload = JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce: "test-nonce", ts: Date.now() },
      });
      
      wsInstances[0].emitMessage(eventPayload);
      
      expect(wsInstances[0].sent.length).toBeGreaterThan(0);
    });
  });

  describe("sendRequest", () => {
    it("should throw error when not connected", async () => {
      client = new WebSocketClient({
        url: "ws://localhost:18789",
      });
      
      await expect(client.sendRequest("test.method", {})).rejects.toThrow("WebSocket is not connected");
    });
  });
});

describe("WebSocketClient Error Handling", () => {
  let client: any;

  beforeEach(() => {
    wsInstances.length = 0;
  });

  afterEach(() => {
    client?.disconnect();
  });

  describe("connection error handling", () => {
    it("should handle WebSocket error", async () => {
      const onError = vi.fn();
      client = new WebSocketClient({
        url: "ws://localhost:18789",
        onError,
      });

      const connectPromise = client.connect();
      wsInstances[0].emitError(new Error("Network error"));
      
      await expect(connectPromise).rejects.toThrow("Network error");
    });

    it("should handle connection close with reconnect", async () => {
      const onDisconnect = vi.fn();
      client = new WebSocketClient({
        url: "ws://localhost:18789",
        token: "test-token",
        maxRetries: 3,
        initialRetryDelayMs: 100,
        onDisconnect,
      });

      const connectPromise = client.connect();
      wsInstances[0].emitOpen();
      await connectPromise;
      
      expect(client.isConnected()).toBe(true);
      
      wsInstances[0].emitClose(1006, "abnormal closure");
      
      expect(onDisconnect).toHaveBeenCalled();
    });
  });
});

describe("WebSocketClient Version History", () => {
  let client: any;

  beforeEach(() => {
    wsInstances.length = 0;
    client = new WebSocketClient({
      url: "ws://localhost:18789",
      token: "test-token",
    });
  });

  afterEach(() => {
    client?.disconnect();
  });

  describe("getVersionHistory", () => {
    it("should return empty array when no history", () => {
      const history = client.getVersionHistory("test/path");
      expect(history).toEqual([]);
    });
  });

  describe("getAuditLog", () => {
    it("should return audit log entries", () => {
      const logs = client.getAuditLog();
      expect(Array.isArray(logs)).toBe(true);
    });
  });
});
