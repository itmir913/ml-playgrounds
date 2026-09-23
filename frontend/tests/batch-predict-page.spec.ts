// @vitest-environment jsdom
/**
 * 일괄 예측의 **판이 입력을 따라오는가.**
 *
 * 답은 쪽 단위로 캐시하고, 그 캐시를 버리는 열쇠가 서명이다. **판 크기가 그 서명에
 * 들어 있다** — 상한을 풀면 판 크기가 곧 행 수가 되어 같은 쪽 번호가 다른 행을 가리키기
 * 때문이다. 한 번 샌 적이 있고(`55226b7`, 상한을 풀면 표가 비었다) 그때 서명에 판
 * 크기가 들어갔는데, **호출부는 무검사였다** (2026-09-02 R20 B-2): 서명에 넘기는
 * `pageSize.value`를 `1`로 박아도 전체 2,749개가 초록이었다.
 *
 * 그래서 여기서는 **화면에 실제로 답이 든 줄이 몇인지**를 본다 — 줄 수만 세면 안 잡힌다.
 * 늘어난 줄은 그려지고, 어긋나는 것은 **그 줄의 답**이기 때문이다(판 크기를 `1`로 박으면
 * 103줄 중 100줄만 답을 든다). 서명 계산 자체는 `predict.spec.ts`가 따로 문다.
 */

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hashBytes } from '../src/hash'
import { i18n, setLocale } from '../src/i18n'
import { PREDICT_PAGE_SIZE } from '../src/limits'
import { applyLimitsOff } from '../src/limits-switch'
import type { PredictableModel } from '../src/ml/predict'
import type { Preprocessor } from '../src/ml/preprocess'
import { dataSettings } from '../src/project/schema'
import { useProjectStore } from '../src/stores/project'
import BatchPredict from '../src/views/predict/BatchPredict.vue'
import { experiment, projectFile, run } from './fixtures/project'

// 계산은 이 검사의 주제가 아니다. 답 칸에 run id를 적어 두면 어느 모델의 답인지 보인다.
vi.mock('../src/ml/predict', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/ml/predict')>()
  return {
    ...original,
    predictPage: (models: readonly PredictableModel[], rows: readonly unknown[]) =>
      rows.map(() => models.map((model) => ({ value: model.run.id }))),
  }
})

const A: PredictableModel = {
  experiment: experiment('experiment-1', []),
  run: run('run-A', { algorithm: 'decision_tree' }),
}

const preprocessors = new Map<string, Preprocessor>([
  ['experiment-1', { columns: [] } as unknown as Preprocessor],
])

/** 예측용 표가 붙은 프로젝트. 행 수를 검사가 정한다. */
function projectWithRows(count: number) {
  const lines = ['꽃받침', ...Array.from({ length: count }, (_, index) => String(index + 1))]
  const bytes = new TextEncoder().encode(`﻿${lines.join('\r\n')}\r\n`)
  const base = projectFile()
  return {
    ...base,
    document: {
      ...base.document,
      settings: {
        ...base.document.settings,
        data: {
          ...dataSettings('tabular', base.document.settings),
          predictDataset: {
            path: 'dataset/predict.csv',
            originalFileName: 'p.csv',
            hasHeader: true,
            encoding: 'utf-8' as const,
          },
        },
      },
    },
    predictDataset: { bytes, hash: hashBytes(bytes) },
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** 답이 실제로 든 줄 수. 가짜 계산이 칸에 run id를 적어 두므로 그것을 센다. */
function answeredRows(wrapper: ReturnType<typeof mount>): number {
  return wrapper.findAll('tbody tr').filter((row) => row.text().includes('run-A')).length
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await setLocale('ko')
})

afterEach(() => {
  applyLimitsOff(false)
})

describe('상한을 푸는 순간', () => {
  it('늘어난 줄까지 답이 따라온다 - 앞 쪽 몫만 남지 않는다', async () => {
    const project = useProjectStore()
    const rows = PREDICT_PAGE_SIZE + 3
    project.update(projectWithRows(rows))

    const wrapper = mount(BatchPredict, {
      props: {
        models: [A],
        preprocessors,
        dataset: null,
        fields: [],
        experimentNames: new Map(),
      },
      global: { plugins: [i18n] },
    })
    await tick()
    await flushPromises()
    // 상한이 있는 동안에는 한 쪽만 뜨고, 그 쪽의 모든 줄에 답이 있다.
    expect(wrapper.findAll('tbody tr')).toHaveLength(PREDICT_PAGE_SIZE)
    expect(answeredRows(wrapper)).toBe(PREDICT_PAGE_SIZE)

    applyLimitsOff(true)
    await tick()
    await flushPromises()
    await tick()
    await flushPromises()

    expect(wrapper.findAll('tbody tr')).toHaveLength(rows)
    // **서명이 판 크기를 안 보면 여기가 어긋난다** — 캐시가 안 버려져 앞 쪽 몫의 답만
    // 남고, 늘어난 줄은 답이 없는 채로 선다.
    expect(answeredRows(wrapper)).toBe(rows)
  })
})

/**
 * **보이는 모델만 바꾸면 보던 쪽에 남는다** (`open-decisions.md` 55 표의 8, R38-D55 C-8). 행은
 * 그대로라 같은 쪽의 답을 다시 셀 뿐인데, 전에는 첫 쪽으로 돌아가 학생이 보던 행을 다시 찾아가야
 * 했다. 행이 바뀌면(파일) 같은 번호가 다른 행이라 첫 쪽이다.
 */
describe('보이는 모델을 바꿀 때의 쪽', () => {
  const B: PredictableModel = {
    experiment: experiment('experiment-1', []),
    run: run('run-B', { algorithm: 'knn' }),
  }

  it('모델만 바뀌면 그 쪽에 남고, 파일이 바뀌면 첫 쪽이다', async () => {
    const project = useProjectStore()
    project.update(projectWithRows(PREDICT_PAGE_SIZE * 2 + 3))
    const wrapper = mount(BatchPredict, {
      props: { models: [A], preprocessors, dataset: null, fields: [], experimentNames: new Map() },
      global: { plugins: [i18n] },
    })
    await tick()
    await flushPromises()
    const pageText = () => wrapper.find('p.tabular-nums').text()
    const next = wrapper
      .findAll('button')
      .find((one) => one.text() === i18n.global.t('common.nextPage'))
    expect(next, 'next page').toBeDefined()
    await next!.trigger('click')
    await tick()
    await flushPromises()
    expect(pageText()).toBe('2 / 3')

    await wrapper.setProps({ models: [A, B] })
    await tick()
    await flushPromises()
    expect(pageText()).toBe('2 / 3')
    // 다시 센 답이 그 쪽에 선다 — 새 모델의 답까지.
    expect(wrapper.findAll('tbody tr')[0]?.text()).toContain('run-B')

    project.update(projectWithRows(PREDICT_PAGE_SIZE * 2 + 4))
    await tick()
    await flushPromises()
    expect(pageText()).toBe('1 / 3')
  })
})
