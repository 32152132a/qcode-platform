<template>
  <el-collapse class="source-card">
    <el-collapse-item :name="title">
      <template #title><div class="source-heading"><h2>{{ title }}</h2><p>{{ address }}</p></div></template>
      <div class="source-toolbar">
        <el-space wrap><slot name="status" /></el-space>
        <el-space v-if="$slots.actions" wrap><slot name="actions" /></el-space>
      </div>
      <slot />
    </el-collapse-item>
  </el-collapse>
</template>
<script setup lang="ts">
defineProps<{ title: string; address: string }>();
</script>
<style scoped lang="scss">
.source-card {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  padding: 0 var(--admin-gap);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color);
  :deep(.el-collapse-item__header) { height: auto; min-height: 76px; line-height: normal; }
  :deep(.el-collapse-item__wrap) { border-bottom: 0; }
  :deep(.el-collapse-item__content) { padding-bottom: var(--admin-gap); }
  .source-heading { min-width: 0; padding: 12px 0; }
  h2 { margin: 0; font-size: 15px; }
  p { margin: 8px 0 0; color: var(--el-text-color-secondary); font-size: 12px; overflow-wrap: anywhere; }
  .source-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: var(--admin-gap); }
}
</style>
