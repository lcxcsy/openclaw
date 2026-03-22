export interface ErrorShape {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;
}

export const PROTOCOL_VERSION = 3;

export type FrameType = "req" | "res" | "event";

export interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
}

export interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: ErrorShape;
}

export interface EventFrame {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: StateVersion;
}

export interface StateVersion {
  presence: number;
  health: number;
}

export type GatewayFrame = RequestFrame | ResponseFrame | EventFrame;

export interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: string;
    displayName?: string;
    version: string;
    platform: string;
    deviceFamily?: string;
    mode: string;
    instanceId?: string;
  };
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  pathEnv?: string;
  auth?: {
    token?: string;
    bootstrapToken?: string;
    deviceToken?: string;
    password?: string;
  };
  role?: string;
  scopes?: string[];
  device?: {
    id: string;
    publicKey: string;
    signature: string;
    signedAt: number;
    nonce: string;
  };
}

export interface HelloOk {
  type: "hello-ok";
  protocol: number;
  server: {
    version: string;
    connId: string;
  };
  features: {
    methods: string[];
    events: string[];
  };
  snapshot: {
    presence: PresenceEntry[];
    health: unknown;
    stateVersion: StateVersion;
    uptimeMs: number;
    configPath?: string;
    stateDir?: string;
  };
  canvasHostUrl?: string;
  auth?: {
    deviceToken: string;
    role: string;
    scopes: string[];
    issuedAtMs?: number;
  };
  policy: {
    maxPayload: number;
    maxBufferedBytes: number;
    tickIntervalMs: number;
  };
}

export interface PresenceEntry {
  host?: string;
  ip?: string;
  version?: string;
  platform?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  mode?: string;
  lastInputSeconds?: number;
  reason?: string;
  tags?: string[];
  text?: string;
  ts: number;
  deviceId?: string;
  roles?: string[];
  scopes?: string[];
  instanceId?: string;
}

export interface AgentFile {
  path: string;
  content: string;
  size: number;
  modifiedAt: number;
  version?: number;
}

export interface AgentSummary {
  agentId: string;
  name?: string;
  description?: string;
  model?: string;
  enabled?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface VersionInfo {
  version: number;
  timestamp: number;
  operation: "create" | "update" | "delete" | "rollback";
  operator?: string;
  checksum?: string;
}

export interface ConfigUpdateResult {
  success: boolean;
  path: string;
  version?: number;
  error?: string;
  retryable?: boolean;
}

export interface TransactionResult {
  transactionId: string;
  success: boolean;
  results: ConfigUpdateResult[];
  rolledBack: boolean;
}

export interface AuditLogEntry {
  timestamp: number;
  operation: string;
  target: string;
  operator?: string;
  result: "success" | "failure";
  details?: Record<string, unknown>;
  error?: string;
}

export const ErrorCodes = {
  NOT_LINKED: "NOT_LINKED",
  NOT_PAIRED: "NOT_PAIRED",
  AGENT_TIMEOUT: "AGENT_TIMEOUT",
  INVALID_REQUEST: "INVALID_REQUEST",
  UNAVAILABLE: "UNAVAILABLE",
  CONNECTION_FAILED: "CONNECTION_FAILED",
  AUTH_FAILED: "AUTH_FAILED",
  CONFIG_NOT_FOUND: "CONFIG_NOT_FOUND",
  CONFIG_UPDATE_FAILED: "CONFIG_UPDATE_FAILED",
  VERSION_NOT_FOUND: "VERSION_NOT_FOUND",
  TRANSACTION_FAILED: "TRANSACTION_FAILED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class WebSocketClientError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "WebSocketClientError";
  }
}
