/**
 * 포트폴리오 - 문항과 답을 다루는 순수 함수들, 그리고 사람이 읽는 마크다운.
 *
 * **양식은 마크다운이고 답은 서식 없는 글이다** (mlpx-spec.md §8). 문항을 더하고
 * 지우고 옮기는 판단이 전부 여기 있고 화면은 결과를 받아 그린다 - 컴포넌트 안에 두면
 * 아무도 그 판단을 테스트하지 않는다 (CLAUDE.md §4).
 *
 * **여기는 i18n을 모른다.** 문항 문구는 쓴 사람의 말이라 애초에 번역 대상이 아니고,
 * `.md` 머리글의 라벨은 부르는 쪽이 만들어 넘긴다 (§8.6).
 */

import { CANONICAL_FORMAT_IDS, CANONICAL_FORMATS } from '../data/image/formats'
import { own } from '../records'
import { DIR } from './format'
import type { Portfolio, PortfolioTemplateSection } from './schema'

/** 아직 id가 없는 문항. 마크다운에서 갓 읽어 온 것과 화면이 새로 만드는 것이 이 모양이다. */
export interface DraftSection {
  /** 양식에 주석으로 박혀 있던 id (§8.2). 없으면 제목에서 만든다. */
  readonly id?: string
  readonly title: string
  readonly description?: string
}

/** 화면이 문항 하나를 그리는 데 필요한 것 전부. */
export interface PortfolioSection extends PortfolioTemplateSection {
  readonly answer: string
}

/** 지금 양식에 없는 id에 붙어 있는 답 (§8.4). */
export interface OrphanAnswer {
  readonly id: string
  readonly answer: string
}

/** 슬러그를 만들 수 없는 제목이 떨어지는 자리. 뒤에 순번이 붙는다 (§8.2). */
const FALLBACK_ID_PREFIX = 'section'

/** 슬러그에 남길 글자. 한글도 글자다 - 라틴 문자만 남기면 한국어 제목이 전부 순번이 된다. */
const NOT_IN_SLUG = /[^\p{L}\p{N}]+/gu

const TRIM_DASHES = /^-+|-+$/g

export function sectionsOf(portfolio: Portfolio): readonly PortfolioTemplateSection[] {
  return portfolio.template.sections
}

/**
 * 양식을 골랐는가. **비어 있는 것이 "아직 안 골랐다"다** (mlpx-spec.md §8.5).
 * 화면은 이것이 거짓일 때 시작 화면을 낸다.
 */
export function hasTemplate(portfolio: Portfolio): boolean {
  return portfolio.template.sections.length > 0
}

/**
 * **원시 연산은 `src/records.ts`가 갖는다** (2026-09-23 R37 C-5).
 *
 * A-2가 이 파일에서 셋을 닫았는데, 같은 병이 하이퍼파라미터 표 둘에 더 있었다 —
 * 자리가 다섯이 되자 사본을 두는 것이 위험해졌다. 왜 필요한지는 그 파일에 있다.
 */

/** 화면이 그릴 문항들. 답을 문항에 붙여 준다. */
export function portfolioSections(portfolio: Portfolio): PortfolioSection[] {
  return portfolio.template.sections.map((section) => ({
    ...section,
    answer: own(portfolio.answers, section.id) ?? '',
  }))
}

/**
 * 제목에서 문항 id를 만든다 (§8.2).
 *
 * **순서 번호로 하지 않는다** - 문항 순서를 바꾸는 순간 답이 엉뚱한 문항에 조용히
 * 붙는다. 슬러그는 제목을 고치면 답이 떨어져 나가지만 그건 화면에 보인다.
 *
 * 기호만 있는 제목처럼 만들 수 없는 것은 순번으로 떨어진다. **순번은 그 양식 안에서의
 * 자리다** - 같은 양식을 두 번 가져와도 같은 id가 나와야 다시 안 붙는다 (§8.3).
 */
export function sectionIdFor(title: string, index: number): string {
  const slug = title.trim().toLowerCase().replace(NOT_IN_SLUG, '-').replace(TRIM_DASHES, '')
  return slug === '' ? `${FALLBACK_ID_PREFIX}-${index + 1}` : slug
}

/** 이미 쓰인 id를 피해 번호를 붙인다. 겹치는 제목이 한 양식 안에 둘 있을 수 있다. */
function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

function draftToSection(draft: DraftSection, id: string): PortfolioTemplateSection {
  const description = draft.description?.trim()
  return {
    id,
    title: draft.title.trim(),
    ...(description === undefined || description === '' ? {} : { description }),
  }
}

/**
 * 가져온 문항을 뒤에 붙인다. **대체가 아니라 추가다** (mlpx-spec.md §8.3).
 *
 * **이미 있는 id는 다시 붙이지 않는다.** 그래야 두 번 눌러도 문항이 불어나지 않고,
 * 그 문항에 쓴 글도 안 흔들린다. 밖에 이미 있는 것에 번호를 붙이지 않는 이유가
 * 그것이다 - 번호를 붙이면 같은 양식을 가져올 때마다 사본이 쌓인다.
 */
export function withImportedSections(
  portfolio: Portfolio,
  drafts: readonly DraftSection[],
  locale?: string,
): Portfolio {
  const before = new Set(portfolio.template.sections.map((section) => section.id))
  const taken = new Set(before)
  /** 이 묶음 안에서 그 자연 id가 몇 번째로 나왔나. 이름은 등장 순번이 정한다. */
  const seen = new Map<string, number>()
  const added: PortfolioTemplateSection[] = []
  drafts.forEach((draft, index) => {
    const natural = draft.id ?? sectionIdFor(draft.title, index)
    /**
     * **밖에 이미 있던 것과 이번 묶음 안의 충돌은 다른 일이다.**
     *
     * 앞엣것은 건너뛴다(위 머리말 - 두 번 눌러도 안 불어난다). 뒤엣것은 §8.2가
     * *"겹치면 뒤에 번호를 붙이고"*라고 정한 자리다 - 건너뛰면 **교사가 준 양식의
     * 문항이 안내문째 말없이 빠진다.** 제목이 눈에 다르게 보여도 슬러그가 같으면
     * 충돌한다(`결과`와 `결과?`).
     *
     * **이름을 묶음 안의 등장 순번으로 정한다.** `taken`으로 번호를 붙이면
     * 가져올 때마다 하나씩 밀려 **같은 양식의 사본이 쌓인다.** 순번으로 정해야
     * 둘째 `느낀 점`이 언제나 `느낀-점-2`이고, 그것이 밖에 이미 있으면 건너뛴다 —
     * 밖에 `느낀-점`만 있을 때 둘째가 사라지던 자리다 (2026-08-31 사각 감사 A-2).
     */
    const nth = (seen.get(natural) ?? 0) + 1
    seen.set(natural, nth)
    const candidate = nth === 1 ? natural : `${natural}-${nth}`
    if (before.has(candidate)) return
    const id = uniqueId(candidate, taken)
    added.push(draftToSection(draft, id))
    taken.add(id)
  })
  if (added.length === 0) return portfolio

  /**
   * **양식의 언어는 처음 문항이 들어올 때 박고 그 뒤로 안 바뀐다** (mlpx-spec.md §8.5).
   *
   * 가져오기가 대체가 아니라 추가라서 언어가 섞인 양식을 만들 수는 있는데, 그때 참인
   * 단일 값은 없다 — **양식의 정체는 그것을 세운 첫 가져오기가 갖는다.**
   *
   * `locale`이 없는 것은 빠뜨림이 아니라 **모른다**는 뜻이다 (밖에서 받은 `.md`).
   * 그때 UI 언어를 대신 적으면 추측이 사실로 굳는다.
   */
  const first = portfolio.template.sections.length === 0
  const stamped = first && locale !== undefined ? { locale } : {}

  return {
    ...portfolio,
    template: {
      ...portfolio.template,
      ...stamped,
      sections: [...portfolio.template.sections, ...added],
    },
  }
}

/**
 * 사람이 문항 하나를 더한다.
 *
 * **가져오기와 다르다** - 여기서는 id가 겹쳐도 건너뛰지 않고 번호를 받는다. 누른
 * 사람은 문항이 하나 늘기를 기대했고, 아무 일도 안 일어나는 것은 고장으로 읽힌다.
 */
export function withSectionAdded(portfolio: Portfolio, draft: DraftSection): Portfolio {
  const taken = new Set(portfolio.template.sections.map((section) => section.id))
  const id = uniqueId(draft.id ?? sectionIdFor(draft.title, taken.size), taken)
  return {
    ...portfolio,
    template: {
      ...portfolio.template,
      sections: [...portfolio.template.sections, draftToSection(draft, id)],
    },
  }
}

/**
 * 문항을 지운다. **그 문항의 답도 함께 지운다** (mlpx-spec.md §8.4).
 *
 * 되돌릴 수 없다. 의도가 분명하기 때문이다 - 지우겠다고 누른 것이다. 답이 유령으로
 * 파일에 남으면 크기만 먹고 아무도 못 본다.
 */
export function withSectionRemoved(portfolio: Portfolio, id: string): Portfolio {
  const sections = portfolio.template.sections.filter((section) => section.id !== id)
  if (sections.length === portfolio.template.sections.length) return portfolio
  const answers = { ...portfolio.answers }
  delete answers[id]
  // **첨부도 함께 지운다.** 문서에서만 떼면 사진 바이트가 파일에 남아 크기만 먹고
  // 아무도 못 본다 - `.mlpx`로 내보낼 때 아무도 안 가리키는 것은 안 담긴다(`writeProject`).
  // 바이트를 놓는 것은 이 순수 함수가 아니라 부르는 쪽이다(`withoutReleasedAttachments`).
  const attachments = { ...portfolio.attachments }
  delete attachments[id]
  return { ...portfolio, template: { ...portfolio.template, sections }, answers, attachments }
}

/**
 * 순서 옮기기의 맨 위. **잠금과 옮기기가 이 함수 하나를 본다** — 등록부의 `sectionTop`(`locks.ts`)과
 * `withSectionMoved`가 함께 부른다(#31, `architecture.md` §10.7). 모델 층은 등록부를 들이지 않으므로
 * 판정이 여기 있고 등록부가 이것을 부른다. `locks.spec.ts`의 *"순서 옮기기는 잠금과 같은 판정으로
 * 멈춘다"*가 문다.
 */
export function sectionTopBlockers(input: { readonly index: number }): readonly 'TOP'[] {
  return input.index <= 0 ? ['TOP'] : []
}

/** 순서 옮기기의 맨 아래. `sectionTopBlockers`와 같은 까닭으로 여기 있다(등록부의 `sectionBottom`). */
export function sectionBottomBlockers(input: {
  readonly index: number
  readonly count: number
}): readonly 'BOTTOM'[] {
  return input.index >= input.count - 1 ? ['BOTTOM'] : []
}

/**
 * 문항을 한 칸 옮긴다. 끝에서 더 가면 아무 일도 안 일어난다 — 그 끝은 **잠금과 같은 판정**
 * (`sectionTopBlockers`·`sectionBottomBlockers`)이 정한다. 한 칸만 받는다: 판정이 한 칸의 끝을
 * 말하므로 여러 칸을 받으면 판정 밖의 범위 검사가 다시 필요해진다.
 */
export function withSectionMoved(portfolio: Portfolio, id: string, step: -1 | 1): Portfolio {
  const sections = [...portfolio.template.sections]
  const from = sections.findIndex((section) => section.id === id)
  if (from === -1) return portfolio
  const refused =
    step < 0
      ? sectionTopBlockers({ index: from })
      : sectionBottomBlockers({ index: from, count: sections.length })
  if (refused.length > 0) return portfolio
  const to = from + step
  const [moved] = sections.splice(from, 1)
  if (moved === undefined) return portfolio
  sections.splice(to, 0, moved)
  return { ...portfolio, template: { ...portfolio.template, sections } }
}

/**
 * 문항의 문구를 고친다. **id는 안 건드린다** - 제목을 다듬었다고 쓴 글이 떨어져
 * 나가면 아무도 제목을 못 고친다.
 *
 * **쓴 그대로 담는다. 여기서 다듬지 않는다** (2026-08-14에 고쳤다). 타자마다 `trim()`을
 * 걸었더니 **안내문에 줄바꿈을 칠 수 없었다** - 끝에 친 `\n`이 잘려 저장된 값이 화면과
 * 달라지고, Vue는 DOM의 지금 값과 새 값을 견주므로(`patchDOMProp`) 그때 칸을 다시
 * 써서 방금 친 줄바꿈을 지운다. 제목 끝의 공백도 같은 이유로 안 지운다.
 *
 * **비어 있으면 자리 자체를 지운다.** 빈 문자열을 파일에 남기지 않는다 - 안내문이
 * 없는 것과 빈 안내문이 있는 것은 같은 것이다.
 */
export function withSectionText(
  portfolio: Portfolio,
  id: string,
  patch: { readonly title?: string; readonly description?: string },
): Portfolio {
  const sections = portfolio.template.sections.map((section) => {
    if (section.id !== id) return section
    const description = patch.description ?? section.description
    const blank = description === undefined || description.trim() === ''
    // **`description`을 먼저 떼어낸다.** 안 떼면 비웠을 때 옛 안내문이 그대로 남는다.
    const { description: cleared, ...rest } = section
    void cleared
    return {
      ...rest,
      title: patch.title ?? section.title,
      ...(blank ? {} : { description }),
    }
  })
  return { ...portfolio, template: { ...portfolio.template, sections } }
}

/** 답을 갈아 끼운다. 쓴 그대로 담는다 - 다듬는 것은 읽는 쪽이 한다. */
export function withAnswer(portfolio: Portfolio, id: string, answer: string): Portfolio {
  return { ...portfolio, answers: { ...portfolio.answers, [id]: answer } }
}

/** 이 문항에 붙은 사진들. 붙인 순서가 곧 보이는 순서다. */
export function attachmentsOf(portfolio: Portfolio, sectionId: string): readonly string[] {
  return own(portfolio.attachments, sectionId) ?? []
}

/**
 * 문항 하나에 붙은 사진들을 **화면이 그리는 모양**으로 만든다.
 *
 * **주소가 없는 것은 뺀다** — 파일에서 바이트가 빠진 첨부가 그렇고, 거기서 빈 `<img>`를
 * 그리면 깨진 그림 아이콘이 뜬다.
 *
 * 순수 함수인 이유는 부르는 화면이 둘이 되기 때문이다 — 포트폴리오 편집 화면과 점검
 * 화면이 같은 것을 그린다 (open-decisions.md "점검은 읽기 전용 열람기다").
 */
export function photosOf(
  portfolio: Portfolio,
  sectionId: string,
  urls: ReadonlyMap<string, string>,
): { path: string; url: string }[] {
  return attachmentsOf(portfolio, sectionId)
    .map((path) => ({ path, url: urls.get(path) ?? '' }))
    .filter((one) => one.url !== '')
}

/** 파일 안에서 누군가 가리키고 있는 사진 경로 전부. */
export function referencedAttachments(portfolio: Portfolio): Set<string> {
  return new Set(Object.values(portfolio.attachments).flat())
}

/**
 * 고치기 전에는 누가 가리켰는데 고친 뒤에는 **아무도 안 가리키는** 사진의 바이트를 놓은 맵.
 *
 * **사진을 떼든 문항을 지우든 같은 규칙이다** (mlpx-spec.md §8.4 "다른 문항이 아직 가리키는
 * 사진은 떼거나 문항을 지워도 남는다"). 문항을 지울 때 참조만
 * 떼면 바이트가 브라우저 저장소에 계속 남고(`.mlpx`에서만 빠진다), 사진 하나를 뗄 때 참조를
 * 안 보고 바이트를 지우면 **같은 경로를 가리키는 다른 문항의 사진이 함께 사라진다** — 우리
 * 코드는 그런 파일을 안 만들지만 남이 고친 파일에서는 온다. 판정을 한 곳에 두어 두 입구가
 * 갈리지 않게 한다.
 *
 * 원래 아무도 안 가리키던 바이트는 건드리지 않는다 — 이 편집이 놓은 것이 아니다.
 * `portfolio.spec.ts`의 *"놓는 바이트"*와 `portfolio-view.spec.ts`의 *"지우면 바이트도
 * 놓는다"*가 문다.
 */
export function withoutReleasedAttachments(
  before: Portfolio,
  after: Portfolio,
  stored: ReadonlyMap<string, Uint8Array>,
): Map<string, Uint8Array> {
  const still = referencedAttachments(after)
  const kept = new Map(stored)
  for (const path of referencedAttachments(before)) {
    if (!still.has(path)) kept.delete(path)
  }
  return kept
}

/**
 * 다음 사진이 가질 경로.
 *
 * **가리키는 이름과 바이트로 들고 있는 이름 전부의 최대 번호 + 1이다.** 가장 큰 번호를
 * 떼어 내면 그 번호는 다시 쓰인다 — 떼거나 문항을 지우면 아무도 안 가리키게 된 바이트도
 * 함께 놓으므로(`withoutReleasedAttachments`) 한 이름에 두 사진이 사는 일은 없다. 그래도
 * `stored`를 세는 이유는 **아무도 안 가리키는 바이트가 들어올 수 있기 때문이다** — 옛 판에서
 * 문항을 지운 프로젝트가 브라우저 저장소에 그렇게 남아 있고, 그 이름을 새 사진이 다시 받으면
 * 이름으로 묶인 화면의 사진 주소(`useObjectUrls`)가 옛 사진을 보일 수 있다.
 * `portfolio-attach.spec.ts`의 *"문항을 지운 뒤 다른 문항에 붙인 사진이"*와
 * `portfolio.spec.ts`가 문다.
 */
export function nextAttachmentPath(
  portfolio: Portfolio,
  extension: string,
  stored: Iterable<string>,
): string {
  const names = new Set([...referencedAttachments(portfolio), ...stored])
  const numbers = [...names].map((path) => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return Number.parseInt(name, 10)
  })
  const last = Math.max(0, ...numbers.filter((one) => Number.isFinite(one)))
  return attachmentPathOf(last + 1, extension)
}

/** 앱이 사진에 짓는 이름 — 한 벌이다. `nextAttachmentPath`가 짓고 `isAppAttachmentPath`가 되짓어 견준다. */
function attachmentPathOf(number: number, extension: string): string {
  return `${DIR.attachments}${number}${extension}`
}

/** 사진을 구울 수 있는 형식의 확장자(`attachments.ts`가 `detectCanonicalFormat`으로 고른다). */
const ATTACHMENT_EXTENSIONS = CANONICAL_FORMAT_IDS.map((id) => CANONICAL_FORMATS[id].extension)

/**
 * **앱이 지은 모양의 사진 경로인가** — `attachmentPathOf`로 되지어 글자까지 같아야 한다 (open-decisions.md 93).
 *
 * 경로는 학생의 `document.json`(`portfolio.attachments`)에서 오고, 읽기는 zip 엔트리가 있는지와 zip 밖으로 새는지만 본다.
 * 엔트리 이름을 같은 문자열로 지은 조작한 파일이면 `a)<img …>`·줄바꿈이 든 경로가 그대로 들어온다. `document.md`는 이 모양만
 * 사진 링크로 싣는다 — 이력상 앱은 이 모양(1부터의 수, 0 채움 없음, 하위 폴더 없음, `.webp`·`.jpg`) 말고 지은 적이 없다.
 * `portfolio.spec.ts`의 *"결정 93"* 묶음과 `portfolio-bundle.spec.ts`가 문다.
 */
export function isAppAttachmentPath(path: string): boolean {
  const extension = ATTACHMENT_EXTENSIONS.find((one) => path.endsWith(one))
  if (extension === undefined || !path.startsWith(DIR.attachments)) return false
  const number = Number.parseInt(path.slice(DIR.attachments.length), 10)
  return Number.isSafeInteger(number) && number >= 1 && path === attachmentPathOf(number, extension)
}

/** 사진 하나를 문항에 붙인다. **답 아래에 카드로 붙는다** - 문단 중간에는 못 꽂는다. */
export function withAttachmentAdded(
  portfolio: Portfolio,
  sectionId: string,
  path: string,
): Portfolio {
  return {
    ...portfolio,
    attachments: {
      ...portfolio.attachments,
      [sectionId]: [...attachmentsOf(portfolio, sectionId), path],
    },
  }
}

/** 사진 하나를 뗀다. 마지막 한 장을 떼면 그 문항의 자리도 없앤다. */
export function withAttachmentRemoved(
  portfolio: Portfolio,
  sectionId: string,
  path: string,
): Portfolio {
  const kept = attachmentsOf(portfolio, sectionId).filter((one) => one !== path)
  const attachments = { ...portfolio.attachments }
  delete attachments[sectionId]
  /**
   * **색인 대입이 아니라 리터럴로 담는다** (2026-09-23 R37-V, A-2의 이웃).
   *
   * `attachments[sectionId] = kept`는 id가 `__proto__`일 때 **own 속성을 안 만들고
   * 프로토타입을 바꾼다.** 그러면 `own()`이 못 찾아 **그 문항의 사진이 전부 조용히
   * 사라진다.** 계산된 열쇠를 쓴 객체 리터럴은 언제나 own 속성을 만든다.
   */
  return {
    ...portfolio,
    attachments: kept.length === 0 ? attachments : { ...attachments, [sectionId]: kept },
  }
}

/**
 * 지금 양식에 없는 id의 답 (mlpx-spec.md §8.4).
 *
 * 정상 경로로는 안 생긴다 - 문항을 지우면 답도 함께 지우고, 가져오기는 대체가 아니다.
 * **그래도 버리지 않는다.** 남이 손으로 고친 파일에서는 올 수 있고, 그때 조용히
 * 지우면 그 파일을 준 사람의 글이 말없이 사라진다.
 */
export function orphanAnswers(portfolio: Portfolio): OrphanAnswer[] {
  const known = new Set(portfolio.template.sections.map((section) => section.id))
  return Object.entries(portfolio.answers)
    .filter(([id, answer]) => !known.has(id) && answer.trim() !== '')
    .map(([id, answer]) => ({ id, answer }))
}

/**
 * 체크리스트가 완료로 넘어가는 기준 (mlpx-spec.md §8.3).
 *
 * **"한 글자라도 썼는가"가 아니라 "모든 문항에 답이 있는가"다.** 딸려 오는 것 셋 -
 * 문항을 새로 추가하면 완료가 다시 풀리고(자기가 늘린 것이다), 지금 양식에 없는
 * 문항의 답은 안 세며, 양식을 아직 고르지 않았으면 완료가 아니다.
 */
export function isPortfolioAnswered(portfolio: Portfolio): boolean {
  if (!hasTemplate(portfolio)) return false
  return portfolio.template.sections.every(
    (section) => (own(portfolio.answers, section.id) ?? '').trim() !== '',
  )
}

const encoder = new TextEncoder()

/**
 * 포트폴리오가 차지하는 글의 바이트 수. 상한 판정에 쓴다 (mlpx-spec.md §8.6.1).
 *
 * **첨부도 나중에 같은 상한에 합류한다.** 문항마다 나누지 않는 이유는 나누면 어느
 * 칸이 얼마인지를 설명해야 하기 때문이다.
 */
export function portfolioTextBytes(portfolio: Portfolio): number {
  let bytes = 0
  for (const section of portfolio.template.sections) {
    bytes += encoder.encode(section.title).length
    bytes += encoder.encode(section.description ?? '').length
  }
  for (const answer of Object.values(portfolio.answers)) {
    bytes += encoder.encode(answer).length
  }
  return bytes
}

/**
 * 글과 첨부를 합친 크기. **상한이 보는 값이다** (mlpx-spec.md §8.6.1).
 *
 * 문항마다 나누지 않는다 - 나누면 어느 칸이 얼마인지를 설명해야 한다.
 */
export function portfolioBytes(
  portfolio: Portfolio,
  attachments: ReadonlyMap<string, Uint8Array>,
): number {
  let bytes = portfolioTextBytes(portfolio)
  for (const path of referencedAttachments(portfolio)) {
    bytes += attachments.get(path)?.byteLength ?? 0
  }
  return bytes
}

/**
 * `.md` 머리글과 라벨. **부르는 쪽이 만들어 넘긴다** (mlpx-spec.md §8.6).
 *
 * 포맷 계층은 `t()`를 모른다 - i18n을 끌어들이면 zip 왕복 테스트마다 번역을 부팅해야
 * 한다.
 */
export interface PortfolioMarkdownText {
  /** 문서 제목. 프로젝트 이름이다. */
  readonly title: string
  /** 머리에 적는 프로젝트 정보. 화면에서는 `ProjectSummary`가 하는 일이다. */
  readonly rows: readonly (readonly [label: string, value: string])[]
  /** 지금 양식에 없는 답을 모아 두는 자리의 제목. */
  readonly orphanTitle: string
}

/*
 * ─── 여기서 `escapeInline`까지가 `document.md`의 판정이다 ───
 *
 * **판정의 공백과 줄 끝은 CommonMark의 정의를 따른다 — 공백은 스페이스와 탭, 줄 끝은 `\n`·`\r`이다.** JS의
 * `trim`·`\s`는 NBSP·U+3000·U+2028/2029·FEFF·`\v`·`\f`까지 공백으로 보고 `.`은 U+2028/2029와 `\r`에 안 맞는다.
 * 그 차이로 빈 줄·닫는 울타리를 뷰어와 다르게 세면 울타리 안팎이 뒤집혀 학생의 태그가 선다(open-decisions.md 89,
 * 보안 검토 A-1·A-2). `portfolio.spec.ts`의 *"판정 구역에 JS 공백 판정이 없다"*가 이 구역을 훑는다.
 */

/** 줄머리의 `#`. 앞의 여백까지 함께 본다 - 세 칸까지 들여쓴 제목도 제목으로 읽힌다. */
const LINE_LEADING_HASH = /^( {0,3})(#+)/

/**
 * 단독으로 서면 앞줄을 제목으로 만드는 줄.
 *
 * **한 글자도 성립한다.** CommonMark의 setext 밑줄에는 최소 길이가 없어서
 * `앞줄` 다음 줄의 `-` 하나가 `<h2>`를, `=` 하나가 `<h1>`을 만든다. 학생이 목록을
 * 치다 남긴 **빈 항목(`- `)**이 정확히 그 모양이다. 막을 것은 글자 수가 아니라
 * 성질이다 (`mlpx-spec.md` §8.6).
 */
const SETEXT_UNDERLINE = /^( {0,3})(-+|=+)[ \t]*$/

/**
 * 코드 울타리 줄. 뒤에 언어 이름이 올 수 있는 것이 여는 줄이다 (CommonMark).
 *
 * 닫으려면 **같은 글자로 그만큼 이상** 길어야 하고, 닫는 줄에는 언어 이름을 못 붙인다.
 *
 * **들여쓰기는 공백 셋까지다 — 탭이 아니다.** CommonMark에서 탭은 네 칸이라 탭으로
 * 들여쓴 줄은 울타리가 아니라 **들여쓴 글**이다. `\s{0,3}`으로 세던 때는 그 줄을
 * 울타리로 읽고 답 끝에 닫는 줄을 더했는데, **더한 그 줄이 진짜 여는 울타리가 되어
 * 뒤따르는 문항을 삼켰다** (2026-08-31 사각 감사 A-1).
 *
 * **뒤는 `[^\n]*`다 — `.*`가 아니다.** `.`은 U+2028/2029에 안 맞아 언어 자리에 그 글자가 든 여는 줄을 놓쳤다.
 */
const FENCE = /^( {0,3})(`{3,}|~{3,})([^\n]*)$/

/** CommonMark의 빈 줄 — 스페이스와 탭만. 닫는 울타리 뒤도 같은 정의다. */
const BLANK = /^[ \t]*$/

/**
 * **링크의 주소가 시작하는 자리** — `]` 뒤에 (스페이스·탭을 건너) `(`나 `:`가 온다 (open-decisions.md 93).
 *
 * 인라인 링크·이미지는 `](`로, 링크 참조 정의는 `]:`로 주소를 연다(CommonMark — 둘 다 붙어 있어야 하지만 느슨한 뷰어를
 * 생각해 사이의 스페이스·탭도 센다). 참조 링크(`[x][r]`·`[r]`)는 주소를 정의에서 받으므로 정의만 막으면 된다.
 * **이 모양이 있는 문단의 코드 스팬은 믿지 않는다**(`trustedCodeSpans`) — 링크 목적지가 백틱을 먹고, 블록인 정의는
 * 인라인인 코드 스팬보다 먼저 서기 때문이다(`` [r`]: javascript:x` ``를 markdown-it은 정의로 읽는다 — `portfolio.spec.ts`의
 * *"결정 93"* 묶음의 *"코드 스팬처럼 보이는 정의"*가 문다).
 */
const LINK_DESTINATION = /\][ \t]*[(:]/

/**
 * **통과하는 주소** — 여는 자리 뒤 스페이스·탭을 건너 **날글자** `http://`·`https://`가 곧바로 온다 (open-decisions.md 93).
 *
 * 스킴 글자를 날글자로만 받으므로 엔티티(`&#104;`)·백슬래시·공백이 끼면 통과하지 못한다 — 어느 뷰어가 엔티티를 풀든
 * 말든 주소의 머리는 우리가 본 그대로 `http(s)://`다(사람 확인 — 머리의 글자에 `&`·`\`가 없으니 풀 것이 없다). 대소문자만 가리지 않는다(스킴은 대소문자를 안 가린다). `i` 깃발 대신
 * 글자 묶음을 쓴다 — 깃발은 `u`와 함께면 `ſ`(U+017F)를 `s`로 접는다(사람 확인, node에서 `/^https:/iu`가 `httpſ:`에 맞았다).
 */
const WEB_ADDRESS = /^[ \t]*[Hh][Tt][Tt][Pp][Ss]?:\/\//

/**
 * **주소가 http·https가 아닌 링크는 글자로 싣는다** (open-decisions.md 93, mlpx-spec.md §8.6).
 *
 * 주소를 여는 `(`·`:` 앞에 백슬래시를 넣는다 — `[x]\(javascript:…)`·`[r]\: javascript:…`. 그 자리에서 링크 문법이 안 서고
 * 뷰어에는 원문 글자(`[x](javascript:…)`)가 보인다. 여는 `[`를 찾아 바꾸는 것보다 좁다 — 괄호 짝을 셀 필요가 없다.
 * `javascript:`·`data:`·그 밖의 스킴과 상대 주소가 모두 여기 걸린다. 사진 링크는 이 판정을 안 거치고 앱이 지은 모양의
 * 경로만 실린다(`isAppAttachmentPath`).
 *
 * `text`가 코드 스팬으로 잘린 조각이어도 판정이 같다 — 이 모양이 있는 문단은 스팬을 믿지 않아 줄이 통째로 온다.
 * `portfolio.spec.ts`의 *"결정 93"* 묶음(가리는 모양 × 사용자 글의 자리, 링크를 거르지 않는 렌더러의 보안 퍼저)이 문다.
 */
function escapeLinks(text: string): string {
  return text.replace(new RegExp(LINK_DESTINATION.source, 'g'), (opener: string, at: number) =>
    WEB_ADDRESS.test(text.slice(at + opener.length))
      ? opener
      : `${opener.slice(0, -1)}\\${opener.slice(-1)}`,
  )
}

/**
 * **코드 밖의 `<`는 `&lt;`로 싣고, http·https가 아닌 링크는 글자로 싣는다** (open-decisions.md 89·93, mlpx-spec.md §8.6).
 *
 * 학생이 쓴 HTML이 HTML을 거르지 않는 뷰어에서 태그로 서면 **교사 화면에서 학생의 코드가 돈다**(XSS). 줄머리의
 * `<`는 HTML 블록을 열어 뒤 문항까지 삼킨다. `&lt;`는 뷰어가 `<` 글자로 보이고 어느 자리에서도 태그를 못 연다.
 * `javascript:` 주소의 링크도 누르면 돈다(`escapeLinks`).
 * 코드 안(울타리·코드 스팬)은 뷰어가 이미 글자로 보이고 거기서 바꾸면 `&lt;`가 그대로 보이므로 안 바꾼다.
 */
function escapeOutsideCode(
  line: string,
  spans: readonly (readonly [from: number, to: number])[],
): string {
  const escape = (text: string) => escapeLinks(text).replace(/</g, '&lt;')
  let out = ''
  let at = 0
  for (const [from, to] of spans) {
    out += escape(line.slice(at, from)) + line.slice(from, to)
    at = to
  }
  return out + escape(line.slice(at))
}

/** 백틱 연속 하나. `escaped`는 앞의 백슬래시 개수가 홀수라 첫 백틱이 글자라는 뜻이다. */
interface BacktickRun {
  readonly line: number
  readonly start: number
  readonly end: number
  readonly escaped: boolean
}

function backtickRuns(lines: readonly string[], paragraph: readonly number[]): BacktickRun[] {
  const runs: BacktickRun[] = []
  for (const index of paragraph) {
    const line = lines[index]!
    for (const match of line.matchAll(/`+/g)) {
      const start = match.index
      let slashes = 0
      while (start - slashes > 0 && line[start - slashes - 1] === '\\') slashes += 1
      runs.push({ line: index, start, end: start + match[0].length, escaped: slashes % 2 === 1 })
    }
  }
  return runs
}

/**
 * **믿을 수 있는 코드 스팬** — 줄 번호마다 `[여는 백틱, 닫는 백틱 뒤)` (open-decisions.md 89).
 *
 * 짝짓기는 CommonMark다: 길이 n의 백틱 연속이 열고 **정확히 같은 길이**의 다음 연속이 닫는다. 닫는 쪽을 찾을 때는
 * 백슬래시를 안 본다(스팬 안에서 백슬래시는 글자다). 여는 쪽은 앞의 백슬래시가 홀수면 첫 백틱이 글자이고 나머지가
 * 연속이다. 못 닫은 연속은 글자다. 스팬은 문단 안에서 줄을 넘는다 — 그래서 문단(울타리 밖의 빈 줄 없는 줄들) 단위로 짝짓는다.
 *
 * **모르겠으면 믿지 않는다 — 보안이 먼저다.** 여기서 스팬이라 했는데 뷰어가 아니라고 읽으면 그 안의 `<`가 태그로 선다.
 * 거꾸로 틀리면 코드 안에 `&lt;`가 보일 뿐이다. 그래서 문단에 다음 중 하나라도 있으면 **그 문단의 스팬을 하나도 안 믿는다**:
 * - **줄을 넘는 스팬** — 목록 표지 줄 등이 문단을 가르면 짝이 밀린다(`` `a `` · `` - b` `` · `` `<img>` ``에서
 *   뷰어는 `<img>`를 태그로 세운다). 모든 스팬이 한 줄 안에서 닫히면 문단을 어느 줄에서 갈라도 짝이 같다 — 스팬은
 *   제 줄 안의 첫 같은 길이 연속으로 닫히고, 문단 전체에서 못 닫은 연속은 어느 조각에서도 못 닫기 때문이다.
 *   그래서 못 닫은 연속은 글자로 두고 믿음을 거두지 않는다.
 * - **링크의 주소가 여는 자리(`LINK_DESTINATION` — `](`·`]:`)** — 링크 목적지가 백틱을 먹어 짝이 밀린다
 *   (`` [a](`) <img> (`) ``). 참조 정의는 블록이라 스팬보다 먼저 선다(open-decisions.md 93).
 * - **`|`가 든 스팬** — 표 칸이 스팬을 가른다(GFM 표, markdown-it 기본값).
 * 들여쓴 코드 블록은 따로 가리지 않는다 — 거기서 스팬이 믿기면 `<`가 그대로(코드 블록이라 글자다), 안 믿기면
 * `&lt;`가 보인다. `portfolio.spec.ts`의 *"결정 89"* 묶음이 갈래마다 문다.
 */
function trustedCodeSpans(
  lines: readonly string[],
  paragraph: readonly number[],
): Map<number, [number, number][]> {
  if (paragraph.some((index) => LINK_DESTINATION.test(lines[index]!))) return new Map()
  const runs = backtickRuns(lines, paragraph)
  // **선형 시간이다** (R42 감사 C-1). 짝을 찾을 때마다 0부터 훑거나(`findIndex`) 한 줄의 스팬 목록을 통째로
  // 베끼면(`[...old, span]`) 백틱이 많은 문단에서 제곱 시간이 되고, [파일로 저장]이 그동안 멈춘다. 그래서
  // 길이마다 그 길이의 연속이 놓인 자리를 차례로 모아 두고, `i`가 앞으로만 가므로 길이마다 가리키는 칸도 앞으로만
  // 민다. 무는 검사: `portfolio.spec.ts`의 *"백틱이 많은 답도 마크다운이 곧 나온다"*.
  const byLength = new Map<number, { readonly at: number[]; next: number }>()
  runs.forEach((other, k) => {
    const size = other.end - other.start
    const slot = byLength.get(size)
    if (slot) slot.at.push(k)
    else byLength.set(size, { at: [k], next: 0 })
  })
  /** `i` 뒤의 첫 같은 길이 연속. 없으면 -1. */
  const nextOfLength = (length: number, after: number): number => {
    const slot = byLength.get(length)
    if (!slot) return -1
    while (slot.next < slot.at.length && slot.at[slot.next]! <= after) slot.next += 1
    return slot.next < slot.at.length ? slot.at[slot.next]! : -1
  }
  const spans = new Map<number, [number, number][]>()
  let i = 0
  while (i < runs.length) {
    const run = runs[i]!
    const open = run.escaped ? run.start + 1 : run.start
    const length = run.end - open
    if (length === 0) {
      i += 1
      continue
    }
    const j = nextOfLength(length, i)
    // 못 닫은 연속은 글자다. 문단 전체에서 짝이 없으면 문단의 어느 조각에서도 짝이 없으므로 짝을 안 민다.
    if (j === -1) {
      i += 1
      continue
    }
    const close = runs[j]!
    if (close.line !== run.line) return new Map()
    if (lines[run.line]!.slice(open, close.end).includes('|')) return new Map()
    const onLine = spans.get(run.line)
    if (onLine) onLine.push([open, close.end])
    else spans.set(run.line, [[open, close.end]])
    i = j + 1
  }
  return spans
}

/**
 * 울타리 모양(백틱·물결 셋 이상)이 **줄머리가 아닌 곳**에 있는 줄 — 앞에 공백·탭·`>`·목록 표지가 있다.
 *
 * 아래 줄 규칙은 0열에서 연 울타리만 정확히 센다. 목록·인용 안의 울타리는 그 컨테이너가 끝날 때
 * 뷰어가 **말없이 닫는데**, 줄 규칙은 그것을 몰라 답 끝에 더한 닫는 줄이 새 울타리를 연다
 * (open-decisions.md 82). 넓게 잡는다 — 잘못 걸리면 답이 코드 블록으로 보일 뿐 문항은 안 잃는다.
 */
const NESTED_FENCE = /^[ \t>*+\-.)0-9]+(?:`{3,}|~{3,})/

/**
 * 줄 규칙이 이 답의 울타리를 확신할 수 있는가. 못 하면 답을 통째 감싼다 (`wrapInFence`).
 *
 * **HTML 블록은 여기서 안 본다** — 코드 밖의 `<`가 글자가 되어(`escapeOutsideCode`) 답 안에서 HTML 블록이 안 열리고,
 * 뷰어는 그 줄 뒤의 ` ``` `를 울타리로 읽는다. 줄 규칙이 세는 것과 같다 (open-decisions.md 89).
 */
function fenceUncertain(lines: readonly string[]): boolean {
  return lines.some((line) => NESTED_FENCE.test(line))
}

/**
 * **답을 통째 코드 블록에 싣는다** (open-decisions.md 82, mlpx-spec.md §8.6).
 *
 * 울타리는 백틱이고 **답 안의 가장 긴 백틱 연속보다 하나 길다**(최소 셋). CommonMark에서 닫는 줄은
 * 여는 줄 이상 길어야 하고 물결은 백틱 울타리를 못 닫으므로, 답 안의 어느 줄도 이것을 닫지 못한다.
 * 코드 블록 안이라 글자는 하나도 이스케이프하지 않는다. `portfolio.spec.ts`의 *"결정 82"* 묶음이 문다.
 */
function wrapInFence(lines: readonly string[]): string {
  let longest = 0
  for (const line of lines) {
    for (const run of line.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  }
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return [fence, ...lines, fence].join('\n')
}

/** 울타리 밖의 한 줄. 문항 구조를 깨는 두 모양을 막는다 (위 두 정규식). `<`와 링크는 `escapeOutsideCode`가 따로 본다. */
function escapeLine(line: string): string {
  return line
    .replace(LINE_LEADING_HASH, '$1\\$2')
    .replace(SETEXT_UNDERLINE, (_match, indent: string, rule: string) => `${indent}\\${rule}`)
}

/** 울타리 안의 줄(`code`), 여는 울타리 줄(`opener`), 그 밖의 글(`text`). */
type LineKind = 'text' | 'opener' | 'code'

/** 문단마다 믿을 수 있는 코드 스팬. 문단은 `text` 중 빈 줄이 아닌 줄이 이어진 것이다. */
function codeSpansOf(
  lines: readonly string[],
  kinds: readonly LineKind[],
): Map<number, [number, number][]> {
  const all = new Map<number, [number, number][]>()
  let paragraph: number[] = []
  const flush = () => {
    for (const [index, spans] of trustedCodeSpans(lines, paragraph)) all.set(index, spans)
    paragraph = []
  }
  lines.forEach((line, index) => {
    if (kinds[index] === 'text' && !BLANK.test(line)) paragraph.push(index)
    else flush()
  })
  flush()
  return all
}

/**
 * 답을 `.md`에 담을 수 있게 만든다.
 *
 * **읽기 좋은 것이 기준이다** (mlpx-spec.md §8.6). 전부 이스케이프하면 안전하기는
 * 한데 읽으라고 만든 파일을 읽기 나쁘게 만든다 - 메모장으로 열면 `\#`이 보인다.
 * 막을 것은 **문항 구조를 깨는 것**과 **학생의 HTML이 태그로 서는 것뿐**이고, 답에 목록이나 강조가 들어가 그대로
 * 살아나는 것은 사고가 아니라 잘 된 것이다.
 *
 * **열어 놓고 안 닫은 코드 울타리는 여기서 닫는다.** 여는 줄 하나가 **뒤따르는 문항을 전부
 * 삼킨다** - 정보 수업 포트폴리오에서 코드를 붙여넣는 것은 흔한 일이고, 백틱 셋을 열고 안 닫는
 * 것도 흔하다. 닫는 자리가 답의 끝인 이유가 그것이다: 문항 경계가 거기서 되살아난다. **닫을 때
 * 답의 글자는 건드리지 않고 닫는 줄만 더한다** — 답이 겪는 것은 그와 무관한 위의 이스케이프와
 * 줄 끝 맞춤뿐이다. `portfolio.spec.ts`의 표가 답 바로 뒤에 닫는 말이 붙은 모양을 통째로
 * 견준다.
 *
 * **HTML은 태그로 안 서게 한다** — 코드 밖의 `<`를 `&lt;`로 싣는다(`escapeOutsideCode`, open-decisions.md 89).
 * 주소가 http·https가 아닌 링크도 거기서 글자로 싣는다(open-decisions.md 93). HTML 블록이 안 열리므로 이 규칙은 울타리 하나만 센다.
 *
 * **울타리 안에서는 이스케이프하지 않는다.** 거기서는 `#`이 제목을 못 만들고,
 * 학생이 쓴 파이썬 주석이 `\#`으로 보이면 그건 읽기 나쁘게 만든 것이다. `<`도 같다 —
 * 코드 블록 안의 `&lt;`는 그대로 보인다. 믿을 수 있는 코드 스팬(`trustedCodeSpans`) 안도 같다.
 *
 * **이 줄 규칙이 확신하지 못하는 답은 여기까지 오지 않는다** — 목록·인용 안의 울타리는
 * `wrapInFence`가 통째 감싼다 (open-decisions.md 82).
 */
function escapeAnswer(answer: string): string {
  const kinds: LineKind[] = []
  let fence: string | undefined
  /**
   * 여는 줄의 들여쓰기. **닫는 줄에 그대로 붙인다** — 목록 안에 들여쓴 울타리는
   * 0열의 줄로 안 닫히고, 그러면 더한 줄까지 코드 블록 안으로 들어가 문항이 계속
   * 사라진다 (2026-08-31 사각 감사 A-1).
   */
  let fenceIndent = ''

  // **줄 끝을 `\n` 하나로 맞춘다.** JS 정규식의 `.`은 `\r`에 안 맞아서 CRLF로 적힌 답의
  // 여는 울타리(` ```python\r `)를 못 알아보고 안 닫았다 — 뷰어는 CRLF를 줄 끝으로 읽는다.
  // `portfolio.spec.ts`의 표에서 *"CRLF로 적힌 울타리"*가 문다.
  const answerLines = answer.replace(/\r\n?/g, '\n').split('\n')
  if (fenceUncertain(answerLines)) return wrapInFence(answerLines)

  for (const line of answerLines) {
    if (fence !== undefined) {
      kinds.push('code')
      const closing = FENCE.exec(line)
      // 닫는 줄에는 언어 이름을 못 붙인다. 그래서 뒤가 비어 있어야 한다.
      const closes =
        closing !== null &&
        closing[2]!.startsWith(fence[0]!) &&
        closing[2]!.length >= fence.length &&
        BLANK.test(closing[3]!)
      if (closes) fence = undefined
      continue
    }

    const opening = FENCE.exec(line)
    // **백틱 울타리의 언어 자리에는 백틱이 못 온다** (CommonMark). 그 줄은 울타리가
    // 아니라 코드 스팬이 든 글이다 - 울타리로 읽으면 없던 것을 닫으려 든다.
    const opens = opening !== null && !(opening[2]!.startsWith('`') && opening[3]!.includes('`'))
    if (opens) {
      fence = opening![2]!
      fenceIndent = opening![1]!
    }
    kinds.push(opens ? 'opener' : 'text')
  }

  // 여는 울타리 줄은 문단이 아니다 — 언어 자리의 `<`도 스팬 없이 바꾼다.
  const spans = codeSpansOf(answerLines, kinds)
  const lines = answerLines.map((line, index) =>
    kinds[index] === 'code' ? line : escapeLine(escapeOutsideCode(line, spans.get(index) ?? [])),
  )
  if (fence !== undefined) lines.push(`${fenceIndent}${fence}`)
  return lines.join('\n')
}

/**
 * 머리글 값은 한 줄에 담긴다. 줄바꿈이 들어오면 목록이 깨진다.
 *
 * **줄 끝은 `\n`·`\r\n`·홑 `\r` 셋이다** — 뷰어는 홑 `\r`도 줄 끝으로 읽는다. `\n`만 접던 때 `\r`이 남아 `escapeInline`은
 * 한 줄로 믿고 뷰어는 두 줄로 읽어, 조작한 `.mlpx`의 제목에서 태그가 섰다(보안 검토 A-2).
 */
function oneLine(value: string): string {
  return value.replace(/[ \t]*(?:\r\n?|\n)[ \t]*/g, ' ').replace(/^[ \t]+|[ \t]+$/g, '')
}

/**
 * **한 줄짜리 사용자 글(문서 제목·문항 제목·머리글)도 답과 같은 규칙으로 싣는다** (open-decisions.md 89·93) — 코드
 * 스팬 밖의 `<`는 `&lt;`이고 http·https가 아닌 링크는 글자다. 판정은 답과 한 벌이다(`trustedCodeSpans`·`escapeOutsideCode`). **뷰어가 한 줄로 읽는 것을
 * 통째로 넘긴다** — 머리글의 라벨과 값을 따로 넘기면 한쪽의 남는 백틱이 다른 쪽과 짝지어 스팬이 밀린다.
 * `portfolio.spec.ts`의 *"결정 89"* 묶음의 *"답 밖의 사용자 글"*과 *"결정 93"* 묶음이 문다.
 */
function escapeInline(text: string): string {
  return escapeOutsideCode(text, trustedCodeSpans([text], [0]).get(0) ?? [])
}

/**
 * 포트폴리오를 사람이 읽는 마크다운으로 만든다. **`.mlpx` 안의 `portfolio/document.md`가
 * 이것이다.**
 *
 * 원본은 `portfolio/document.json`이고 이건 파생물인데, 그래도 파일에 담는 이유는 **우리 앱
 * 없이도 읽혀야 하기 때문이다** - 교사가 압축을 풀어 메모장으로 열어도 학생이 무엇을
 * 썼는지 보여야 한다 (CLAUDE.md §1.3).
 *
 * **머리에 프로젝트 정보를 적는다** (§8.6). 화면에서는 `ProjectSummary`가 그 일을
 * 하는데, 파일만 받은 사람은 그 화면을 못 본다.
 *
 * **안 쓴 문항도 제목은 남긴다.** 빈 칸이 보이는 것과 문항이 사라지는 것은 다르다 -
 * 받은 파일에 "느낀 점"이 없으면 안 쓴 것인지 문항이 없었던 것인지 알 수 없다.
 */
export function renderPortfolioMarkdown(text: PortfolioMarkdownText, portfolio: Portfolio): string {
  const lines = [`# ${escapeInline(oneLine(text.title))}`, '']
  for (const [label, value] of text.rows) {
    lines.push(`- ${escapeInline(`**${oneLine(label)}**: ${oneLine(value)}`)}`)
  }
  if (text.rows.length > 0) lines.push('')

  for (const section of portfolioSections(portfolio)) {
    lines.push(`## ${escapeInline(oneLine(section.title))}`, '')
    const answer = escapeAnswer(section.answer.trim())
    if (answer !== '') lines.push(answer, '')
    // **사진은 상대 경로로 적는다** (§8.6.1). `portfolio/document.md`에서 본 자리이고,
    // 압축을 푼 뒤에도 그대로 맞는다 - 안 적으면 파일만 받은 사람에게는 사진이 없다.
    // **앱이 지은 모양의 경로만 싣는다** — 조작한 파일의 경로는 링크 문법을 깨고 태그를 세운다(open-decisions.md 93).
    for (const path of attachmentsOf(portfolio, section.id).filter(isAppAttachmentPath)) {
      lines.push(`![](${path.slice(DIR.portfolio.length)})`, '')
    }
  }

  // 지금 양식에 없는 답도 파일에 남긴다. 화면이 "이전 문항의 답"으로 보여주는 것과
  // 같은 것이고, 여기서 빠뜨리면 파일만 받은 사람에게는 그 글이 없는 것이 된다.
  const orphans = orphanAnswers(portfolio)
  if (orphans.length > 0) {
    lines.push(`## ${escapeInline(oneLine(text.orphanTitle))}`, '')
    for (const orphan of orphans) {
      lines.push(escapeAnswer(orphan.answer.trim()), '')
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}
