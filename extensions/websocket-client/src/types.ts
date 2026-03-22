export type WsEvent = "open" | "message" | "close" | "error";

export interface WsEventHandlers {
  open: () => void;
  message: (data: string | Buffer) => void;
  close: (code: number, reason: Buffer) => void;
  error: (err: unknown) => void;
}
