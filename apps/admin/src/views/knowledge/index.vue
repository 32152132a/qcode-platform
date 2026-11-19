<template>
  <LayoutFormTable class="knowledge-page">
    <template #table><KnowledgeWorkspace /></template>
  </LayoutFormTable>
</template>
<script setup lang="ts">
import LayoutFormTable from '@/layout/LayoutFormTable.vue'
import KnowledgeWorkspace from './components/KnowledgeWorkspace/index.vue'
</script>
<style scoped lang="scss">
.knowledge-page > :deep(.table){padding:16px 18px 14px}
</style>
