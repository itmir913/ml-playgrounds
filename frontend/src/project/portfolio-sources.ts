/**
 * 양식은 어디서 오나 (mlpx-spec.md §8.7).
 *
 * **출처는 달라도 하는 일은 같다 - 마크다운 문자열 하나를 돌려주는 것.** 그래서
 * 등록부에는 출처마다 그 함수 하나만 등록되고, 파싱·문항 세우기는 한 벌이다
 * (`portfolio-form.ts`). 입구가 늘었다고 방어선이 갈라지면 그 자리가 곧 구멍이다.
 *
 * **화면은 이 배열을 그대로 그린다.** 경로마다 다른 단추를 만들지 않는다 - 줄이
 * 하나 붙으면 화면이 저절로 그것을 보여준다.
 *
 * **지금 여기 있는 것은 내장 프리셋 하나다.** 파일 열기·주소·URL·자가호스팅 서버는
 * 각자의 단계에서 줄로 붙는다 (`roadmap.md` V5). **안 만든 경로를 비활성으로 미리
 * 세워 두지 않는다** - 회색으로라도 서 있으면 그건 없는 기능을 있다고 말하는 것이다.
 */

import { ClientError } from '@/errors'
import type { Locale } from '@/i18n'

import { presetUrl } from './portfolio-presets'

export interface TemplateSourceContext {
  /** 지금 화면의 언어. 내장 프리셋이 언어마다 하나씩이다 (§8.7). */
  readonly locale: Locale
}

export interface TemplateSource {
  /** 등록부 id. 화면 문구는 `portfolio.source.<id>`에서 찾는다. */
  readonly id: string
  /** 양식 마크다운을 돌려준다. 이것이 출처가 하는 일의 전부다. */
  readonly load: (context: TemplateSourceContext) => Promise<string>
}

/**
 * 내장 프리셋을 받아 온다.
 *
 * **같은 오리진의 정적 파일이다** - 번들에 없으므로 네트워크를 탄다. 못 받는 경우가
 * 실재한다(오프라인, 학교망). 그래서 바닥은 이것이 아니라 빈 양식이고(§8.3), 여기서는
 * 조용히 빈손으로 돌아가지 않고 소리를 낸다.
 */
async function loadPreset({ locale }: TemplateSourceContext): Promise<string> {
  let response: Response
  try {
    response = await fetch(presetUrl(locale))
  } catch {
    throw new ClientError('PORTFOLIO_TEMPLATE_UNAVAILABLE')
  }
  if (!response.ok) throw new ClientError('PORTFOLIO_TEMPLATE_UNAVAILABLE')
  return await response.text()
}

export const TEMPLATE_SOURCES: readonly TemplateSource[] = [{ id: 'preset', load: loadPreset }]
