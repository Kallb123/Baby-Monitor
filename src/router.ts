import { createRouter, createWebHistory } from 'vue-router'

import MonitorView from './views/MonitorView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'monitor', component: MonitorView },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
  ],
})

export default router
