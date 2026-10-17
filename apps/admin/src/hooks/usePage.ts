import { computed, ref, watch } from 'vue'

export function usePage(total: () => number, initialPageSize = 10) {
  const page = ref(1)
  const pageSize = ref(initialPageSize)
  const offset = computed(() => (page.value - 1) * pageSize.value)
  function resetPage() {
    page.value = 1
  }
  watch(pageSize, resetPage)
  watch(total, (value) => {
    page.value = Math.min(page.value, Math.max(1, Math.ceil(value / pageSize.value)))
  })
  return { page, pageSize, offset, resetPage }
}
