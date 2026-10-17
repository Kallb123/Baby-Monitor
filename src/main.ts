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
