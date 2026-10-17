import { createRouter, createWebHistory } from 'vue-router'

import MonitorView from './views/MonitorView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'monitor', component: MonitorView },
    // Cameras are now edited in place on the monitor; keep old bookmarks working.
    { path: '/settings', redirect: '/' },
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
