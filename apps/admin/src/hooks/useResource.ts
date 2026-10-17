import { onMounted, watch } from 'vue'
import { request } from '@/api/request'
import { useAxios } from './useAxios'

export function useResource<T>(url: () => string) {
  const resource = useAxios(() => request<T>(url()))
  onMounted(resource.load)
  watch(url, resource.load)
  return resource
}
