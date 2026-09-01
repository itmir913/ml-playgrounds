/**
 * 앱 진입점. Pinia, vue-i18n, 라우터를 붙인다.
 * 로직은 여기 두지 않는다.
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { i18n, initLocale } from './i18n'
import { initLimitsOff } from './limits-switch'
import { router } from './router'
import { initTheme } from './theme'
import './styles/index.css'

const app = createApp(App)
// Pinia가 먼저다. 라우터 가드가 스토어를 부르므로 첫 이동 전에 활성 인스턴스가 있어야 한다.
app.use(createPinia())
app.use(i18n)
app.use(router)

// 저장된 언어 선택을 읽는 동안 화면을 막지 않는다.
// 시작은 대체 언어이고, 결정되는 즉시 교체된다.
void initLocale()

// 상한 해제도 같은 자리에 저장돼 있다 (`project/storage.ts`의 preferences).
// **읽는 동안은 상한이 살아 있다** - 안전한 쪽에서 시작해 도착하면 풀린다.
void initLimitsOff()

// 배색은 기기 설정만 보므로 기다릴 것이 없다. **마운트보다 먼저** 정해야 첫 그림이
// 밝게 떴다가 어두워지지 않는다.
initTheme()

app.mount('#app')
