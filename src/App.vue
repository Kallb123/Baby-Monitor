<script setup lang="ts">
import { RouterView } from 'vue-router'

import { useScreenWakeLock } from '@/composables/useScreenWakeLock'

useScreenWakeLock()
</script>

<template>
  <RouterView />
</template>
