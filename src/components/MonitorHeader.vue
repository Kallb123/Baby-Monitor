<script setup lang="ts">
import { onScopeDispose, ref } from 'vue'

import type { LayoutMode } from '@shared/config.ts'
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
  </header>
</template>

<style scoped>
.monitor-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  grid-template-areas:
    'title layouts edit add'
    'status layouts edit add';
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
.add-btn {
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

button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Phones in portrait: icon-only Edit, and the status line gets its own row so
   "… crying" isn't cut off next to the buttons. */
@media (max-width: 560px) {
  .monitor-header {
    grid-template-areas:
      'title layouts edit add'
      'status status status status';
    column-gap: 8px;
    row-gap: 6px;
    padding-left: calc(16px + env(safe-area-inset-left));
    padding-right: calc(12px + env(safe-area-inset-right));
  }

  .title {
    align-self: center;
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
