/**
 * 하이퍼파라미터 서술과 그 판정.
 *
 * 여기가 지키는 것 셋.
 *
 * 1. **확정은 멱등이다.** `fit`이 안에서 한 번 더 부르므로 두 번 걸어도 같아야 한다.
 *    안 그러면 값이 누적되고 그 원인은 `fit` 안에서 안 보인다.
 * 2. **눈금 밖은 시끄럽게 실패한다.** 조용히 당겨 넣지 않는다.
 * 3. **화면과 학습이 같은 표를 본다.** 서술이 두 벌이면 화면은 멀쩡한데 학습이 거부한다.
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { ALGORITHMS } from '../src/ml/algorithms'
import { RUNTIMES } from '../src/ml/backend'
import { ENGINES } from '../src/ml/engines'
import { parameters as mljsParameters, resolve as mljsResolve } from '../src/ml/engines/mljs'
import {
  parameters as pyodideParameters,
  resolve as pyodideResolve,
} from '../src/ml/engines/pyodide-sklearn'
import {
  assertInRange,
  defaultsOf,
  outOfRange,
  parametersFor,
  resolveWith,
  type HyperparameterSpec,
} from '../src/ml/hyperparams'

const TREES: HyperparameterSpec = {
  name: 'nEstimators',
  integer: true,
  min: 1,
  max: 500,
  step: 1,
  default: 100,
}

const RATE: HyperparameterSpec = {
  name: 'learningRate',
  integer: false,
  min: 0.0001,
  max: 1,
  step: 0.0001,
  default: 0.005,
}

describe('값을 확정한다', () => {
  it('안 준 자리는 기본값으로 채운다', () => {
    expect(resolveWith([TREES, RATE], {})).toEqual({ nEstimators: 100, learningRate: 0.005 })
  })

  it('학생이 준 값이 이긴다', () => {
    expect(resolveWith([TREES], { nEstimators: 30 })).toEqual({ nEstimators: 30 })
  })

  it('못 쓰는 값은 기본값으로 돌아간다', () => {
    // 파일에 적힌 값과 엔진이 쓴 값이 갈리면 안 되므로 확정이 곧 기록이다.
    expect(resolveWith([TREES], { nEstimators: 'many' })).toEqual({ nEstimators: 100 })
    expect(resolveWith([TREES], { nEstimators: Number.NaN })).toEqual({ nEstimators: 100 })
  })

  it('정수 자리의 소수는 반올림한다 - 나무 2.5그루는 값이 아니다', () => {
    expect(resolveWith([TREES], { nEstimators: 2.5 })).toEqual({ nEstimators: 3 })
    expect(resolveWith([TREES], { nEstimators: 2.4 })).toEqual({ nEstimators: 2 })
  })

  it('정수가 아닌 자리는 그대로 둔다', () => {
    expect(resolveWith([RATE], { learningRate: 0.03 })).toEqual({ learningRate: 0.03 })
  })

  it('모르는 키는 손대지 않는다 - 무엇을 시도했는지가 사실이다', () => {
    expect(resolveWith([TREES], { criterion: 'entropy' })).toEqual({
      nEstimators: 100,
      criterion: 'entropy',
    })
  })

  it('멱등이다', () => {
    const specs = [TREES, RATE]
    for (const given of [{}, { nEstimators: 2.5 }, { nEstimators: 9999 }, { nope: 1 }]) {
      const once = resolveWith(specs, given)
      expect(resolveWith(specs, once)).toEqual(once)
    }
  })

  it('눈금 밖 값을 당겨 넣지 않는다 - 그건 시끄럽게 실패할 일이다', () => {
    expect(resolveWith([TREES], { nEstimators: 0 })).toEqual({ nEstimators: 0 })
    expect(resolveWith([TREES], { nEstimators: 9999 })).toEqual({ nEstimators: 9999 })
  })

  it('기본값 표는 서술에서 나온다', () => {
    expect(defaultsOf([TREES, RATE])).toEqual({ nEstimators: 100, learningRate: 0.005 })
  })
})

describe('눈금 밖을 가려낸다', () => {
  it('양쪽 끝을 포함한다', () => {
    expect(outOfRange([TREES], { nEstimators: 1 })).toEqual([])
    expect(outOfRange([TREES], { nEstimators: 500 })).toEqual([])
  })

  it('밖이면 무엇이 왜 걸렸는지를 준다', () => {
    expect(outOfRange([TREES], { nEstimators: 0 })).toEqual([
      { name: 'nEstimators', min: 1, max: 500, actual: 0 },
    ])
  })

  it('서술에 없는 키는 판정하지 않는다 - 우리가 범위를 모르는 값이다', () => {
    expect(outOfRange([TREES], { criterion: 'entropy', nEstimators: 5 })).toEqual([])
  })

  it('숫자가 아닌 값은 판정하지 않는다 - 확정이 이미 기본값으로 바꿨다', () => {
    expect(outOfRange([TREES], { nEstimators: 'many' })).toEqual([])
  })

  it('던질 때는 우리 코드로 던진다', () => {
    expect(() => assertInRange([TREES], { nEstimators: 5 })).not.toThrow()

    try {
      assertInRange([TREES], { nEstimators: 0 })
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (!isClientError(error)) return
      expect(error.code).toBe('HYPERPARAM_OUT_OF_RANGE')
      // 이름은 엔진이 받는 키 그대로다. 우리 어휘가 아니라 값이다.
      expect(error.params).toEqual({ name: 'nEstimators', min: 1, max: 500, actual: 0 })
    }
  })
})

describe('등록부', () => {
  it('실행 방법을 거쳐도 엔진과 같은 표를 본다', () => {
    // 화면은 parametersFor로, 학습은 엔진의 parameters로 읽는다. 둘이 갈리면
    // 화면은 멀쩡한데 학습이 거부하는 상태가 생긴다.
    for (const engine of ENGINES) {
      for (const algorithm of ALGORITHMS) {
        expect(
          parametersFor(engine.runtimeId, algorithm.id),
          `${engine.runtimeId}/${algorithm.id}`,
        ).toEqual(engine.parameters(algorithm.id))
      }
    }
  })

  it('모르는 실행 방법과 모르는 알고리즘은 빈 배열이다', () => {
    expect(parametersFor('server-sklearn', 'decision_tree')).toEqual([])
    expect(parametersFor('mljs', '없는알고리즘')).toEqual([])
  })

  it('서술마다 기본값이 자기 눈금 안에 있다', () => {
    // 기본값이 눈금 밖이면 학생이 아무것도 안 건드려도 학습이 실패한다.
    for (const runtime of RUNTIMES) {
      for (const algorithm of ALGORITHMS) {
        const specs = parametersFor(runtime.id, algorithm.id)
        expect(outOfRange(specs, defaultsOf(specs)), `${runtime.id}/${algorithm.id}`).toEqual([])
      }
    }
  })

  it('엔진의 확정이 서술을 그대로 쓴다', () => {
    // resolve가 자기 폴백 표를 따로 들고 있으면 두 숫자가 갈라진다.
    for (const algorithm of ALGORITHMS) {
      const mljsSpecs = mljsParameters(algorithm.id)
      expect(mljsResolve(algorithm.id, {}), `mljs/${algorithm.id}`).toEqual(defaultsOf(mljsSpecs))

      const pyodideSpecs = pyodideParameters(algorithm.id)
      expect(pyodideResolve(algorithm.id, {}), `pyodide-sklearn/${algorithm.id}`).toEqual(
        defaultsOf(pyodideSpecs),
      )
    }
  })

  it('엔진의 확정이 멱등이다', () => {
    // fit이 안에서 한 번 더 부르므로 두 번 걸어도 같아야 한다.
    for (const engine of ENGINES) {
      for (const algorithm of ALGORITHMS) {
        const specs = engine.parameters(algorithm.id)
        if (specs.length === 0) continue
        const once = engine.resolve(algorithm.id, {})
        expect(engine.resolve(algorithm.id, once), `${engine.runtimeId}/${algorithm.id}`).toEqual(
          once,
        )
      }
    }
  })
})
