import { createContext, useContext } from 'react';
import type { AuthUser } from '../types/api';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
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

/** The context object + useAuth live here, separately from AuthProvider
 * (see AuthProvider.tsx) purely so this file exports only non-component
 * values and that one exports only the component -- fast refresh needs a
 * file to be one or the other, not a mix of both. */
export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
