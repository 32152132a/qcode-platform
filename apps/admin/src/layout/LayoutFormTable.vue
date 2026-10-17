<template>
  <section class="layout-form-table" :class="{ 'layout-form-table--transparent': transparent }">
    <div v-if="$slots.form" class="form"><slot name="form" /></div>
    <slot name="status" />
    <div class="table"><slot name="table" /></div>
  </section>
</template>
<script setup lang="ts">
  defineProps<{ transparent?: boolean }>()
</script>
<style scoped lang="scss">
  .layout-form-table {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    min-width: 0;
    gap: var(--admin-gap);
    .form,
    .table {
      min-width: 0;
      padding: var(--admin-padding);
      background: var(--admin-surface);
      border-radius: var(--admin-radius);
    }
    .table {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      align-content: start;
      gap: var(--admin-gap);
    }
    &--transparent .table {
      padding: 0;
      background: transparent;
    }
  }
</style>
