/**
 * `portfolio/document.md`의 머리글을 만든다 (mlpx-spec.md §8.6).
 *
 * **화면에서는 `ProjectSummary`가 하는 일이다.** 파일만 받은 사람은 그 화면을 못 보므로
 * 언제 만든 것이고 무슨 데이터로 무엇을 했는지가 첫 줄에 있어야 한다.
 *
 * **여기가 `t()`를 아는 마지막 자리다.** 포맷 계층(`project/format.ts`)은 번역을 모르고
 * (§8.6), 렌더링(`project/portfolio.ts`)도 모른다 - 만들어진 문자열을 받을 뿐이다.
 * 그래서 화면 없이 가짜 번역으로 검사할 수 있다.
 *
 * **`ProjectSummary`와 같은 줄을 만들지 않는다.** 저기는 데이터 종류마다 다른 판을
 * 쓰고(행 수·범주·백본) 여기는 manifest만 본다 - 두 벌이 되지 않게 겹치는 줄을 늘리지
 * 마라. 늘려야 한다면 한쪽을 고치는 것이 아니라 둘의 출처를 하나로 만들어라.
 */

import { formatDateTime } from '@/composables/useFormat'

import { withIdentity } from './identity'
import type { Identity } from './identity'
import { renderPortfolioMarkdown } from './portfolio'
import type { PortfolioMarkdownText } from './portfolio'
import type { Manifest, ProjectDocument } from './schema'

/** 로케일 키를 문장으로 바꾸는 것. 화면은 `t`를, 검사는 가짜를 넘긴다. */
export type Translate = (key: string) => string

/** 교사가 점검에서 고친 학번·이름(`roster.ts`의 `StudentEdit`와 같은 모양). 빈 값은 없는 것이다. */
export interface CorrectedStudent {
  readonly studentId?: string
  readonly studentName?: string
}

/**
 * 머리글의 글감을 만든다. **`corrected`는 교사의 묶음만 넘긴다** (open-decisions.md 114) — 넘기면 머리글의 학번·이름이
 * 고친 값이 되고, 파일에 적힌 값이 그와 다르면 그 값을 한 줄 더 적는다(`identity.*InFile`). 학생이 비워 낸 칸은
 * `meta.none`이다. 같으면 아무 줄도 더하지 않는다 — 고치지 않은 서른 명에 같은 값이 두 번 서면 군더더기다.
 * 무는 검사: `portfolio-bundle.spec.ts`의 *"머리글은 고친 학번·이름이고"*.
 */
export function portfolioMarkdownText(
  manifest: Manifest,
  translate: Translate,
  locale: string,
  corrected?: CorrectedStudent,
): PortfolioMarkdownText {
  const rows: [label: string, value: string][] = []

  /**
   * **인적사항이 맨 위다** (mlpx-spec.md §8.6). 이 파일은 제출물이고 받은 사람이 제일
   * 먼저 찾는 것이 학번과 이름이다.
   *
   * **적었을 때만 나온다.** 안 적은 사람의 자리에 빈 칸을 만들면 그것이 빠뜨린 것으로
   * 보인다.
   */
  const inFile = {
    studentId: filled(manifest.student?.studentId),
    studentName: filled(manifest.student?.name),
  }
  const shown = corrected
    ? { studentId: filled(corrected.studentId), studentName: filled(corrected.studentName) }
    : inFile
  if (shown.studentId !== '') rows.push([translate('identity.studentId'), shown.studentId])
  if (shown.studentName !== '') rows.push([translate('identity.studentName'), shown.studentName])
  if (shown.studentId !== inFile.studentId) {
    rows.push([translate('identity.studentIdInFile'), inFile.studentId || translate('meta.none')])
  }
  if (shown.studentName !== inFile.studentName) {
    rows.push([
      translate('identity.studentNameInFile'),
      inFile.studentName || translate('meta.none'),
    ])
  }

  rows.push(
    [translate('meta.created'), formatDateTime(locale, manifest.createdAt)],
    [translate('meta.updated'), formatDateTime(locale, manifest.updatedAt)],
    [translate('meta.dataType'), translate(`dataTypes.${manifest.dataType}`)],
    [
      translate('meta.taskType'),
      // 아직 안 골랐으면 없는 것이 맞다. 기본값을 적으면 고른 것처럼 읽힌다.
      manifest.taskType === undefined
        ? translate('meta.none')
        : translate(`taskTypes.${manifest.taskType}`),
    ],
  )

  return { title: manifest.name, rows, orphanTitle: translate('portfolio.orphanTitle') }
}

/** 앞뒤 공백을 떼고, 없는 값은 빈 글자다. 견주기가 `undefined`와 `''`를 가르지 않게 한다. */
function filled(value: string | undefined): string {
  return value?.trim() ?? ''
}

/** 내보낼 문서와, 그 문서에서 나온 마크다운. **둘은 언제나 같은 세대다.** */
export interface IdentifiedExport {
  readonly document: ProjectDocument
  readonly markdown: string
}

/**
 * 인적사항을 문서에 넣고, **그렇게 만들어진 문서로** `document.md`를 그린다.
 *
 * **둘을 한 함수가 만드는 것이 이 함수의 존재 이유다.** 화면에서 따로 부르면 마크다운이
 * 갱신 전 manifest를 보게 되고, 그러면 zip 안에서 `manifest.json`과 `document.md`가
 * 서로 다른 말을 한다 - 학번과 이름을 처음 적고 내보내는 그 한 번에 정확히 그랬다.
 * 겉(파일 이름)은 맞고 속만 비어서 아무도 못 알아챈다.
 */
export function identifiedExport(
  document: ProjectDocument,
  identity: Identity,
  now: string,
  translate: Translate,
  locale: string,
): IdentifiedExport {
  /**
   * **`manifest.locale`은 머리글이 그려진 언어다** (mlpx-spec.md §2). 여기서 함께
   * 찍는 이유는 머리글을 그리는 언어를 아는 자리가 여기뿐이기 때문이다 — 따로
   * 두면 갱신을 빠뜨리고, **실제로 빠뜨려서 `locale: "en"`인데 머리글이 한국어인
   * 파일이 나왔다.**
   */
  const withIdentityApplied = withIdentity(document, identity, now)
  const identified: ProjectDocument = {
    ...withIdentityApplied,
    manifest: { ...withIdentityApplied.manifest, locale },
  }
  return {
    document: identified,
    markdown: renderPortfolioMarkdown(
      portfolioMarkdownText(identified.manifest, translate, locale),
      identified.portfolio,
    ),
  }
}
