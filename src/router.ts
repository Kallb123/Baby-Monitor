import { createRouter, createWebHistory } from 'vue-router'

import MonitorView from './views/MonitorView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'monitor', component: MonitorView },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('./views/SettingsView.vue'),
    },
  ],
})

// After a redeploy, a long-open tablet may request lazy chunks that no longer
// exist. Reload once to pick up the new build instead of leaving a dead link.
router.onError((error, to) => {
  const chunkFailed = /dynamically imported module|Importing a module script failed/i.test(
    String(error?.message ?? error),
  )
  if (chunkFailed) window.location.assign(to.fullPath)
})

export default router
