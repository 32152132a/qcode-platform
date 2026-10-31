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
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
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
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      gap: var(--admin-gap);
    }
    &--transparent .table {
      padding: 0;
      background: transparent;
    }
  }
</style>
