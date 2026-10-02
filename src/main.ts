import './style.css'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'

// Resolve pixi-filters deprecated API warning
// pixi-filters v5 internally uses settings.FILTER_RESOLUTION, which is deprecated in PixiJS v7+
import { Filter } from 'pixi.js'
Filter.defaultResolution = window.devicePixelRatio || 1

import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import router from './router'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.mount('#app')
