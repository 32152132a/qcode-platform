<template>
  <div class="admin-layout">
    <aside v-if="!isMobile" class="desktop-sidebar">
      <AdminNavigation :items="items" />
    </aside>
    <AdminHeader
      :title="currentTitle"
      :username="auth.user?.username || '管理员'"
      @menu="mobileMenu = true"
      @logout="logout"
    />
    <ContentComponent class="content-area" />
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
  import { navigationEntries } from './navigation'
  import { useDevice } from '@/hooks/useDevice'
  import ContentComponent from './content/index.vue'
  const auth = useAuthStore(),
    router = useRouter(),
    route = useRoute()
  const mobileMenu = ref(false)
  const { isMobile } = useDevice()
  const items = computed<NavigationItem[]>(() =>
    navigationEntries
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
    display: grid;
    grid-template-columns: 208px minmax(0, 1fr);
    grid-template-rows: 60px minmax(0, 1fr);
    grid-template-areas: 'sidebar header' 'sidebar content';
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    color: var(--el-text-color-primary);
    background: var(--admin-background);
    .desktop-sidebar {
      grid-area: sidebar;
      min-height: 0;
      border-right: 1px solid var(--admin-border);
    }
    :deep(.admin-header) {
      grid-area: header;
    }
    .content-area {
      grid-area: content;
    }
    @media (max-width: 768px) {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'header' 'content';
      .desktop-sidebar {
        display: none;
      }
    }
  }
  :global(.admin-menu-drawer .el-drawer__body) {
    padding: 0;
  }
</style>
