<template>
  <main id="admin-content" class="admin-content" tabindex="-1">
    <router-view />
  </main>
</template>
<style scoped lang="scss">
  .admin-content {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: var(--admin-gap);
    scrollbar-gutter: stable;
    outline: none;
  }
</style>
