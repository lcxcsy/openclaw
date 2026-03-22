import { WebSocketClient, type ClientOptions } from "./client.js";

export interface ConfigGetOptions {
  agentId?: string;
  path: string;
}

export interface ConfigUpdateOptions {
  agentId?: string;
  path: string;
  content: string;
  atomic?: boolean;
}

export interface ConfigHistoryOptions {
  path: string;
  limit?: number;
}

export interface ConfigRollbackOptions {
  path: string;
  version: number;
}

export class ConfigManager {
  private client: WebSocketClient;

  constructor(options: ClientOptions) {
    this.client = new WebSocketClient(options);
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  disconnect(): void {
    this.client.disconnect();
  }

  isConnected(): boolean {
    return this.client.isConnected();
  }

  async getConfig(options: ConfigGetOptions): Promise<string> {
    const agentId = options.agentId || "default";
    const file = await this.client.getAgentFile(agentId, options.path);
    return file.content;
  }

  async updateConfig(options: ConfigUpdateOptions): Promise<{
    success: boolean;
    version?: number;
    error?: string;
  }> {
    const agentId = options.agentId || "default";

    if (options.atomic) {
      const result = await this.client.updateConfigAtomic([{
        agentId,
        filePath: options.path,
        content: options.content,
      }]);
      return {
        success: result.success,
        version: result.results[0]?.version,
        error: result.results[0]?.error,
      };
    }

    const result = await this.client.setAgentFile(agentId, options.path, options.content);
    return {
      success: result.success,
      version: result.version,
      error: result.error,
    };
  }

  async getHistory(options: ConfigHistoryOptions): Promise<{
    path: string;
    versions: Array<{
      version: number;
      timestamp: number;
      operation: string;
      checksum?: string;
    }>;
  }> {
    const history = this.client.getVersionHistory(options.path);
    const limit = options.limit || 10;
    return {
      path: options.path,
      versions: history.slice(-limit),
    };
  }

  async rollback(options: ConfigRollbackOptions): Promise<{
    success: boolean;
    version?: number;
    error?: string;
  }> {
    const result = await this.client.rollback(options.path, options.version);
    return {
      success: result.success,
      version: result.version,
      error: result.error,
    };
  }

  async listAgents(): Promise<Array<{
    agentId: string;
    name?: string;
    description?: string;
  }>> {
    const agents = await this.client.listAgents();
    return agents.map((a) => ({
      agentId: a.agentId,
      name: a.name,
      description: a.description,
    }));
  }

  getAuditLog() {
    return this.client.getAuditLog();
  }
}

export async function createConfigManager(options: ClientOptions): Promise<ConfigManager> {
  const manager = new ConfigManager(options);
  await manager.connect();
  return manager;
}

export { WebSocketClient };
export type { ClientOptions, ConfigUpdateResult, TransactionResult, AuditLogEntry } from "./client.js";
