<template>
  <section class="page-panel">
    <header>
      <div>
        <h1>{{ title }}</h1>
        <p v-if="description">{{ description }}</p>
      </div>
      <div class="page-actions"><slot name="actions" /></div>
    </header>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <div v-loading="loading"><slot /></div>
  </section>
</template>
<script setup lang="ts">
  defineProps<{ title: string; description?: string; loading?: boolean; error?: string }>()
</script>
<style scoped lang="scss">
  .page-panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    gap: 24px;
    > div {
      min-width: 0;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    h1 {
      font-size: 26px;
      margin: 0;
      font-weight: 650;
      letter-spacing: -0.7px;
    }
    p {
      color: #7a8597;
      margin: 10px 0 0;
      line-height: 1.7;
    }
    .page-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
  }
</style>
