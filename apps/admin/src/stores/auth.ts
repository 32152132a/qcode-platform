import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getSession, request, saveSession, renewSession } from '@/api/request'
import type { Session } from '@/types'
export const useAuthStore = defineStore('auth', () => {
  const user = ref(getSession()?.user || null)
  window.addEventListener('qcode-session', () => {
    user.value = getSession()?.user || null
  })
  const can = (permission: string) => user.value?.permissions.includes(permission) || false
  async function login(username: string, password: string) {
    const session = await request<Session>('/auth/login', 'POST', {
      username,
      password,
      device: 'QCode 管理控制台',
    })
    if (!session.user.permissions?.length) {
      await request('/auth/logout', 'POST', {}, false, {
        headers: { Authorization: 'Bearer ' + session.token },
      })
      throw new Error('此账号没有后台管理权限，请使用员工客户端')
    }
    saveSession(session)
  }
  async function logout() {
    try {
      await request('/auth/logout', 'POST', {})
    } finally {
      saveSession(null)
    }
  }
  return { user, can, login, logout, refresh: renewSession }
})
