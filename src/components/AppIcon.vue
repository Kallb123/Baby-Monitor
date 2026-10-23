<script lang="ts">
type IconElement = { tag: 'path' | 'rect' | 'line' | 'circle'; attrs: Record<string, string> }

const path = (d: string): IconElement => ({ tag: 'path', attrs: { d } })
const rect = (x: string, y: string, width: string, height: string, rx: string): IconElement => ({
  tag: 'rect',
  attrs: { x, y, width, height, rx },
})
const line = (x1: string, y1: string, x2: string, y2: string): IconElement => ({
  tag: 'line',
  attrs: { x1, y1, x2, y2 },
})

const circle = (cx: string, cy: string, r: string): IconElement => ({
  tag: 'circle',
  attrs: { cx, cy, r },
})

const speaker = path(
  'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z',
)

/** Lucide icons (https://lucide.dev), as the design system asks. */
const icons = {
  grid: [
    rect('3', '3', '7', '7', '1'),
    rect('14', '3', '7', '7', '1'),
    rect('14', '14', '7', '7', '1'),
    rect('3', '14', '7', '7', '1'),
  ],
  focus: [rect('3', '3', '13', '18', '2'), path('M20 4v4'), path('M20 11v2'), path('M20 16v4')],
  pencil: [
    path(
      'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
    ),
    path('m15 5 4 4'),
  ],
  plus: [path('M5 12h14'), path('M12 5v14')],
  thermometer: [path('M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z')],
  droplet: [
    path(
      'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z',
    ),
  ],
  baby: [
    path('M9 12h.01'),
    path('M15 12h.01'),
    path('M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5'),
    path(
      'M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1',
    ),
  ],
  volume: [speaker, path('M16 9a5 5 0 0 1 0 6'), path('M19.364 18.364a9 9 0 0 0 0-12.728')],
  'volume-off': [speaker, line('22', '9', '16', '15'), line('16', '9', '22', '15')],
  trash: [
    path('M3 6h18'),
    path('M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6'),
    path('M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'),
  ],
  settings: [
    path(
      'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
    ),
    circle('12', '12', '3'),
  ],
  'arrow-left': [path('m12 19-7-7 7-7'), path('M19 12H5')],
  'triangle-alert': [
    path('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'),
    path('M12 9v4'),
    path('M12 17h.01'),
  ],
} satisfies Record<string, IconElement[]>

export type IconName = keyof typeof icons
</script>

<script setup lang="ts">
withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 20 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <component :is="el.tag" v-for="(el, i) in icons[name]" :key="i" v-bind="el.attrs" />
  </svg>
</template>
