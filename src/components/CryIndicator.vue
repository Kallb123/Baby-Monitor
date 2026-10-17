<script setup lang="ts">
defineProps<{
  crying: boolean
}>()
</script>

<template>
  <div
    class="cry-indicator"
    :class="{ crying }"
    role="status"
    :aria-label="crying ? 'Crying detected' : 'No crying detected'"
  >
    <!-- Face with open mouth and tears. -->
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" />
      <circle cx="9" cy="10" r="1.2" fill="currentColor" />
      <circle cx="15" cy="10" r="1.2" fill="currentColor" />
      <ellipse cx="12" cy="15.5" rx="2.4" ry="1.8" fill="currentColor" />
      <path v-if="crying" d="M7.5 12.5 q-0.8 2 0 3 q0.8 -1 0 -3z" fill="currentColor" />
      <path v-if="crying" d="M16.5 12.5 q-0.8 2 0 3 q0.8 -1 0 -3z" fill="currentColor" />
    </svg>
  </div>
</template>

<style scoped>
.cry-indicator {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: rgb(255 255 255 / 45%);
  background: rgb(0 0 0 / 35%);
}

.cry-indicator.crying {
  color: #fff;
  background: var(--alert);
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    transform: scale(1.12);
    box-shadow: 0 0 0 6px rgb(255 77 79 / 25%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .cry-indicator.crying {
    animation: none;
  }
}
</style>
