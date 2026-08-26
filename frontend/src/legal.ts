/**
 * **바깥에 내놓는 규정이 어디 있는가.** 주소를 아는 곳은 여기 하나다.
 *
 * 문서 자체는 앱 안에 없다 — `public/legal/`의 자립 HTML이고, 앱은 링크만 건다.
 * 전문을 로케일 JSON에 넣으면 조문이 수십 개 키로 쪼개지고(CLAUDE.md §3의 "한 문장은
 * 한 키"), 조 하나를 고칠 때마다 앱을 다시 빌드해야 한다. 근거는
 * `open-decisions.md` "바깥에 내놓는 규정은 앱이 데리고 간다".
 *
 * **전부 상대 경로다.** 절대 주소를 박으면 학교가 직접 띄운 자가호스팅이 남의
 * 사이트를 가리킨다 (`open-decisions.md` #10-1의 "`base`는 `'./'`(상대 경로)다").
 *
 * **처리방침은 로케일마다 한 장이다.** 언어를 늘리고 `public/legal/`을 안 채우면
 * 학생이 404를 본다 — `tests/legal.spec.ts`가 SUPPORTED_LOCALES와 대조해서 막는다.
 */

import type { Locale } from '@/i18n'

/** 규정 서랍. **학운위 심의 서류에 적는 주소가 이것이다.** */
export const LEGAL_INDEX_PATH = './legal/'

/**
 * 오픈소스 고지. **빌드가 굽는 파일이라 `public/`에 없다** —
 * 이름의 출처는 `scripts/notices.ts`의 `NOTICES_FILE`이고, 둘이 어긋나면
 * `tests/legal.spec.ts`가 운다. 여기서 그 모듈을 import하지 않는 것은 그쪽이
 * 노드 전용이라 번들에 들어오면 안 되기 때문이다.
 */
export const NOTICES_PATH = './third-party-notices.txt'

/** 그 언어의 개인정보 처리방침. */
export function privacyPath(locale: Locale): string {
  return `${LEGAL_INDEX_PATH}privacy.${locale}.html`
}
