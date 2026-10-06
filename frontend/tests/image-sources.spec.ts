// @vitest-environment jsdom
// 등록부가 `Translate` 타입을 `i18n.ts`에서 가져오고, 그 파일에 DOM 부재 가드가 있다.
/**
 * 사진 입력 방식 등록부 (`data/image/sources.ts`, open-decisions.md 67).
 *
 * **여기서 보는 것은 줄이 어떻게 서는가다** — 무엇을 받아 오는지가 아니라. 선례
 * (`portfolio-sources.spec.ts`)와 같이, 무게와 덧붙이기를 등록부에 둔 약속이 화면 없이 확인되어야
 * 한다. 받은 파일이 드롭과 같은 길을 타는가는 화면의 검사가 본다.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { withoutComments } from './fixtures/source'

import {
  IMAGE_SOURCES,
  imageSourceRows,
  type ImageSourceContext,
  type PickedFiles,
} from '../src/data/image/sources'

const SRC = join(process.cwd(), 'src')

/** 부를 때마다 기록하고 정해 둔 것을 돌려주는 가짜 context. 번역은 키를 그대로 돌려준다. */
function fakeContext(
  answers: { files?: PickedFiles; folder?: PickedFiles; sketch?: PickedFiles } = {},
  translate: (key: string) => string = (key) => key,
): ImageSourceContext & {
  pickFiles: ReturnType<typeof vi.fn>
  pickFolder: ReturnType<typeof vi.fn>
  openSketch: ReturnType<typeof vi.fn>
} {
  return {
    translate,
    pickFiles: vi.fn(() => Promise.resolve(answers.files ?? null)),
    pickFolder: vi.fn(() => Promise.resolve(answers.folder ?? null)),
    openSketch: vi.fn(() => Promise.resolve(answers.sketch ?? null)),
  }
}

describe('줄이 선다', () => {
  it('사진 선택·폴더 선택·그리기가 이 순서로 선다', async () => {
    const { rows, failures } = await imageSourceRows(fakeContext())
    expect(failures).toEqual([])
    expect(rows.map((row) => row.key)).toEqual(['files', 'folder', 'sketch'])
    expect(rows.map((row) => row.label)).toEqual([
      'data.image.source.files',
      'data.image.source.folder',
      'data.image.source.sketch',
    ])
  })

  it('출처는 파일과 그리기 둘이다', () => {
    expect(IMAGE_SOURCES.map((source) => source.id)).toEqual(['files', 'sketch'])
  })

  it('앞서는 줄은 하나뿐이다 - 사진 선택이다', async () => {
    const { rows } = await imageSourceRows(fakeContext())
    expect(rows.filter((row) => row.weight === 'lead').map((row) => row.key)).toEqual(['files'])
    expect(rows.filter((row) => row.key !== 'files').every((row) => row.weight === 'normal')).toBe(
      true,
    )
  })

  /** **디스크에 없는 것은 갈아끼우면 사라진다** — 그림만 덧붙인다. 붙여넣기와 같은 판단이다. */
  it('그리기만 덧붙인다', async () => {
    const { rows } = await imageSourceRows(fakeContext())
    expect(Object.fromEntries(rows.map((row) => [row.key, row.appends]))).toEqual({
      files: false,
      folder: false,
      sketch: true,
    })
  })

  /** **안 만든 경로를 회색으로도 세우지 않는다** (선례 `portfolio-sources.ts`의 머리말). */
  it('웹캠 줄이 없다', async () => {
    const { rows } = await imageSourceRows(fakeContext())
    const named = (text: string): boolean => /webcam|camera/i.test(text)
    expect(rows.filter((row) => named(row.key) || named(row.label))).toEqual([])
    expect(IMAGE_SOURCES.filter((source) => named(source.id))).toEqual([])
  })
})

describe('load는 화면이 준 함수를 부른다', () => {
  const picked = [new File(['a'], 'a.png')]
  const folder = [new File(['b'], 'cat/b.png')]
  const drawn = [new File(['c'], 'drawn-1.png'), new File(['d'], 'drawn-2.png')]

  it('줄마다 제 함수를 한 번 부르고 받은 것을 그대로 넘긴다', async () => {
    const context = fakeContext({ files: picked, folder, sketch: drawn })
    const { rows } = await imageSourceRows(context)
    const byKey = new Map(rows.map((row) => [row.key, row]))

    // 줄을 세우는 것만으로는 아무 창도 안 연다.
    expect(context.pickFiles).not.toHaveBeenCalled()
    expect(context.pickFolder).not.toHaveBeenCalled()
    expect(context.openSketch).not.toHaveBeenCalled()

    expect(await byKey.get('files')?.load()).toBe(picked)
    expect(await byKey.get('folder')?.load()).toBe(folder)
    expect(await byKey.get('sketch')?.load()).toBe(drawn)
    expect(context.pickFiles).toHaveBeenCalledTimes(1)
    expect(context.pickFolder).toHaveBeenCalledTimes(1)
    expect(context.openSketch).toHaveBeenCalledTimes(1)
  })

  it('닫은 것(`null`)을 그대로 넘긴다 - 실패가 아니다', async () => {
    const { rows } = await imageSourceRows(fakeContext())
    for (const row of rows) expect(await row.load(), row.key).toBeNull()
  })
})

describe('한 출처가 던져도 나머지는 선다', () => {
  it('번역이 동기로 던져도 다른 출처의 줄은 선다', async () => {
    const boom = new Error('translate failed')
    const { rows, failures } = await imageSourceRows(
      fakeContext({}, (key) => {
        if (key === 'data.image.source.sketch') throw boom
        return key
      }),
    )
    expect(rows.map((row) => row.key)).toEqual(['files', 'folder'])
    expect(failures).toEqual([boom])
  })

  it('앞 출처가 던져도 뒤 출처는 선다', async () => {
    const boom = new Error('translate failed')
    const { rows, failures } = await imageSourceRows(
      fakeContext({}, (key) => {
        if (key === 'data.image.source.files') throw boom
        return key
      }),
    )
    expect(rows.map((row) => row.key)).toEqual(['sketch'])
    expect(failures).toEqual([boom])
  })
})

/**
 * **등록부와 그리기는 화면·프로젝트·굽기를 모른다** (open-decisions.md 67 "구현이 지킬 것").
 * 그래야 화면 없이 검사할 수 있고, 메뉴와 대화상자가 바뀌어도 이 둘은 안 흔들린다.
 *
 * **직접 들이는 것만 본다.** 허용한 `@/i18n`·`@/limits`·`@/data/image/formats`의 뒤까지는 안
 * 따라간다 — 그래서 `@/i18n`은 **타입으로만** 들여야 한다(그 모듈은 `vue-i18n`을 부른다). 세 모양
 * (`from`·부작용 `import`·동적 `import()`)을 다 보는 것은 `limits-rules.spec.ts`의 워커 검사와 같다.
 */
describe('등록부와 그리기가 화면·프로젝트·굽기를 안 들인다', () => {
  const GUARDED = ['data/image/sources.ts', 'data/image/sketch.ts']

  /** `vue` 계열, 저장소·화면 계층, 프로젝트 계층, 굽기·워커 쪽 모듈. 경로는 `@/` 꼴로 본다. */
  const FORBIDDEN =
    /^(?:vue$|@vue\/|pinia$|vue-i18n$|idb$|@\/(?:stores|components|views|composables|project)(?:\/|$)|@\/data\/image\/(?:bake|client|spawn|handler|upload|canonical|canonicalize\.worker|room|test-set)$)/

  const QUOTE = String.fromCharCode(39)

  /** 들이는 지정자와 그 줄이 타입 전용인가. 상대 경로는 `@/` 꼴로 바꾼다. */
  function importsOf(path: string, source: string): { specifier: string; typeOnly: boolean }[] {
    const text = withoutComments(source).join(String.fromCharCode(10))
    const found = [
      ...text.matchAll(/(import\s+type\b[^'"]*?)?\bfrom\s*['"]([^'"]+)['"]/g),
      ...text.matchAll(/()\bimport\s+['"]([^'"]+)['"]/g),
      ...text.matchAll(/()\bimport\s*\(\s*['"]([^'"]+)['"]/g),
    ]
    return found.map((match) => {
      const raw = match[2] ?? ''
      const specifier = raw.startsWith('.')
        ? `@/${relative(SRC, join(dirname(path), raw))
            .split('\\')
            .join('/')}`
        : raw
      return { specifier, typeOnly: (match[1] ?? '') !== '' }
    })
  }

  function violations(path: string, source: string): string[] {
    return importsOf(path, source).flatMap(({ specifier, typeOnly }) => {
      if (FORBIDDEN.test(specifier)) return [specifier]
      if (specifier === '@/i18n' && !typeOnly) return [`${specifier} (not type-only)`]
      return []
    })
  }

  /** 예문은 조립한다 — 이 파일이 import 훑기에 읽혀도 진짜 들임으로 안 보이게. */
  const line = (head: string, spec: string): string => `${head} ${QUOTE}${spec}${QUOTE}`
  const AT = join(SRC, 'data', 'image', 'sources.ts')

  it('검사기가 잡는다', () => {
    const cases = [
      line('import { ref } from', 'vue'),
      line('import { useProjectStore } from', '@/stores/project'),
      line('import AppButton from', '@/components/AppButton.vue'),
      line('import { addImages } from', '@/project/images'),
      line('import { bakeCanonical } from', './bake'),
      line('import { canonicalizeImages } from', '../image/client'),
      line('import', '@/composables/usePasteImages'),
      `const m = await import(${QUOTE}@/stores/project${QUOTE})`,
      line('import { i18n } from', '@/i18n'),
    ]
    for (const one of cases) expect(violations(AT, one), one).not.toEqual([])
  })

  it('검사기가 안 잡는다', () => {
    const cases = [
      line('import type { Translate } from', '@/i18n'),
      line('import { SKETCH_INK } from', '@/limits'),
      line('import { SKETCH_EXPORT_FORMAT } from', './formats'),
      // 주석은 걷어낸다.
      `// ${line('import { ref } from', 'vue')}`,
    ]
    for (const one of cases) expect(violations(AT, one), one).toEqual([])
  })

  it('지킬 파일을 실제로 읽고 들이는 것을 찾는다', () => {
    for (const file of GUARDED) {
      const path = join(SRC, file)
      expect(importsOf(path, readFileSync(path, 'utf-8')).length, file).toBeGreaterThan(0)
    }
  })

  it('지금 소스에 위반이 없다', () => {
    const found = GUARDED.flatMap((file) => {
      const path = join(SRC, file)
      return violations(path, readFileSync(path, 'utf-8')).map((one) => `${file} -> ${one}`)
    })
    expect(found, 'the source registry and sketch logic must not know screens or baking').toEqual(
      [],
    )
  })
})
