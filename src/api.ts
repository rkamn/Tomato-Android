const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:5050')
  .trim()
  .replace(/\/+$/, '');

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
    throw new ApiError(
      errorPayload?.message || `Tomato request failed (${response.status}).`,
      response.status,
      errorPayload?.code,
    );
  }

  if (!text) throw new ApiError('Tomato returned an empty response.', response.status);
  return payload as T;
}

export function apiPath(path: string): string {
  if (/^(https?:|data:|file:)/i.test(path)) return path;
  return `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
