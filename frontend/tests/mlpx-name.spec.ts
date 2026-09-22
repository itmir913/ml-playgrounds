/**
 * **프로젝트 파일의 이름** — 판정과 `accept`와 확장자 제거가 한 자리에서 나오는가
 * (결정문 48, 2026-09-23).
 *
 * 실물에서 나왔다. **아이패드·아이폰 사파리는 내보낸 `비올까.mlpx`를 `비올까.mlpx.zip`으로
 * 저장한다** — `Blob`의 종류가 말하는 확장자를 이름에 덧붙인다. 그 이름이 점검 화면에서
 * 조용히 떨어졌다.
 *
 * **여기가 무는 것은 갈림이다.** 판정만 넓히면 거울상이 생긴다 — 열 수는 있는데
 * **고를 수 없는** 파일. 교사는 데스크톱에서 제출물을 여는데 거기서는 대화상자가 정말로
 * 걸러 낸다. 거울상의 원본(`accept`와 판정이 갈려 고를 수는 있는데 안 열리는 파일)은
 * `rule-coverage.md`에 이미 적혀 있다.
 *
 * **못 보는 것: 사파리가 이름에 무엇을 붙이는가.** 브라우저의 저장 동작이라 검사가 닿지
 * 않는다 — `MLPX_MIME`을 바꾼 뒤 기기에서 사람이 쟀다(`format.ts`).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  isProjectFileName,
  MLPX_ACCEPT,
  MLPX_EXTENSION,
  MLPX_MIME,
  withoutProjectExtension,
} from '../src/project/format'
import { rosterOf } from '../src/project/roster'
import { folderFor, folderNames } from '../src/project/portfolio-bundle'

const SAFARI = `${MLPX_EXTENSION}.zip`

describe('무엇을 프로젝트 파일로 보는가', () => {
  it('두 이름을 다 받는다', () => {
    expect(isProjectFileName(`비올까${MLPX_EXTENSION}`)).toBe(true)
    expect(isProjectFileName(`비올까${SAFARI}`)).toBe(true)
  })

  /** 리눅스에서 `.MLPX`가 만들어진다. 대소문자로 제출물이 사라지면 안 된다. */
  it('대소문자를 안 본다', () => {
    expect(isProjectFileName('비올까.MLPX')).toBe(true)
    expect(isProjectFileName('비올까.Mlpx.ZIP')).toBe(true)
  })

  /**
   * **관용의 범위는 `.mlpx.zip` 하나다.** 맨 `.zip`을 받으면 교사가 폴더째 놓을 때
   * 학생이 올린 사진 묶음까지 프로젝트 목록에 뜬다.
   */
  it('그냥 압축 파일은 안 받는다', () => {
    expect(isProjectFileName('사진.zip')).toBe(false)
    expect(isProjectFileName('비올까.zip')).toBe(false)
    expect(isProjectFileName('mlpx.zip')).toBe(false)
  })

  it('비슷한 이름에 속지 않는다', () => {
    expect(isProjectFileName('비올까.mlpx.csv')).toBe(false)
    expect(isProjectFileName('비올까.mlpxzip')).toBe(false)
    expect(isProjectFileName('비올까')).toBe(false)
  })
})

describe('고르는 자리와 받는 자리가 같다', () => {
  /**
   * **`accept`의 토큰 전부가 받아들여지는 이름이어야 한다.** 하나라도 판정이 거절하면
   * 고를 수는 있는데 안 열리는 파일이 생긴다.
   */
  it('accept가 말하는 것을 판정이 전부 받는다', () => {
    const tokens = MLPX_ACCEPT.split(',')
    expect(tokens.length).toBeGreaterThan(1)
    for (const token of tokens) expect(isProjectFileName(`비올까${token}`), token).toBe(true)
  })

  /** 거울상: 판정이 받는 두 모양이 `accept`에 있어야 고를 수 있다. */
  it('판정이 받는 모양이 accept에 다 있다', () => {
    for (const tail of [MLPX_EXTENSION, SAFARI]) {
      expect(MLPX_ACCEPT.split(',')).toContain(tail)
    }
  })

  /**
   * **`accept`를 손으로 적은 자리가 없다.** 상수를 세워도 다음 사람이 화면에 직접 적으면
   * 그 자리만 안 고쳐진다 — 이미지 zip에서 같은 일이 있었다(R11 C-5).
   */
  it('화면이 확장자를 손으로 적지 않는다', () => {
    const views = ['src/views/InspectView.vue', 'src/views/WelcomeView.vue']
    for (const path of views) {
      const source = readFileSync(join(process.cwd(), path), 'utf-8')
      const accepts = [...source.matchAll(/accept="([^"]*)"/g)].map((found) => found[1])
      for (const value of accepts) expect(value, `${path}: ${value ?? ''}`).not.toContain('.mlpx')
    }
  })
})

describe('명렬이 사파리의 이름을 세운다', () => {
  function fileOf(name: string): File {
    return new File([new Uint8Array([1, 2, 3])], name)
  }

  it('붙은 이름도 한 줄로 선다', () => {
    const items = rosterOf([fileOf(`비올까${SAFARI}`)])
    expect(items.map((item) => item.label)).toEqual([`비올까${SAFARI}`])
  })

  it('사진 묶음은 안 선다', () => {
    expect(rosterOf([fileOf('사진.zip')])).toEqual([])
  })
})

describe('확장자 제거', () => {
  it('두 이름이 같은 것을 준다', () => {
    expect(withoutProjectExtension(`비올까${MLPX_EXTENSION}`)).toBe('비올까')
    expect(withoutProjectExtension(`비올까${SAFARI}`)).toBe('비올까')
  })

  it('프로젝트 파일이 아니면 그대로 둔다', () => {
    expect(withoutProjectExtension('사진.zip')).toBe('사진.zip')
    expect(withoutProjectExtension('비올까')).toBe('비올까')
  })

  /**
   * **같은 프로젝트를 두 기기에서 내보낸 것이 한 폴더로 간다.** 갈리면 교사가 같은 학생을
   * 두 번 본다. 그리고 그때 폴더가 겹치므로 `folderNames`가 번호를 붙여 갈라 준다 —
   * **조용히 덮이면 한 학생의 글이 남의 글로 바뀐다** (R28 C-20).
   */
  it('묶음의 폴더 이름이 같아지고, 겹침은 번호로 갈린다', () => {
    expect(folderFor(`1반/비올까${SAFARI}`)).toBe('1반/비올까')
    expect(folderNames([`비올까${MLPX_EXTENSION}`, `비올까${SAFARI}`])).toEqual([
      '비올까',
      '비올까 (2)',
    ])
  })
})

describe('내보내는 종류', () => {
  /**
   * **`application/zip`이면 사파리가 이름에 `.zip`을 붙인다** (기기 실측, 결정문 48).
   * 되돌리면 아이패드의 제출물 이름이 다시 더럽혀지고 파일 앱의 압축 해제를 부른다.
   */
  it('zip이 아니다', () => {
    expect(MLPX_MIME).not.toContain('zip')
  })

  /** 포트폴리오 묶음은 **바뀌지 않는다** — 그건 교사가 실제로 푸는 zip이다. */
  it('포트폴리오 묶음은 여전히 zip이다', () => {
    const source = readFileSync(join(process.cwd(), 'src/project/portfolio-bundle.ts'), 'utf-8')
    expect(source).toContain("type: 'application/zip'")
  })
})
