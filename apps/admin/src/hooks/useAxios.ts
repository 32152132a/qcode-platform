import { onScopeDispose, ref, shallowRef } from 'vue'

// Transport, authentication and token refresh remain in api/request.
export function useAxios<T>(api: () => Promise<T>) {
  const data = shallowRef<T>()
  const loading = ref(false)
  const error = ref('')
  let sequence = 0
  async function load() {
    const current = ++sequence
    loading.value = true
    error.value = ''
    try {
      const result = await api()
      if (current === sequence) data.value = result
    } catch (cause) {
      if (current === sequence) error.value = cause instanceof Error ? cause.message : '加载失败'
    } finally {
      if (current === sequence) loading.value = false
    }
  }
  onScopeDispose(() => {
    sequence++
  })
  return { data, loading, error, load }
}
