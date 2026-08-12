/**
 * 이미지 군집 결과를 사진 묶음으로 만드는 것 (`ml/image-clusters.ts`, open-decisions.md #28-8).
 *
 * **틀려도 화면은 멀쩡해 보인다** — 사진이 엉뚱한 군집에 뜨거나 대표가 전형적이지 않은
 * 사진일 뿐이고, 학생은 그것을 모델의 판단으로 읽는다.
 */

import { describe, expect, it } from 'vitest'

import { KMEANS_FORMAT } from '../src/ml/models'
import { imageClusterGroups } from '../src/ml/image-clusters'

/** 중심점 둘. 1차원이라 값 하나가 곧 좌표다. */
function modelBytes(centroids: readonly (readonly number[])[]): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      format: KMEANS_FORMAT,
      featureCount: centroids[0]?.length ?? 1,
      k: centroids.length,
      centroids,
    }),
  )
}

const MODEL = modelBytes([[0], [10]])

describe('사진을 군집별로 묶는다', () => {
  it('가까운 중심점으로 배정한다', () => {
    const groups = imageClusterGroups(
      KMEANS_FORMAT,
      MODEL,
      [[0], [1], [9], [10]],
      ['a', 'b', 'c', 'd'],
    )
    expect(groups?.map((group) => group.hashes)).toEqual([
      ['a', 'b'],
      ['d', 'c'],
    ])
  })

  /**
   * 앞엣것이 그 군집에서 가장 전형적인 사진이다. 학생이 "이 군집은 무엇인가"를 볼 때
   * 먼저 보는 것이 그것이어야 한다.
   */
  it('중심에 가까운 순으로 늘어놓는다', () => {
    const groups = imageClusterGroups(KMEANS_FORMAT, MODEL, [[3], [1], [0]], ['far', 'mid', 'near'])
    expect(groups?.[0]?.hashes).toEqual(['near', 'mid', 'far'])
  })

  /** 1,280차원 중심점 벡터는 표로 못 보여준다. 대신 실제 사진 하나를 건다. */
  it('대표는 중심에 가장 가까운 실제 사진이다', () => {
    const groups = imageClusterGroups(KMEANS_FORMAT, MODEL, [[3], [0]], ['far', 'near'])
    expect(groups?.[0]?.representative).toBe('near')
  })

  /** 비어 있는 군집도 자리를 갖는다 — 없으면 번호가 건너뛰어 학생이 사라진 줄 안다. */
  it('사진이 안 배정된 군집도 남는다', () => {
    const groups = imageClusterGroups(KMEANS_FORMAT, MODEL, [[0], [1]], ['a', 'b'])
    expect(groups).toHaveLength(2)
    expect(groups?.[1]?.hashes).toEqual([])
    expect(groups?.[1]?.representative).toBeUndefined()
  })
})

describe('못 만들면 아무것도 안 그린다', () => {
  it('무리로 설명할 수 없는 형식이면 null이다', () => {
    expect(imageClusterGroups('mlpx-tree-v1', MODEL, [[0]], ['a'])).toBeNull()
  })

  it('모델이 파일에 없으면 null이다', () => {
    expect(imageClusterGroups(KMEANS_FORMAT, undefined, [[0]], ['a'])).toBeNull()
  })

  it('깨진 모델이면 null이다 - 던지지 않는다', () => {
    const broken = new TextEncoder().encode('{')
    expect(imageClusterGroups(KMEANS_FORMAT, broken, [[0]], ['a'])).toBeNull()
  })

  /** 행과 사진이 어긋난 상태로 그리면 엉뚱한 사진이 그 군집에 뜬다. */
  it('행 수와 사진 수가 다르면 null이다', () => {
    expect(imageClusterGroups(KMEANS_FORMAT, MODEL, [[0], [1]], ['a'])).toBeNull()
  })

  it('사진이 없으면 null이다', () => {
    expect(imageClusterGroups(KMEANS_FORMAT, MODEL, [], [])).toBeNull()
  })
})
