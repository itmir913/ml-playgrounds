/**
 * 포트폴리오 묶음 (`project/portfolio-bundle.ts`).
 *
 * **여기서 지키는 것은 둘이다.** 푼 뒤에 글과 사진이 맞물리는가, 그리고 **나가는 것이
 * 우리가 지은 것뿐인가** (open-decisions.md "점검은 읽기 전용 열람기다"). 앞의 것은
 * 상대 경로가 맞아야 하고, 뒤의 것은 정본 표·사진·모델이 안 실려야 한다.
 */

import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { bundleOf, entriesOf, folderFor, folderNames } from '../src/project/portfolio-bundle'
import { DIR, ENTRY } from '../src/project/format'
import type { ProjectFile } from '../src/project/format'
import { projectFile } from './fixtures/project'

/** 가짜 번역. 키를 그대로 돌려주므로 머리글의 언어를 검사가 안 본다. */
const label = (key: string): string => `[${key}]`

/** 사진 한 장이 붙은 제출물. 문항 `motivation`은 픽스처가 이미 갖고 있다. */
function withPhoto(path = `${DIR.attachments}1.webp`): ProjectFile {
  const base = projectFile()
  return {
    ...base,
    document: {
      ...base.document,
      portfolio: { ...base.document.portfolio, attachments: { motivation: [path] } },
    },
    attachments: new Map([[path, new Uint8Array([1, 2, 3])]]),
  }
}

describe('폴더 이름', () => {
  it('확장자를 뗀다', () => {
    expect(folderFor('1반-3번-홍길동.mlpx')).toBe('1반-3번-홍길동')
    expect(folderFor('1반-3번-홍길동.MLPX')).toBe('1반-3번-홍길동')
  })

  it('폴더째 골랐으면 경로가 폴더로 남는다', () => {
    expect(folderFor('1반/3번-홍길동.mlpx')).toBe('1반/3번-홍길동')
    // 탐색기가 주는 상대 경로는 역슬래시일 수 있다.
    expect(folderFor('1반\\3번-홍길동.mlpx')).toBe('1반/3번-홍길동')
  })

  it('위로 올라가는 조각은 걷어낸다', () => {
    expect(folderFor('../../etc/passwd.mlpx')).toBe('etc/passwd')
    expect(folderFor('./1반//3번.mlpx')).toBe('1반/3번')
  })
})

describe('제출물 하나의 엔트리', () => {
  it('글은 파일 안에서와 같은 자리에 들어간다', () => {
    const files = entriesOf({ label: '홍길동.mlpx', file: projectFile() }, '홍길동', label, 'ko')
    expect(Object.keys(files)).toEqual([`홍길동/${ENTRY.portfolioMarkdown}`])
  })

  it('사진도 파일 안에서와 같은 자리다 - 글이 상대 경로로 가리킨다', () => {
    const files = entriesOf({ label: '홍길동.mlpx', file: withPhoto() }, '홍길동', label, 'ko')
    const markdown = new TextDecoder().decode(files[`홍길동/${ENTRY.portfolioMarkdown}`])

    // 글이 적은 주소를 글이 놓인 자리에서 풀면 사진의 자리가 나온다.
    expect(markdown).toContain('![](attachments/1.webp)')
    expect(files[`홍길동/${DIR.attachments}1.webp`]).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('아무 문항도 안 가리키는 사진은 안 담는다', () => {
    const base = withPhoto()
    const orphan: ProjectFile = {
      ...base,
      attachments: new Map([
        ...base.attachments,
        [`${DIR.attachments}2.webp`, new Uint8Array([9])],
      ]),
    }
    const files = entriesOf({ label: '홍길동.mlpx', file: orphan }, '홍길동', label, 'ko')
    expect(files[`홍길동/${DIR.attachments}2.webp`]).toBeUndefined()
  })

  it('머리글은 교사의 언어로 그린다 - 학생 파일에 담긴 글을 베끼지 않는다', () => {
    const files = entriesOf({ label: '홍길동.mlpx', file: projectFile() }, '홍길동', label, 'ko')
    const markdown = new TextDecoder().decode(files[`홍길동/${ENTRY.portfolioMarkdown}`])
    expect(markdown).toContain('[meta.created]')
  })
})

describe('묶음', () => {
  it('제출물마다 폴더가 갈린다', async () => {
    const blob = bundleOf(
      [
        { label: '1반/홍길동.mlpx', file: projectFile() },
        { label: '1반/김철수.mlpx', file: projectFile() },
      ],
      label,
      'ko',
    )
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(Object.keys(entries).sort()).toEqual([
      `1반/김철수/${ENTRY.portfolioMarkdown}`,
      `1반/홍길동/${ENTRY.portfolioMarkdown}`,
    ])
  })

  it('정본 표도 모델도 사진도 안 실린다 - 나가는 것은 글과 그 글의 첨부뿐이다', async () => {
    const blob = bundleOf([{ label: '홍길동.mlpx', file: withPhoto() }], label, 'ko')
    const names = Object.keys(unzipSync(new Uint8Array(await blob.arrayBuffer())))

    // 픽스처는 표와 모델을 갖고 있다. 하나라도 새면 이 검사가 운다.
    expect(names.some((name) => name.startsWith(DIR.dataset))).toBe(false)
    expect(names.some((name) => name.startsWith(DIR.model))).toBe(false)
    expect(names).not.toContain(ENTRY.manifest)
  })
})

/**
 * **폴더 이름이 겹치면 한 학생의 글이 남의 글로 바뀐다** (2026-09-18 R28 C-20).
 *
 * `folderFor`는 확장자만 떼므로 한 폴더의 `a.mlpx`와 `a.MLPX`가 같은 이름이 된다 —
 * 대소문자를 가리는 파일 시스템(리눅스)에서 만들 수 있는 입력이고, 그때 zip 엔트리는
 * **조용히 덮인다.** 교사는 서른 명을 냈는데 스물아홉 폴더를 받고 그 사실을 알 길이 없다.
 */
describe('폴더 이름은 서로 다르다', () => {
  it('겹치면 뒤엣것에 번호를 붙인다', () => {
    expect(folderNames(['a.mlpx', 'a.MLPX', 'a.mlpx'])).toEqual(['a', 'a (2)', 'a (3)'])
  })

  it('안 겹치면 그대로 둔다', () => {
    expect(folderNames(['1반/홍길동.mlpx', '1반/김철수.mlpx'])).toEqual([
      '1반/홍길동',
      '1반/김철수',
    ])
  })

  it('묶음이 그 이름을 쓴다 - 덮이는 제출물이 없다', async () => {
    const blob = bundleOf(
      [
        { label: '홍길동.mlpx', file: projectFile() },
        { label: '홍길동.MLPX', file: projectFile() },
      ],
      label,
      'ko',
    )
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(Object.keys(entries).sort()).toEqual([
      `홍길동 (2)/${ENTRY.portfolioMarkdown}`,
      `홍길동/${ENTRY.portfolioMarkdown}`,
    ])
  })
})
