import { onScopeDispose, ref, watch, type Ref } from 'vue'

import { STIRRING_HOLD_MS, STIRRING_LEVEL } from '@/lib/sound-status'

/** True while the meter level is above the stirring threshold, held briefly after it drops. */
export function useStirring(level: Ref<number>) {
  const stirring = ref(false)
  let release: ReturnType<typeof setTimeout> | undefined

  watch(level, (value) => {
    if (value < STIRRING_LEVEL) return
    stirring.value = true
    clearTimeout(release)
    release = setTimeout(() => (stirring.value = false), STIRRING_HOLD_MS)
  })

  onScopeDispose(() => clearTimeout(release))

  return { stirring }
}
