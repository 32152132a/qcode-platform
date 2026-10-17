import { computed, onMounted, onUnmounted, ref } from 'vue'

export function useDevice() {
  const isMobile = ref(window.innerWidth <= 768)
  function checkDevice() {
    isMobile.value = window.innerWidth <= 768
  }
  onMounted(() => window.addEventListener('resize', checkDevice))
  onUnmounted(() => window.removeEventListener('resize', checkDevice))
  return { isMobile, isDesktop: computed(() => !isMobile.value) }
}
