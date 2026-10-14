/**
 * 포트폴리오 묶음 (`project/portfolio-bundle.ts`).
 *
 * **여기서 지키는 것은 셋이다.** 푼 뒤에 글과 사진이 맞물리는가, **나가는 것이 우리가 지은 것뿐인가**
 * (open-decisions.md "점검은 읽기 전용 열람기다"), 그리고 폴더가 누구의 무엇인지 말하는가(결정 114).
 */

import { unzip, unzipSync } from 'fflate'
import MarkdownIt from 'markdown-it'
import { describe, expect, it, vi } from 'vitest'

import {
  BUNDLE_INDEX,
  BUNDLE_INDEX_COLUMNS,
  bundleOf,
  entriesOf,
  folderFor,
  folderNames,
  type BundleEntry,
} from '../src/project/portfolio-bundle'
import { DIR, readProject } from '../src/project/format'
import type { ProjectFile } from '../src/project/format'
import { nextAttachmentPath, renderPortfolioMarkdown } from '../src/project/portfolio'
import { bundleStudentOf } from '../src/project/roster'
import { MAX_ARCHIVE_ENTRIES, MAX_FILE_NAME_BYTES, MAX_FILE_NAME_LENGTH } from '../src/limits'
import { projectFile } from './fixtures/project'
import { writeProjectBytes } from './fixtures/write'

/** 가짜 번역. 키를 그대로 돌려주므로 머리글의 언어를 검사가 안 본다. */
const label = (key: string): string => `[${key}]`

/** 묶음 안의 글 이름 (결정 114). */
const MD = 'document.md'

/** 제목이 `title`인 제출물. 픽스처의 제목은 `붓꽃 품종 분류`다. */
function titled(title: string, base: ProjectFile = projectFile()): ProjectFile {
  return {
    ...base,
    document: { ...base.document, manifest: { ...base.document.manifest, name: title } },
  }
}

/** 학번·이름이 적힌 제출물. 빈 글자는 안 적은 것이다. */
function withStudent(studentId: string, name: string): ProjectFile {
  const base = projectFile()
  return {
    ...base,
    document: {
      ...base.document,
      manifest: { ...base.document.manifest, student: { studentId, name } },
    },
  }
}

/** 묶음을 풀어 엔트리 이름과 바이트를 낸다. */
async function unpack(blob: Blob): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()))
}

/** `index.csv`를 줄과 칸으로 낸다. 검사의 칸에는 따옴표·쉼표·줄바꿈이 없다. */
function indexRows(files: Record<string, Uint8Array>): string[][] {
  const text = new TextDecoder().decode(files[BUNDLE_INDEX])
  return text.split('\n').map((line) => line.split(','))
}

/**
 * **묶음이 드는 것은 글과 첨부뿐이다** (2026-09-18 R28-V N-1).
 *
 * `ProjectFile`을 통째로 받던 때는 굽기가 끝날 때까지 **서른 개의 정본 표와 모델과 사진이
 * 동시에 살았다** — zip에 나가는 것은 둘뿐인데도 그랬다. `useRoster`의 *"메모리에 사는
 * 파싱 결과가 언제나 하나다"*가 이 경로에서 거짓이었다.
 *
 * **검사가 아니라 타입이 막는다.** 여기 `@ts-expect-error`가 서 있다는 것이 그 증거이고,
 * 타입이 다시 넓어지면 이 지시자가 **쓸모없어져서** 컴파일이 깨진다 (`useWork.spec.ts`의
 * 같은 관용구).
 */
it('묶음 항목은 정본 표도 모델도 안 든다 - 타입이 막는다', () => {
  const file: NonNullable<BundleEntry['file']> = projectFile()
  // **값이 아니라 타입을 본다.** 넘긴 객체에는 아직 그 칸이 붙어 있을 수 있지만
  // (구조적 타입), **읽으려는 코드가 컴파일을 못 지난다**는 것이 이 검사의 내용이다.
  // @ts-expect-error 묶음은 정본 표를 안 든다.
  void file.dataset
  // @ts-expect-error 묶음은 모델을 안 든다.
  void file.models
  expect(file.document).toBeDefined()
  expect(file.attachments).toBeDefined()
})

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

/**
 * **결정 114 — 폴더는 `학번 이름 - 제목`이다.** 학번·이름은 빈 것을 빼고 공백으로, 그것과 제목은 빈 것을 빼고
 * ` - `로 잇는다. 셋 다 없으면 이름표의 파일 이름이고 상위 폴더는 버린다.
 */
describe('결정 114', () => {
  it.each([
    [{ studentId: '10213', studentName: '홍길동', title: '붓꽃 분류' }, '10213 홍길동 - 붓꽃 분류'],
    [{ studentName: '김철수', title: '어쩌구' }, '김철수 - 어쩌구'],
    [{ studentId: '10213', title: '붓꽃' }, '10213 - 붓꽃'],
    [{ title: '감귤' }, '감귤'],
    [{ studentId: '10213', studentName: '홍길동' }, '10213 홍길동'],
    [{ studentId: '  ', studentName: ' 홍길동 ', title: ' 붓꽃 ' }, '홍길동 - 붓꽃'],
  ])('%j', (parts, expected) => {
    expect(folderFor({ label: '1반/hong.mlpx', ...parts }, 1)).toBe(expected)
  })

  it('셋 다 없으면 이름표의 파일 이름이다 - 상위 폴더는 버린다', () => {
    expect(folderFor({ label: '1반/hong.mlpx' }, 1)).toBe('hong')
    expect(folderFor({ label: '1반\\hong.MLPX' }, 1)).toBe('hong')
    expect(folderFor({ label: '../../etc/passwd.mlpx' }, 1)).toBe('passwd')
    expect(folderNames([{ label: '1반/hong.mlpx' }, { label: '2반/hong.mlpx' }])).toEqual([
      'hong',
      'hong (2)',
    ])
  })

  it('학번·이름·제목의 경로 구분자는 폴더를 안 만든다', () => {
    expect(folderFor({ label: 'a.mlpx', studentName: '홍/길동', title: '붓꽃\\분류' }, 1)).toBe(
      '홍길동 - 붓꽃분류',
    )
  })

  it('맨 위의 index.csv와 같은 이름의 폴더를 안 만든다', () => {
    expect(
      folderNames([
        { label: 'a.mlpx', title: 'index.csv' },
        { label: 'b.mlpx', title: 'INDEX.CSV' },
      ]),
    ).toEqual(['index.csv (2)', 'INDEX.CSV (3)'])
  })

  it('묶음은 평평하고, 글은 document.md, 사진은 그 옆 attachments/다', async () => {
    const files = await unpack(
      bundleOf(
        [
          {
            label: '1반/hong.mlpx',
            studentId: '10213',
            studentName: '홍길동',
            file: titled('붓꽃 분류', withPhoto()),
          },
          { label: '1반/kim.mlpx', studentName: '김철수', file: titled('어쩌구') },
          { label: '1반/lee.mlpx', file: titled('') },
        ],
        label,
        'ko',
      ),
    )
    expect(Object.keys(files).sort()).toEqual([
      '10213 홍길동 - 붓꽃 분류/attachments/1.webp',
      `10213 홍길동 - 붓꽃 분류/${MD}`,
      BUNDLE_INDEX,
      `lee/${MD}`,
      `김철수 - 어쩌구/${MD}`,
    ])
  })

  /** 교사가 명렬에서 본 이름과 폴더 이름이 같아야 찾는다. 칸을 비운 고침도 고침이다. */
  it('교사가 고친 학번·이름을 쓴다', () => {
    const base = projectFile()
    const document = {
      ...base.document,
      manifest: { ...base.document.manifest, student: { studentId: '1', name: '홍길동' } },
    }
    expect(bundleStudentOf(document, undefined)).toEqual({ studentId: '1', studentName: '홍길동' })
    expect(bundleStudentOf(document, { studentName: '홍길순' })).toEqual({
      studentId: '1',
      studentName: '홍길순',
    })
    expect(bundleStudentOf(document, { studentId: '' })).toEqual({ studentName: '홍길동' })
  })

  it('index.csv는 화면 순서대로 줄을 세우고, 못 읽은 제출물도 폴더 칸을 비운 채 한 줄이다', async () => {
    const files = await unpack(
      bundleOf(
        [
          { label: '1반/kim.mlpx', studentName: '김철수', file: titled('붓꽃') },
          { label: '1반/broken.mlpx' },
          {
            label: '1반/hong.mlpx',
            studentId: '10213',
            studentName: '홍길동',
            file: titled('붓꽃'),
          },
        ],
        label,
        'ko',
      ),
    )
    expect(files[BUNDLE_INDEX]!.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]))
    const rows = indexRows(files)
    // 디코더가 BOM을 떼므로 머리 줄은 열 이름 그대로다.
    expect(rows[0]).toEqual([...BUNDLE_INDEX_COLUMNS])
    // 픽스처 파일에는 학번·이름이 없다 — 뒤의 두 칸(파일에 적힌 값)이 비고, 앞의 두 칸은 교사가 넣은 값이다.
    expect(rows.slice(1)).toEqual([
      ['김철수 - 붓꽃', '', '김철수', '붓꽃', '1반/kim.mlpx', '', ''],
      ['', '', '', '', '1반/broken.mlpx', '', ''],
      ['10213 홍길동 - 붓꽃', '10213', '홍길동', '붓꽃', '1반/hong.mlpx', '', ''],
    ])
  })

  /** 고친 값 옆에 파일에 적힌 값이 남는다 — 고치지 않았으면 같은 값이 두 번 선다. 표는 늘 채운다. */
  it('index.csv는 파일에 적힌 학번·이름을 뒤 칸에 늘 남긴다', async () => {
    const files = await unpack(
      bundleOf(
        [
          {
            label: 'a.mlpx',
            studentId: '10213',
            studentName: '홍길동',
            file: withStudent('10231', '홍길동'),
          },
          {
            label: 'b.mlpx',
            studentId: '10214',
            studentName: '김철수',
            file: withStudent('10214', '김철수'),
          },
        ],
        label,
        'ko',
      ),
    )
    expect(indexRows(files).slice(1)).toEqual([
      [
        '10213 홍길동 - 붓꽃 품종 분류',
        '10213',
        '홍길동',
        '붓꽃 품종 분류',
        'a.mlpx',
        '10231',
        '홍길동',
      ],
      [
        '10214 김철수 - 붓꽃 품종 분류',
        '10214',
        '김철수',
        '붓꽃 품종 분류',
        'b.mlpx',
        '10214',
        '김철수',
      ],
    ])
  })

  /**
   * **머리글은 고친 학번·이름이고, 파일에 적힌 값이 다르면 그 줄이 하나 더 선다** (결정 114). 같으면 아무것도 더하지
   * 않는다. 학생이 비워 낸 칸은 `meta.none`이다.
   */
  it('머리글은 고친 학번·이름이고 다를 때만 파일의 값을 덧붙인다', () => {
    const markdownOf = (
      file: ProjectFile,
      corrected?: { studentId?: string; studentName?: string },
    ) => new TextDecoder().decode(entriesOf(file, 'f', label, 'ko', corrected)[`f/${MD}`])

    const same = markdownOf(withStudent('10213', '홍길동'), {
      studentId: '10213',
      studentName: '홍길동',
    })
    expect(same).toContain('**[identity.studentId]**: 10213')
    expect(same).not.toContain('InFile')

    const fixed = markdownOf(withStudent('10231', ''), {
      studentId: '10213',
      studentName: '홍길동',
    })
    expect(fixed).toContain('**[identity.studentId]**: 10213')
    expect(fixed).toContain('**[identity.studentName]**: 홍길동')
    expect(fixed).toContain('**[identity.studentIdInFile]**: 10231')
    expect(fixed).toContain('**[identity.studentNameInFile]**: [meta.none]')

    // 교사가 칸을 비우면 그 줄은 빠지고 파일의 값만 남는다.
    const cleared = markdownOf(withStudent('10231', '홍길동'), { studentName: '홍길동' })
    expect(cleared).not.toContain('**[identity.studentId]**')
    expect(cleared).toContain('**[identity.studentIdInFile]**: 10231')

    // 고침을 안 넘기면(학생의 저장) 파일의 값 그대로다.
    const plain = markdownOf(withStudent('10231', '홍길동'))
    expect(plain).toContain('**[identity.studentId]**: 10231')
    expect(plain).not.toContain('InFile')
  })

  /** 폴더는 윈도가 못 쓰는 글자를 걷지만 표는 학생이 적은 그대로다. 수식 머리도 가리지 않는다(결정 110). */
  it('index.csv의 값은 걷기 전의 것이다', async () => {
    const files = await unpack(
      bundleOf([{ label: 'a.mlpx', studentId: '-1', file: titled('a:b "c"') }], label, 'ko'),
    )
    const text = new TextDecoder().decode(files[BUNDLE_INDEX])
    expect(text.split('\n')[1]).toBe('-1 - ab c,-1,,"a:b ""c""",a.mlpx,,')
  })

  it('읽은 제출물이 없어도 index.csv는 선다', async () => {
    const files = await unpack(bundleOf([{ label: 'broken.mlpx' }], label, 'ko'))
    expect(Object.keys(files)).toEqual([BUNDLE_INDEX])
  })

  /** 자른 자리가 공백이면 윈도가 떼고, 겹침 번호를 붙여도 한 토막의 한계 안이어야 한다. */
  it('긴 제목은 한 토막의 한계 안으로 자른다', () => {
    const encoder = new TextEncoder()
    const long = '가'.repeat(MAX_FILE_NAME_LENGTH * 2)
    const names = folderNames([
      { label: 'a.mlpx', title: long },
      { label: 'b.mlpx', title: long },
    ])
    for (const name of names) {
      expect(encoder.encode(name).length).toBeLessThanOrEqual(MAX_FILE_NAME_BYTES)
      expect(name).not.toMatch(/[. ]$/)
    }
    expect(names[1]).toMatch(/ \(2\)$/)
    expect(new Set(names).size).toBe(2)

    // 한계가 `홍길동 -` 뒤의 공백에 걸려도 끝에 공백이 안 남는다.
    const cut = '가'.repeat(Math.floor((MAX_FILE_NAME_BYTES - 1) / 3))
    const name = folderFor({ label: 'a.mlpx', studentName: cut, title: '나' }, 1)
    expect(name).toMatch(/ -$/)
    expect(name).not.toMatch(/[. ]$/)
  })
})

describe('폴더 이름', () => {
  it('확장자를 뗀다', () => {
    expect(folderFor({ label: '1반-3번-홍길동.mlpx' }, 1)).toBe('1반-3번-홍길동')
    expect(folderFor({ label: '1반-3번-홍길동.MLPX' }, 1)).toBe('1반-3번-홍길동')
  })

  /**
   * **남는 이름이 없으면 순번이다** (2026-09-28 감사 D C-5). 빈 이름이면 엔트리가
   * `/document.md`라는 절대 경로가 됐다. 확장자를 떼고 빈 조각이나 `.`이 남는 것도 같은 병이다.
   */
  it('남는 이름이 없으면 순번이 폴더 이름이다', () => {
    expect(folderFor({ label: '.mlpx' }, 3)).toBe('_3')
    expect(folderFor({ label: '../..' }, 4)).toBe('_4')
    expect(folderFor({ label: '..mlpx' }, 5)).toBe('_5')
    expect(folderFor({ label: '1반/.mlpx' }, 6)).toBe('_6')
    expect(folderFor({ label: 'a.mlpx', studentId: ' ', title: '...' }, 7)).toBe('a')
  })

  /**
   * **순번에는 표지가 붙는다** (2026-09-29, 코드 소유자 결정 12). 맨 순번이면 이름 없는 제출물이
   * 폴더 `2`를 먼저 차지해 이름표가 `2.mlpx`인 학생이 `2 (2)`로 밀렸다.
   */
  it('이름 없는 제출물이 이름표가 숫자인 학생의 자리를 뺏지 않는다', () => {
    expect(folderNames([{ label: '.mlpx' }, { label: '2.mlpx' }])).toEqual(['_1', '2'])
    expect(folderNames([{ label: 'a.mlpx' }, { label: '..' }, { label: '2.mlpx' }])).toEqual([
      'a',
      '_2',
      '2',
    ])
  })

  it('표지와 같은 이름표가 있어도 덮지 않고 가른다', () => {
    expect(folderNames([{ label: '_2.mlpx' }, { label: '..' }])).toEqual(['_2', '_2 (2)'])
  })

  it('묶음의 어느 엔트리도 빈 조각이나 절대 경로가 아니다', async () => {
    const names = Object.keys(
      await unpack(
        bundleOf(
          [
            { label: '.mlpx', file: titled('') },
            { label: '../..', file: titled('') },
          ],
          label,
          'ko',
        ),
      ),
    )
    expect(names.sort()).toEqual([`_1/${MD}`, `_2/${MD}`, BUNDLE_INDEX])
  })
})

/**
 * **푸는 자리 밖으로 새는 첨부는 안 싣는다** (2026-09-28 감사 D A-2).
 *
 * 학생 파일은 읽을 때 첨부 경로를 안 거르므로 `../`가 든 경로가 문서와 바이트 양쪽에 살아서
 * 온다. 이 zip은 우리가 지어 교사에게 주는 것이라 `..`를 따르는 압축 도구로 풀면 교사의 디스크
 * 어딘가에 학생이 고른 파일이 떨어진다.
 */
describe('푸는 자리 밖으로 새는 첨부는 안 싣는다', () => {
  const unsafe = [
    `${DIR.attachments}../../../../evil.cmd`,
    `${DIR.attachments}a\\..\\..\\evil.cmd`,
    '/etc/evil.cmd',
    'C:/evil.cmd',
    // 접두가 없는 경로는 떼어 낼 `portfolio/`가 없어 폴더 밖 자리로 간다.
    'attachments/1.webp',
  ]
  for (const path of unsafe) {
    it(path, () => {
      const files = entriesOf(withPhoto(path), '홍길동', label, 'ko')
      expect(Object.keys(files)).toEqual([`홍길동/${MD}`])
    })
  }

  it('멀쩡한 첨부는 그대로 싣는다 - 거르는 것이 전부를 막지 않는다', () => {
    const files = entriesOf(withPhoto(), '홍길동', label, 'ko')
    expect(Object.keys(files)).toEqual([`홍길동/${MD}`, '홍길동/attachments/1.webp'])
  })
})

describe('제출물 하나의 엔트리', () => {
  it('글은 폴더 바로 아래에 든다', () => {
    const files = entriesOf(projectFile(), '홍길동', label, 'ko')
    expect(Object.keys(files)).toEqual([`홍길동/${MD}`])
  })

  it('사진은 글 옆의 attachments/다 - 글이 상대 경로로 가리킨다', () => {
    const files = entriesOf(withPhoto(), '홍길동', label, 'ko')
    const markdown = new TextDecoder().decode(files[`홍길동/${MD}`])

    // 글이 적은 주소를 글이 놓인 자리에서 풀면 사진의 자리가 나온다.
    expect(markdown).toContain('![](attachments/1.webp)')
    expect(files['홍길동/attachments/1.webp']).toEqual(new Uint8Array([1, 2, 3]))
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
    const files = entriesOf(orphan, '홍길동', label, 'ko')
    expect(files['홍길동/attachments/2.webp']).toBeUndefined()
  })

  it('머리글은 교사의 언어로 그린다 - 학생 파일에 담긴 글을 베끼지 않는다', () => {
    const files = entriesOf(projectFile(), '홍길동', label, 'ko')
    const markdown = new TextDecoder().decode(files[`홍길동/${MD}`])
    expect(markdown).toContain('[meta.created]')
  })
})

/**
 * **기기 시계가 zip이 담을 수 없는 해여도 묶는다** (2026-09-28 감사 A C-1). zip의 날짜 칸은
 * 1980~2099년이고 fflate는 그 밖이면 던진다 — 교사의 묶음 내려받기가 시계 하나로 막힌다.
 */
describe('기기 시계가 zip이 담을 수 없는 해여도 묶는다', () => {
  for (const clock of ['1970-01-02T00:00:00', '2100-06-01T00:00:00']) {
    it(`시계가 ${clock}`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(clock))
      try {
        const files = await unpack(
          bundleOf([{ label: 'a.mlpx', file: titled('홍길동') }], label, 'ko'),
        )
        expect(Object.keys(files).sort()).toEqual([BUNDLE_INDEX, `홍길동/${MD}`])
      } finally {
        vi.useRealTimers()
      }
    })
  }
})

describe('묶음', () => {
  it('정본 표도 모델도 사진도 안 실린다 - 나가는 것은 글과 그 글의 첨부뿐이다', async () => {
    const names = Object.keys(
      await unpack(bundleOf([{ label: 'a.mlpx', file: withPhoto() }], label, 'ko')),
    )

    // 픽스처는 표와 모델을 갖고 있다. 하나라도 새면 이 검사가 운다.
    expect(names.some((name) => name.includes('dataset/'))).toBe(false)
    expect(names.some((name) => name.includes('model'))).toBe(false)
    expect(names.some((name) => name.endsWith('manifest.json'))).toBe(false)
  })

  /**
   * **묶음은 아무것도 누르지 않는다** (open-decisions.md 107, R43-1 감사 B-1). 첨부는 이미 구운 사진이라 줄지 않고,
   * 누르면 메인 스레드가 30명 × 5MB에 7,717ms 멈췄다. 수준을 바꿔도 되돌려도 전에는 아무 검사도 안 울었다 —
   * `.mlpx`의 *"모든 엔트리를 무압축으로 담는다"*와 같은 모양으로 엔트리마다 압축 방식을 본다.
   */
  it('묶음은 아무것도 누르지 않는다', async () => {
    const blob = bundleOf(
      [
        { label: '홍길동.mlpx', file: withPhoto() },
        { label: '김철수.mlpx', file: titled('김철수') },
      ],
      label,
      'ko',
    )
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const methods = new Map<string, number>()
    await new Promise<void>((resolve, reject) => {
      unzip(
        bytes,
        {
          filter: (file) => {
            methods.set(file.name, file.compression)
            return false
          },
        },
        (error) => (error ? reject(error) : resolve()),
      )
    })
    // 글(누르면 줄어드는 것)과 사진과 표가 다 든다.
    expect([...methods.keys()].some((name) => name.endsWith(MD))).toBe(true)
    expect([...methods.keys()].some((name) => name.endsWith('.webp'))).toBe(true)
    expect([...methods.keys()]).toContain(BUNDLE_INDEX)
    for (const [path, method] of methods) expect(method, path).toBe(0)
  })
})

/**
 * **묶음 zip도 엔트리 수 한계 안에서만 쓴다** (open-decisions.md ".mlpx 한 파일의 엔트리 수는 ZIP64
 * 없이 쓸 수 있는 만큼이다"의 코드 소유자 후속). 묶음을 굽는 fflate도 ZIP64를 안 쓴다 — 넘은 채로
 * 쓰면 푸는 쪽이 제출물을 말없이 빠뜨린다. 넘으면 조용히 쓰지 않고 던지고, 점검 화면이 알린다
 * (`InspectView.vue`의 `downloadPortfolios`). `index.csv`도 하나로 센다.
 */
describe('묶음 엔트리 수', () => {
  /** 글 하나와 첨부 `photos`장이 든 제출물 — 묶음에서 엔트리 `photos + 1`개다. */
  function withPhotos(photos: number): ProjectFile {
    const base = projectFile()
    const paths: string[] = []
    const attachments = new Map<string, Uint8Array>()
    for (let index = 1; index <= photos; index += 1) {
      const path = `${DIR.attachments}${String(index)}.webp`
      paths.push(path)
      attachments.set(path, new Uint8Array([1]))
    }
    return {
      ...base,
      document: {
        ...base.document,
        portfolio: { ...base.document.portfolio, attachments: { motivation: paths } },
      },
      attachments,
    }
  }

  it('한계를 넘으면 조용히 쓰지 않고 던진다', () => {
    const entries: BundleEntry[] = [{ label: 'a.mlpx', file: withPhotos(MAX_ARCHIVE_ENTRIES - 1) }]
    expect(() => bundleOf(entries, label, 'ko')).toThrow(
      expect.objectContaining({ code: 'PORTFOLIO_BUNDLE_TOO_MANY_ENTRIES' }),
    )
  })

  it('한계와 같은 수는 쓰이고 다 풀린다', async () => {
    const names = Object.keys(
      await unpack(
        bundleOf([{ label: 'a.mlpx', file: withPhotos(MAX_ARCHIVE_ENTRIES - 2) }], label, 'ko'),
      ),
    )
    expect(names).toHaveLength(MAX_ARCHIVE_ENTRIES)
  }, 60_000)
})

/**
 * **폴더 이름이 겹치면 한 학생의 글이 남의 글로 바뀐다** (2026-09-18 R28 C-20).
 *
 * 같은 학생이 같은 제목으로 두 번 냈거나 이름표만 남은 둘이 같은 파일 이름이면 같은 폴더가 된다 — 그때 zip
 * 엔트리는 **조용히 덮인다.** 교사는 서른 명을 냈는데 스물아홉 폴더를 받고 그 사실을 알 길이 없다.
 */
describe('폴더 이름은 서로 다르다', () => {
  const of = (...labels: string[]) => labels.map((one) => ({ label: one }))

  it('겹치면 뒤엣것에 번호를 붙인다', () => {
    expect(folderNames(of('a.mlpx', 'a.MLPX', 'a.mlpx'))).toEqual(['a', 'a (2)', 'a (3)'])
  })

  it('대소문자만 다른 이름도 가른다', () => {
    expect(folderNames(of('1반/Kim.mlpx', '1반/kim.mlpx'))).toEqual(['Kim', 'kim (2)'])
  })

  /**
   * **윈도가 못 푸는 글자를 걷는다** (0.35.2 경계 감사 C C-1). 리눅스·맥에서 지은 이름이 그대로 폴더가 되면 `Expand-Archive`는
   * 묶음을 통째로 안 풀고, 파이썬·bsdtar는 말없이 바꿔 `q?`와 `q*`를 한 폴더로 합쳤다. 걸은 뒤의 겹침은 번호로 갈린다. 공백은
   * 남긴다 — 교사가 읽는 이름이다.
   */
  it('윈도가 못 푸는 글자를 걷는다', () => {
    expect(
      folderNames(
        of(
          'a:b.mlpx',
          'q?.mlpx',
          'q*.mlpx',
          'CON.mlpx',
          'nul.txt.mlpx',
          'dot..mlpx',
          'x .mlpx',
          'x.mlpx',
          '1반 홍길동.mlpx',
          '.숨김.mlpx',
          'lt<gt>|"\u0007.mlpx',
          // 오른쪽에서 왼쪽으로(U+202E) — 탐색기에서 글자 순서가 뒤집혀 보인다(0.35.3 최종 감사 C-3).
          'r\u202etl.mlpx',
        ),
      ),
    ).toEqual([
      'ab',
      'q',
      'q (2)',
      'CON_',
      'nul_.txt',
      'dot',
      'x',
      'x (2)',
      '1반 홍길동',
      '숨김',
      'ltgt',
      'rtl',
    ])
    // 학번·이름·제목도 같은 걷기를 지난다. 잇고 나서 예약 이름이 되는 것도 피한다.
    expect(folderFor({ label: 'a.mlpx', title: 'CON' }, 1)).toBe('CON_')
    expect(folderFor({ label: 'a.mlpx', studentName: 'q?', title: 'r\u202etl.' }, 1)).toBe(
      'q - rtl',
    )
  })

  /** 윈도는 대문자 표로 견준다 — 소문자로 견주면 `σ`·`ς`가 둘로 남아 풀 때 한 폴더가 된다. */
  it('대문자로 같아지는 이름도 가른다', () => {
    expect(folderNames(of('σ.mlpx', 'ς.mlpx'))).toEqual(['σ', 'ς (2)'])
  })

  /** 원래 있는 이름(`a (2)`라는 진짜 제출물)을 붙인 번호가 뺏지 않는다. */
  it('번호를 이어 세도 이미 있는 이름은 피한다', () => {
    expect(folderNames(of('a.mlpx', 'a.mlpx', 'a (2).mlpx', 'a.mlpx', 'A.mlpx'))).toEqual([
      'a',
      'a (3)',
      'a (2)',
      'a (4)',
      'A (5)',
    ])
  })

  /**
   * **같은 이름이 많아도 번호를 처음부터 다시 세지 않는다** (R43-1 감사 C-1의 이웃). 매번 2부터 세면 같은 이름
   * N개가 N²이다. 한도는 고친 뒤 값의 수십 배이고 고치기 전 값보다 한참 아래다.
   */
  it('같은 이름이 많아도 폴더 이름이 곧 나온다', () => {
    const COUNT = 20_000
    const BUDGET_MS = 3_000
    const started = performance.now()
    const names = folderNames(Array.from({ length: COUNT }, () => ({ label: 'topic.mlpx' })))
    const elapsed = performance.now() - started
    expect(new Set(names).size).toBe(COUNT)
    expect(elapsed, `${String(Math.round(elapsed))} ms`).toBeLessThan(BUDGET_MS)
  })

  it('묶음이 그 이름을 쓴다 - 덮이는 제출물이 없다', async () => {
    const files = await unpack(
      bundleOf(
        [
          { label: 'a.mlpx', file: titled('홍길동') },
          { label: 'b.mlpx', file: titled('홍길동') },
        ],
        label,
        'ko',
      ),
    )
    expect(Object.keys(files).sort()).toEqual([BUNDLE_INDEX, `홍길동 (2)/${MD}`, `홍길동/${MD}`])
  })
})

/**
 * **조작한 파일의 사진 경로는 `document.md`에 사진 링크로 안 싣는다** (open-decisions.md 93, 보안 검토 v6 A-1).
 *
 * 경로는 학생의 `document.json`(`portfolio.attachments`)에서 오고, `readProject`는 zip 엔트리가 있는지와 새는지만 본다 —
 * 엔트리 이름을 같은 문자열로 지으면 통과한다. 교사의 묶음이 그것으로 `document.md`를 다시 굽는다. **진짜 입구로 잰다**:
 * `writeProject` → `readProject` → `entriesOf`. 기본 markdown-it과 `validateLink`를 끈 렌더러 둘 다에서 학생의 태그도,
 * http·https가 아닌 주소도 서면 안 된다.
 */
describe('조작한 사진 경로는 묶음의 document.md에 안 실린다', () => {
  const strict = new MarkdownIt({ html: true })
  const loose = new MarkdownIt({ html: true })
  loose.validateLink = () => true

  /** 렌더 결과의 `href`·`src` 중 앱이 지은 사진도, http·https도 아닌 것. */
  const unsafeIn = (html: string, made: string) =>
    [...html.matchAll(/ (href|src)="([^"]*)"/g)]
      .map(([, , value]) => value!.replace(/&amp;/g, '&'))
      .filter((url) => url !== made && !/^https?:\/\//i.test(url))

  /** 사진 경로 `paths`가 붙은 제출물을 파일로 썼다 읽어 묶음의 `document.md`를 낸다. */
  async function bundledMarkdown(paths: readonly string[]): Promise<string> {
    const base = projectFile()
    const file: ProjectFile = {
      ...base,
      document: {
        ...base.document,
        portfolio: { ...base.document.portfolio, attachments: { motivation: [...paths] } },
      },
      attachments: new Map(paths.map((path) => [path, new Uint8Array([1, 2, 3])])),
    }
    const text = { title: '붓꽃', rows: [], orphanTitle: '이전' }
    const { bytes } = await writeProjectBytes(
      file,
      renderPortfolioMarkdown(text, file.document.portfolio),
    )
    const { project: opened } = await readProject(bytes)
    // 읽기가 경로를 그대로 들였는지부터 본다 — 안 들였으면 이 검사는 입구를 안 지난 것이다.
    expect(opened.document.portfolio.attachments['motivation']).toEqual(paths)
    const files = entriesOf(opened, '홍길동', label, 'ko')
    // 조작한 경로의 바이트도 안 실린다 — 링크가 없는 사진이 묶음에 떨어지면 안 된다.
    expect(Object.keys(files).filter((name) => name.includes('attachments/'))).toEqual(
      paths.includes(made) ? [`홍길동/${made.slice(DIR.portfolio.length)}`] : [],
    )
    return new TextDecoder().decode(files[`홍길동/${MD}`])
  }

  const made = nextAttachmentPath(projectFile().document.portfolio, '.webp', [])
  const madeLink = made.slice(DIR.portfolio.length)

  it.each([
    `${DIR.attachments}a)<img src=x onerror=alert(1)>`,
    `${DIR.attachments}a) [c](javascript:alert(1)`,
    `${DIR.attachments}a)\n\n[r]: javascript:alert(1)\n\n[눌러][r]`,
    // 수로 시작하고 앱의 확장자로 끝나도 되지은 모양과 글자까지 같아야 한다.
    `${DIR.attachments}2)<img src=x onerror=alert(1)>.webp`,
  ])('%j', async (path) => {
    const markdown = await bundledMarkdown([path, made])
    expect(markdown).not.toContain(path.slice(DIR.portfolio.length))
    expect(markdown).toContain(`![](${madeLink})`)
    for (const md of [strict, loose]) {
      const html = md.render(markdown)
      expect(html).not.toMatch(/<img [^>]*onerror|<a /)
      expect(unsafeIn(html, madeLink)).toEqual([])
    }
  })

  it('nextAttachmentPath가 지은 경로는 그대로 실린다', async () => {
    const markdown = await bundledMarkdown([made])
    expect(markdown).toContain(`\n![](${madeLink})\n`)
    expect(strict.render(markdown)).toContain(`<img src="${madeLink}" alt="">`)
  })
})
