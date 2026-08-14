/**
 * 양식은 어디서 오나 (mlpx-spec.md §8.7).
 *
 * **출처는 달라도 하는 일은 같다 - 마크다운 문자열 하나를 돌려주는 것.** 그래서
 * 등록부에는 출처마다 그 함수 하나만 등록되고, 파싱·살균·문항 세우기는 한 벌이다
 * (`portfolio-form.ts`). 입구가 늘었다고 방어선이 갈라지면 그 자리가 곧 구멍이다.
 *
 * **화면은 여기서 나온 줄을 그대로 그린다.** 경로마다 다른 단추를 만들지 않는다 -
 * 줄이 하나 붙으면 화면이 저절로 그것을 보여준다. **출처 하나가 줄 여럿을 낼 수도
 * 있다** - 내장 프리셋이 그렇다.
 *
 * **지금 있는 것이 전부다** - 내장 프리셋과 파일 열기. 주소로 나누는 길은 재 보고
 * 접었고(기본 양식 하나가 758자짜리 링크다), 짧은 코드는 서버가 있어야 성립해서
 * 자가호스팅 백엔드(V6)의 일로 갔다 (`open-decisions.md` "4단계는 접었다").
 *
 * **안 만든 경로를 비활성으로 미리 세워 두지 않는다** - 회색으로라도 서 있으면 그건
 * 없는 기능을 있다고 말하는 것이다.
 *
 * **DOM은 여기 없다.** 파일을 고르게 하는 것은 화면이고, 등록부는 그 함수를 받는다.
 */

import type { Locale } from '@/i18n'

import { loadPresetForm, loadPresets, presetName } from './portfolio-presets'

/** 로케일 키를 문장으로 바꾸는 것. 화면은 `t`를, 검사는 가짜를 넘긴다. */
export type Translate = (key: string) => string

export interface TemplateSourceContext {
  /** 지금 화면의 언어. 내장 프리셋이 언어마다 하나씩이다 (§8.7). */
  readonly locale: Locale
  readonly translate: Translate
  /**
   * 파일 하나를 고르게 한다. 고르지 않고 닫으면 `null`이다.
   *
   * **화면이 준다.** 등록부가 `<input type="file">`을 알기 시작하면 이 파일은 화면
   * 없이 검사할 수 없게 된다.
   */
  readonly pickFile: () => Promise<File | null>
}

export interface TemplateRow {
  /** 목록에서의 자리. 프리셋이 여럿이면 id마다 다르다. */
  readonly key: string
  /** 이미 번역된 이름. 프리셋은 `index.json`에서, 나머지는 로케일에서 온다. */
  readonly label: string
  /** 양식 마크다운. **`null`은 아무 일도 없었다는 뜻이다** - 파일 고르기를 닫았을 때. */
  readonly load: () => Promise<string | null>
}

export interface TemplateSource {
  readonly id: string
  readonly rows: (context: TemplateSourceContext) => Promise<TemplateRow[]>
}

/**
 * 내장 프리셋. **목록이 `public/portfolio/index.json`에서 온다** - 파일 둘과 줄 하나를
 * 더하면 여기 저절로 는다.
 */
const preset: TemplateSource = {
  id: 'preset',
  rows: async ({ locale }) =>
    (await loadPresets()).map((entry) => ({
      key: `preset:${entry.id}`,
      label: presetName(entry, locale),
      load: () => loadPresetForm(entry.id, locale),
    })),
}

/**
 * 파일에서 열기. **가장 확실하다** (§8.7) - 파일을 나르는 통로는 이미 있어야만 한다.
 * 데이터를 나눌 수 없으면 이 도구 자체를 못 쓰기 때문이다.
 */
const file: TemplateSource = {
  id: 'file',
  rows: ({ translate, pickFile }) =>
    Promise.resolve([
      {
        key: 'file',
        label: translate('portfolio.source.file'),
        load: async () => {
          const picked = await pickFile()
          // 고르지 않고 닫은 것은 실패가 아니다. 아무 말도 하지 않는다.
          return picked === null ? null : await picked.text()
        },
      },
    ]),
}

export const TEMPLATE_SOURCES: readonly TemplateSource[] = [preset, file]

/**
 * 목록에 세울 줄 전부.
 *
 * **한 출처가 실패해도 나머지는 선다.** 프리셋 목록을 못 받는 것은 실재하는 상황이고
 * (오프라인, 학교망), 그때 파일 열기까지 사라지면 화면에 남는 것이 없다. 실패는
 * 삼키지 않고 부르는 쪽에 넘긴다 - 누른 사람은 무슨 일이 있었는지 알아야 한다.
 */
export async function templateRows(
  context: TemplateSourceContext,
): Promise<{ rows: TemplateRow[]; failures: unknown[] }> {
  const settled = await Promise.allSettled(TEMPLATE_SOURCES.map((source) => source.rows(context)))
  return {
    rows: settled.flatMap((one) => (one.status === 'fulfilled' ? one.value : [])),
    failures: settled.flatMap((one) => (one.status === 'rejected' ? [one.reason] : [])),
  }
}
