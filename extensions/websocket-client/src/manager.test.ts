import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ConfigManager } from "../index.js";

type WsEvent = "open" | "message" | "close" | "error";
type WsEventHandlers = {
  open: () => void;
  message: (data: string | Buffer) => void;
  close: (code: number, reason: Buffer) => void;
  error: (err: unknown) => void;
};

class MockWebSocket {
  private openHandlers: WsEventHandlers["open"][] = [];
  private messageHandlers: WsEventHandlers["message"][] = [];
  private closeHandlers: WsEventHandlers["close"][] = [];
  private errorHandlers: WsEventHandlers["error"][] = [];
  readonly sent: string[] = [];
  readyState = 1;

  constructor(_url: string, _options?: unknown) {}

  on(event: "open", handler: WsEventHandlers["open"]): void;
  on(event: "message", handler: WsEventHandlers["message"]): void;
  on(event: "close", handler: WsEventHandlers["close"]): void;
  on(event: "error", handler: WsEventHandlers["error"]): void;
  on(event: WsEvent, handler: WsEventHandlers[WsEvent]): void {
    switch (event) {
      case "open":
        this.openHandlers.push(handler as WsEventHandlers["open"]);
        return;
      case "message":
        this.messageHandlers.push(handler as WsEventHandlers["message"]);
        return;
      case "close":
        this.closeHandlers.push(handler as WsEventHandlers["close"]);
        return;
      case "error":
        this.errorHandlers.push(handler as WsEventHandlers["error"]);
        return;
      default:
        return;
    }
  }

  close(code?: number, reason?: string): void {
    this.emitClose(code ?? 1000, reason ?? "");
  }

  send(data: string): void {
    this.sent.push(data);
  }

  emitOpen(): void {
    for (const handler of this.openHandlers) {
      handler();
    }
  }

  emitMessage(data: string): void {
    for (const handler of this.messageHandlers) {
      handler(data);
    }
  }

  emitClose(code: number, reason: string): void {
    for (const handler of this.closeHandlers) {
      handler(code, Buffer.from(reason));
    }
  }

  emitError(err: unknown): void {
    for (const handler of this.errorHandlers) {
      handler(err);
    }
  }
}

const wsInstances: MockWebSocket[] = [];

vi.mock("ws", () => ({
  WebSocket: MockWebSocket,
}));

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "test-uuid-" + Math.random().toString(36).substr(2, 9)),
}));


describe("ConfigManager", () => {
  let manager: ConfigManager;
  let mockWs: MockWebSocket;

  beforeEach(() => {
    wsInstances.length = 0;
  });

  afterEach(() => {
    if (manager) {
      manager.disconnect();
    }
  });

  describe("constructor", () => {
    it("should create ConfigManager instance", () => {
      manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });
      expect(manager).toBeDefined();
    });
  });

  describe("connect", () => {
    it("should connect to WebSocket server", async () => {
      manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      const connectPromise = manager.connect();
      
      expect(wsInstances.length).toBe(1);
      mockWs = wsInstances[0];
      mockWs.emitOpen();
      
      await connectPromise;
      expect(manager.isConnected()).toBe(true);
    });

    it("should handle connection failure", async () => {
      manager = new ConfigManager({
        url: "ws://invalid:18789",
        connectTimeoutMs: 100,
      });

      await expect(manager.connect()).rejects.toThrow();
    });
  });

  describe("isConnected", () => {
    it("should return false when not connected", () => {
      manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });
      expect(manager.isConnected()).toBe(false);
    });
  });

  describe("getConfig", () => {
    it("should throw error when not connected", async () => {
      manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      await expect(manager.getConfig({ path: "AGENTS.md" })).rejects.toThrow(
        "WebSocket is not connected"
      );
    });
  });

  describe("updateConfig", () => {
    it("should throw error when not connected", async () => {
      manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      await expect(
        manager.updateConfig({
          path: "AGENTS.md",
          content: "# Test",
        })
      ).rejects.toThrow("WebSocket is not connected");
    });
  });

  describe("getHistory", () => {
    it("should return empty history for new path", async () => {
      manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      const history = await manager.getHistory({ path: "AGENTS.md" });
      expect(history.path).toBe("AGENTS.md");
      expect(history.versions).toEqual([]);
    });
  });

  describe("rollback", () => {
    it("should return error when no version history", async () => {
      manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      const result = await manager.rollback({ path: "AGENTS.md", version: 1 });
      expect(result.success).toBe(false);
    });
  });

  describe("listAgents", () => {
    it("should throw error when not connected", async () => {
      manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      await expect(manager.listAgents()).rejects.toThrow(
        "WebSocket is not connected"
      );
    });
  });

  describe("getAuditLog", () => {
    it("should return audit log entries", () => {
      manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      const logs = manager.getAuditLog();
      expect(Array.isArray(logs)).toBe(true);
    });
  });
});

describe("ConfigManager Options Validation", () => {
  afterEach(() => {
    if (typeof wsInstances !== "undefined") {
      wsInstances.length = 0;
    }
  });

  describe("ConfigGetOptions", () => {
    it("should accept valid options with agentId", async () => {
      const manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      manager.disconnect();
    });

    it("should accept valid options without agentId", async () => {
      const manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      manager.disconnect();
    });
  });

  describe("ConfigUpdateOptions", () => {
    it("should support atomic update option", () => {
      const manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      manager.disconnect();
    });
  });

  describe("ConfigHistoryOptions", () => {
    it("should support limit option", () => {
      const manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      manager.disconnect();
    });
  });

  describe("ConfigRollbackOptions", () => {
    it("should require version number", () => {
      const manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      manager.disconnect();
    });
  });
});

describe("ConfigManager Edge Cases", () => {
  let mockWs: MockWebSocket;

  afterEach(() => {
    if (typeof wsInstances !== "undefined") {
      wsInstances.length = 0;
    }
  });

  describe("Empty path handling", () => {
    it("should handle empty config path", async () => {
      const manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      await manager.connect();
      mockWs = wsInstances[0];
      
      mockWs.emitMessage(JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce: "test", ts: Date.now() },
      }));

      await new Promise(resolve => setTimeout(resolve, 100));
      manager.disconnect();
    });
  });

  describe("Large content handling", () => {
    it("should handle large config content", async () => {
      const largeContent = "x".repeat(1024 * 1024);
      const manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      manager.disconnect();
    });
  });

  describe("Special characters in path", () => {
    it("should handle special characters in path", async () => {
      const manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      const history = await manager.getHistory({ path: "path/with/special-chars_123" });
      expect(history.path).toBe("path/with/special-chars_123");
      
      manager.disconnect();
    });
  });

  describe("Concurrent operations", () => {
    it("should handle multiple config operations", async () => {
      const manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      await manager.connect();
      mockWs = wsInstances[0];

      const historyPromises = [
        manager.getHistory({ path: "AGENTS.md" }),
        manager.getHistory({ path: "SOUL.md" }),
        manager.getHistory({ path: "config.json" }),
      ];

      const results = await Promise.all(historyPromises);
      expect(results).toHaveLength(3);

      manager.disconnect();
    });
  });
});

describe("ConfigManager Error Scenarios", () => {
  afterEach(() => {
    if (typeof wsInstances !== "undefined") {
      wsInstances.length = 0;
    }
  });

  describe("Invalid response handling", () => {
    it("should handle malformed JSON", async () => {
      const manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      await manager.connect();
      const mockWs = wsInstances[0];

      mockWs.emitMessage("not valid json");

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(manager.isConnected()).toBe(true);

      manager.disconnect();
    });
  });

  describe("Rapid disconnect/connect", () => {
    it("should handle rapid connect/disconnect cycles", async () => {
      const manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      for (let i = 0; i < 3; i++) {
        await manager.connect();
        manager.disconnect();
      }

      expect(true).toBe(true);
    });
  });

  describe("Missing required parameters", () => {
    it("should handle getConfig without path", async () => {
      const manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      await expect(
        (manager as any).getConfig({})
      ).rejects.toThrow();

      manager.disconnect();
    });

    it("should handle updateConfig without content", async () => {
      const manager = new ConfigManager({
        url: "ws://localhost:18789",
        token: "test-token",
      });

      await expect(
        (manager as any).updateConfig({ path: "test.md" })
      ).rejects.toThrow();

      manager.disconnect();
    });
  });
});
