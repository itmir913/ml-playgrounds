/**
 * 앱 진입점. Pinia, vue-i18n, 라우터를 붙인다.
 * 로직은 여기 두지 않는다.
 */

import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')
