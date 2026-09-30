import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import * as authApi from '../api/auth';
import type { AuthUser } from '../types/api';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  accountId: string | null;
  login: (email: string, code: string) => Promise<void>;
  /** Sets the resulting session directly from an already-completed call
   * (signup-company / superadmin-login) rather than re-deriving it --
   * those flows hit a different endpoint than plain magic-code login. */
  setSession: (user: AuthUser, accountId: string) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await authApi.me();
      setUser(res.user);
      setAccountId(res.accountId);
      setStatus('authenticated');
    } catch {
      setUser(null);
      setAccountId(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, code: string) => {
    const res = await authApi.verifyCode(email, code);
    setUser(res.user);
    setAccountId(res.accountId);
    setStatus('authenticated');
  }, []);

  const setSession = useCallback((user: AuthUser, accountId: string) => {
    setUser(user);
    setAccountId(accountId);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    setAccountId(null);
    setStatus('anonymous');
  }, []);

  return (
    <AuthContext.Provider
      value={{ status, user, accountId, login, setSession, logout, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
