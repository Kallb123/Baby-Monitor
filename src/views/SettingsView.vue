<script setup lang="ts">
import { onMounted, ref, toRaw, watch } from 'vue'
import { useRouter } from 'vue-router'

import { ApiRequestError } from '@/api'
import { useConfigStore } from '@/stores/config'
import { appConfigSchema, layoutModes, type AppConfig, type Camera } from '@shared/config.ts'

const configStore = useConfigStore()
const router = useRouter()

// Edit a detached copy so the monitor keeps showing the saved config until Save.
const cloneConfig = (config: AppConfig) => structuredClone(toRaw(config))
const draft = ref<AppConfig>(cloneConfig(configStore.config))
const errors = ref<Record<string, string>>({})
const saving = ref(false)
const saveError = ref<string>()

watch(
  () => configStore.config,
  (config) => (draft.value = cloneConfig(config)),
)

onMounted(() => {
  if (!configStore.loaded) void configStore.load()
})

const entityFields = [
  { key: 'cry', label: 'Cry detection entity', placeholder: 'binary_sensor.nursery_crying' },
  { key: 'temperature', label: 'Temperature entity', placeholder: 'sensor.nursery_temperature' },
  { key: 'humidity', label: 'Humidity entity', placeholder: 'sensor.nursery_humidity' },
] as const

function addCamera() {
  const n = draft.value.cameras.length + 1
  draft.value.cameras.push({ id: `camera-${n}`, name: `Camera ${n}`, rtspUrl: '', entities: {} })
}

function removeCamera(index: number) {
  draft.value.cameras.splice(index, 1)
}

/** Blank optional inputs become undefined so the schema treats them as unset. */
function normalise(config: AppConfig): AppConfig {
  const cameras = config.cameras.map((camera): Camera => ({
    ...camera,
    entities: Object.fromEntries(
      Object.entries(camera.entities).filter(([, value]) => value?.trim()),
    ),
  }))
  return {
    ...config,
    cameras,
    layout: { ...config.layout, focusCameraId: config.layout.focusCameraId || undefined },
  }
}

function toErrors(issues: { path: PropertyKey[]; message: string }[]) {
  return Object.fromEntries(
    issues.map((issue) => [issue.path.map(String).join('.'), issue.message]),
  )
}

async function save() {
  saveError.value = undefined
  const candidate = normalise(draft.value)
  const result = appConfigSchema.safeParse(candidate)
  if (!result.success) {
    errors.value = toErrors(result.error.issues)
    return
  }
  errors.value = {}
  saving.value = true
  try {
    await configStore.save(result.data)
    await router.push('/')
  } catch (e) {
    if (e instanceof ApiRequestError && e.body?.issues) errors.value = toErrors(e.body.issues)
    saveError.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="settings">
    <header>
      <RouterLink to="/" class="back">← Monitor</RouterLink>
      <h1>Settings</h1>
    </header>

    <form @submit.prevent="save">
      <section>
        <h2>Layout</h2>
        <label>
          Mode
          <select v-model="draft.layout.mode">
            <option v-for="mode in layoutModes" :key="mode" :value="mode">{{ mode }}</option>
          </select>
        </label>
        <label v-if="draft.layout.mode === 'focus'">
          Large camera
          <select v-model="draft.layout.focusCameraId">
            <option :value="undefined">First camera</option>
            <option v-for="camera in draft.cameras" :key="camera.id" :value="camera.id">
              {{ camera.name }}
            </option>
          </select>
        </label>
      </section>

      <section>
        <h2>Cameras</h2>
        <fieldset v-for="(camera, index) in draft.cameras" :key="index" class="camera">
          <legend>{{ camera.name || `Camera ${index + 1}` }}</legend>
          <label>
            Name
            <input v-model="camera.name" required />
            <small v-if="errors[`cameras.${index}.name`]">{{
              errors[`cameras.${index}.name`]
            }}</small>
          </label>
          <label>
            ID (also the go2rtc stream name)
            <input v-model="camera.id" required />
            <small v-if="errors[`cameras.${index}.id`]">{{ errors[`cameras.${index}.id`] }}</small>
          </label>
          <label>
            RTSP URL
            <input
              v-model="camera.rtspUrl"
              placeholder="rtsp://user:pass@192.168.1.20:554/stream1"
              autocomplete="off"
              required
            />
            <small v-if="errors[`cameras.${index}.rtspUrl`]">
              {{ errors[`cameras.${index}.rtspUrl`] }}
            </small>
          </label>
          <label v-for="field in entityFields" :key="field.key">
            {{ field.label }}
            <input v-model="camera.entities[field.key]" :placeholder="field.placeholder" />
            <small v-if="errors[`cameras.${index}.entities.${field.key}`]">
              {{ errors[`cameras.${index}.entities.${field.key}`] }}
            </small>
          </label>
          <button type="button" class="danger" @click="removeCamera(index)">Remove camera</button>
        </fieldset>
        <button type="button" @click="addCamera">Add camera</button>
      </section>

      <p v-if="saveError" class="notice error">{{ saveError }}</p>
      <button type="submit" class="primary" :disabled="saving">
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
    </form>
  </main>
</template>

<style scoped>
.settings {
  max-width: 640px;
  margin: 0 auto;
  padding: calc(16px + env(safe-area-inset-top)) 16px calc(32px + env(safe-area-inset-bottom));
  overflow-y: auto;
  height: 100%;
}

header {
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 16px;
}

.back {
  color: var(--accent);
  text-decoration: none;
}

form,
section,
fieldset {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

section {
  margin-bottom: 24px;
}

fieldset {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.9rem;
  color: var(--text-muted);
}

small {
  color: var(--alert);
}
</style>
