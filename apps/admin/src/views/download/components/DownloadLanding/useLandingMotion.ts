import { onMounted, onUnmounted, type Ref } from 'vue'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// Local to the landing page; reverting also clears inline styles and scroll listeners.
export function useLandingMotion(root: Ref<HTMLElement | undefined>) {
  let media: ReturnType<typeof gsap.matchMedia> | undefined
  onMounted(() => {
    if (!root.value) return
    gsap.registerPlugin(ScrollTrigger)
    media = gsap.matchMedia()
    media.add({ motion: '(prefers-reduced-motion: no-preference)', mobile: '(max-width: 700px)' }, context => {
      if (!context.conditions?.motion || !root.value) return
      const cleanups: (() => void)[] = []
      const distance = context.conditions.mobile ? 16 : 36
      const items = Array.from(root.value.querySelectorAll<HTMLElement>('[data-reveal]'))
      for (const item of items) {
        gsap.from(item, {
          opacity: 0, y: distance, duration: 0.8, ease: 'power2.out',
          delay: Math.min(Array.from(item.parentElement?.children || []).indexOf(item) * 0.1, 0.4),
          scrollTrigger: { trigger: item, start: 'top 92%', once: true },
          // Keyboard navigation must never land on an invisible link or button.
          onComplete: () => gsap.set(item, { clearProps: 'opacity,visibility,transform' }),
        })
        const showOnFocus = () => { gsap.killTweensOf(item); gsap.set(item, { clearProps: 'opacity,visibility,transform' }) }
        item.addEventListener('focusin', showOnFocus)
        cleanups.push(() => item.removeEventListener('focusin', showOnFocus))
      }
      return () => { for (const cleanup of cleanups.splice(0)) cleanup() }
    }, root.value)
  })
  onUnmounted(() => media?.revert())
}
