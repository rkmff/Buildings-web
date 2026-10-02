export class ApiError extends Error {
  status: number
  konflikt?: Konflikt | null

  constructor(status: number, message: string, konflikt?: Konflikt | null) {
    super(message)
    this.status = status
    this.konflikt = konflikt
  }
}

export interface Konflikt {
  anzahl: number
  name: string
  start_datum: string
  ende_datum: string
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data: any = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event('buildings:abgemeldet'))
    }
    throw new ApiError(res.status, data?.message || `Fehler ${res.status}`, data?.konflikt)
  }
  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
}
