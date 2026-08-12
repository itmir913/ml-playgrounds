/**
 * 백본 등록부가 **실물과 맞는지** 본다.
 *
 * 차원·노드 이름·정본 크기는 사람이 모델에서 눈으로 읽어 옮겨 적은 값이고, 그런 값은
 * 반드시 어긋난다. 어긋나도 예외가 안 난다 — `execute`가 없는 노드를 받으면 그때서야
 * 터지고, 정본 크기가 틀리면 **아무 데서도 안 터지고 성적만 조용히 나빠진다.**
 *
 * 그래서 여기서 `model.json`을 직접 열어 대조한다. 가중치는 저장소에 없고
 * `npm run backbones`가 받아 놓는다 (`scripts/fetch-backbone.mjs`).
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { BACKBONES, BACKBONE_IDS, DEFAULT_BACKBONE_ID, backboneFor } from '@/ml/backbones'
import { TASK_TYPES } from '@/project/schema'

interface GraphNode {
  readonly name: string
  readonly op: string
  readonly attr?: {
    readonly shape?: { readonly shape?: { readonly dim?: readonly { readonly size: string }[] } }
  }
}

interface ModelJson {
  readonly modelTopology: { readonly node: readonly GraphNode[] }
  readonly weightsManifest: readonly {
    readonly weights: readonly { readonly name: string; readonly shape: readonly number[] }[]
  }[]
}

function readModelJson(modelPath: string): ModelJson {
  const path = fileURLToPath(new URL(`../public/${modelPath}`, import.meta.url))
  if (!existsSync(path)) {
    throw new Error(
      `백본 가중치가 없다: ${modelPath}\n` +
        `저장소에 두지 않는 파일이다. \`npm run backbones\`로 받아라.`,
    )
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as ModelJson
}

describe('백본 등록부', () => {
  it('id마다 명세가 하나씩 있다', () => {
    expect(BACKBONES.map((backbone) => backbone.id)).toEqual([...BACKBONE_IDS])
  })

  it('기본 백본이 등록부에 있다', () => {
    expect(backboneFor(DEFAULT_BACKBONE_ID)).toBeDefined()
  })

  it.each(BACKBONES.map((backbone) => [backbone.id, backbone] as const))(
    '%s: 과제는 우리가 아는 것들이고 회귀는 없다',
    (_id, backbone) => {
      for (const task of backbone.tasks) expect(TASK_TYPES).toContain(task)
      // 이미지 회귀는 안 한다. 화면이 아니라 여기서 막힌다.
      expect(backbone.tasks).not.toContain('regression')
      expect(backbone.tasks.length).toBeGreaterThan(0)
    },
  )
})

describe('백본 명세는 model.json과 맞는다', () => {
  it.each(BACKBONES.map((backbone) => [backbone.id, backbone] as const))('%s', (_id, backbone) => {
    const model = readModelJson(backbone.modelPath)
    const nodes = model.modelTopology.node

    // 입력 크기 — 정본을 이 크기로 굽는다.
    const input = nodes.find((node) => node.op === 'Placeholder')
    expect(input, '입력 노드가 없다').toBeDefined()
    const dims = input?.attr?.shape?.shape?.dim ?? []
    expect(dims.map((dim) => Number(dim.size))).toEqual([
      -1,
      backbone.canonicalSize,
      backbone.canonicalSize,
      3,
    ])

    // 임베딩을 뽑을 노드 — 이름이 틀리면 execute가 터진다.
    expect(
      nodes.some((node) => node.name === backbone.embeddingNode),
      `${backbone.embeddingNode} 노드가 그래프에 없다`,
    ).toBe(true)

    /**
     * 임베딩 차원 — 분류기가 받는 폭이 곧 임베딩의 길이다.
     *
     * 노드 출력 shape은 model.json에 없어서 직접 못 읽는다. 대신 우리가 버리는
     * 분류기의 입력 폭을 본다: [1, 1, 임베딩차원, 클래스수].
     */
    const weights = model.weightsManifest.flatMap((group) => group.weights)
    const classifier = weights.find(
      (weight) => weight.name.includes('Logits') && weight.shape.length === 4,
    )
    expect(classifier, '분류기 가중치를 못 찾았다').toBeDefined()
    expect(classifier?.shape[2]).toBe(backbone.embeddingDim)
  })
})
