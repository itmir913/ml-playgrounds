/**
 * 포트폴리오 묶음 (`project/portfolio-bundle.ts`).
 *
 * **여기서 지키는 것은 둘이다.** 푼 뒤에 글과 사진이 맞물리는가, 그리고 **나가는 것이
 * 우리가 지은 것뿐인가** (open-decisions.md "점검은 읽기 전용 열람기다"). 앞의 것은
 * 상대 경로가 맞아야 하고, 뒤의 것은 정본 표·사진·모델이 안 실려야 한다.
 */

import { unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

import {
  bundleOf,
  entriesOf,
  folderFor,
  folderNames,
  type BundleEntry,
} from '../src/project/portfolio-bundle'
import { DIR, ENTRY } from '../src/project/format'
import type { ProjectFile } from '../src/project/format'
import { MAX_ARCHIVE_ENTRIES } from '../src/limits'
import { projectFile } from './fixtures/project'

/** 가짜 번역. 키를 그대로 돌려주므로 머리글의 언어를 검사가 안 본다. */
const label = (key: string): string => `[${key}]`

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
  const entry: BundleEntry = { label: 'a.mlpx', file: projectFile() }
  // **값이 아니라 타입을 본다.** 넘긴 객체에는 아직 그 칸이 붙어 있을 수 있지만
  // (구조적 타입), **읽으려는 코드가 컴파일을 못 지난다**는 것이 이 검사의 내용이다.
  // @ts-expect-error 묶음은 정본 표를 안 든다.
  void entry.file.dataset
  // @ts-expect-error 묶음은 모델을 안 든다.
  void entry.file.models
  expect(entry.file.document).toBeDefined()
  expect(entry.file.attachments).toBeDefined()
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

describe('폴더 이름', () => {
  it('확장자를 뗀다', () => {
    expect(folderFor('1반-3번-홍길동.mlpx', 1)).toBe('1반-3번-홍길동')
    expect(folderFor('1반-3번-홍길동.MLPX', 1)).toBe('1반-3번-홍길동')
  })

  it('폴더째 골랐으면 경로가 폴더로 남는다', () => {
    expect(folderFor('1반/3번-홍길동.mlpx', 1)).toBe('1반/3번-홍길동')
    // 탐색기가 주는 상대 경로는 역슬래시일 수 있다.
    expect(folderFor('1반\\3번-홍길동.mlpx', 1)).toBe('1반/3번-홍길동')
  })

  it('위로 올라가는 조각은 걷어낸다', () => {
    expect(folderFor('../../etc/passwd.mlpx', 1)).toBe('etc/passwd')
    expect(folderFor('./1반//3번.mlpx', 1)).toBe('1반/3번')
  })

  /**
   * **남는 이름이 없으면 순번이다** (2026-09-28 감사 D C-5). 빈 이름이면 엔트리가
   * `/portfolio/document.md`라는 절대 경로가 됐다. 확장자를 떼고 빈 조각이나 `.`이 남는
   * 것도 같은 병이다(`1반/.mlpx`는 `1반//portfolio/…`가 됐다).
   */
  it('남는 이름이 없으면 순번이 폴더 이름이다', () => {
    expect(folderFor('.mlpx', 3)).toBe('_3')
    expect(folderFor('../..', 4)).toBe('_4')
    expect(folderFor('..mlpx', 5)).toBe('_5')
    expect(folderFor('1반/.mlpx', 6)).toBe('1반')
  })

  /**
   * **순번에는 표지가 붙는다** (2026-09-29, 코드 소유자 결정 12). 맨 순번이면 이름 없는 제출물이
   * 폴더 `2`를 먼저 차지해 이름표가 `2.mlpx`인 학생이 `2 (2)`로 밀렸다 — 교사는 `2 (2)`가 누구인지
   * 명렬을 다시 봐야 한다. `_2`는 이름표에서 나오려면 파일 이름이 `_2.mlpx`여야 한다.
   */
  it('이름 없는 제출물이 이름표가 숫자인 학생의 자리를 뺏지 않는다', () => {
    expect(folderNames(['.mlpx', '2.mlpx'])).toEqual(['_1', '2'])
    expect(folderNames(['a.mlpx', '..', '2.mlpx'])).toEqual(['a', '_2', '2'])
  })

  it('표지와 같은 이름표가 있어도 덮지 않고 가른다', () => {
    expect(folderNames(['_2.mlpx', '..'])).toEqual(['_2', '_2 (2)'])
  })

  it('묶음의 어느 엔트리도 빈 조각이나 절대 경로가 아니다', async () => {
    const blob = bundleOf(
      [
        { label: '.mlpx', file: projectFile() },
        { label: '../..', file: projectFile() },
      ],
      label,
      'ko',
    )
    const names = Object.keys(unzipSync(new Uint8Array(await blob.arrayBuffer())))
    expect(names.sort()).toEqual([`_1/${ENTRY.portfolioMarkdown}`, `_2/${ENTRY.portfolioMarkdown}`])
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
  ]
  for (const path of unsafe) {
    it(path, () => {
      const files = entriesOf(
        { label: '홍길동.mlpx', file: withPhoto(path) },
        '홍길동',
        label,
        'ko',
      )
      expect(Object.keys(files)).toEqual([`홍길동/${ENTRY.portfolioMarkdown}`])
    })
  }

  it('멀쩡한 첨부는 그대로 싣는다 - 거르는 것이 전부를 막지 않는다', () => {
    const files = entriesOf({ label: '홍길동.mlpx', file: withPhoto() }, '홍길동', label, 'ko')
    expect(Object.keys(files)).toEqual([
      `홍길동/${ENTRY.portfolioMarkdown}`,
      `홍길동/${DIR.attachments}1.webp`,
    ])
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
        const blob = bundleOf([{ label: '홍길동.mlpx', file: projectFile() }], label, 'ko')
        const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
        expect(Object.keys(entries)).toEqual([`홍길동/${ENTRY.portfolioMarkdown}`])
      } finally {
        vi.useRealTimers()
      }
    })
  }
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
 * **묶음 zip도 엔트리 수 한계 안에서만 쓴다** (open-decisions.md ".mlpx 한 파일의 엔트리 수는 ZIP64
 * 없이 쓸 수 있는 만큼이다"의 코드 소유자 후속). 묶음을 굽는 fflate도 ZIP64를 안 쓴다 — 넘은 채로
 * 쓰면 푸는 쪽이 제출물을 말없이 빠뜨린다. 넘으면 조용히 쓰지 않고 던지고, 점검 화면이 알린다
 * (`InspectView.vue`의 `downloadPortfolios`).
 */
describe('묶음 엔트리 수', () => {
  /** 글 하나와 첨부 `photos`장이 든 제출물 — 묶음에서 엔트리 `photos + 1`개다. */
  function withPhotos(photos: number): ProjectFile {
    const base = projectFile()
    const paths: string[] = []
    const attachments = new Map<string, Uint8Array>()
    for (let index = 0; index < photos; index += 1) {
      const path = `${DIR.attachments}${index}.webp`
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
    const entries: BundleEntry[] = [
      { label: 'a.mlpx', file: withPhotos(MAX_ARCHIVE_ENTRIES - 1) },
      { label: 'b.mlpx', file: projectFile() },
    ]
    expect(() => bundleOf(entries, label, 'ko')).toThrow(
      expect.objectContaining({ code: 'PORTFOLIO_BUNDLE_TOO_MANY_ENTRIES' }),
    )
  })

  it('한계와 같은 수는 쓰이고 다 풀린다', async () => {
    const blob = bundleOf(
      [{ label: 'a.mlpx', file: withPhotos(MAX_ARCHIVE_ENTRIES - 1) }],
      label,
      'ko',
    )
    const names = Object.keys(unzipSync(new Uint8Array(await blob.arrayBuffer())))
    expect(names).toHaveLength(MAX_ARCHIVE_ENTRIES)
  }, 60_000)
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

  it('대소문자만 다른 이름도 가른다', () => {
    expect(folderNames(['1반/Kim.mlpx', '1반/kim.mlpx'])).toEqual(['1반/Kim', '1반/kim (2)'])
  })

  /** 윈도는 대문자 표로 견준다 — 소문자로 견주면 `σ`·`ς`가 둘로 남아 풀 때 한 폴더가 된다. */
  it('대문자로 같아지는 이름도 가른다', () => {
    expect(folderNames(['σ.mlpx', 'ς.mlpx'])).toEqual(['σ', 'ς (2)'])
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
