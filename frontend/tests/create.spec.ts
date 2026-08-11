/**
 * 새 프로젝트 만들기와 화면이 쓰는 순수 함수들.
 *
 * 가장 중요한 것은 **갓 만든 프로젝트가 스키마를 통과하는가**다. 여기가 깨지면
 * 학생이 프로젝트를 만드는 순간 저장이 실패하고, 그건 앱의 첫 동작이다.
 */

import { describe, expect, it } from 'vitest'

import {
  formatBytes,
  formatDateTime,
  formatPercent,
  formatPrediction,
} from '../src/composables/useFormat'
import { NOT_FOR_TABULAR_ALGORITHM } from './fixtures/algorithms'
import { ALGORITHMS, supportedTaskTypes } from '../src/ml/algorithms'
import { FALLBACK_RUNTIME_ID, RUNTIMES } from '../src/ml/backend'
import { newProjectDocument, newProjectSeed, touch } from '../src/project/create'
import { portfolioSections, renderPortfolioMarkdown } from '../src/project/portfolio'
import {
  DEFAULT_PORTFOLIO_SECTIONS,
  DEFAULT_PORTFOLIO_TEMPLATE_ID,
  parseProjectDocument,
  TASK_TYPES,
} from '../src/project/schema'

const seed = {
  projectId: '550e8400-e29b-41d4-a716-446655440000',
  createdAt: '2026-08-05T09:00:00Z',
  randomState: 4242,
}

const input = { name: '붓꽃 품종 분류', locale: 'ko' } as const

describe('새 프로젝트', () => {
  it('스키마를 통과한다', () => {
    expect(() => parseProjectDocument(newProjectDocument(input, seed))).not.toThrow()
  })

  it('기계학습 유형이 없는 상태로 시작한다', () => {
    // **기본값을 두면 학생이 고른 분류와 아무도 안 고른 분류가 파일에서 구분되지 않는다**
    // (open-decisions.md "기계학습 유형은 모델을 고르는 자리에서 고른다").
    expect(newProjectDocument(input, seed).manifest.taskType).toBeUndefined()
    // 그래도 스키마는 통과한다 - 선택 항목이다.
    expect(() => parseProjectDocument(newProjectDocument(input, seed))).not.toThrow()
  })

  it('유형을 넘기면 그대로 담는다 - 남의 파일에서 시작하는 경로가 쓴다', () => {
    const withType = newProjectDocument({ ...input, taskType: 'regression' }, seed)
    expect(withType.manifest.taskType).toBe('regression')
  })

  it('표가 없는 상태로 시작한다', () => {
    const document = newProjectDocument(input, seed)
    expect(document.settings.dataset).toBeUndefined()
    // 열 이름을 알아야 정할 수 있는 것들도 비어 있다.
    expect(document.settings.features).toEqual([])
    expect(document.settings.target).toBeUndefined()
    expect(document.settings.selectedAlgorithms).toEqual([])
    expect(document.runs.experiments).toEqual([])
  })

  it('같은 씨앗이면 같은 문서가 나온다', () => {
    expect(newProjectDocument(input, seed)).toEqual(newProjectDocument(input, seed))
  })

  it('randomState를 파일에 박는다 - 재현 가능성이 이 도구의 생명이다', () => {
    expect(newProjectDocument(input, seed).settings.split.randomState).toBe(seed.randomState)
  })

  it('만든 시각과 고친 시각이 같은 값으로 시작한다', () => {
    const { manifest } = newProjectDocument(input, seed)
    expect(manifest.createdAt).toBe(seed.createdAt)
    expect(manifest.updatedAt).toBe(seed.createdAt)
  })

  it('기본 실행 방법은 등록부에 있고 브라우저에서 돈다', () => {
    // 서버가 없는 것이 기본 상태다 (CLAUDE.md §1.1).
    const runtime = RUNTIMES.find((spec) => spec.id === FALLBACK_RUNTIME_ID)
    expect(runtime?.location).toBe('browser')
    expect(newProjectDocument(input, seed).settings.runtime).toBe(FALLBACK_RUNTIME_ID)
  })

  it('스케일링은 꺼진 채로, 범주형 인코딩은 켜진 채로 시작한다', () => {
    // 학생이 스케일링을 켰을 때 숫자가 달라지는 것을 보는 것이 수업 장면이다.
    // 인코딩은 반대다 - 꺼져 있으면 문자 열이 든 표로 아무것도 못 한다.
    const { preprocessing } = newProjectDocument(input, seed).settings
    expect(preprocessing.scaling).toBe('none')
    expect(preprocessing.categoricalEncoding).toBe('onehot')
  })

  it('씨앗은 매번 다른 id를 준다', () => {
    expect(newProjectSeed().projectId).not.toBe(newProjectSeed().projectId)
  })

  it('touch는 고친 시각만 바꾼다', () => {
    const before = newProjectDocument(input, seed)
    const after = touch(before, '2026-08-06T01:00:00Z')
    expect(after.manifest.updatedAt).toBe('2026-08-06T01:00:00Z')
    expect(after.manifest.createdAt).toBe(before.manifest.createdAt)
    expect(after.settings).toBe(before.settings)
  })
})

describe('고를 수 있는 과제 유형', () => {
  it('알고리즘이 하나도 없는 유형은 빠진다', () => {
    // 고르게 하면 학생이 아무것도 못 하는 프로젝트를 만든다.
    for (const taskType of supportedTaskTypes()) {
      expect(
        ALGORITHMS.some((one) => one.taskTypes[taskType]),
        taskType,
      ).toBe(true)
    }
  })

  it('알고리즘을 등록하면 저절로 따라온다', () => {
    const only = ALGORITHMS.filter((one) => one.taskTypes.regression)
    expect(supportedTaskTypes(undefined, only)).toEqual(['regression'])
  })

  /**
   * **유형과 데이터 종류는 독립이 아니다.** 이미지에 회귀는 성립하지 않는데, 그건 우리가
   * 정한 것이 아니라 그 조합에 등록된 알고리즘이 없다는 사실이다. 안 걸러 주면 학생이
   * 회귀를 고른 뒤에야 모델이 전부 꺼진 목록을 만난다.
   */
  it('데이터 종류에 맞는 유형만 남는다', () => {
    expect(supportedTaskTypes('tabular')).toEqual(['classification', 'regression', 'clustering'])
    // **표본은 가짜다.** 어휘에는 지금 되는 종류만 있으므로(open-decisions.md "어휘에는
    // 지금 되는 것만 넣는다") 안 맞는 종류를 넘겨서 확인할 수 없다. 표에서 안 서는
    // 알고리즘만 있는 세상에서는 고를 유형이 하나도 없어야 한다.
    expect(supportedTaskTypes('tabular', [NOT_FOR_TABULAR_ALGORITHM])).toEqual([])
  })

  it('데이터를 안 올렸으면 좁히지 않는다 - 무엇을 올릴지 모른다', () => {
    expect(supportedTaskTypes(undefined)).toEqual(supportedTaskTypes())
  })

  it('순서는 TASK_TYPES를 따른다 - 화면마다 순서가 다르면 안 된다', () => {
    const supported = supportedTaskTypes()
    expect(supported).toEqual(TASK_TYPES.filter((one) => supported.includes(one)))
  })
})

describe('화면 표시 포맷', () => {
  it('로케일을 바꾸면 결과가 따라간다', () => {
    // 'ko-KR'을 코드에 박으면 그 자리는 영원히 한국어다 (docs/i18n.md 규칙 6).
    expect(formatDateTime('ko', '2026-08-05T09:00:00Z')).not.toBe(
      formatDateTime('en', '2026-08-05T09:00:00Z'),
    )
  })

  it('바이트는 단위를 올려가며 보여준다', () => {
    expect(formatBytes('en', 512)).toContain('512')
    expect(formatBytes('en', 1024 * 1024)).toContain('1')
    // 바이트 단위에서는 소수점이 의미가 없다.
    expect(formatBytes('en', 900)).not.toContain('.')
  })

  it('깨진 시각은 있는 그대로 보여준다 - Invalid Date를 화면에 올리지 않는다', () => {
    // 남의 파일에서 온 값이 깨져 있을 수 있다.
    expect(formatDateTime('ko', '언제였더라')).toBe('언제였더라')
  })

  it('비율은 백분율로 바뀐다', () => {
    expect(formatPercent('en', 0.9333)).toContain('93')
  })

  it('예측한 수치에서 부동소수의 잡음을 걷어낸다', () => {
    // String(0.1 + 0.2)는 0.30000000000000004이다. 학생이 보는 것은 모델의 답인데
    // 거기에 우리 계산기의 사정이 새어 나온다.
    expect(formatPrediction('en', 0.1 + 0.2)).toBe('0.3')
    expect(formatPrediction('en', 3.4000000000000004)).toBe('3.4')
  })

  it('예측값은 자릿수를 고정하지 않는다 - 학생의 데이터 단위이기 때문이다', () => {
    // 지표와 다른 점이다. 집값이면 수백만이고 농도면 0.0001이라 소수 셋으로 자르면
    // 한쪽은 뒤가 잘리고 다른 쪽은 0만 남는다.
    expect(formatPrediction('en', 1250000)).toBe('1,250,000')
    expect(formatPrediction('en', 0.000125)).toBe('0.000125')
    expect(formatPrediction('en', 7)).toBe('7')
  })

  it('언어에 맡긴다 - 자릿수 구분을 직접 조립하지 않는다', () => {
    expect(formatPrediction('de', 1250000)).not.toBe(formatPrediction('en', 1250000))
  })
})

describe('포트폴리오 마크다운', () => {
  const label = (key: string) => `[${key.split('.').pop() ?? ''}]`

  it('안 쓴 문항도 제목은 남긴다', () => {
    // 교사가 받은 파일에서 문항이 통째로 없으면 학생이 안 쓴 것인지 문항이 없었던
    // 것인지 알 수 없다.
    const markdown = renderPortfolioMarkdown(
      '붓꽃 품종 분류',
      { template: { id: DEFAULT_PORTFOLIO_TEMPLATE_ID }, answers: {} },
      label,
    )
    for (const section of DEFAULT_PORTFOLIO_SECTIONS) {
      expect(markdown, section).toContain(`## [${section}]`)
    }
  })

  it('프로젝트 이름이 제목이 된다', () => {
    const markdown = renderPortfolioMarkdown(
      '붓꽃 품종 분류',
      { template: { id: DEFAULT_PORTFOLIO_TEMPLATE_ID }, answers: {} },
      label,
    )
    expect(markdown.startsWith('# 붓꽃 품종 분류\n')).toBe(true)
  })

  it('학생이 쓴 글을 손대지 않는다', () => {
    // 마크다운을 이스케이프하지 않는다. 목록과 굵은 글씨를 쓸 수 있어야 한다.
    const markdown = renderPortfolioMarkdown(
      '제목',
      {
        template: { id: DEFAULT_PORTFOLIO_TEMPLATE_ID },
        answers: { motivation: '- 꽃이 **좋아서**' },
      },
      label,
    )
    expect(markdown).toContain('- 꽃이 **좋아서**')
  })

  it('교사가 쓴 문항이 있으면 그 문구를 그대로 쓴다', () => {
    // 애초에 번역 대상이 아니므로 로케일을 거치지 않는다 (mlpx-spec.md §8).
    const sections = portfolioSections(
      {
        template: { id: 'teacher-1', sections: [{ id: 'q1', title: '이번 시간에 무엇을 했나요' }] },
        answers: { q1: '데이터를 모았습니다' },
      },
      label,
    )
    expect(sections).toEqual([
      { id: 'q1', title: '이번 시간에 무엇을 했나요', answer: '데이터를 모았습니다' },
    ])
  })
})
