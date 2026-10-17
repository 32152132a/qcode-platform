<template>
  <header class="admin-header">
    <div class="header-location">
      <el-button class="menu-toggle" text aria-label="打开导航菜单" @click="emit('menu')"
        ><Menu /></el-button
      ><span class="location-root">管理控制台</span><ArrowRight class="separator" /><span
        class="location-current"
        >{{ title }}</span
      >
    </div>
    <div class="header-account">
      <span class="account-avatar"><User /></span
      ><span class="username" :title="username">{{ username }}</span
      ><el-button text @click="emit('logout')">退出登录</el-button>
    </div>
  </header>
</template>
<script setup lang="ts">
  import { ArrowRight, Menu, User } from '@element-plus/icons-vue'
  defineProps<{ title: string; username: string }>()
  const emit = defineEmits<{ menu: []; logout: [] }>()
</script>
<style scoped lang="scss">
  .admin-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--admin-gap);
    padding: 0 24px;
    min-width: 0;
    background: var(--admin-surface);
    border-bottom: 1px solid var(--admin-border);
    svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }
    .header-location,
    .header-account {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      font-size: 13px;
    }
    .location-root {
      color: var(--el-text-color-secondary);
    }
    .separator {
      width: 11px;
      height: 11px;
      color: #b7bac1;
    }
    .location-current {
      color: var(--el-text-color-regular);
      white-space: nowrap;
    }
    .account-avatar {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--el-fill-color);
      color: var(--el-text-color-secondary);
    }
    .username {
      color: var(--el-text-color-regular);
      max-width: 160px;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }
    .header-account .el-button {
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }
    .menu-toggle {
      display: none;
      padding: 6px;
    }
    @media (max-width: 768px) {
      padding: 0 12px;
      gap: 8px;
      .menu-toggle {
        display: inline-flex;
      }
      .location-root,
      .separator,
      .account-avatar {
        display: none;
      }
      .header-account {
        gap: 6px;
      }
      .username {
        max-width: 68px;
        font-size: 12px;
      }
      .header-location {
        gap: 6px;
      }
    }
  }
</style>
