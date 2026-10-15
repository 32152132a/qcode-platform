import { ref, onMounted, watch, type Ref } from 'vue'
import { request } from '@/api/request'
export function useResource<T>(url: () => string) {
  const data = ref<T>() as Ref<T | undefined>
  const loading = ref(false)
  const error = ref('')
  let sequence = 0
  async function load() {
    const current = ++sequence
    loading.value = true
    error.value = ''
    try {
      const value = await request<T>(url())
      if (current === sequence) data.value = value
    } catch (cause) {
      if (current === sequence) error.value = cause instanceof Error ? cause.message : '加载失败'
    } finally {
      if (current === sequence) loading.value = false
    }
  }
  onMounted(load)
  watch(url, load)
  return { data, loading, error, load }
}
