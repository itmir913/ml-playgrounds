/**
 * **지금 UI 언어를 `Locale`로 좁힌 것.** vue-i18n의 `locale`은 문자열이라 한 번 좁혀야
 * 문자 코드 판정(`data/encoding.ts`)·zip 이름(`data/zip-names.ts`)·처리방침 경로·양식 표에 넘길 수 있다.
 *
 * **좁히는 자리는 여기 하나다** (0.33.3 최종 감사 J-code C-2). 화면 여덟이 같은 한 줄을 들고 있었고,
 * 사진 화면 셋이 그것을 늘 `FALLBACK_LOCALE`로 돌려도 아무것도 안 울었다(C-1) — 판정 검사는 언어를
 * 손으로 주기 때문이다. 이제 화면은 이것을 부르고(`i18n-usage.spec.ts`가 복사본을 막는다),
 * 좁히기 자체는 `use-ui-locale.spec.ts`가 화면을 띄워 잰다.
 */

import { computed, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { FALLBACK_LOCALE, isSupportedLocale, type Locale } from '@/i18n'

export function useUiLocale(): ComputedRef<Locale> {
  const { locale } = useI18n()
  return computed(() => (isSupportedLocale(locale.value) ? locale.value : FALLBACK_LOCALE))
}
