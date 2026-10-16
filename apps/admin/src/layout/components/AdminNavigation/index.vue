<template>
  <div class="admin-navigation">
    <router-link class="brand" to="/" aria-label="返回 QCode 首页"
      ><img src="/branding/qcode-96.png" alt="" /><span
        >QCode<small>团队 AI 控制台</small></span
      ></router-link
    >
    <nav aria-label="后台导航">
      <template v-for="group in groups" :key="group.name"
        ><span class="group-title">{{ group.name }}</span
        ><router-link
          v-for="item in group.items"
          :key="item.id"
          :to="'/manage/' + item.id"
          @click="emit('select')"
          ><component :is="icons[item.id]" /><span>{{ item.label }}</span></router-link
        ></template
      >
    </nav>
    <router-link class="download-entry" to="/" @click="emit('select')"
      ><Download />客户端下载<ArrowRight
    /></router-link>
  </div>
</template>
<script setup lang="ts">
  import { computed } from 'vue'
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
    background: #fff;
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
      border-bottom: 1px solid #ebeef5;
      img {
        width: 30px;
        height: 30px;
      }
      > span {
        font-size: 19px;
        font-weight: 600;
        color: #303133;
      }
      small {
        display: block;
        margin-top: 2px;
        color: #909399;
        font-size: 10px;
        font-weight: 400;
      }
    }
    nav {
      display: grid;
      align-content: start;
      gap: 3px;
      padding: 14px 12px;
      overflow-y: auto;
      a {
        display: flex;
        align-items: center;
        gap: 11px;
        color: #606266;
        padding: 11px 14px;
        border-radius: 4px;
        font-size: 13px;
        min-width: 0;
        &:hover {
          background: #f5f7fa;
        }
        &.router-link-active {
          color: #409eff;
          background: #ecf5ff;
          font-weight: 500;
        }
        svg {
          color: #909399;
        }
        &.router-link-active svg {
          color: inherit;
        }
      }
    }
    .group-title {
      font-size: 10px;
      color: #a0a3a8;
      letter-spacing: 1px;
      padding: 14px 14px 7px;
      &:first-child {
        padding-top: 3px;
      }
    }
    .download-entry {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 18px;
      padding: 17px 8px;
      color: #909399;
      border-top: 1px solid #ebeef5;
      font-size: 12px;
      > svg:last-child {
        margin-left: auto;
        width: 12px;
      }
      &:hover {
        color: #409eff;
      }
    }
  }
</style>
