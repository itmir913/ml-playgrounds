/**
 * 픽스처 팩토리가 **매번 남남인 객체를 주는가.**
 *
 * 검사를 검사하는 파일이다. 여기가 없으면 `fixtures/project.ts`의 `fresh()`를 지워도
 * 아무 일도 안 일어난다 — 그 순간부터 오염은 **되살아나되 조용하다.**
 *
 * **왜 조용한가.** 공유 객체를 한 검사가 제자리에서 고치면 같은 파일의 뒤따르는 검사가
 * 그 값을 물려받는데, `vitest -t`로 하나만 돌리면 통과하고 전체를 돌릴 때만 빨개진다.
 * 원인이 자기 검사 안에 없어서 찾는 데 오래 걸린다 (2026-08-12에 실제로 밟았다 —
 * `format.spec.ts`의 `nSamples` 왕복 검사).
 *
 * 그래서 확인하는 것은 **값이 같은가가 아니라 정체가 다른가**다. 한 겹 아래까지 본다 —
 * 얕은 복사는 `settings.split`을 여전히 공유한다.
 */

import { describe, expect, it } from 'vitest'

import { dataSettings } from '../src/project/schema'

import {
  emptyProjectFile,
  experiment,
  manifest,
  projectFile,
  projectFileWithPredictDataset,
  projectFileWithTestDataset,
  run,
  settings,
} from './fixtures/project'

describe('projectFile()은 부를 때마다 남남이다', () => {
  it('두 번 부르면 settings가 다른 객체다', () => {
    const first = projectFile()
    const second = projectFile()
    expect(first.document.settings).not.toBe(second.document.settings)
    // 값은 같아야 한다. 정체만 달라진 것이지 내용이 달라진 것이 아니다.
    expect(first.document.settings).toEqual(second.document.settings)
  })

  it('한 겹 아래도 남남이다 - 얕은 복사로는 부족하다', () => {
    const first = projectFile()
    const second = projectFile()
    expect(first.document.settings.split).not.toBe(second.document.settings.split)
    expect(first.document.settings.data.preprocessing).not.toBe(
      second.document.settings.data.preprocessing,
    )
    expect(first.document.settings.data.features).not.toBe(second.document.settings.data.features)
    expect(first.document.manifest).not.toBe(second.document.manifest)
    expect(first.dataset).not.toBe(second.dataset)
  })

  it('하나를 고쳐도 다음에 부른 것이 멀쩡하다', () => {
    const poisoned = projectFile()
    poisoned.document.settings.split.testSize = 0.99
    dataSettings('tabular', poisoned.document.settings).features.push('없는 열')

    const clean = projectFile()
    expect(clean.document.settings.split.testSize).toBe(0.2)
    expect(clean.document.settings.data.features).toEqual(['꽃받침 길이', 'petal_length'])
  })

  it('내보낸 상수 자체도 안 다친다 - 검사가 기대값으로 쓰는 것이다', () => {
    const poisoned = projectFile()
    poisoned.document.settings.split.testSize = 0.99
    poisoned.document.manifest.name = '오염된 이름'

    expect(settings.split.testSize).toBe(0.2)
    expect(manifest.name).toBe('붓꽃 품종 분류')
  })
})

describe('나머지 팩토리도 같다', () => {
  it('emptyProjectFile()', () => {
    const poisoned = emptyProjectFile()
    poisoned.document.settings.split.testSize = 0.99
    expect(emptyProjectFile().document.settings.split.testSize).toBe(0.2)
    expect(settings.split.testSize).toBe(0.2)
  })

  /**
   * `hash`가 readonly라 제자리 대입으로는 못 민다. **바이트는 밀린다** — `bytes`는
   * readonly 속성이어도 그 안의 칸은 그대로 쓰인다. 왕복 검사가 비트 단위로 비교하는
   * 바로 그 배열이라, 여기가 공유되면 **무결성 검사가 자기가 오염시킨 값을 본다.**
   */
  it('평가 데이터를 붙인 것', () => {
    const poisoned = projectFileWithTestDataset()
    poisoned.testDataset!.bytes[0] = 0
    expect(projectFileWithTestDataset().testDataset?.bytes[0]).not.toBe(0)
  })

  it('예측 데이터를 붙인 것', () => {
    const poisoned = projectFileWithPredictDataset()
    poisoned.predictDataset!.bytes[0] = 0
    expect(projectFileWithPredictDataset().predictDataset?.bytes[0]).not.toBe(0)
  })

  it('학습 데이터도 같다 - 무결성 검사가 보는 바로 그 배열이다', () => {
    const poisoned = projectFile()
    poisoned.dataset!.bytes[0] = 0
    expect(projectFile().dataset?.bytes[0]).not.toBe(0)
  })

  /**
   * **실험 스냅샷이 가장 놓치기 쉽다.** `experiment()`는 함수라 껍데기는 매번 새것인데,
   * 그 안의 `settings.split`을 상수에서 그대로 물어 오면 한 겹 아래가 공유된다.
   */
  it('실험 스냅샷의 분할 설정', () => {
    const poisoned = experiment('experiment-1', [run('run-1')])
    poisoned.settings.split.testSize = 0.99
    dataSettings('tabular', poisoned.settings).features.push('없는 열')

    const clean = experiment('experiment-2', [run('run-2')])
    expect(clean.settings.split.testSize).toBe(0.2)
    expect(clean.settings.data.features).toEqual(['꽃받침 길이', 'petal_length'])
    expect(settings.split.testSize).toBe(0.2)
  })
})
