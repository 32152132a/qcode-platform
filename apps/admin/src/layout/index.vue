<template>
  <div class="admin-layout">
    <aside class="desktop-sidebar"><AdminNavigation :items="items" /></aside>
    <AdminHeader
      :title="currentTitle"
      :username="auth.user?.username || '管理员'"
      @menu="mobileMenu = true"
      @logout="logout"
    />
    <main id="admin-content" class="admin-content" tabindex="-1"><router-view /></main>
    <el-drawer
      v-model="mobileMenu"
      class="admin-menu-drawer"
      direction="ltr"
      size="224px"
      :with-header="false"
      aria-label="后台导航菜单"
      ><AdminNavigation :items="items" @select="mobileMenu = false"
    /></el-drawer>
  </div>
</template>
<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { ElMessage } from 'element-plus'
  import { useRoute, useRouter } from 'vue-router'
  import { useAuthStore } from '@/stores/auth'
  import AdminNavigation from './components/AdminNavigation/index.vue'
  import AdminHeader from './components/AdminHeader/index.vue'
  import type { NavigationItem } from './types'
  const auth = useAuthStore(),
    router = useRouter(),
    route = useRoute()
  const mobileMenu = ref(false)
  const entries = [
    ['overview', '工作台概览', 'usage', '工作空间'],
    ['users', '用户管理', 'users', '组织与访问'],
    ['departments', '部门管理', 'departments', '组织与访问'],
    ['models', '模型与服务', 'models', 'AI 资源'],
    ['keys', 'Key 管理', 'keys', 'AI 资源'],
    ['skills', '共享 Skill', 'skills', 'AI 资源'],
    ['knowledge', '知识库', 'knowledge', 'AI 资源'],
    ['usage', '用量统计', 'usage', '运行与管理'],
    ['requests', '请求日志', 'requests', '运行与管理'],
    ['audits', '操作审计', 'audits', '运行与管理'],
    ['settings', '系统设置', 'settings', '运行与管理'],
    ['system', '系统状态', 'system', '运行与管理'],
  ]
  const items = computed<NavigationItem[]>(() =>
    entries
      .filter((item) => auth.can(item[2] + ':read'))
      .map(([id, label, , group]) => ({ id, label, group }))
  )
  const currentTitle = computed(
    () => items.value.find((item) => route.path === '/manage/' + item.id)?.label || '管理控制台'
  )
  async function logout() {
    try {
      await auth.logout()
      await router.replace('/login')
    } catch (cause) {
      ElMessage.error(cause instanceof Error ? cause.message : '退出失败，请重试')
    }
  }
  watch(
    () => route.fullPath,
    () => {
      mobileMenu.value = false
    }
  )
</script>
<style scoped lang="scss">
  .admin-layout {
    --el-color-primary: #409eff;
    --el-color-primary-light-3: #79bbff;
    --el-color-primary-light-5: #a0cfff;
    --el-color-primary-light-7: #c6e2ff;
    --el-color-primary-light-8: #d9ecff;
    --el-color-primary-light-9: #ecf5ff;
    --el-color-primary-dark-2: #337ecc;
    --el-border-radius-base: 4px;
    --el-text-color-primary: #303133;
    --el-text-color-regular: #606266;
    --el-border-color: #dcdfe6;
    --el-border-color-light: #e4e7ed;
    --admin-surface: #fff;
    --admin-background: #f3f3f3;
    --admin-border: #ebeef5;
    --admin-gap: 20px;
    --admin-radius: 4px;
    display: grid;
    grid-template-columns: 208px minmax(0, 1fr);
    grid-template-rows: 60px minmax(0, 1fr);
    grid-template-areas: 'sidebar header' 'sidebar content';
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    color: #303133;
    background: var(--admin-background);
    .desktop-sidebar {
      grid-area: sidebar;
      min-height: 0;
      border-right: 1px solid #e8e8e8;
    }
    :deep(.admin-header) {
      grid-area: header;
    }
    .admin-content {
      grid-area: content;
      min-width: 0;
      min-height: 0;
      overflow: auto;
      padding: var(--admin-gap);
      scrollbar-gutter: stable;
      outline: none;
    }
    :deep(.el-button) {
      border-radius: 4px;
    }
    :deep(.el-card) {
      border-radius: 4px;
      box-shadow: none;
    }
    :deep(.el-table) {
      --el-table-header-bg-color: #f5f7fa;
      --el-table-header-text-color: #606266;
      --el-table-border-color: #ebeef5;
    }
    :deep(.el-table th.el-table__cell) {
      font-weight: 500;
    }
    :deep(.el-table .el-table__cell) {
      padding-block: 12px;
    }
    @media (max-width: 768px) {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'header' 'content';
      --admin-gap: 12px;
      .desktop-sidebar {
        display: none;
      }
    }
  }
  :global(.admin-menu-drawer .el-drawer__body) {
    padding: 0;
  }
</style>
