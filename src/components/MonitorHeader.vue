<script setup lang="ts">
import { onScopeDispose, ref } from 'vue'
import { RouterLink } from 'vue-router'

import type { LayoutMode } from '@shared/config.ts'
import { useFullscreen } from '@/composables/useFullscreen'
import AppIcon from './AppIcon.vue'

defineProps<{
  status: string
  /** Secondary warning, e.g. Home Assistant being unreachable. */
  notice: string | undefined
  layoutMode: LayoutMode
  editing: boolean
  canEdit: boolean
  canAdd: boolean
}>()

const emit = defineEmits<{
  layout: [mode: LayoutMode]
  toggleEdit: []
  add: []
}>()

const formatTime = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const clock = ref(formatTime())
const clockTimer = setInterval(() => (clock.value = formatTime()), 1000)
onScopeDispose(() => clearInterval(clockTimer))

const { supported: fullscreenSupported, isFullscreen, toggle: toggleFullscreen } = useFullscreen()

const layouts = [
  { mode: 'grid', icon: 'grid', label: 'Grid layout' },
  { mode: 'focus', icon: 'focus', label: 'Large + thumbnails layout' },
] as const
</script>

<template>
  <header class="monitor-header">
    <h1 class="title">Nursery</h1>
    <p class="status">
      <span>{{ clock }} · {{ status }}</span>
      <span v-if="notice" class="notice"> · {{ notice }}</span>
    </p>

    <div class="layouts" role="group" aria-label="Layout">
      <button
        v-for="layout in layouts"
        :key="layout.mode"
        type="button"
        class="layout-btn"
        :class="{ active: layoutMode === layout.mode }"
        :aria-label="layout.label"
        :aria-pressed="layoutMode === layout.mode"
        :title="layout.label"
        @click="emit('layout', layout.mode)"
      >
        <AppIcon :name="layout.icon" />
      </button>
    </div>

    <button
      type="button"
      class="edit-btn"
      :class="{ active: editing }"
      :aria-pressed="editing"
      :disabled="!canEdit && !editing"
      @click="emit('toggleEdit')"
    >
      <AppIcon name="pencil" :size="18" />
      <span class="edit-label">{{ editing ? 'Done' : 'Edit' }}</span>
    </button>

    <button
      type="button"
      class="add-btn"
      aria-label="Add camera"
      title="Add camera"
      :disabled="!canAdd"
      @click="emit('add')"
    >
      <AppIcon name="plus" :size="22" />
    </button>

    <div class="nav">
      <button
        v-if="fullscreenSupported"
        type="button"
        class="fullscreen-btn"
        :aria-label="isFullscreen ? 'Exit full screen' : 'Enter full screen'"
        :title="isFullscreen ? 'Exit full screen' : 'Enter full screen'"
        :aria-pressed="isFullscreen"
        @click="toggleFullscreen"
      >
        <AppIcon :name="isFullscreen ? 'minimize' : 'maximize'" :size="22" />
      </button>

      <RouterLink to="/history" class="history-btn" aria-label="History" title="History">
        <AppIcon name="history" :size="22" />
      </RouterLink>

      <RouterLink to="/settings" class="settings-btn" aria-label="Settings" title="Settings">
        <AppIcon name="settings" :size="22" />
      </RouterLink>
    </div>
  </header>
</template>

<style scoped>
.monitor-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto auto auto auto;
  grid-template-areas:
    'title layouts edit add fullscreen history settings'
    'status layouts edit add fullscreen history settings';
  align-items: center;
  column-gap: 16px;
  flex: none;
  padding: calc(14px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right)) 6px
    calc(24px + env(safe-area-inset-left));
}

.title {
  grid-area: title;
  align-self: end;
  margin: 0;
  font-family: var(--font-heading);
  font-size: 24px;
  font-weight: 400;
  line-height: 1.1;
  color: var(--color-text);
}

.status {
  grid-area: status;
  align-self: start;
  margin: 0;
  font-size: 14px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notice {
  color: var(--color-accent-300);
}

.layouts {
  grid-area: layouts;
  display: flex;
  gap: 4px;
  flex: none;
  padding: 4px;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
}

.layout-btn,
.add-btn,
.fullscreen-btn,
.history-btn,
.settings-btn {
  display: grid;
  place-items: center;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: var(--radius-pill);
}

.layout-btn {
  width: 44px;
  height: 44px;
  background: transparent;
  color: var(--color-text-muted);
}

.layout-btn:not(.active):hover {
  background: rgb(238 231 219 / 7%);
}

.layout-btn.active,
.edit-btn.active {
  background: var(--color-neutral-200);
  color: var(--color-ink);
}

.edit-btn {
  grid-area: edit;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  height: 52px;
  padding: 0 20px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-heading);
  font-size: 16px;
}

.edit-btn:not(:disabled):hover {
  filter: brightness(1.12);
}

.add-btn {
  grid-area: add;
  width: 52px;
  height: 52px;
  background: var(--color-accent);
  color: var(--color-bg);
}

.add-btn:not(:disabled):hover {
  background: var(--color-accent-500);
}

.add-btn:not(:disabled):active {
  background: var(--color-accent-400);
}

.fullscreen-btn,
.history-btn,
.settings-btn {
  width: 52px;
  height: 52px;
  background: var(--color-surface);
  color: var(--color-text);
}

/* Transparent on wide screens so the buttons keep their own grid areas; phones
   turn it into a real flex row (see the media query). */
.nav {
  display: contents;
}

.fullscreen-btn {
  grid-area: fullscreen;
}

.history-btn {
  grid-area: history;
}

.settings-btn {
  grid-area: settings;
}

.fullscreen-btn:hover,
.history-btn:hover,
.settings-btn:hover {
  filter: brightness(1.12);
}

button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Phones in portrait: icon-only Edit, and the status line gets its own row so
   "… crying" isn't cut off next to the buttons. Full screen, History and
   Settings drop into that row too, right-aligned in one flex group, or seven
   buttons would squeeze the title out and the status would lose width. The
   breakpoint sits above the other pages' 560px because the full-screen button
   needs another 68px in the single-row layout. */
@media (max-width: 640px) {
  .monitor-header {
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    grid-template-areas:
      'title layouts edit add'
      'status status nav nav';
    column-gap: 8px;
    row-gap: 6px;
    padding-left: calc(16px + env(safe-area-inset-left));
    padding-right: calc(12px + env(safe-area-inset-right));
  }

  .title {
    align-self: center;
  }

  .status {
    align-self: center;
  }

  .nav {
    grid-area: nav;
    display: flex;
    justify-content: flex-end;
  }

  .fullscreen-btn,
  .history-btn,
  .settings-btn {
    width: 40px;
    height: 40px;
    background: transparent;
    color: var(--color-text-muted);
  }

  .edit-btn {
    width: 52px;
    padding: 0;
    justify-content: center;
  }

  .edit-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
</style>
