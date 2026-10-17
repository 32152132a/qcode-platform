<template>
  <el-card class="source-card" shadow="never">
    <template #header>
      <header class="source-heading">
        <div>
          <h2>{{ title }}</h2>
          <p>{{ address }}</p>
        </div>
        <slot name="state" />
      </header>
    </template>
    <div class="source-toolbar">
      <el-space wrap><slot name="status" /></el-space>
      <el-space v-if="$slots.actions" wrap><slot name="actions" /></el-space>
    </div>
    <slot />
  </el-card>
</template>
<script setup lang="ts">
defineProps<{ title: string; address: string }>();
</script>
<style scoped lang="scss">
.source-card {
  .source-heading,
  .source-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
  }
  h2 {
    margin: 0;
    font-size: 15px;
  }
  p {
    margin: 8px 0 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .source-heading > div {
    min-width: 0;
  }
  .source-toolbar {
    margin-bottom: var(--admin-gap);
  }
}
</style>
