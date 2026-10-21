/**
 * **차트의 숫자도 지금 고른 언어로 찍는다** (open-decisions.md "119. 화면의 세는 수를 어디서 포맷하는가").
 *
 * Chart.js는 눈금·툴팁의 숫자를 `options.locale`로 포맷하고, 비어 있으면 **브라우저 언어**를 쓴다. 그러면 같은
 * 그림에서 툴팁(우리 문장 — 고른 언어)과 축 눈금(브라우저 언어)이 다른 규칙으로 찍힌다.
 *
 * **차트를 등록하는 부품마다 이 파일을 들인다**(부작용 import). 차트 라이브러리는 지연 로딩이라 `i18n.ts`가 직접
 * 부르면 차트를 안 보는 학생도 그 라이브러리를 받는다. 무는 검사: `chart-registry.spec.ts` "차트를 등록하는 부품은
 * 언어를 따라간다".
 */

import { Chart } from 'chart.js'
import { watchEffect } from 'vue'

import { i18n } from '../i18n'

watchEffect(() => {
  Chart.defaults.locale = i18n.global.locale.value
})
