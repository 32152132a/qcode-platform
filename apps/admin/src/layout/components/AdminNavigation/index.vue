<template>
  <div class="admin-navigation">
    <router-link class="brand" to="/" aria-label="返回 QCode 首页"
      ><img src="/brand-logo.svg" alt="" /><span
        >QCode<small>团队 AI 控制台</small></span
      ></router-link
    >
    <nav aria-label="后台导航">
      <el-menu :default-active="route.path" router @select="emit('select')">
        <el-menu-item-group v-for="group in groups" :key="group.name" :title="group.name">
          <el-menu-item v-for="item in group.items" :key="item.id" :index="'/manage/' + item.id">
            <el-icon><component :is="icons[item.id]" /></el-icon><span>{{ item.label }}</span>
          </el-menu-item>
        </el-menu-item-group>
      </el-menu>
    </nav>
    <router-link class="download-entry" to="/" @click="emit('select')"
      ><Download />客户端下载<ArrowRight
    /></router-link>
  </div>
</template>
<script setup lang="ts">
  import { computed } from 'vue'
  import { useRoute } from 'vue-router'
  import {
    ArrowRight,
    Collection,
    Connection,
    DataAnalysis,
    Download,
    Files,
    Grid,
    Key,
    Monitor,
    OfficeBuilding,
    Setting,
    Tickets,
    User,
    View,
  } from '@element-plus/icons-vue'
  import type { NavigationItem } from '../../types'
  const route = useRoute()
  const props = defineProps<{ items: NavigationItem[] }>()
  const emit = defineEmits<{ select: [] }>()
  const icons = {
    overview: Grid,
    users: User,
    models: Connection,
    keys: Key,
    departments: OfficeBuilding,
    skills: Files,
    knowledge: Collection,
    usage: DataAnalysis,
    requests: Tickets,
    audits: View,
    settings: Setting,
    system: Monitor,
  } as Record<string, typeof Grid>
  const groups = computed(() =>
    [...new Set(props.items.map((item) => item.group))].map((name) => ({
      name,
      items: props.items.filter((item) => item.group === name),
    }))
  )
</script>
<style scoped lang="scss">
  .admin-navigation {
    height: 100%;
    min-height: 0;
    display: grid;
    grid-template-rows: 60px minmax(0, 1fr) auto;
    background: var(--admin-surface);
    svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 22px;
      border-bottom: 1px solid var(--admin-border);
      img {
        width: 30px;
        height: 30px;
      }
      > span {
        font-size: 19px;
        font-weight: 600;
        color: var(--el-text-color-primary);
      }
      small {
        display: block;
        margin-top: 2px;
        color: var(--el-text-color-secondary);
        font-size: 10px;
        font-weight: 400;
      }
    }
    nav {
      overflow-y: auto;
      padding: 12px;
      .el-menu {
        border: 0;
      }
      .el-menu-item {
        height: 42px;
        border-radius: var(--admin-radius);
      }
      :deep(.el-menu-item-group__title) {
        font-size: 12px;
      }
    }
    .download-entry {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 18px;
      padding: 17px 8px;
      color: var(--el-text-color-secondary);
      border-top: 1px solid var(--admin-border);
      font-size: 12px;
      > svg:last-child {
        margin-left: auto;
        width: 12px;
      }
      &:hover {
        color: var(--el-color-primary);
      }
    }
  }
</style>
