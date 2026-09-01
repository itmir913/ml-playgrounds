// @vitest-environment jsdom
// 지원 언어 목록을 `i18n.ts`에서 가져오고, 그 파일에 DOM 부재 가드가 있다.
/**
 * 양식을 가져올 곳들의 등록부 (`project/portfolio-sources.ts`, mlpx-spec.md §8.3·§8.7).
 *
 * **여기서 보는 것은 줄이 어떻게 서는가다** - 무엇을 받아 오는지가 아니라. 무게를
 * 등록부에 둔 이유가 "화면이 경로마다 다른 단추를 만들지 않는 것"이므로, 그 약속이
 * 지켜지는지는 화면 없이 확인할 수 있어야 한다.
 *
 * **검사마다 모듈을 새로 들인다.** 프리셋 목록은 성공한 것을 기억하므로
 * (`portfolio-presets.ts`의 `cached`), 앞 검사가 받아 둔 것이 뒤 검사에 그대로 남는다 -
 * 그러면 "못 받았을 때"를 검사할 방법이 없어진다.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TemplateRow, TemplateSourceContext } from '../src/project/portfolio-sources'

const DIRECTORY = join(process.cwd(), 'public', 'portfolio')
if (!existsSync(DIRECTORY)) throw new Error(`preset directory not found: ${DIRECTORY}`)

const INDEX = readFileSync(join(DIRECTORY, 'index.json'), 'utf-8')

const context: TemplateSourceContext = {
  locale: 'ko',
  translate: (key) => key,
  pickFile: () => Promise.resolve(null),
}

/** 목록을 받아 오는 통로만 흉내 낸다. 받아 온 양식의 내용은 여기서 볼 것이 아니다. */
async function rowsWith(
  fetchImpl: () => Promise<Response>,
): Promise<{ rows: TemplateRow[]; failures: unknown[] }> {
  vi.resetModules()
  vi.stubGlobal('fetch', fetchImpl)
  const { templateRows } = await import('../src/project/portfolio-sources')
  return await templateRows(context)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('앞서는 줄은 하나뿐이다', () => {
  it('파일에서 가져오기가 그 줄이다', async () => {
    const { rows, failures } = await rowsWith(() => Promise.resolve(new Response(INDEX)))

    expect(failures).toEqual([])
    expect(rows.filter((row) => row.weight === 'lead').map((row) => row.key)).toEqual(['file'])
    // 프리셋이 몇이든 나머지는 전부 같은 무게다.
    expect(rows.filter((row) => row.key !== 'file').every((row) => row.weight === 'normal')).toBe(
      true,
    )
    // **무게는 단추 모양이 되고, 순서는 등록부의 순서다** (mlpx-spec.md §8.3).
    // `TemplateSourceList.vue`의 VARIANTS가 lead를 primary로 옮긴다. 한때 이 자리에
    // "무게는 색이 아니라 순서다"라고 명세와 반대로 적혀 있었다 (R9 감사 B-8).
    // 그리고 그 순서를 못 박는 단언이 없어서 등록부를 뒤집어도 안 울었다.
    expect(rows.at(-1)?.key, 'the leading row sits at the bottom of the list').toBe('file')
  })

  /**
   * **프리셋 줄은 자기 언어를 들고 온다** (mlpx-spec.md §8.5). 이 값이 없으면 양식에
   * `template.locale`이 안 박히고, 그건 2026-08-15에 실물 파일로 한 번 터진 자리다.
   *
   * `TemplateRow.locale`이 옵셔널이라 **타입도 안 운다** - 등록부에서 그 칸을 지워도
   * 저장소 전체가 조용했다 (R14-1 감사 A-3).
   */
  it('프리셋 줄은 자기 언어를 들고 온다 - 파일에서 온 것은 모른다', async () => {
    const { rows } = await rowsWith(() => Promise.resolve(new Response(INDEX)))

    const presets = rows.filter((row) => row.key !== 'file')
    expect(presets.length, 'this check needs at least one preset').toBeGreaterThan(0)
    expect(presets.every((row) => row.locale === 'ko')).toBe(true)
    // 밖에서 받은 `.md`는 언어를 **모른다**. 빠뜨림이 아니라 모른다는 뜻이다.
    expect(rows.find((row) => row.key === 'file')?.locale).toBeUndefined()
  })

  it('프리셋 목록을 못 받아도 그 줄은 선다', async () => {
    const { rows, failures } = await rowsWith(() => Promise.reject(new Error('학교망이 막았다')))

    expect(rows.map((row) => row.key)).toEqual(['file'])
    expect(rows[0]?.weight).toBe('lead')
    // 실패는 삼키지 않는다 - 누른 사람은 무슨 일이 있었는지 알아야 한다.
    expect(failures).toHaveLength(1)
  })
})
