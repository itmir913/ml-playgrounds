/**
 * 내장 양식이 어디 있는가 (mlpx-spec.md §8.7).
 *
 * **번들에 넣지 않고 `public/`에 둔다.** 그러면 내장도 "받아 오는 것"이 되어 파일·
 * 주소·백엔드와 같은 모양이 되고, 파싱과 문항 세우기가 한 벌로 끝난다 - 내장만
 * 특별 취급하는 분기가 없다. 깃에서 파일로 관리되는 것도 값이다: 양식을 고치는
 * 일이 코드를 고치는 일이 아니게 된다.
 *
 * **대가는 네트워크를 탄다는 것이다.** 그래서 바닥은 프리셋이 아니라 빈 양식이다
 * (§8.3) - 그건 코드가 만들고 파일도 연결도 필요 없다.
 *
 * **이름은 프리셋이 하나일 때의 것이다.** 여럿이 되면 디렉터리로 옮긴다 - `public/`
 * 파일이라 주소만 바뀌고 아무것도 안 깨진다.
 */

import type { Locale } from '@/i18n'

/** `public/` 안의 파일 이름. 검사가 이 함수로 파일 목록과 지원 언어를 맞춰 본다. */
export function presetFileName(locale: Locale): string {
  return `portfolio.preset.${locale}.md`
}

/**
 * 받아 올 주소. **`BASE_URL`을 지난다** - GitHub Pages는 저장소 이름이 앞에 붙는
 * 경로에서 서빙되고, 자가호스팅은 루트다 (CLAUDE.md §2).
 */
export function presetUrl(locale: Locale): string {
  return `${import.meta.env.BASE_URL}${presetFileName(locale)}`
}
