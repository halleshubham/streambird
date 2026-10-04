import { api } from './client';
import type { MeResponse } from '../types/api';

export function requestCode(email: string): Promise<{ message: string }> {
  return api.post('/auth/request-code', { email });
}

export function verifyCode(email: string, code: string): Promise<MeResponse> {
  return api.post('/auth/verify-code', { email, code });
}

/** Company Admin sign-up: call requestCode first (same endpoint as
 * magic-code login), then this with the same code plus a company name. */
export function signupCompany(
  companyName: string,
  email: string,
  code: string,
): Promise<MeResponse> {
  return api.post('/auth/signup-company', { companyName, email, code });
}

/** Step 1: checks the password and emails a one-time code. */
export function superadminLogin(email: string, password: string): Promise<{ otpRequired: true }> {
  return api.post('/auth/superadmin-login', { email, password });
}

/** Step 2: password again plus the emailed code; this one signs in. */
export function superadminVerify(email: string, password: string, code: string): Promise<MeResponse> {
  return api.post('/auth/superadmin-verify', { email, password, code });
}

export function logout(): Promise<void> {
  return api.post('/auth/logout');
}

export function me(): Promise<MeResponse> {
  return api.get('/auth/me');
}

/** Full-page redirect -- not a fetch() call. See AuthController.googleRedirect. */
export function googleLoginUrl(): string {
  return '/api/auth/google';
}

/** Full-page redirect -- not a fetch() call. See AuthController.facebookRedirect. */
export function facebookLoginUrl(): string {
  return '/api/auth/facebook';
}
