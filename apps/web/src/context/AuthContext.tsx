import * as React from "react";
import { api, clearSession, getStoredUser, getToken, storeSession } from "../lib/api";

interface Session {
  token: string;
  user: { id: string; username: string; name: string; role: string; agency: string };
}

interface AuthCtx {
  session: Session | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = React.createContext<AuthCtx>(null as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(() => {
    const token = getToken();
    const user = getStoredUser();
    return token && user ? { token, user } : null;
  });

  const login = React.useCallback(async (username: string, password: string) => {
    const res = await api.post("/auth/login", { username, password });
    storeSession(res.token, res.user);
    setSession({ token: res.token, user: res.user });
  }, []);

  const logout = React.useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  return <Ctx.Provider value={{ session, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  return React.useContext(Ctx);
}
