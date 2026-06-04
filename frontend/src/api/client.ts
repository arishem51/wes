import axios from 'axios';

/**
 * Shared axios instance for the WES backend.
 *
 * Base URL comes from VITE_API_BASE_URL (defaults to `/api`, which is proxied
 * to the NestJS server by Vite during development — see vite.config.ts).
 */
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

// Attach the auth token (if the WES auth module stores one) to every request.
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('wes.accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** Normalise backend/axios errors into a human-readable message. */
export function toApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined;
    const msg = data?.message;
    if (Array.isArray(msg)) return msg.join(', ');
    if (typeof msg === 'string') return msg;
    return error.message;
  }
  return error instanceof Error ? error.message : 'Đã xảy ra lỗi không xác định';
}

/** Whether the UI should run against in-memory mock data. */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
