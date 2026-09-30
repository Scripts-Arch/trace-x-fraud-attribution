/** Shared runtime state for API modules (initialised in index.ts). */
import { Store } from "./db";
import { env } from "./env";

export interface WsMessage {
  type: string;
  payload: unknown;
  at: number;
}

export const state = {
  store: null as unknown as Store,
  mlUrl: env.mlServiceUrl,
  broadcast: (_msg: WsMessage) => {},
};

export function emit(type: string, payload: unknown): void {
  state.broadcast({ type, payload, at: Date.now() });
}
