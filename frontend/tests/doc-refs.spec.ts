/**
 * **문서를 가리키는 참조가 살아 있는가.**
 *
 * 이 저장소는 문서를 경로가 아니라 **절 번호와 제목**으로 가리킨다 —
 * `mlpx-spec.md §5.9`, `architecture.md §8.13.1`,
 * `open-decisions.md "모바일에서도 동작한다"` 같은 모양이고, 2026-08-20에 세어 보니
 * 약 1,400군데다. 그중 900군데가 `frontend/src`의 주석이다.
 *
 * **그래서 문서를 나눌 수가 없었다.** 2026-08-06에 `open-decisions.md`의 결정됨을
 * 다른 파일로 옮기는 안을 접었고, 접은 이유가 이것이었다 — "문서 링크가 깨졌는지
 * 알려주는 검사가 없다." 이 파일이 그 검사다. 이것이 서면서 문서가 허브와 스포크로
 * 나뉘었다 (`open-decisions.md` "문서를 나누되 주소는 안 바꾼다 — 허브와 색인").
 *
 * **허브와 스포크.** 원본 경로(`docs/architecture.md`)는 그 자리에 남아 머리글과
 * 색인이 되고, 본문은 **허브 이름의 디렉터리**(`docs/architecture/`)로 나간다.
 * 절 번호와 제목은 안 바뀌므로 **기존 참조는 한 줄도 안 고친다.**
 *
 * **못 보는 것**이 셋 있다. 알고 두는 구멍이다.
 *
 * - **문서 이름이 통째로 바뀌는 것.** 아는 문서의 집합을 `docs/` 아래에서 읽어 오므로,
 *   파일이 사라지면 그 이름을 부르던 참조는 "아는 문서가 아니다"가 되어 조용히 넘어간다.
 *   `docs/`를 붙여 적은 참조(`docs/i18n.md`)는 잡는다.
 * - **여러 줄에 걸쳐 끊긴 제목의 뒷부분.** 주석이 줄바꿈되면 따옴표가 안 닫힌다.
 *   그때는 그 줄에 남은 만큼이 어느 표제의 **부분 문자열인지**만 본다.
 * - **번호가 맞는데 뜻이 다른 절.** 절을 다시 번호 매기면 참조는 살아 있는 채로
 *   엉뚱한 곳을 가리킨다. 그래서 "절을 다시 번호 매기지 않는다"가 규칙이다.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

/** 저장소 뿌리. vitest는 `frontend/`에서 돈다. */
const ROOT = join(process.cwd(), '..')

/** 줄 나누기. **정규식 리터럴로 둔다** - 문자열로 적으면 이스케이프가 한 겹 더 든다. */
const NEWLINE = /\r?\n/

/** 참조를 훑을 곳. 문서와 소스와 검사 전부다. */
const SCANNED: readonly string[] = [
  'docs',
  'CLAUDE.md',
  'README.md',
  'frontend/src',
  'frontend/tests',
  'frontend/vite.config.ts',
  'frontend/scripts',
  'backend/app',
  'backend/tests',
  'backend/scripts',
]

/** 걷지 않는 디렉터리. 남의 코드와 산출물이다. */
const SKIPPED = new Set(['node_modules', 'dist', '.venv', '__pycache__', '.git', 'coverage'])

/** 참조가 들어 있을 수 있는 확장자. */
const SCANNABLE = /\.(md|ts|vue|py)$/

function walk(path: string): string[] {
  const stat = statSync(path)
  if (!stat.isDirectory()) return SCANNABLE.test(path) ? [path] : []
  return readdirSync(path).flatMap((entry) => (SKIPPED.has(entry) ? [] : walk(join(path, entry))))
}

/** 저장소 상대 경로. 윈도우의 역슬래시를 눕힌다. */
function inRepo(path: string): string {
  return relative(ROOT, path).replace(/\\/g, '/')
}

/**
 * 표제에서 장식을 걷어낸 글자. `~~`·`**`·백틱이 표제마다 붙어 있어서
 * **그대로 비교하면 색인과 표제가 절대 안 맞는다.**
 */
export function cleanHeading(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/[~*`]/g, '')
    .trim()
}

/**
 * 색인에 실리는 만큼. 표제 뒤의 부연(`— R1 B-5`, `(2026-08-19)`)은 뗀다 —
 * **주소로 쓰이는 것은 앞쪽이고**, 부연은 표제를 고칠 때마다 흔들린다.
 */
export function indexKey(heading: string): string {
  return cleanHeading(heading)
    .split(/\s[—–]\s/)[0]!
    .replace(/\s*\((?:V\d+,?\s*)?\d{4}-\d{2}-\d{2}\)\s*$/, '')
    .trim()
}

/**
 * 표제가 이고 있는 번호. `## 8. 프런트엔드 셸` -> `8`,
 * `### 8.13.1 예측 화면` -> `8.13.1`, `#### 28-5. 그릴 점의 상한` -> `28-5`.
 */
export function headingNumber(heading: string): string | null {
  const match = /^(\d+(?:\.\d+)*|\d+-\d+)\.?(?:\s|$)/.exec(cleanHeading(heading))
  return match ? match[1]! : null
}

/** 표제가 "이 미결정을 닫았다"고 선언하는 낱말. 둘 다 쓰인다. */
const CLOSING = /마무리|종결/

/**
 * 표제 하나가 받아 주는 번호들.
 *
 * 자기가 이고 있는 번호에 더해, **자기가 닫은 미결정 번호**도 받는다 —
 * `### 인코딩 판정과 지원 목록 (2026-08-04) — #15 마무리`가 그 모양이다. 미결정이
 * 결정됨으로 넘어가면 번호를 잃고 제목을 얻는데, **번호로 가리키던 참조는 그대로
 * 남는다.** 닫은 자리에 닫힘을 적어 두는 것이 이 저장소의 표기이고, 그것이 곧 옛
 * 번호의 전달 주소다.
 *
 * **표기가 한 모양이 아니다.** 낱말이 둘(`마무리`·`종결`)이고, 번호와 낱말 사이에
 * 다른 글자가 끼기도 한다 — `#25 ① 마무리`, `#21의 마지막 줄 마무리`. 그래서
 * `#N 마무리`를 붙여서 찾지 않고, **닫힘을 선언한 표제 안의 `#N`을 전부** 받는다.
 * 처음에는 `#N 마무리` 한 모양만 봤고, 그것 때문에 `#23 종결`이 안 잡혀 실제로
 * 참조 넷이 끊어졌다 (2026-08-20).
 */
export function headingAnchors(heading: string): string[] {
  const own = headingNumber(heading)
  const closed = CLOSING.test(heading)
    ? [...heading.matchAll(/#(\d+(?:-\d+)?)/g)].map((match) => match[1]!)
    : []
  return own === null ? closed : [own, ...closed]
}

interface Family {
  /** 허브의 저장소 상대 경로. `docs/architecture.md`. */
  readonly hub: string
  /** 허브 + 스포크 전부의 표제 줄. */
  readonly headings: readonly string[]
  /** 스포크 안의 `##`·`###` 표제. 색인에 실려야 하는 것들. */
  readonly spokeHeadings: readonly string[]
  /** 허브 파일의 본문. 색인이 여기 있다. */
  readonly hubText: string
  /** 허브 + 스포크 전부의 본문을 인용 대조용으로 편 것. */
  readonly flattened: string
}

/**
 * 표제 줄들. **울타리 친 코드 블록 안은 빼고 본다** — `mlpx-spec.md` §8이
 * 포트폴리오 양식의 예시로 `## 이 주제를 고른 이유`를 코드 블록에 담고 있는데,
 * 그것은 문서의 절이 아니라 **문서가 인용한 남의 마크다운**이다.
 */
function headingsOf(text: string): string[] {
  let fenced = false
  return text.split(NEWLINE).filter((line) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced
      return false
    }
    return !fenced && /^#{1,6}\s/.test(line)
  })
}

/**
 * 인용을 대조하기 위해 글자를 펴는 것. 셋을 없앤다.
 *
 * - **꾸밈**(`**`·`~~`·백틱) — 인용하는 쪽은 대개 떼고 적는다.
 * - **따옴표 종류**(`'`·`"`·`“`·`”`) — 표제는 `"…"`인데 인용은 `'…'`로 적힌 자리가 있다.
 * - **줄바꿈** — 문서는 80자에서 접히므로 **인용한 문장이 원문에서는 두 줄에 걸쳐 있다.**
 */
export function flatten(text: string): string {
  return text
    .replace(/[~*`]/g, '')
    .replace(/['"“”‘’]/g, '')
    .replace(/\s+/g, ' ')
}

/** `docs/` 아래와 뿌리의 문서를, 파일 이름으로 찾을 수 있게 모은다. */
function families(): Map<string, Family> {
  const found = new Map<string, Family>()
  const docs = join(ROOT, 'docs')
  const hubs = [
    ...readdirSync(docs)
      .filter((entry) => entry.endsWith('.md'))
      .map((entry) => join(docs, entry)),
    join(ROOT, 'CLAUDE.md'),
    join(ROOT, 'README.md'),
  ]
  for (const hub of hubs) {
    const base = basename(hub)
    const spokeDir = join(docs, base.replace(/\.md$/, ''))
    const spokes = statSync(spokeDir, { throwIfNoEntry: false })?.isDirectory()
      ? readdirSync(spokeDir)
          .filter((entry) => entry.endsWith('.md'))
          .sort()
          .map((entry) => readFileSync(join(spokeDir, entry), 'utf-8'))
      : []
    const hubText = readFileSync(hub, 'utf-8')
    found.set(base, {
      hub: inRepo(hub),
      hubText,
      flattened: flatten([hubText, ...spokes].join('\n')),
      headings: [...headingsOf(hubText), ...spokes.flatMap(headingsOf)],
      spokeHeadings: spokes.flatMap((text) =>
        headingsOf(text).filter((line) => /^#{2,3}\s/.test(line)),
      ),
    })
  }
  return found
}

const FAMILIES = families()

/** 아는 문서 이름들. 참조를 찾는 정규식을 여기서 만든다. */
const KNOWN = [...FAMILIES.keys()]

/**
 * 한 줄에서 참조 하나를 잡는 정규식.
 *
 * **조사가 끼면 절 번호가 아니다.** `` `open-decisions.md`의 2026-08-04 ``에서
 * 2026을 절로 읽으면 안 되므로, 번호는 파일 이름 바로 뒤(공백과 `§`·`#`만 사이에)
 * 붙은 것만 본다. 인용은 반대로 `의`와 굵게 표시를 사이에 허용한다 — 문서가
 * 실제로 그 모양으로 인용하기 때문이다.
 */
const REFERENCE = new RegExp(
  `(docs/)?\`?(${KNOWN.map((name) => name.replace(/\./g, '\\.')).join('|')})\`?` +
    `(?:\\s*(?:§\\s*(\\d+(?:\\.\\d+)*)|#(\\d+(?:-\\d+)?)|(\\d+(?:\\.\\d+)*)(?![\\w.-])|규칙\\s*(\\d+))` +
    `|(?:의)?[\\s*]*"([^"\\n]*)")?`,
  'g',
)

export interface Reference {
  readonly where: string
  readonly doc: string
  /** `docs/`를 붙여 적었는가. */
  readonly explicit: boolean
  readonly section: string | null
  readonly rule: number | null
  readonly title: string | null
  /** 따옴표가 안 닫혀서 제목이 잘렸는가. */
  readonly partial: boolean
}

/** 한 줄에서 참조를 뽑는다. */
export function referencesIn(line: string, where: string): Reference[] {
  const found: Reference[] = []
  for (const match of line.matchAll(REFERENCE)) {
    const [text, explicit, doc, section, hash, bare, rule, quoted] = match
    let title = quoted ?? null
    let partial = false
    if (title === null) {
      // 따옴표가 열리고 안 닫힌 줄. 남은 만큼이 표제의 부분 문자열인지만 본다.
      const opened = /^(?:의)?[\s*]*"([^"\n]+)$/.exec(line.slice(match.index + text.length))
      if (opened) {
        title = opened[1]!.replace(/[\s*)\-—]+$/, '')
        partial = true
        if (title.length < 6) title = null
      }
    }
    found.push({
      where,
      doc: doc!,
      explicit: explicit !== undefined,
      section: section ?? hash ?? bare ?? null,
      rule: rule === undefined ? null : Number(rule),
      title,
      partial,
    })
  }
  return found
}

/** 저장소 전체의 참조. */
function allReferences(): Reference[] {
  return SCANNED.flatMap((target) =>
    walk(join(ROOT, target)).flatMap((path) =>
      readFileSync(path, 'utf-8')
        .split(NEWLINE)
        .flatMap((line, index) => referencesIn(line, `${inRepo(path)}:${index + 1}`)),
    ),
  )
}

const REFERENCES = allReferences()

/** `docs/i18n.md`의 프런트엔드 규칙은 번호 매긴 목록이다. 몇 번까지 있는가. */
function highestRule(): number {
  const text = FAMILIES.get('i18n.md')!.hubText
  const front = text.slice(text.indexOf('## 프런트엔드'))
  return Math.max(...[...front.matchAll(/^(\d+)\.\s/gm)].map((match) => Number(match[1])))
}

describe('문서 참조', () => {
  it('훑을 것이 실제로 있다', () => {
    // 정규식이나 경로가 어긋나 **0건을 훑고 통과하는 것**이 이 검사의 가장 나쁜 실패다.
    expect(REFERENCES.length).toBeGreaterThan(1000)
    expect(FAMILIES.size).toBeGreaterThan(8)
  })

  it('가리키는 문서가 실제로 있다', () => {
    const missing = new Set<string>()
    for (const target of SCANNED) {
      for (const path of walk(join(ROOT, target))) {
        readFileSync(path, 'utf-8')
          .split(NEWLINE)
          .forEach((line, index) => {
            for (const match of line.matchAll(/docs\/([a-z][a-z0-9-]*\.md)/g)) {
              if (!FAMILIES.has(match[1]!)) {
                missing.add(`${inRepo(path)}:${index + 1}  ${match[0]}`)
              }
            }
          })
      }
    }
    expect([...missing].sort(), '없는 문서를 가리키는 자리').toEqual([])
  })

  it('가리키는 절 번호가 실제로 있다', () => {
    const dangling: string[] = []
    for (const reference of REFERENCES) {
      if (reference.section === null) continue
      const family = FAMILIES.get(reference.doc)!
      const numbers = new Set(family.headings.flatMap(headingAnchors))
      if (!numbers.has(reference.section)) {
        dangling.push(`${reference.where}  ${reference.doc} §${reference.section}`)
      }
    }
    expect(dangling, '없는 절을 가리키는 자리').toEqual([])
  })

  it('인용한 글자가 그 문서에 실제로 있다', () => {
    // **표제만 보지 않는다.** 따옴표는 주소로도(`"모바일에서도 동작한다"`) 인용으로도
    // (그 문서의 한 문장을 그대로 옮기는 것) 쓰인다. 둘을 가르는 표시가 없으므로
    // **글자가 그 문서 안에 있는가**만 묻는다. 표제가 바뀌어도, 인용한 문장이
    // 사라져도 잡힌다.
    const dangling: string[] = []
    for (const reference of REFERENCES) {
      if (reference.title === null) continue
      if (!FAMILIES.get(reference.doc)!.flattened.includes(flatten(reference.title))) {
        dangling.push(`${reference.where}  ${reference.doc} "${reference.title}"`)
      }
    }
    expect(dangling, '그 문서에 없는 글자를 인용한 자리').toEqual([])
  })

  it('가리키는 i18n 규칙 번호가 실제로 있다', () => {
    const highest = highestRule()
    const dangling = REFERENCES.filter(
      (reference) =>
        reference.rule !== null &&
        reference.doc === 'i18n.md' &&
        (reference.rule < 1 || reference.rule > highest),
    ).map((reference) => `${reference.where}  규칙 ${reference.rule} (1..${highest})`)
    expect(dangling, '없는 규칙을 가리키는 자리').toEqual([])
  })

  it('스포크의 표제가 허브 색인에 다 있다', () => {
    // **허브 아무 데나 있으면 되는 것이 아니다.** 색인은 목록이므로 글머리 기호나
    // 표제로 적힌 줄에서만 찾는다 — 본문이 그 제목을 인용하고 있는 것으로는 안 된다.
    // (실제로 `"모바일에서도 동작한다"`가 허브 머리말에 인용되어 있어서, 색인에서
    // 그 줄을 지워도 검사가 안 울었다.)
    const unlisted: string[] = []
    for (const [name, family] of FAMILIES) {
      const listed = family.hubText.split(NEWLINE).filter((line) => /^\s*(?:[-*]\s|#)/.test(line))
      for (const heading of family.spokeHeadings) {
        const key = indexKey(heading)
        if (key !== '' && !listed.some((line) => line.includes(key))) {
          unlisted.push(`${name}  ${key}`)
        }
      }
    }
    expect(unlisted, '색인에 없는 스포크 표제').toEqual([])
  })

  it('검사기가 실제로 잡는다', () => {
    expect(referencesIn('보라 (architecture.md §8.13.1).', 'x')[0]!.section).toBe('8.13.1')
    expect(referencesIn('보라 (mlpx-spec.md 5.7).', 'x')[0]!.section).toBe('5.7')
    expect(referencesIn('보라 (`open-decisions.md` #28-6).', 'x')[0]!.section).toBe('28-6')

    const rule = referencesIn('보라 (docs/i18n.md 규칙 7).', 'x')[0]!
    expect(rule.rule).toBe(7)
    expect(rule.explicit).toBe(true)

    expect(referencesIn('보라 (open-decisions.md "모바일에서도 동작한다").', 'x')[0]!.title).toBe(
      '모바일에서도 동작한다',
    )

    // **줄을 변수로 뺀다.** 여기 그대로 적으면 따옴표가 안 닫힌 채로 남아
    // 위 검사가 이 줄의 꼬리(`', 'x')[0]!`)까지 인용으로 읽는다.
    const wrapped = ' * (open-decisions.md "군집 답의 증거는 팝오버가 갖는'
    const cut = referencesIn(wrapped, 'x')[0]!
    expect(cut.partial).toBe(true)
    expect(cut.title).toBe('군집 답의 증거는 팝오버가 갖는')

    // 날짜를 절 번호로 읽으면 안 된다. 조사가 끼면 번호 참조가 아니다.
    expect(referencesIn('`open-decisions.md`의 2026-08-04 표', 'x')[0]!.section).toBeNull()

    // 장식이 붙은 표제도 같은 열쇠를 낸다.
    expect(indexKey('### ~~32. 프로젝트 파일 크기 경고~~ — **결정됨 (2026-08-19)**')).toBe(
      '32. 프로젝트 파일 크기 경고',
    )
    expect(headingNumber('#### 28-5. 그릴 점의 상한')).toBe('28-5')
    expect(headingNumber('## 8. 프런트엔드 셸')).toBe('8')
    expect(headingNumber('### 모바일에서도 동작한다 (2026-08-04)')).toBeNull()

    // 닫힌 미결정 번호는 닫은 표제가 받는다. 낱말도 자리도 한 모양이 아니다.
    expect(headingAnchors('### 인코딩 판정과 지원 목록 (2026-08-04) — #15 마무리')).toEqual(['15'])
    expect(headingAnchors('### 포트폴리오 — 답은 글이다 (V5, 2026-08-14) — #23 종결')).toEqual([
      '23',
    ])
    expect(headingAnchors('### 백본 추론은 TF.js가 돌린다 (2026-08-12) — #25 ① 마무리')).toEqual([
      '25',
    ])
    // 닫힘을 선언하지 않은 표제의 `#N`은 남의 번호를 가리키는 본문일 뿐이다.
    expect(headingAnchors('### 군집 산점도의 축 (2026-08-15) — #28-2를 좁힌다')).toEqual([])

    // 원문이 두 줄에 걸쳐 있어도, 따옴표 종류가 달라도 같은 글자다.
    expect(flatten('파일 계층은 "파일 참조인가"를\n묻는다')).toBe(
      flatten("파일 계층은 '파일 참조인가'를 묻는다"),
    )
  })
})
