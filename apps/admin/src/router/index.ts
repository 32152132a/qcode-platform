import { createRouter, createWebHistory } from 'vue-router'
import { getSession } from '@/api/request'
const pages = {
  overview: () => import('@/views/overview/index.vue'),
  users: () => import('@/views/users/index.vue'),
  models: () => import('@/views/models/index.vue'),
  capabilities: () => import('@/views/capabilities/index.vue'),
  keys: () => import('@/views/keys/index.vue'),
  skills: () => import('@/views/skills/index.vue'),
  plans: () => import('@/views/plans/index.vue'),
  feedback: () => import('@/views/feedback/index.vue'),
  knowledge: () => import('@/views/knowledge/index.vue'),
  usage: () => import('@/views/usage/index.vue'),
  requests: () => import('@/views/requests/index.vue'),
  settings: () => import('@/views/settings/index.vue'),
  system: () => import('@/views/system/index.vue'),
}
const routes = [
  { path: '/download', redirect: '/' },
  {
    path: '/',
    component: () => import('@/views/download/index.vue'),
    meta: { public: true },
  },
  {
    path: '/login',
    component: () => import('@/views/login/index.vue'),
    meta: { public: true },
  },
  {
    path: '/manage',
    component: () => import('@/layout/index.vue'),
    children: [
      { path: '', redirect: '/manage/overview' },
      ...Object.entries(pages).map(([page, component]) => ({
        path: page,
        component,
        meta: { permission: (page === 'overview' ? 'usage' : page === 'capabilities' ? 'models' : page) + ':read' },
      })),
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    component: () => import('@/views/not-found/index.vue'),
    meta: { public: true },
  },
]
export const router = createRouter({ history: createWebHistory(), routes })
router.beforeEach((to) => {
  if (!to.meta.public && !getSession()) return { path: '/login', query: { redirect: to.fullPath } }
  const permission = to.meta.permission
  if (typeof permission === 'string' && !getSession()?.user.permissions.includes(permission))
    return '/'
})
window.addEventListener('qcode-session', () => {
  if (!getSession() && !router.currentRoute.value.meta.public) void router.replace('/login')
})
