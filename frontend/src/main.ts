/**
 * 앱 진입점. Pinia, vue-i18n, 라우터를 붙인다.
 * 로직은 여기 두지 않는다.
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { i18n, initLocale } from './i18n'
import './style.css'

const app = createApp(App)
app.use(createPinia())
app.use(i18n)

// 저장된 언어 선택을 읽는 동안 화면을 막지 않는다.
// 시작은 대체 언어이고, 결정되는 즉시 교체된다.
void initLocale()

app.mount('#app')
