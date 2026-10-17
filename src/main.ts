// Self-hosted so the monitor keeps its look on a LAN without internet access.
import '@fontsource/caprasimo/latin-400.css'
import '@fontsource/figtree/latin-400.css'
import '@fontsource/figtree/latin-600.css'
import '@fontsource/figtree/latin-700.css'
import './assets/main.css'

import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { unlockAudioOnFirstGesture } from './lib/audio-context'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)

unlockAudioOnFirstGesture()

app.mount('#app')
