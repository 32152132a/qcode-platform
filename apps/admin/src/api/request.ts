import { businessRequest } from '../../../client/api-contract.mjs'
import axios, { type AxiosRequestConfig } from 'axios'
import type { Session } from '@/types'
const client = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '', timeout: 20000 })
let session: Session | null = null
try {
  session = JSON.parse(sessionStorage.getItem('qcode.admin.session') || 'null')
} catch {
  sessionStorage.removeItem('qcode.admin.session')
}
let renewing: Promise<void> | undefined
export const getSession = () => session
export function saveSession(value: Session | null) {
  session = value
  if (value) sessionStorage.setItem('qcode.admin.session', JSON.stringify(value))
  else sessionStorage.removeItem('qcode.admin.session')
  window.dispatchEvent(new Event('qcode-session'))
}
export async function renewSession() {
  if (!renewing)
    renewing = (async () => {
      if (!session?.refreshToken) throw new Error('请先登录')
      try {
        const response = await client.post<Session>('/auth/refresh', {
          refreshToken: session.refreshToken,
        })
        saveSession(response.data)
      } catch {
        saveSession(null)
        throw new Error('会话已失效，请重新登录')
      }
    })()
  try {
    await renewing
  } finally {
    renewing = undefined
  }
}
export async function request<T = unknown>(
  url: string,
  method = 'GET',
  data?: unknown,
  retry = true,
  options: AxiosRequestConfig = {}
): Promise<T> {
  try {
    const encoded = businessRequest(url, method, data)
    const response = await client.request<T>({
      ...options,
      url: encoded.url,
      method: encoded.method,
      data: encoded.data,
      headers: {
        ...options.headers,
        ...(session?.token ? { Authorization: 'Bearer ' + session.token } : {}),
      },
    })
    return response.data
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (
        error.response?.status === 401 &&
        retry &&
        session?.refreshToken &&
        url !== '/auth/login'
      ) {
        await renewSession()
        return request<T>(url, method, data, false, options)
      }
      if (error.response?.status === 401 && url !== '/auth/login') saveSession(null)
      throw new Error(error.response?.data?.error?.message || '请求失败，请检查网络或服务状态')
    }
    throw error
  }
}
export async function download(url: string, name: string) {
  const blob = await request<Blob>(url, 'GET', undefined, true, { responseType: 'blob' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}
