<template>
  <LayoutFormTable class="page-panel" :transparent="transparent">
    <template #form>
      <header class="page-heading">
        <div class="page-title">
          <h1>{{ title }}</h1>
          <p v-if="description">{{ description }}</p>
        </div>
        <div v-if="$slots.actions" class="page-actions">
          <slot name="actions" />
        </div>
      </header>
    </template>
    <template v-if="error" #status
      ><el-alert v-if="error" :title="error" type="error" :closable="false" show-icon
    /></template>
    <template #table
      ><div v-loading="loading" class="page-content"><slot /></div
    ></template>
  </LayoutFormTable>
</template>
<script setup lang="ts">
  import LayoutFormTable from '@/layout/LayoutFormTable.vue'
  defineProps<{
    title: string
    description?: string
    loading?: boolean
    error?: string
    transparent?: boolean
  }>()
</script>
<style scoped lang="scss">
  .page-panel {
    .page-heading {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--admin-gap);
    }
    .page-title {
      min-width: 0;
      h1 {
        display: flex;
        align-items: center;
        gap: 9px;
        font-size: 17px;
        color: var(--el-text-color-primary);
        font-weight: 600;
        letter-spacing: 0;
        margin: 0;
        &::before {
          content: '';
          width: 3px;
          height: 17px;
          border-radius: 2px;
          background: var(--el-color-primary);
          flex-shrink: 0;
        }
      }
      p {
        color: var(--el-text-color-secondary);
        font-size: 12px;
        line-height: 1.8;
        margin: 9px 0 0 12px;
      }
    }
    .page-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
      min-width: 0;
      :deep(.el-button + .el-button) {
        margin-left: 0;
      }
      :deep(.el-date-editor) {
        flex-grow: 0;
        max-width: 100%;
      }
    }
    .page-content {
      min-width: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      align-content: start;
      gap: var(--admin-gap);
    }
    @media (max-width: 1100px) {
      .page-heading {
        align-items: flex-start;
        flex-wrap: wrap;
        gap: 16px;
      }
      .page-actions {
        justify-content: flex-start;
        max-width: 100%;
      }
    }
    @media (max-width: 650px) {
      .page-title p {
        margin-left: 0;
      }
      .page-actions {
        width: 100%;
      }
      .page-actions :deep(.el-date-editor) {
        width: 100%;
        min-width: 0;
        flex-basis: 100%;
      }
    }
  }
</style>
