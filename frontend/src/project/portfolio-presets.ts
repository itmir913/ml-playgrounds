/**
 * 내장 양식이 어디 있는가 (mlpx-spec.md §8.7).
 *
 * **번들에 넣지 않고 `public/`에 둔다.** 그러면 내장도 "받아 오는 것"이 되어 파일·
 * 주소·백엔드와 같은 모양이 되고, 파싱과 문항 세우기가 한 벌로 끝난다 - 내장만
 * 특별 취급하는 분기가 없다. 깃에서 파일로 관리되는 것도 값이다: 양식을 고치는
 * 일이 코드를 고치는 일이 아니게 된다.
 *
 * **프리셋은 파일만 더하면 는다.** 목록은 `public/portfolio/index.json`이 갖고 이름도
 * 거기 있다 - 로케일 JSON에 두면 프리셋을 하나 늘리는 데 코드 수정과 배포가 낀다.
 *
 * **그래서 `index.json`도 검증을 거친다.** 우리가 배포하지만 자가호스팅에서는 설치한
 * 쪽이 고치는 파일이다. 깨져 있으면 프리셋 줄만 사라지고 빈 양식과 파일 열기는 그대로
 * 산다 - 바닥은 언제나 빈 양식이다 (§8.3).
 *
 * **대가는 네트워크를 탄다는 것이다.** 그래서 바닥이 프리셋이 아니다.
 */

import { z } from 'zod'

import { ClientError } from '@/errors'
import { FALLBACK_LOCALE, type Locale } from '@/i18n'

/** `public/` 아래 프리셋이 사는 곳. */
const DIRECTORY = 'portfolio/'

/**
 * 프리셋 id로 쓸 수 있는 글자. **주소에 그대로 들어가므로 좁게 잡는다** - `..`이나
 * 슬래시가 들어오면 우리가 남의 파일을 받아 오는 통로가 된다.
 */
const SAFE_ID = /^[a-zA-Z0-9_-]+$/

/**
 * `index.json`의 모양. id마다 언어별 이름이다.
 *
 * ```jsonc
 * { "hello": { "ko": "회상 일기", "en": "Looking back" } }
 * ```
 */
const presetIndexSchema = z.record(z.string(), z.record(z.string(), z.string()))

export interface Preset {
  readonly id: string
  /** 언어 -> 이름. 지원 언어마다 있어야 하고, CI가 그것을 본다. */
  readonly names: Readonly<Record<string, string>>
}

/** `public/` 안의 파일 이름. 검사가 이 함수로 파일 목록과 등록된 프리셋을 맞춰 본다. */
export function presetFileName(id: string, locale: Locale): string {
  return `${id}.${locale}.md`
}

/**
 * 받아 올 주소. **`BASE_URL`을 지난다** - GitHub Pages는 저장소 이름이 앞에 붙는
 * 경로에서 서빙되고, 자가호스팅은 루트다 (CLAUDE.md §2).
 */
export function presetUrl(id: string, locale: Locale): string {
  return `${import.meta.env.BASE_URL}${DIRECTORY}${presetFileName(id, locale)}`
}

export function presetIndexUrl(): string {
  return `${import.meta.env.BASE_URL}${DIRECTORY}index.json`
}

/** 목록에 뜰 이름. 없는 언어는 en으로 떨어지고, 그것도 없으면 id가 그대로 이름이다. */
export function presetName(preset: Preset, locale: Locale): string {
  const name = preset.names[locale] ?? preset.names[FALLBACK_LOCALE] ?? ''
  return name.trim() === '' ? preset.id : name
}

async function fetchText(url: string): Promise<string> {
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    throw new ClientError('PORTFOLIO_TEMPLATE_UNAVAILABLE')
  }
  if (!response.ok) throw new ClientError('PORTFOLIO_TEMPLATE_UNAVAILABLE')
  return await response.text()
}

/**
 * 검증까지 마친 목록. **파싱에 실패한 파일은 없는 것으로 친다** - 깨진 목록으로 화면을
 * 그리면 프리셋을 눌렀을 때 404가 나고, 그건 목록을 못 받은 것보다 나쁘다.
 */
export function parsePresetIndex(text: string): Preset[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ClientError('PORTFOLIO_TEMPLATE_UNAVAILABLE')
  }
  const parsed = presetIndexSchema.safeParse(raw)
  if (!parsed.success) throw new ClientError('PORTFOLIO_TEMPLATE_UNAVAILABLE')

  return Object.entries(parsed.data)
    .filter(([id]) => SAFE_ID.test(id))
    .map(([id, names]) => ({ id, names }))
}

/**
 * 목록을 한 번만 받는다. **성공한 것만 기억한다** - 학교망이 잠깐 막았다고 그 세션
 * 내내 프리셋이 없는 것이 되면 안 된다.
 */
let cached: Promise<Preset[]> | null = null

export function loadPresets(): Promise<Preset[]> {
  cached ??= fetchText(presetIndexUrl())
    .then(parsePresetIndex)
    .catch((error: unknown) => {
      cached = null
      throw error
    })
  return cached
}

export function loadPresetForm(id: string, locale: Locale): Promise<string> {
  return fetchText(presetUrl(id, locale))
}
