export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * While a superadmin support session is active the app names it on EVERY request (X-Support-Session). If that
 * session has ended server-side the API answers 409 `support_session_ended` instead of silently serving the admin's
 * own account to a screen that still shows the customer's. Set by AuthProvider from GET /auth/me.
 */
let supportSessionId: string | null = null;
export function setSupportSessionId(id: string | null): void {
  supportSessionId = id;
}
/** Extra headers for code that calls fetch() directly. */
export function supportHeaders(): Record<string, string> {
  return supportSessionId ? { 'X-Support-Session': supportSessionId } : {};
}
export const SUPPORT_SESSION_ENDED_EVENT = 'streambird:support-ended';

/**
 * credentials: 'include' on every call -- the sb_session cookie is
 * httpOnly and same-origin (same-site in dev via the Vite proxy below),
 * so it rides along automatically; no token to manage client-side.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    // A multipart body (FormData) must set its own Content-Type with the boundary, so only JSON calls get one.
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...supportHeaders(),
      ...options.headers,
    },
    ...options,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 409 && body?.message?.code === 'support_session_ended') {
      window.dispatchEvent(new Event(SUPPORT_SESSION_ENDED_EVENT));
      throw new ApiError('Support session ended', 409);
    }
    const raw = body?.message;
    const message = Array.isArray(raw?.message)
      ? raw.message.join(', ')
      : (raw?.message ?? raw ?? `Request failed (${res.status})`);
    throw new ApiError(message, res.status);
  }

  return body as T;
}

/**
 * Multipart upload over XMLHttpRequest, the only browser API that reports how much of the request body has been sent
 * (fetch cannot). `onProgress` gets 0-100. Errors surface exactly like request(): an ApiError with the server's message.
 */
export function uploadForm<T>(method: 'POST' | 'PUT', path: string, form: FormData, onProgress?: (percent: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `/api${path}`);
    xhr.withCredentials = true;
    for (const [k, v] of Object.entries(supportHeaders())) xhr.setRequestHeader(k, v);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      };
    }
    xhr.onload = () => {
      let body: any = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((xhr.status === 204 ? undefined : body) as T);
        return;
      }
      if (xhr.status === 409 && body?.message?.code === 'support_session_ended') {
        window.dispatchEvent(new Event(SUPPORT_SESSION_ENDED_EVENT));
        reject(new ApiError('Support session ended', 409));
        return;
      }
      const raw = body?.message;
      const message = Array.isArray(raw?.message) ? raw.message.join(', ') : Array.isArray(raw) ? raw.join(', ') : (raw?.message ?? raw ?? `Upload failed (${xhr.status})`);
      reject(new ApiError(typeof message === 'string' ? message : `Upload failed (${xhr.status})`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('The upload did not finish. Check your connection and try again.', 0));
    xhr.onabort = () => reject(new ApiError('The upload was cancelled.', 0));
    xhr.ontimeout = () => reject(new ApiError('The upload timed out. Try again.', 0));
    xhr.send(form);
  });
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  postForm: <T>(path: string, form: FormData, onProgress?: (percent: number) => void) => uploadForm<T>('POST', path, form, onProgress),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: body !== undefined ? JSON.stringify(body) : undefined }),
};
