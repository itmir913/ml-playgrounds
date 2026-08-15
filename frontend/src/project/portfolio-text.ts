/**
 * `portfolio.md`의 머리글을 만든다 (mlpx-spec.md §8.6).
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

export function portfolioMarkdownText(
  manifest: Manifest,
  translate: Translate,
  locale: string,
): PortfolioMarkdownText {
  const rows: [label: string, value: string][] = []

  /**
   * **인적사항이 맨 위다** (mlpx-spec.md §8.6). 이 파일은 제출물이고 받은 사람이 제일
   * 먼저 찾는 것이 학번과 이름이다.
   *
   * **적었을 때만 나온다.** 안 적은 사람의 자리에 빈 칸을 만들면 그것이 빠뜨린 것으로
   * 보인다.
   */
  const student = manifest.student
  if (student?.studentId !== undefined && student.studentId !== '') {
    rows.push([translate('identity.studentId'), student.studentId])
  }
  if (student?.name !== undefined && student.name !== '') {
    rows.push([translate('identity.studentName'), student.name])
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
  const identified = withIdentity(document, identity, now)
  return {
    document: identified,
    markdown: renderPortfolioMarkdown(
      portfolioMarkdownText(identified.manifest, translate, locale),
      identified.portfolio,
    ),
  }
}
