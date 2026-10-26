import { NativeModules, Platform } from 'react-native';

function resolveApiUrl(): string {
  const configured = (process.env.EXPO_PUBLIC_API_URL || '').trim().replace(/\/+$/, '');

  const scriptURL: string | undefined = typeof NativeModules?.SourceCode?.scriptURL === 'string'
    ? NativeModules.SourceCode.scriptURL
    : undefined;
  let devHost: string | null = null;
  if (scriptURL) {
    const match = scriptURL.match(/^https?:\/\/([^/:]+)/);
    if (match && match[1] && match[1] !== 'localhost' && match[1] !== '127.0.0.1') {
      devHost = match[1];
    }
  }

  if (configured) {
    if (devHost && (configured.includes('10.0.2.2') || configured.includes('localhost') || configured.includes('127.0.0.1'))) {
      return configured.replace(/10\.0\.2\.2|localhost|127\.0\.0\.1/, devHost);
    }
    return configured;
  }

  if (devHost) {
    return `http://${devHost}:5050`;
  }

  return Platform.OS === 'android' ? 'http://10.0.2.2:5050' : 'http://localhost:5050';
}

export const API_URL = resolveApiUrl();

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let onUnauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorizedHandler = handler;
}

export async function apiRequest<T>(
  path: string,
  token?: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(
      `Can't reach Tomato right now. Check the API URL (${API_URL}) and your network.`,
      0,
    );
  }

  const text = await response.text();
  let payload: unknown;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError('Tomato returned an invalid response.', response.status);
    }
  }

  if (!response.ok) {
    const errorPayload = payload as { message?: string; code?: string } | undefined;
    if (response.status === 401 && token && onUnauthorizedHandler) {
      onUnauthorizedHandler();
    }
    throw new ApiError(
      errorPayload?.message || `Tomato request failed (${response.status}).`,
      response.status,
      errorPayload?.code,
    );
  }

  if (!text) throw new ApiError('Tomato returned an empty response.', response.status);
  return payload as T;
}

export function apiPath(path?: string | null): string {
  if (!path || typeof path !== 'string') return '';
  if (/^(https?:|data:|file:)/i.test(path)) return path;
  return `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
