/** Thin API client with JWT handling and WebSocket live updates. */

const TOKEN_KEY = "tracex.token";
const USER_KEY = "tracex.user";
const API_BASE: string = import.meta.env.VITE_API_URL || "/api/v1";
const WS_URL: string | undefined = import.meta.env.VITE_WS_URL;

/** Absolute origin of the API (for raw fetches/links outside the api helper):
 *  derived from VITE_API_URL when set, else same origin as the web app. */
export function apiOrigin(): string {
  if (import.meta.env.VITE_API_URL) {
    try {
      return new URL(import.meta.env.VITE_API_URL as string).origin;
    } catch { /* fall through */ }
  }
  return window.location.origin;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): any | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeSession(token: string, user: any): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request(method: string, path: string, body?: unknown): Promise<any> {
  const token = getToken();
  const resp = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (resp.status === 401 && !path.startsWith("/auth/login")) {
    clearSession();
    window.location.href = "/login";
    throw new ApiError(401, "Session expired");
  }
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ApiError(resp.status, json?.error || `HTTP ${resp.status}`);
  return json;
}

export const api = {
  get: (path: string) => request("GET", path),
  post: (path: string, body?: unknown) => request("POST", path, body),
  del: (path: string) => request("DELETE", path),
};

/** Raw URL fetch for report endpoints (token via header). */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Subscribe to live WS events; returns an unsubscribe fn. */
export function connectWs(onEvent: (type: string, payload: any) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;

  const open = () => {
    if (closed) return;
    const url = WS_URL || `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
    ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        onEvent(msg.type, msg.payload);
      } catch { /* ignore malformed frames */ }
    };
    ws.onclose = () => {
      if (!closed && retry < 8) {
        retry += 1;
        setTimeout(open, 1200 * retry);
      }
    };
    ws.onerror = () => ws?.close();
  };
  open();
  return () => {
    closed = true;
    ws?.close();
  };
}
