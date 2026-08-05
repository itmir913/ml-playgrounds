/**
 * `settings.json`을 고치는 순수 함수들.
 *
 * **여기가 막는 것은 조용히 틀린 학습이다.** "타깃으로 고른 열은 특성에서 빠진다"가
 * 안 지켜지면 정답이 문제에 함께 들어가 정확도가 1.0으로 나오고, 학생은 아주 좋은
 * 모델을 만들었다고 믿는다. 화면으로는 눈에 안 띈다 — 체크박스 하나가 켜져 있을 뿐이다.
 *
 * 결과가 스키마를 통과하는지도 함께 본다. 이 층의 산출물이 곧 `.mlpx`다.
 */

import { describe, expect, it } from 'vitest'

import { newProjectDocument } from '../src/project/create'
import { projectDocumentSchema, type ProjectDocument } from '../src/project/schema'
import {
  withAlgorithms,
  withFeatures,
  withHyperparameter,
  withPreprocessing,
  withRuntime,
  withSplit,
  withTarget,
  withTaskType,
} from '../src/project/settings'

const NOW = '2026-08-06T01:00:00.000Z'

function base(): ProjectDocument {
  return newProjectDocument(
    { name: '붓꽃', locale: 'ko' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-08-05T00:00:00.000Z',
      randomState: 42,
    },
  )
}

/** 특성 몇 개와 모델 몇 개를 고른 상태. 대부분의 검사가 여기서 시작한다. */
function chosen(): ProjectDocument {
  const document = withFeatures(base(), ['꽃받침길이', '꽃잎길이', '품종'], NOW)
  return withAlgorithms(document, ['decision_tree', 'linear_regression'], NOW)
}

describe('고친 시각을 남긴다', () => {
  it('설정을 고치면 updatedAt이 따라 움직인다', () => {
    // 목록 화면이 이 값으로 정렬한다. 안 찍히면 방금 만진 프로젝트가 아래에 남는다.
    expect(withFeatures(base(), ['키'], NOW).manifest.updatedAt).toBe(NOW)
    expect(withTaskType(base(), 'regression', [], NOW).manifest.updatedAt).toBe(NOW)
  })
})

describe('타깃과 특성은 겹치지 않는다', () => {
  it('타깃으로 고른 열은 특성에서 빠진다', () => {
    const next = withTarget(chosen(), '품종', NOW)
    expect(next.settings.target).toBe('품종')
    expect(next.settings.features).toEqual(['꽃받침길이', '꽃잎길이'])
  })

  it('특성 목록에 타깃을 넣어도 안 들어간다', () => {
    const next = withFeatures(withTarget(base(), '품종', NOW), ['꽃잎길이', '품종'], NOW)
    expect(next.settings.features).toEqual(['꽃잎길이'])
  })

  it('타깃을 지우면 고르지 않은 상태로 돌아간다', () => {
    const next = withTarget(withTarget(base(), '품종', NOW), undefined, NOW)
    expect(next.settings.target).toBeUndefined()
  })
})

describe('기계학습 유형', () => {
  it('manifest에 적힌다 - settings가 아니다', () => {
    expect(withTaskType(base(), 'regression', [], NOW).manifest.taskType).toBe('regression')
  })

  it('넘겨받은 모델만 지운다', () => {
    const next = withTaskType(chosen(), 'regression', ['decision_tree'], NOW)
    expect(next.settings.selectedAlgorithms).toEqual([{ algorithm: 'linear_regression' }])
  })

  it('아무것도 안 넘기면 선택은 그대로다', () => {
    const before = chosen()
    const next = withTaskType(before, 'regression', [], NOW)
    expect(next.settings.selectedAlgorithms).toEqual(before.settings.selectedAlgorithms)
  })
})

describe('모델 목록', () => {
  it('새로 체크한 것은 실험 기본을 따르는 줄로 붙는다', () => {
    const next = withAlgorithms(base(), ['knn'], NOW)
    expect(next.settings.selectedAlgorithms).toEqual([{ algorithm: 'knn' }])
  })

  it('있던 줄의 실행 방법 덮어쓰기를 잃지 않는다', () => {
    // 같은 알고리즘이 실행 방법만 다르게 두 번 들어갈 수 있다 (mlpx-spec.md §3).
    const document = base()
    document.settings.selectedAlgorithms = [
      { algorithm: 'svm', runtime: 'server-sklearn' },
      { algorithm: 'svm' },
    ]
    const next = withAlgorithms(document, ['svm', 'knn'], NOW)
    expect(next.settings.selectedAlgorithms).toEqual([
      { algorithm: 'svm', runtime: 'server-sklearn' },
      { algorithm: 'svm' },
      { algorithm: 'knn' },
    ])
  })

  it('체크를 풀면 그 줄이 전부 빠진다', () => {
    const next = withAlgorithms(chosen(), ['decision_tree'], NOW)
    expect(next.settings.selectedAlgorithms).toEqual([{ algorithm: 'decision_tree' }])
  })
})

describe('하이퍼파라미터', () => {
  it('알고리즘과 실행 방법으로 키를 잡는다', () => {
    const next = withHyperparameter(
      base(),
      { algorithm: 'decision_tree', runtime: 'mljs', name: 'maxDepth' },
      5,
      NOW,
    )
    expect(next.settings.hyperparameters).toEqual({ decision_tree: { mljs: { maxDepth: 5 } } })
  })

  it('실행 방법이 다르면 값이 섞이지 않는다', () => {
    const one = withHyperparameter(
      base(),
      { algorithm: 'decision_tree', runtime: 'mljs', name: 'maxDepth' },
      5,
      NOW,
    )
    const two = withHyperparameter(
      one,
      { algorithm: 'decision_tree', runtime: 'server-sklearn', name: 'max_depth' },
      7,
      NOW,
    )
    expect(two.settings.hyperparameters).toEqual({
      decision_tree: { mljs: { maxDepth: 5 }, 'server-sklearn': { max_depth: 7 } },
    })
  })

  it('undefined면 지우고 빈 껍데기도 걷는다', () => {
    const one = withHyperparameter(base(), { algorithm: 'knn', runtime: 'mljs', name: 'k' }, 9, NOW)
    const two = withHyperparameter(
      one,
      { algorithm: 'knn', runtime: 'mljs', name: 'k' },
      undefined,
      NOW,
    )
    expect(two.settings.hyperparameters).toEqual({})
  })

  it('앞의 값을 건드리지 않는다', () => {
    const before = withHyperparameter(
      base(),
      { algorithm: 'knn', runtime: 'mljs', name: 'k' },
      9,
      NOW,
    )
    withHyperparameter(before, { algorithm: 'knn', runtime: 'mljs', name: 'k' }, 3, NOW)
    expect(before.settings.hyperparameters).toEqual({ knn: { mljs: { k: 9 } } })
  })
})

describe('전처리와 분할', () => {
  it('건드린 값만 바뀐다', () => {
    const next = withPreprocessing(base(), { scaling: 'standard' }, NOW)
    expect(next.settings.preprocessing).toEqual({
      missing: 'drop',
      scaling: 'standard',
      categoricalEncoding: 'onehot',
    })
  })

  it('난수 씨앗은 분할을 고쳐도 그대로다', () => {
    // 학생이 바꾸면 실험 사이의 비교가 성립하지 않는다 (project/create.ts).
    const next = withSplit(base(), { testSize: 0.4, stratify: false }, NOW)
    expect(next.settings.split).toEqual({
      method: 'holdout',
      testSize: 0.4,
      stratify: false,
      randomState: 42,
    })
  })

  it('실행 방법을 바꿔도 모델별 덮어쓰기는 그대로다', () => {
    const document = base()
    document.settings.selectedAlgorithms = [{ algorithm: 'svm', runtime: 'server-sklearn' }]
    const next = withRuntime(document, 'pyodide-sklearn', NOW)
    expect(next.settings.runtime).toBe('pyodide-sklearn')
    expect(next.settings.selectedAlgorithms).toEqual([
      { algorithm: 'svm', runtime: 'server-sklearn' },
    ])
  })
})

describe('결과가 스키마를 통과한다', () => {
  it('이 층의 산출물이 곧 .mlpx다', () => {
    let document = withTaskType(base(), 'regression', [], NOW)
    document = withTarget(document, '점수', NOW)
    document = withFeatures(document, ['키', '몸무게'], NOW)
    document = withPreprocessing(document, { missing: 'mean', scaling: 'robust' }, NOW)
    document = withSplit(document, { testSize: 0.35 }, NOW)
    document = withRuntime(document, 'mljs', NOW)
    document = withAlgorithms(document, ['linear_regression'], NOW)
    document = withHyperparameter(
      document,
      { algorithm: 'linear_regression', runtime: 'mljs', name: '뭔가' },
      1,
      NOW,
    )

    expect(() => projectDocumentSchema.parse(document)).not.toThrow()
  })
})
