/**
 * 열 이름 짓기와 열 요약, 그리고 확정한 표를 프로젝트에 붙이는 일.
 *
 * 여기서 가장 중요한 것 둘.
 *
 * 1. **이름이 서로 달라야 한다.** 아래 계층이 `columns.indexOf(name)`으로 열을 찾으므로
 *    같은 이름이 둘이면 두 번째 열은 영영 닿지 않고, 학생이 그 열을 골라도 말없이
 *    첫 번째 열로 학습한다.
 * 2. **데이터를 바꾸면 실험이 전부 사라져야 한다** (mlpx-spec.md §4.3). 남으면 참조형
 *    모델이 다른 줄을 보고 예측한다.
 */

import { describe, expect, it } from 'vitest'

import { dataSettings } from '../src/project/schema'

import {
  acceptPredictDataset,
  alignTestDataset,
  columnNames,
  spreadsheetName,
  summarizeColumns,
  toDataset,
} from '../src/data/columns'
import { isClientError } from '../src/errors'
import { hashBytes } from '../src/hash'
import {
  applyDataset,
  applyPredictDataset,
  applyTestDataset,
  readPredictDataset,
  readTestDataset,
  removePredictDataset,
  removeTestDataset,
} from '../src/project/dataset'
import {
  PREDICT_DATASET_PATH,
  TABULAR_DATASET_PATH,
  TEST_DATASET_PATH,
  type ProjectFile,
} from '../src/project/format'
import {
  experiment,
  emptyProjectFile,
  projectFile,
  projectFileWithTestDataset,
  run,
} from './fixtures/project'

const grid = [
  ['이름', '점수', '반'],
  ['가', '90', 'A'],
  ['나', '', 'B'],
  ['다', '70', 'A'],
]

function imported(overrides: Partial<Parameters<typeof applyDataset>[1]> = {}) {
  const bytes = new TextEncoder().encode('이름,점수,반\n가,90,A\n')
  return {
    bytes,
    hash: hashBytes(bytes),
    grid,
    source: 'csv' as const,
    sourceEncoding: 'cp949' as const,
    ...overrides,
  }
}

describe('엑셀식 열 이름', () => {
  it('A부터 시작해 Z를 넘으면 두 글자가 된다', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(spreadsheetName)).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
    ])
  })
})

describe('열 이름', () => {
  it('머리글이 있으면 그대로 쓴다', () => {
    expect(columnNames(grid, true)).toEqual(['이름', '점수', '반'])
  })

  it('머리글이 없으면 A, B, C로 부른다', () => {
    // 숫자나 번역된 이름을 쓰지 않는 이유는 이 값이 .mlpx에 그대로 저장되기 때문이다.
    expect(columnNames(grid, false)).toEqual(['(A)', '(B)', '(C)'])
  })

  it('같은 머리글이 두 번 있으면 어느 열인지 붙여 준다', () => {
    // 엑셀이 내보낸 CSV에 실제로 있는 일이다. 그냥 두면 두 번째 열에 영영 닿지 못한다.
    expect(columnNames([['점수', '반', '점수']], true)).toEqual(['점수', '반', '점수 (C)'])
  })

  it('빈 머리글도 이름을 받는다', () => {
    expect(columnNames([['이름', '', '반']], true)).toEqual(['이름', '(B)', '반'])
  })

  it('이름이 언제나 서로 다르다', () => {
    const names = columnNames([['a', 'a', 'a', '', '']], true)
    expect(new Set(names).size).toBe(names.length)
  })

  it('줄마다 칸 수가 달라도 가장 넓은 줄을 따른다', () => {
    expect(columnNames([['a'], ['1', '2', '3']], true)).toEqual(['a', '(B)', '(C)'])
  })
})

describe('학습 계층이 쓰는 모양', () => {
  it('머리글은 행에서 빠진다 - 행 번호가 곧 trainIndices의 번호다', () => {
    expect(toDataset(grid, true).rows).toHaveLength(3)
    expect(toDataset(grid, false).rows).toHaveLength(4)
  })
})

describe('열 요약', () => {
  const summary = summarizeColumns(toDataset(grid, true))

  it('숫자로만 된 열은 수치로 본다', () => {
    expect(summary.map((column) => column.kind)).toEqual(['categorical', 'numeric', 'categorical'])
  })

  it('빈 칸을 센다', () => {
    expect(summary[1]?.missing).toBe(1)
  })

  it('값 종류를 센다 - 결측은 빼고', () => {
    // 분류의 대상 열을 고를 때 이게 판단 재료다.
    expect(summary[1]?.unique).toBe(2)
    expect(summary[2]?.unique).toBe(2)
  })

  it('표본은 중복 없이 앞에서부터', () => {
    expect(summary[2]?.samples).toEqual(['A', 'B'])
  })

  it('값이 하나도 없는 열은 범주로 떨어진다', () => {
    // 수치라고 우기면 스케일링이 NaN을 만든다.
    expect(summarizeColumns({ columns: ['x'], rows: [[''], ['']] })[0]?.kind).toBe('categorical')
  })
})

describe('평가 데이터 받기', () => {
  // 정본(data.csv). 열 순서는 이름, 점수, 반이고 타깃은 반이라 하자.
  const canonical = ['이름', '점수', '반']

  it('정본과 열 순서가 달라도 이름으로 다시 세운다', () => {
    const shuffled = [
      ['반', '이름', '점수'],
      ['A', '가', '90'],
      ['B', '나', '80'],
    ]
    const aligned = alignTestDataset(shuffled, true, canonical)
    expect(aligned.columns).toEqual(canonical)
    expect(aligned.rows).toEqual([
      ['가', '90', 'A'],
      ['나', '80', 'B'],
    ])
  })

  it('정본에 없는 열은 조용히 버린다', () => {
    const extra = [
      ['이름', '점수', '반', '메모'],
      ['가', '90', 'A', '결석'],
    ]
    const aligned = alignTestDataset(extra, true, canonical)
    expect(aligned.columns).toEqual(canonical)
    expect(aligned.rows).toEqual([['가', '90', 'A']])
  })

  it('타깃 열을 포함해 정본 열 하나라도 없으면 거부한다', () => {
    // data.csv는 언제나 타깃 열을 포함하므로 canonical에 이미 '반'이 들어 있다 -
    // 여기서 그 열이 없는 파일을 올리면 학습에 쓴 특성과 무관하게 걸린다.
    const noTarget = [
      ['이름', '점수'],
      ['가', '90'],
    ]
    try {
      alignTestDataset(noTarget, true, canonical)
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) {
        expect(error.code).toBe('TEST_DATASET_COLUMN_MISSING')
        expect(error.params.columns).toEqual(['반'])
      }
    }
  })

  it('없는 열을 전부 말해 준다', () => {
    const missingTwo = [['이름'], ['가']]
    try {
      alignTestDataset(missingTwo, true, canonical)
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) expect(error.params.columns).toEqual(['점수', '반'])
    }
  })
})

describe('예측 데이터 받기', () => {
  // 특성 열의 합집합이다 - 정본 열 전체가 아니다. 타깃('반')은 요구하지 않는다.
  const required = ['이름', '점수']

  it('타깃이 없어도, 열 순서가 달라도 통과한다 - 순서는 올린 그대로다', () => {
    const shuffled = [
      ['점수', '이름'],
      ['90', '가'],
    ]
    const accepted = acceptPredictDataset(shuffled, true, required)
    expect(accepted.columns).toEqual(['점수', '이름'])
    expect(accepted.rows).toEqual([['90', '가']])
  })

  it('요구하지 않는 열도 버리지 않는다 - 특성이 바뀌면 그 열이 필요해진다', () => {
    const extra = [
      ['이름', '점수', '반'],
      ['가', '90', 'A'],
    ]
    const accepted = acceptPredictDataset(extra, true, required)
    expect(accepted.columns).toEqual(['이름', '점수', '반'])
    expect(accepted.rows).toEqual([['가', '90', 'A']])
  })

  it('요구한 열이 없으면 거부하고 무엇이 없는지 말한다 - TEST_DATASET_COLUMN_MISSING과 다른 코드다', () => {
    const missing = [['이름'], ['가']]
    try {
      acceptPredictDataset(missing, true, required)
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) {
        expect(error.code).toBe('PREDICT_DATASET_COLUMN_MISSING')
        expect(error.params.columns).toEqual(['점수'])
      }
    }
  })
})

describe('프로젝트에 붙이기', () => {
  const now = '2026-08-06T01:00:00Z'
  const options = { fileName: '성적.csv', hasHeader: true, now }

  it('실험을 전부 지운다 - 남으면 참조형 모델이 다른 줄을 본다', () => {
    const before = projectFile()
    const applied = applyDataset(before, imported(), options)

    expect(applied.droppedExperiments).toBe(1)
    expect(applied.project.document.runs.experiments).toEqual([])
    expect(applied.project.models.size).toBe(0)
  })

  it('원래 프로젝트를 건드리지 않는다 - 확정 전에는 되돌릴 것이 없어야 한다', () => {
    const before = projectFile()
    applyDataset(before, imported(), options)
    expect(before.document.runs.experiments).toHaveLength(1)
  })

  it('정본 경로와 인코딩 기록을 남긴다', () => {
    const { dataset } = applyDataset(projectFile(), imported(), options).project.document.settings
      .data

    expect(dataset?.path).toBe(TABULAR_DATASET_PATH)
    expect(dataset?.originalFileName).toBe('성적.csv')
    expect(dataset?.encoding).toBe('utf-8')
    // 올라온 파일이 무엇이었는지는 화면 표시용으로 따로 남는다.
    expect(dataset?.sourceEncoding).toBe('cp949')
  })

  it('엑셀에는 원본 인코딩이 없다', () => {
    const excel = imported({ source: 'xlsx', sourceEncoding: null })
    const { dataset } = applyDataset(projectFile(), excel, options).project.document.settings.data
    expect(dataset?.sourceEncoding).toBeUndefined()
  })

  it('살아남은 열 선택은 유지한다', () => {
    // 오타 하나 고치려고 CSV를 다시 올린 학생이 고르기를 처음부터 다시 하면 안 된다.
    const before = projectFile()
    before.document = {
      ...before.document,
      settings: {
        ...before.document.settings,
        data: { ...before.document.settings.data, features: ['이름', '점수'], target: '반' },
      },
    }

    const applied = applyDataset(before, imported(), options)
    expect(applied.project.document.settings.data.features).toEqual(['이름', '점수'])
    expect(applied.project.document.settings.data.target).toBe('반')
    expect(applied.droppedColumns).toEqual([])
  })

  it('새 표에 없는 열은 빼고 무엇이 빠졌는지 알려준다', () => {
    // 조용히 사라지면 학생은 자기가 고른 열이 빠진 줄 모르고, 학습이 시작된 뒤에야 안다.
    const before = projectFile()
    before.document = {
      ...before.document,
      settings: {
        ...before.document.settings,
        data: { ...before.document.settings.data, features: ['점수', '키'], target: '몸무게' },
      },
    }

    const applied = applyDataset(before, imported(), options)
    expect(applied.project.document.settings.data.features).toEqual(['점수'])
    expect(applied.project.document.settings.data.target).toBeUndefined()
    expect(applied.droppedColumns).toEqual(['키', '몸무게'])
  })

  it('머리글이 없으면 A, B, C 기준으로 걸러진다', () => {
    const before = projectFile()
    before.document = {
      ...before.document,
      settings: {
        ...before.document.settings,
        data: { ...before.document.settings.data, features: ['(A)', '이름'], target: undefined },
      },
    }

    const applied = applyDataset(before, imported(), { ...options, hasHeader: false })
    expect(applied.project.document.settings.data.features).toEqual(['(A)'])
  })

  it('고친 시각을 새로 찍는다', () => {
    const applied = applyDataset(projectFile(), imported(), options)
    expect(applied.project.document.manifest.updatedAt).toBe(now)
  })

  it('실험이 없던 프로젝트는 지울 것도 없다', () => {
    const before = projectFile()
    before.document = { ...before.document, runs: { experiments: [] } }
    expect(applyDataset(before, imported(), options).droppedExperiments).toBe(0)
  })

  it('실험이 여럿이면 여럿을 지운다', () => {
    const before = projectFile()
    before.document = {
      ...before.document,
      runs: {
        experiments: [
          experiment('experiment-1', [run('run-1')]),
          experiment('experiment-2', [run('run-2')]),
        ],
      },
    }
    expect(applyDataset(before, imported(), options).droppedExperiments).toBe(2)
  })

  /**
   * **학습 데이터를 바꾸면 평가·예측 데이터도 함께 떨어진다.**
   *
   * 참조만 남고 본체가 없으면 `writeProject`가 거부해 **그 프로젝트를 저장도 내보내기도
   * 못 하게 된다** (mlpx-spec.md §1 "함께 있고 함께 없다"). 그리고 정본 열이 통째로
   * 바뀐 마당에 옛 `test.csv`는 어차피 대조를 다시 통과해야 하는 파일이다.
   */
  it('평가 데이터도 함께 뗀다 - 참조만 남으면 저장이 막힌다', () => {
    const before = projectFileWithTestDataset()
    const applied = applyDataset(before, imported(), options)

    expect(applied.project.document.settings.data.testDataset).toBeUndefined()
    expect(applied.project.testDataset).toBeUndefined()
    // 평가 데이터가 없어졌으므로 분할 방식도 되돌아간다 - provided인 채로 두면
    // 학습이 평가할 것을 못 찾는다.
    expect(applied.project.document.settings.split.method).toBe('holdout')
  })

  it('예측 데이터도 함께 뗀다 - 같은 이유다', () => {
    const before = projectFile()
    before.document = {
      ...before.document,
      settings: {
        ...before.document.settings,
        data: {
          ...dataSettings('tabular', before.document.settings),
          predictDataset: {
            path: PREDICT_DATASET_PATH,
            originalFileName: 'predict.csv',
            hasHeader: true,
            encoding: 'utf-8',
          },
        },
      },
    }
    before.predictDataset = { bytes: new TextEncoder().encode('a\n1\n'), hash: 'x'.repeat(64) }

    const applied = applyDataset(before, imported(), options)
    expect(applied.project.document.settings.data.predictDataset).toBeUndefined()
    expect(applied.project.predictDataset).toBeUndefined()
  })
})

describe('평가 데이터를 프로젝트에 붙이기', () => {
  const now = '2026-08-06T02:00:00Z'
  const options = { fileName: 'test.csv', hasHeader: true, now }

  /** 정본(data.csv)이 있고 타깃이 정해진 프로젝트. */
  function withCanonicalDataset(): ProjectFile {
    const bytes = new TextEncoder().encode('이름,점수,반\n가,90,A\n나,80,B\n')
    const base = emptyProjectFile()
    return {
      ...base,
      document: {
        ...base.document,
        settings: {
          ...base.document.settings,
          data: {
            ...dataSettings('tabular', base.document.settings),
            dataset: {
              path: TABULAR_DATASET_PATH,
              originalFileName: 'grades.csv',
              hasHeader: true,
              encoding: 'utf-8',
            },
            target: '반',
            features: ['점수'],
          },
        },
      },
      dataset: { bytes, hash: hashBytes(bytes) },
    }
  }

  function testTable(overrides: Partial<Parameters<typeof applyTestDataset>[1]> = {}) {
    const grid = [
      ['반', '이름', '점수'],
      ['A', '다', '70'],
    ]
    const bytes = new TextEncoder().encode('반,이름,점수\nA,다,70\n')
    return {
      bytes,
      hash: hashBytes(bytes),
      grid,
      source: 'csv' as const,
      sourceEncoding: 'utf-8' as const,
      ...overrides,
    }
  }

  it('split.method를 provided로 바꾸고 정본 순서로 다시 세워 담는다', () => {
    const applied = applyTestDataset(withCanonicalDataset(), testTable(), options)
    const { settings } = applied.project.document

    expect(settings.split.method).toBe('provided')
    expect(settings.data.testDataset?.path).toBe(TEST_DATASET_PATH)
    expect(settings.data.testDataset?.originalFileName).toBe('test.csv')

    const read = readTestDataset(applied.project)
    expect(read?.columns).toEqual(['이름', '점수', '반'])
    expect(read?.rows).toEqual([['다', '70', 'A']])
  })

  it('정본 열이 없으면 대조 실패를 그대로 던진다', () => {
    const broken = testTable({
      grid: [
        ['반', '이름'],
        ['A', '다'],
      ],
    })
    try {
      applyTestDataset(withCanonicalDataset(), broken, options)
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) expect(error.code).toBe('TEST_DATASET_COLUMN_MISSING')
    }
  })

  it('붙이면 지금까지의 실험을 전부 지운다', () => {
    const before = withCanonicalDataset()
    before.document = {
      ...before.document,
      runs: { experiments: [experiment('experiment-1', [run('run-1')])] },
    }
    const applied = applyTestDataset(before, testTable(), options)
    expect(applied.droppedExperiments).toBe(1)
    expect(applied.project.document.runs.experiments).toEqual([])
    expect(applied.project.models.size).toBe(0)
  })

  it('고친 시각을 새로 찍는다', () => {
    const applied = applyTestDataset(withCanonicalDataset(), testTable(), options)
    expect(applied.project.document.manifest.updatedAt).toBe(now)
  })

  it('뗀다 - split.method가 holdout으로 되돌아간다', () => {
    const attached = applyTestDataset(withCanonicalDataset(), testTable(), options).project
    const removed = removeTestDataset(attached, now)

    expect(removed.project.document.settings.split.method).toBe('holdout')
    expect(removed.project.document.settings.data.testDataset).toBeUndefined()
    expect(removed.project.testDataset).toBeUndefined()
    expect(readTestDataset(removed.project)).toBeNull()
  })

  it('떼도 지금까지의 실험을 전부 지운다', () => {
    const attached = applyTestDataset(withCanonicalDataset(), testTable(), options).project
    const withExperiments = {
      ...attached,
      document: {
        ...attached.document,
        runs: { experiments: [experiment('experiment-1', [run('run-1')])] },
      },
    }
    const removed = removeTestDataset(withExperiments, now)
    expect(removed.droppedExperiments).toBe(1)
    expect(removed.project.document.runs.experiments).toEqual([])
  })

  /**
   * **예측 데이터는 점수와 무관하므로 평가 데이터를 붙이거나 떼도 그대로 있어야 한다.**
   * 여기서 떨어뜨리면 참조만 남아 저장이 막힌다 (mlpx-spec.md §1).
   */
  it('붙이고 떼는 동안 예측 데이터는 그대로 있다', () => {
    const base = withCanonicalDataset()
    const withPredict: ProjectFile = {
      ...base,
      document: {
        ...base.document,
        settings: {
          ...base.document.settings,
          data: {
            ...dataSettings('tabular', base.document.settings),
            predictDataset: {
              path: PREDICT_DATASET_PATH,
              originalFileName: 'predict.csv',
              hasHeader: true,
              encoding: 'utf-8',
            },
          },
        },
      },
      predictDataset: { bytes: new TextEncoder().encode('a\n1\n'), hash: 'y'.repeat(64) },
    }

    const attached = applyTestDataset(withPredict, testTable(), options).project
    expect(attached.document.settings.data.predictDataset).toBeDefined()
    expect(attached.predictDataset).toBeDefined()

    const removed = removeTestDataset(attached, now).project
    expect(removed.document.settings.data.predictDataset).toBeDefined()
    expect(removed.predictDataset).toBeDefined()
  })

  it('이미 없으면 뗄 것도 없다 - 조용히 아무 일도 안 한다', () => {
    const before = withCanonicalDataset()
    const removed = removeTestDataset(before, now)
    expect(removed.droppedExperiments).toBe(0)
    expect(removed.project).toBe(before)
  })
})

describe('예측 데이터를 프로젝트에 붙이기', () => {
  const now = '2026-08-06T03:00:00Z'
  const options = { fileName: 'predict.csv', hasHeader: true, now, requiredColumns: ['점수'] }

  function predictTable(overrides: Partial<Parameters<typeof applyPredictDataset>[1]> = {}) {
    const grid = [
      ['이름', '점수'],
      ['라', '85'],
    ]
    const bytes = new TextEncoder().encode('이름,점수\n라,85\n')
    return {
      bytes,
      hash: hashBytes(bytes),
      grid,
      source: 'csv' as const,
      sourceEncoding: 'utf-8' as const,
      ...overrides,
    }
  }

  it('올린 열을 전부 담고, 실험은 그대로 둔다', () => {
    const before = projectFile()
    const applied = applyPredictDataset(before, predictTable(), options)
    const { settings } = applied.project.document

    expect(settings.data.predictDataset?.path).toBe(PREDICT_DATASET_PATH)
    expect(settings.data.predictDataset?.originalFileName).toBe('predict.csv')
    // applyTestDataset과 결정적으로 다른 점 - 실험이 안 지워진다.
    expect(applied.project.document.runs.experiments).toEqual(before.document.runs.experiments)
    expect(applied.project.models).toBe(before.models)

    // 요구한 것은 '점수' 하나뿐이지만 '이름'도 남는다 - 학생이 특성에 '이름'을 넣어
    // 재학습하는 순간 그 열이 필요해지고, 그때 이미 버렸으면 파일이 조용히 무효가 된다.
    const read = readPredictDataset(applied.project)
    expect(read?.columns).toEqual(['이름', '점수'])
    expect(read?.rows).toEqual([['라', '85']])
  })

  it('머리글이 없는 파일도 이름을 받아 담는다 - 여기서부터 predict.csv에는 머리글이 있다', () => {
    const headerless = predictTable({ grid: [['라', '85']] })
    const applied = applyPredictDataset(projectFile(), headerless, {
      ...options,
      hasHeader: false,
      // 머리글이 없으면 열 이름이 엑셀식이므로 요구 열도 그 이름으로 온다.
      requiredColumns: ['(B)'],
    })

    const read = readPredictDataset(applied.project)
    expect(read?.columns).toEqual(['(A)', '(B)'])
    expect(read?.rows).toEqual([['라', '85']])
  })

  it('split.method를 건드리지 않는다', () => {
    const before = projectFile()
    const applied = applyPredictDataset(before, predictTable(), options)
    expect(applied.project.document.settings.split.method).toBe(
      before.document.settings.split.method,
    )
  })

  it('요구한 열이 없으면 대조 실패를 그대로 던진다', () => {
    const broken = predictTable({ grid: [['이름'], ['라']] })
    try {
      applyPredictDataset(projectFile(), broken, options)
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) expect(error.code).toBe('PREDICT_DATASET_COLUMN_MISSING')
    }
  })

  it('고친 시각을 새로 찍는다', () => {
    const applied = applyPredictDataset(projectFile(), predictTable(), options)
    expect(applied.project.document.manifest.updatedAt).toBe(now)
  })

  it('뗀다 - 예측 데이터 참조와 본체가 함께 사라진다', () => {
    const attached = applyPredictDataset(projectFile(), predictTable(), options).project
    const removed = removePredictDataset(attached, now)

    expect(removed.project.document.settings.data.predictDataset).toBeUndefined()
    expect(removed.project.predictDataset).toBeUndefined()
    expect(readPredictDataset(removed.project)).toBeNull()
  })

  it('떼도 실험은 그대로다', () => {
    const attached = applyPredictDataset(projectFile(), predictTable(), options).project
    const removed = removePredictDataset(attached, now)
    expect(removed.project.document.runs.experiments).toEqual(attached.document.runs.experiments)
  })

  it('이미 없으면 뗄 것도 없다', () => {
    const before = projectFile()
    const removed = removePredictDataset(before, now)
    expect(removed.project).toBe(before)
  })
})
