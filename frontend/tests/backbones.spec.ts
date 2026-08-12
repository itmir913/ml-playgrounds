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

/**
 * 원본에서 받아 둔 `model.json`. **산출물에는 없다** — 학생 브라우저가 원본에서 직접
 * 받으므로(open-decisions.md "백본을 붙이는 방법") 이 파일이 있는 곳은
 * `scripts/fetch-backbone.mjs`가 놓는 캐시뿐이고, 쓰는 것은 이 검사뿐이다.
 */
function readModelJson(id: string): ModelJson {
  const path = fileURLToPath(new URL(`../.cache/backbones/${id}/model.json`, import.meta.url))
  if (!existsSync(path)) {
    throw new Error(
      `백본 가중치가 없다: ${id}\n` +
        `저장소에 두지 않는 파일이다. \`npm run backbones\`로 받아라.`,
    )
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as ModelJson
}

/** 소스에 안 보이는 바이트를 남기지 않으려고 이름을 붙인다 (`tests/kinds.spec.ts`와 같다). */
const NEWLINE = String.fromCharCode(10)

describe('백본 등록부', () => {
  it('id마다 명세가 하나씩 있다', () => {
    expect(BACKBONES.map((backbone) => backbone.id)).toEqual([...BACKBONE_IDS])
  })

  it('기본 백본이 등록부에 있다', () => {
    expect(backboneFor(DEFAULT_BACKBONE_ID)).toBeDefined()
  })

  /**
   * **트립와이어다.** 통과가 목적이 아니라 둘째 백본이 등록되는 순간 멈추는 것이 목적이다.
   *
   * 지금은 **고르게 하지 않는다** — 손잡이가 하나 늘면 재현 필드와 화면이 같이 늘고,
   * 프로젝트를 만들 때 `DEFAULT_BACKBONE_ID`가 파일에 박힌 뒤로는 아무도 그 값을 안
   * 바꾼다. **그래서 지금은 흔들릴 자리가 없다.**
   *
   * 둘째가 등록되는 날 정해야 하는 것이 셋이다.
   *
   * 1. **고르게 할 것인가.** 안 고르게 하면 기본이 곧 전부이고, 그때 기본을 옮기는 것은
   *    새 프로젝트만 조용히 달라지게 하는 일이다 — 옛 프로젝트는 자기 값을 파일에
   *    들고 있어 안 흔들린다(그게 `backboneId`를 파일에 적는 이유다).
   * 2. **정본 크기가 갈리면 카드가 잠긴다.** 224로 구운 정본은 260을 요구하는 백본에
   *    못 간다 (open-decisions.md #4). 없는 화소를 만들어 늘리지 않는다.
   * 3. **임베딩은 백본마다 따로 쌓인다** (mlpx-spec.md §1.3). 바꾸면 다시 뽑는 것이
   *    맞고, 그 비용을 학생에게 어떻게 말할지가 화면의 일이다.
   */
  it('백본이 하나뿐이다 - 늘리는 사람은 고르게 할지 먼저 정해야 한다', () => {
    expect(
      [...BACKBONE_IDS],
      [
        '백본이 늘었다. 정할 것이 셋 있다.',
        '  1. 고르게 할 것인가 (지금은 안 고르게 하고 기본 하나를 파일에 박는다)',
        '  2. 정본 크기가 갈리면 그 백본 카드를 잠근다 (224 정본 -> 260 백본 불가)',
        '  3. 임베딩은 백본마다 따로 쌓인다 - 바꿀 때 다시 뽑는 비용을 화면이 말해야 한다',
        '정하고 나서 이 검사를 고쳐라.',
      ].join(NEWLINE),
    ).toEqual(['mobilenet-v2'])
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
    const model = readModelJson(backbone.id)
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
