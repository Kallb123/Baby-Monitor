import { onMounted, onScopeDispose, ref, type Ref } from 'vue'

/** Reactive content-box size of an element, tracked with ResizeObserver. */
export function useElementSize(target: Ref<HTMLElement | null | undefined>) {
  const width = ref(0)
  const height = ref(0)
  let observer: ResizeObserver | undefined

  onMounted(() => {
    if (!target.value || typeof ResizeObserver === 'undefined') return
    observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      width.value = entry.contentRect.width
      height.value = entry.contentRect.height
    })
    observer.observe(target.value)
  })

  onScopeDispose(() => observer?.disconnect())

  return { width, height }
}
