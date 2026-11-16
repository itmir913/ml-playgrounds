/**
 * **프로젝트 흐름도가 그릴 때 묻는 것들** (`ml/flow-view.ts`, `architecture.md` §8.22).
 *
 * 종류마다 다른 낱말의 키가 세 로케일에 있는가, 강조 앞에서 무엇이 켜지고 흐려지는가, 조각의 이름과 대상의
 * 이름이 어긋나지 않는가. 컴포넌트 검사(`flow-diagram.spec.ts`)는 이 판단의 결과가 화면에 서는지를 본다.
 */

import { describe, expect, it } from 'vitest'

import { flowModelOf } from '../src/ml/flow'
import { highlightOf } from '../src/ml/flow-highlight'
import { layoutOf } from '../src/ml/flow-layout'
import {
  FLOW_TEXT,
  lineEmphasis,
  nodeEmphasis,
  pieceEmphasis,
  pieceNameKey,
  pieceTargetKey,
  splitPercents,
  targetOf,
  trunkEmphasis,
} from '../src/ml/flow-view'
import { factsOf } from '../src/project/facts'
import { DATA_TYPES } from '../src/project/schema'
import { LOCALE_MESSAGES, LOCALE_TAGS } from './fixtures/locales'
import { modelOf, withTask } from './fixtures/flow-cases'
import { projectFileWithTestDataset, projectFile } from './fixtures/project'

describe('종류마다 다른 낱말', () => {
  it('모든 종류가 칸을 채운다', () => {
    expect(Object.keys(FLOW_TEXT).sort()).toEqual([...DATA_TYPES].sort())
  })

  it('키가 세 로케일에 모두 있다', () => {
    const keys = Object.values(FLOW_TEXT).flatMap((text) => Object.values(text))
    expect(keys.length).toBeGreaterThan(0)
    for (const tag of LOCALE_TAGS) {
      const messages = LOCALE_MESSAGES.get(tag)
      expect(
        keys.filter((key) => !messages?.has(key)),
        tag,
      ).toEqual([])
    }
  })

  it('데이터가 없을 때의 이유는 종류마다 다르다 — 사진 프로젝트에 데이터를 불러오라 하지 않는다', () => {
    expect(FLOW_TEXT.tabular.noDataKey).not.toBe(FLOW_TEXT.image.noDataKey)
  })
})

describe('조각의 이름과 대상', () => {
  const file = projectFileWithTestDataset()
  const model = modelOf(withTask(file, 'classification'))!
  const layout = layoutOf(model, {
    bars: { train: 8, test: 2, gray: 2, testFile: { usable: 3, gray: 1 } },
    testSize: 0.2,
    chipWrap: false,
  })

  it('회색 조각은 자기가 대상이고 파란 조각은 자기 노드가 대상이다', () => {
    const targets = layout.pieces.map((piece) => [piece.segment, pieceTargetKey(piece)])
    expect(targets).toContainEqual(['file:gray', 'file:gray'])
    expect(targets).toContainEqual(['file:bar', 'file'])
    expect(targets).toContainEqual([null, 'train'])
  })

  it('대상의 이름에서 강조의 대상을 되돌린다', () => {
    expect(targetOf('file:gray')).toEqual({ gray: 'file:gray' })
    expect(targetOf('test:gray')).toEqual({ gray: 'test:gray' })
    expect(targetOf('p1')).toEqual({ node: 'p1' })
  })

  it('회색 조각의 이름은 사용하지 않는 데이터이고 막대의 이름은 사용하는 데이터다', () => {
    const gray = layout.pieces.find((piece) => piece.segment === 'file:gray')!
    const bar = layout.pieces.find((piece) => piece.segment === 'file:bar')!
    const train = layout.pieces.find((piece) => piece.node === 'train')!
    expect(pieceNameKey(gray)).toBe('flow.grayData')
    expect(pieceNameKey(bar)).toBe('flow.usedData')
    expect(pieceNameKey(train)).toBeNull()
  })

  it('모든 조각이 이름을 갖는다 — 노드의 이름이거나 위 둘이다', () => {
    for (const piece of layout.pieces) {
      expect(
        pieceNameKey(piece) !== null || model.nodes.some((node) => node.id === piece.node),
      ).toBe(true)
    }
  })
})

describe('켜짐과 흐림', () => {
  const model = modelOf(projectFile())!

  it('강조가 없으면 모두 평소다 — 흐린 것과 윤곽은 섞이지 않는다', () => {
    expect(nodeEmphasis(null, 'learn')).toBe('plain')
    expect(lineEmphasis(null, 'p1>learn')).toBe('plain')
    expect(trunkEmphasis(null)).toBe('plain')
    expect(pieceEmphasis(null, { node: 'file', segment: 'file:bar' })).toBe('plain')
  })

  it('학습 노드를 가리키면 전처리와 훈련은 켜지고 테스트와 새 데이터는 흐려진다', () => {
    const highlight = highlightOf(model, { node: 'learn' })
    expect(nodeEmphasis(highlight, 'learn')).toBe('lit')
    expect(nodeEmphasis(highlight, 'p1')).toBe('lit')
    expect(nodeEmphasis(highlight, 'train')).toBe('lit')
    expect(nodeEmphasis(highlight, 'p2')).toBe('dim')
    expect(nodeEmphasis(highlight, 'new')).toBe('dim')
    expect(lineEmphasis(highlight, 'p1>learn')).toBe('lit')
    expect(lineEmphasis(highlight, 'p2>eval')).toBe('dim')
  })

  it('회색 조각을 가리키면 그 조각과 짝인 파란 조각만 켜진다', () => {
    const highlight = highlightOf(model, { gray: 'file:gray' })
    expect(pieceEmphasis(highlight, { node: 'file', segment: 'file:gray' })).toBe('lit')
    expect(pieceEmphasis(highlight, { node: 'file', segment: 'file:bar' })).toBe('lit')
    expect(pieceEmphasis(highlight, { node: 'train', segment: null })).toBe('dim')
    expect(nodeEmphasis(highlight, 'learn')).toBe('dim')
  })

  it('기준 선의 줄기는 갈래가 켜지면 켜진다', () => {
    const lit = highlightOf(flowModelOf(projectFile(), factsOf(projectFile()), 'preprocess')!, {
      node: 'p2',
    })
    expect(trunkEmphasis(lit)).toBe('lit')
    expect(trunkEmphasis(highlightOf(model, { node: 'new' }))).toBe('dim')
  })
})

describe('분할 비율', () => {
  it('테스트 몫에서 두 백분율을 낸다', () => {
    expect(splitPercents(0.2)).toEqual({ train: 80, test: 20 })
    expect(splitPercents(0.25)).toEqual({ train: 75, test: 25 })
  })

  it('반올림해도 합이 백이다', () => {
    for (const testSize of [0.1, 0.15, 0.333, 0.5]) {
      const { train, test } = splitPercents(testSize)
      expect(train + test).toBe(100)
    }
  })
})
