/**
 * `mlpx-kmeans-v1` — K-Means 군집화 모델.
 *
 * **여덟 번째 형식이다.** 앞의 일곱과 달리 돌려주는 것이 라벨도 수치도 아닌
 * **군집 번호(문자열)**다. Prediction 타입이 `string | number`이므로 부르는 쪽에는
 * 분기가 없다 — 군집 번호를 `"0"`, `"1"`, … 문자열로 돌려준다.
 *
 * 모델에 담기는 것은 **중심점뿐이다.** 예측은 입력과 각 중심점의 거리를 재서
 * 가장 가까운 것을 고르는 것이 전부다. 훈련 데이터가 필요 없으므로
 * `needsTrainingRows: false`다.
 */

import { z } from 'zod'

import { ClientError } from '../../errors'
import type { ModelFile, Predict } from './types'

export const KMEANS_FORMAT = 'mlpx-kmeans-v1'

export interface KMeansModel extends ModelFile {
  readonly format: typeof KMEANS_FORMAT
  readonly featureCount: number
  /** 군집 수. centroids.length와 같다. */
  readonly k: number
  /** centroids[c][j] = 군집 c의 특성 j. */
  readonly centroids: readonly (readonly number[])[]
}

const kmeansSchema = z.looseObject({
  format: z.literal(KMEANS_FORMAT),
  featureCount: z.number(),
  k: z.number(),
  centroids: z.array(z.array(z.number())).min(1),
})

function invalid(field: string): never {
  throw new ClientError('MODEL_FILE_INVALID', { field })
}

/**
 * 파일에서 읽은 JSON을 검증해 모델로 만든다.
 *
 * **예측만 쓰던 것을 밖으로 낸 이유는 중심점 자체가 화면에 쓰이기 때문이다** —
 * 되돌린 중심점이 곧 그 군집의 특성별 평균이다 (`ml/clusters.ts`,
 * `open-decisions.md` #28-6). 검증을 두 벌로 만들지 않으려고 여기 하나만 둔다.
 */
export function parseKMeansModel(file: unknown): KMeansModel {
  const parsed = kmeansSchema.safeParse(file)
  if (!parsed.success) invalid('payload')

  const { featureCount, k, centroids } = parsed.data
  if (!Number.isInteger(featureCount) || featureCount <= 0) invalid('featureCount')
  if (!Number.isInteger(k) || k <= 0) invalid('k')
  if (centroids.length !== k) invalid('centroids')
  for (const centroid of centroids) {
    if (centroid.length !== featureCount) invalid('centroids')
    if (!centroid.every((value) => Number.isFinite(value))) invalid('centroids')
  }

  return { format: KMEANS_FORMAT, featureCount, k, centroids }
}

/**
 * 가장 가까운 중심점의 번호를 문자열로 돌려준다.
 *
 * **문자열인 이유:** 분류의 라벨이 문자열이고 Prediction = string | number다.
 * 군집 번호를 수치로 돌려주면 부르는 쪽이 "이건 회귀인가 군집인가"를 봐야 한다.
 * 문자열이면 분류와 같은 경로를 탄다.
 */
export function kmeansPredict(model: KMeansModel): Predict {
  const { featureCount, k, centroids } = model

  return (features) =>
    features.map((input) => {
      if (input.length !== featureCount) invalid('featureCount')
      let bestCluster = 0
      let bestDist = Number.POSITIVE_INFINITY
      for (let c = 0; c < k; c += 1) {
        const centroid = centroids[c]!
        let dist = 0
        for (let j = 0; j < featureCount; j += 1) {
          const gap = (input[j] ?? 0) - (centroid[j] ?? 0)
          dist += gap * gap
        }
        if (dist < bestDist) {
          bestDist = dist
          bestCluster = c
        }
      }
      return String(bestCluster)
    })
}

/** 등록부가 부르는 이음매. 검증과 예측을 잇는 것뿐이다. */
export function loadKMeansModel(file: unknown): Predict {
  return kmeansPredict(parseKMeansModel(file))
}
