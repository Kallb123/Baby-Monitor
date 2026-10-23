<script setup lang="ts">
import { computed, onMounted, reactive, ref, useId, useTemplateRef } from 'vue'

import { ApiRequestError } from '@/api'
import { cameraIdFromName } from '@/lib/cameras'
import { useConfigStore } from '@/stores/config'
import { useMonitorStore } from '@/stores/monitor'
import {
  appConfigSchema,
  type AppConfig,
  type Camera,
  type CameraEntities,
} from '@shared/config.ts'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  /** Camera to edit; omit to add a new one. */
  cameraId?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const configStore = useConfigStore()
const monitor = useMonitorStore()
const titleId = useId()

const existing = configStore.config.cameras.find((c) => c.id === props.cameraId)
const isEdit = existing !== undefined

const entityFields = [
  { key: 'cry', label: 'Cry detection', placeholder: 'binary_sensor.nursery_crying' },
  { key: 'temperature', label: 'Temperature', placeholder: 'sensor.nursery_temperature' },
  { key: 'humidity', label: 'Humidity', placeholder: 'sensor.nursery_humidity' },
] as const satisfies { key: keyof CameraEntities; label: string; placeholder: string }[]

const form = reactive({
  name: existing?.name ?? '',
  rtspUrl: existing?.rtspUrl ?? '',
  subRtspUrl: existing?.subRtspUrl ?? '',
  entities: { ...existing?.entities } as Record<keyof CameraEntities, string | undefined>,
})
const errors = ref<Record<string, string>>({})
const saveError = ref<string>()
const saving = ref(false)
// Evaluated once: binding it live would collapse the section while someone clears a field.
const sensorsOpen = Object.values(form.entities).some((v) => v?.trim())

const nameInput = useTemplateRef<HTMLInputElement>('nameInput')
onMounted(() => nameInput.value?.focus())

/** Index of this camera in the config being saved, used to pick out its field errors. */
const cameraIndex = computed(() => {
  const index = configStore.config.cameras.findIndex((c) => c.id === existing?.id)
  return index === -1 ? configStore.config.cameras.length : index
})

function buildCamera(): Camera {
  const name = form.name.trim() || 'Camera'
  // Blank optional inputs become unset so the schema doesn't reject them.
  const entities: CameraEntities = Object.fromEntries(
    Object.entries(form.entities)
      .map(([key, value]) => [key, value?.trim()])
      .filter(([, value]) => value),
  )
  const id =
    existing?.id ??
    cameraIdFromName(
      name,
      configStore.config.cameras.map((c) => c.id),
    )
  const subRtspUrl = form.subRtspUrl.trim()
  return { id, name, rtspUrl: form.rtspUrl.trim(), ...(subRtspUrl && { subRtspUrl }), entities }
}

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {}
  let other: string | undefined
  for (const issue of issues) {
    const [root, index, ...rest] = issue.path
    if (root === 'cameras' && index === cameraIndex.value && rest.length > 0) {
      fields[rest.map(String).join('.')] ??= issue.message
    } else {
      other ??= issue.message
    }
  }
  return { fields, other }
}

async function persist(next: AppConfig): Promise<boolean> {
  saveError.value = undefined
  const result = appConfigSchema.safeParse(next)
  if (!result.success) {
    const { fields, other } = fieldErrors(result.error.issues)
    errors.value = fields
    saveError.value = other
    return false
  }
  errors.value = {}
  saving.value = true
  try {
    await configStore.save(result.data)
    return true
  } catch (e) {
    if (e instanceof ApiRequestError && e.body?.issues) {
      errors.value = fieldErrors(e.body.issues).fields
    }
    saveError.value = e instanceof Error ? e.message : String(e)
    return false
  } finally {
    saving.value = false
  }
}

async function save() {
  const camera = buildCamera()
  const { config } = configStore
  const cameras = isEdit
    ? config.cameras.map((c) => (c.id === camera.id ? camera : c))
    : [...config.cameras, camera]
  if (await persist({ ...config, cameras })) emit('close')
}

async function remove() {
  if (!existing) return
  const { config } = configStore
  const cameras = config.cameras.filter((c) => c.id !== existing.id)
  if (!(await persist({ ...config, cameras }))) return
  monitor.setAudio(existing.id, false)
  if (cameras.length === 0) monitor.setEditing(false)
  emit('close')
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <form
      class="dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      novalidate
      @submit.prevent="save"
    >
      <h2 :id="titleId" class="title">{{ isEdit ? 'Edit camera' : 'Add camera' }}</h2>

      <label class="field">
        <span>Camera name</span>
        <input
          ref="nameInput"
          v-model="form.name"
          class="input"
          placeholder="e.g. Maya's room"
          autocomplete="off"
        />
        <small v-if="errors.name" class="error">{{ errors.name }}</small>
      </label>

      <label class="field">
        <span>Stream address (RTSP)</span>
        <input
          v-model="form.rtspUrl"
          class="input"
          inputmode="url"
          placeholder="rtsp://user:pass@192.168.1.20:554/stream1"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
        <small v-if="errors.rtspUrl" class="error">{{ errors.rtspUrl }}</small>
      </label>

      <label class="field">
        <span>Sub-stream address (RTSP, optional)</span>
        <input
          v-model="form.subRtspUrl"
          class="input"
          inputmode="url"
          placeholder="rtsp://user:pass@192.168.1.20:554/stream2"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
        <small v-if="errors.subRtspUrl" class="error">{{ errors.subRtspUrl }}</small>
        <small v-else class="hint">
          A lower-resolution stream from the same camera, used for small tiles.
        </small>
      </label>

      <details class="sensors" :open="sensorsOpen || undefined">
        <summary>Home Assistant sensors</summary>
        <label v-for="field in entityFields" :key="field.key" class="field">
          <span>{{ field.label }}</span>
          <input
            v-model="form.entities[field.key]"
            class="input small"
            :placeholder="field.placeholder"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
          <small v-if="errors[`entities.${field.key}`]" class="error">
            {{ errors[`entities.${field.key}`] }}
          </small>
        </label>
      </details>

      <p v-if="saveError" class="error" role="alert">{{ saveError }}</p>

      <div class="actions">
        <button
          v-if="isEdit"
          type="button"
          class="btn btn-ghost"
          :disabled="saving"
          @click="remove"
        >
          <AppIcon name="trash" :size="18" />
          <span>Remove</span>
        </button>
        <span class="spacer" />
        <button type="button" class="btn btn-secondary" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Saving…' : isEdit ? 'Save' : 'Add' }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
  /* Flex rather than grid so the dialog's max-height resolves against the
     viewport and it scrolls on a landscape phone instead of overflowing. */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(20px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right))
    max(20px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));
  background: var(--color-scrim);
}

.dialog {
  width: min(440px, 100%);
  max-height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 28px;
  border-radius: var(--radius-card);
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
}

.title {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 24px;
  font-weight: 400;
  color: var(--color-text-strong);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 14px;
  color: var(--color-text-muted);
}

.input {
  height: 52px;
  padding: 0 20px;
  font-size: 17px;
  color: var(--color-text-strong);
  caret-color: var(--color-accent-400);
  background: var(--color-bg);
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-pill);
}

.input.small {
  height: 48px;
  font-size: 15px;
}

.input::placeholder {
  color: var(--color-neutral-600);
}

.input:hover {
  border-color: var(--color-neutral-700);
}

.input:focus,
.input:focus-visible {
  border-color: var(--color-accent-500);
  outline: none;
}

.sensors summary {
  width: fit-content;
  padding: 8px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-accent-400);
  cursor: pointer;
}

.sensors .field {
  margin-top: 14px;
}

.hint {
  font-size: 13px;
  color: var(--color-text-muted);
}

.error {
  margin: 0;
  font-size: 13px;
  color: var(--color-accent-300);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}

.spacer {
  flex: 1;
}
</style>
