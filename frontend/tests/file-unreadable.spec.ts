/**
 * **고른 파일을 못 읽으면 "다시 골라라"고 말한다** (open-decisions.md 77, `FILE_UNREADABLE`).
 *
 * 고른 뒤 원본이 옮겨졌거나 USB가 빠지면 `File.arrayBuffer()`·`text()`가 `NotReadableError`
 * 따위로 거절한다. 전에는 그것이 `UNEXPECTED_ERROR`와 영어 원문으로 떴다(2026-09-29 감사 H #13).
 *
 * 재는 것은 둘이다.
 *
 * 1. **문 두 개가 거절을 우리 코드로 바꾸고 원문을 `detail`로 남긴다.**
 * 2. **학생의 파일을 읽는 자리가 그 문 말고는 없다** — 새 화면이 `file.arrayBuffer()`를 직접
 *    부르면 그 자리만 옛 모양으로 돌아간다. 소스를 글자로 훑어 막는다.
 */

import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { readFileBytes, readFileText } from '../src/project/download'
import { sourceFiles, withoutComments } from './fixtures/source'

const SRC = join(process.cwd(), 'src')

/** 읽으면 거절하는 파일. 브라우저가 내는 이름 그대로다. */
function unreadable(): File {
  const file = new File([new Uint8Array([1, 2, 3])], 'moved.csv')
  const refuse = (): Promise<never> =>
    Promise.reject(new DOMException('The requested file could not be read.', 'NotReadableError'))
  Object.defineProperty(file, 'arrayBuffer', { value: refuse })
  Object.defineProperty(file, 'text', { value: refuse })
  return file
}

describe('결정 77: 파일을 읽는 문', () => {
  for (const [name, read] of [
    ['readFileBytes', readFileBytes],
    ['readFileText', readFileText],
  ] as const) {
    it(`${name}: 거절은 FILE_UNREADABLE이고 원문은 detail에 남는다`, async () => {
      const thrown: unknown = await (read as (file: File) => Promise<unknown>)(unreadable()).catch(
        (error: unknown) => error,
      )
      expect(isClientError(thrown) && thrown.code).toBe('FILE_UNREADABLE')
      expect(isClientError(thrown) && thrown.params.detail).toBe(
        'The requested file could not be read.',
      )
    })
  }

  it('읽히는 파일은 그대로 읽는다 (대조)', async () => {
    const file = new File(['가,나\n1,2\n'], 'ok.csv')
    expect(await readFileText(file)).toBe('가,나\n1,2\n')
    expect(await readFileBytes(file)).toEqual(new Uint8Array(await file.arrayBuffer()))
  })
})

/**
 * **파일을 읽는 자리는 두 문뿐이다.** 여기 적힌 것만 `arrayBuffer()`·`text()`를 직접 부른다 —
 * 학생이 고른 파일이 아니라 우리가 만든 `Blob`이나 `fetch`의 응답을 읽는 자리다.
 */
const DIRECT_READERS: Readonly<Record<string, string>> = {
  'project/download.ts': '두 문 자신',
  'data/image/bake.ts': '캔버스가 구운 Blob',
  'project/portfolio-presets.ts': 'fetch 응답',
}

describe('결정 77: 학생의 파일을 읽는 자리', () => {
  it('두 문 밖에서 arrayBuffer()·text()를 직접 부르지 않는다', () => {
    const offenders: string[] = []
    for (const path of sourceFiles(SRC)) {
      const name = relative(SRC, path).split(sep).join('/')
      if (name in DIRECT_READERS) continue
      withoutComments(readFileSync(path, 'utf-8')).forEach((line, index) => {
        if (/\.(arrayBuffer|text)\(\)/.test(line)) offenders.push(`${name}:${index + 1}`)
      })
    }
    expect(offenders, 'read a picked file through readFileBytes/readFileText').toEqual([])
  })

  it('허락 목록은 실제로 직접 읽는 파일만 담는다', () => {
    for (const name of Object.keys(DIRECT_READERS)) {
      const code = withoutComments(readFileSync(join(SRC, name), 'utf-8')).join('\n')
      expect(code, name).toMatch(/\.(arrayBuffer|text)\(\)/)
    }
  })
})
