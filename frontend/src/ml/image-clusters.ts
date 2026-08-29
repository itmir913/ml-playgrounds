/**
 * 이미지 군집 결과를 **사진 묶음으로** 만드는 자리 (open-decisions.md #28-8).
 *
 * **표 군집에서 산점도가 하는 일은 "2번 군집은 어떤 애들인가"에 간접적으로 답하는
 * 것이다.** 이미지에서는 그 질문에 직접 답할 수 있다 — 사진을 보여주면 된다. 1,280차원을
 * 2차원으로 눌러 찍은 점 200개보다 묶인 사진을 그대로 늘어놓는 쪽이 비교도 안 되게
 * 많은 것을 말한다.
 *
 * **배정 계산은 표와 같은 함수를 쓴다** (`assignClusters`). 두 벌이 되면 그 둘이 갈리는
 * 날 화면은 A 군집 색으로 칠한 사진을 B 군집 자리에 넣는다.
 */

import { assignClusters, explainsAsClusters } from '@/ml/clusters'
import { parseKMeansModel } from '@/ml/models'

export interface ImageClusterGroup {
  readonly cluster: number
  /**
   * 그 군집의 사진들. **중심에 가까운 순이다** — 앞엣것이 그 군집에서 가장 전형적인
   * 사진이고, 학생이 "이 군집은 무엇인가"를 볼 때 먼저 보는 것이 그것이어야 한다.
   */
  readonly hashes: readonly string[]
  /**
   * 이 군집을 대표하는 사진. **중심에 가장 가까운 실제 사진이다** (#28-8).
   *
   * 1,280차원 중심점 벡터는 표로 못 보여준다. "이 군집을 대표하는 사진은 이것이다"는
   * 학생이 바로 아는 말이고, 중심에 가장 가까운 표본을 뽑는 것은 표준적인 설명이다.
   */
  readonly representative?: string | undefined
}

/**
 * 훈련 행렬에 모델을 돌려 사진을 군집별로 묶는다.
 *
 * **못 만들면 `null`이고, 그때 화면은 그 자리에 아무것도 안 그린다** (`clusterMaterialFor`와
 * 같은 모양). 무리로 설명할 수 있는 형식이 아니거나, 모델이 파일에 없거나, 읽다가
 * 실패한 경우다 — **셋을 가르지 않는 이유는 화면이 할 일이 셋 다 같기 때문이다.**
 */
export function imageClusterGroups(
  format: string | undefined,
  bytes: Uint8Array | undefined,
  matrix: readonly (readonly number[])[],
  hashes: readonly string[],
): readonly ImageClusterGroup[] | null {
  if (!explainsAsClusters(format)) return null
  if (!bytes || matrix.length === 0 || matrix.length !== hashes.length) return null

  try {
    const model = parseKMeansModel(JSON.parse(new TextDecoder().decode(bytes)))
    // **행 번호가 곧 사진 목록의 자리다.** 학습 때의 `trainIndices`를 쓰지 않는 이유는,
    // 사진은 학습 뒤에도 늘고 줄기 때문이다 — 그때 옛 번호는 다른 사진을 가리킨다.
    // 지금 있는 사진 전부에 지금 모델을 돌리는 것이 학생이 보고 싶은 것이기도 하다.
    const rows = matrix.map((_, index) => index)
    const assignment = assignClusters(matrix, rows, model)

    const grouped = new Map<number, { hash: string; distance: number }[]>()
    for (let index = 0; index < rows.length; index += 1) {
      const cluster = assignment.clusters[index] ?? 0
      const hash = hashes[index]
      if (hash === undefined) continue
      const bucket = grouped.get(cluster) ?? []
      bucket.push({ hash, distance: assignment.distances[index] ?? 0 })
      grouped.set(cluster, bucket)
    }

    return Array.from({ length: model.k }, (_, cluster) => {
      // 동점이면 먼저 온 사진이 앞이다 — `clusterMembers`와 같은 규칙이라 열 때마다
      // 순서가 흔들리지 않는다.
      const members = (grouped.get(cluster) ?? []).sort((a, b) => a.distance - b.distance)
      return {
        cluster,
        hashes: members.map((member) => member.hash),
        ...(members[0] ? { representative: members[0].hash } : {}),
      }
    })
  } catch {
    return null
  }
}
