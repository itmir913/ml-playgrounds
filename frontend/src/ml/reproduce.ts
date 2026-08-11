/**
 * 재실행 대조 — **파일에 적힌 숫자가 그 설정에서 실제로 나오는가** (mlpx-spec.md §7.1).
 *
 * 해시는 "파일이 만들어진 뒤에 바뀌었는가"만 답한다. 학생이 학습 전에 `runs.json`을
 * 고치고 저장했으면 해시는 멀쩡하다. **그때 주장을 검사하는 유일한 층이 여기다.**
 *
 * **엔진을 넘지 않는다** (architecture.md §3.2). 배포 경로가 둘이라 학생이 Pages에서
 * 학습하고 교사가 도커 설치본에서 대조하는 일이 생기는데, 엔진이 다르면 숫자가 갈려
 * **무고한 학생이 위조를 의심받는다.** 그래서 만든 엔진과 같은 엔진이 아니면 대조하지
 * 않고 그 사실을 말한다.
 *
 * **여기서 허용 오차를 정하지 않는다** (`open-decisions.md` #12는 미결이다). 이 층이
 * 내놓는 것은 판정에 필요한 **사실**이다 — 지표마다의 차이, 그리고 그 차이가 0인가.
 * 오차를 얼마나 봐 줄지는 화면과 함께 정한다. 지금 임의의 숫자를 여기 박으면 그 숫자가
 * 곧 규칙이 되고, 나중에 실측으로 정할 자리가 사라진다.
 *
 * **분할을 다시 계산하지 않는다.** 파일에 적힌 `trainIndices`/`testIndices`를 그대로 쓴다
 * (mlpx-spec.md §5.1) — 다시 나누면 라이브러리 버전 차이 하나로 테스트셋이 갈리고,
 * 그러면 대조가 아니라 새 학습이 된다.
 */

import { ClientError, isClientError, type ReproductionStatus } from '../errors'
import type { Experiment, Run } from '../project/schema'
import { RUNTIMES } from './backend'
import { engineFor, type TrainingEngine } from './engines'
import { evaluate } from './metrics'
import { fitPreprocessor, targetValues, transform, type Dataset } from './preprocess'

/** run 하나의 대조 결과. **판정이 아니라 사실이다.** */
export interface Reproduction {
  readonly runId: string
  readonly algorithm: string
  readonly status: ReproductionStatus
  /** 파일에 적힌 지표. */
  readonly stored: Readonly<Record<string, number>>
  /** 다시 돌려 나온 지표. 대조를 못 했으면 없다. */
  readonly again?: Readonly<Record<string, number>>
  /**
   * 지표마다 `다시 - 파일`. **화면이 허용 오차를 정할 때 볼 값이다** (#12).
   *
   * 파일에만 있는 지표는 `NaN`이 아니라 아예 빠진다 — 없는 것과 어긋난 것은 다른 말이고,
   * 옛 파일에는 지금 없는 지표가 들어 있을 수 있다.
   */
  readonly deltas?: Readonly<Record<string, number>>
  /** 대조하지 못한 이유. `ENGINE_UNAVAILABLE`일 때만 있다. */
  readonly engine?: { readonly kind: string; readonly version: string }
}

export interface ReproduceInput {
  readonly experiment: Experiment
  /** 정본 표. `dataset/`이 없는 파일에서는 대조 자체가 불가능하다. */
  readonly dataset: Dataset
  /**
   * 평가 데이터. **`experiment.settings.split.method`가 `provided`일 때만 쓴다.**
   *
   * 그때 `testIndices`는 `dataset`이 아니라 이 표의 행 번호다 (mlpx-spec.md §1.1,
   * ml/split.ts) - 없으면 대조를 못 한다.
   *
   * **선택 인자가 아니라 필수다** (`ExperimentInput.testDataset`과 같은 이유다).
   * 없으면 `null`을 말해야 부르는 쪽이 그 자리를 지나칠 수 없다.
   */
  readonly testDataset: Dataset | null
}

/**
 * 이 run을 만든 엔진이 지금 여기 있는가.
 *
 * **`kind`와 `version`이 둘 다 같아야 한다.** 버전이 다르면 같은 이름의 다른 계산기다 —
 * 의존성이 오르면 숫자가 움직일 수 있고(`MLJS_ENGINE.version`의 규칙), 그 차이를
 * 위조로 읽으면 안 된다.
 *
 * `run.engine`이 아예 없는 옛 run도 대조하지 않는다. 무엇으로 만들었는지 모르는 것과
 * 다른 엔진으로 만든 것은 대조 가능성에서 같다.
 */
function engineOf(run: Run): TrainingEngine | undefined {
  const stamp = run.engine
  if (!stamp) return undefined
  return ENGINES_BY_KIND().get(`${stamp.kind}@${stamp.version}`)
}

/**
 * kind@version -> 엔진. **등록부에서 만든다** — 목록을 손으로 적으면 엔진이 늘 때 어긋난다.
 *
 * 같은 엔진이 두 실행 방법에 붙을 수 있고(sklearn이 그렇게 된다) 그때도 대조는 성립한다.
 * 대조가 가리는 것은 **무엇으로 계산했는가**이지 어디서 돌았는가가 아니다.
 */
function ENGINES_BY_KIND(): Map<string, TrainingEngine> {
  const map = new Map<string, TrainingEngine>()
  for (const runtime of RUNTIMES) {
    const engine = engineFor(runtime.id)
    if (engine) map.set(`${engine.engine.kind}@${engine.engine.version}`, engine)
  }
  return map
}

/**
 * 실험 하나를 다시 돌려 파일의 지표와 견준다.
 *
 * **성공한 run만 본다.** 실패한 run에는 견줄 지표가 없다 — 그 실패를 재현하는 것은
 * 다른 질문이고, 교사가 알고 싶은 것은 "이 점수가 진짜인가"다.
 *
 * **한 run이 터져도 나머지는 대조한다.** 학습에서와 같은 규칙이다 (mlpx-spec.md §4.1).
 * 여기서 통째로 멈추면 교사는 멀쩡한 모델의 대조 결과까지 못 본다.
 */
export function reproduceExperiment(input: ReproduceInput): Reproduction[] {
  const { experiment, dataset, testDataset } = input
  const { settings } = experiment
  const target = settings.data.target ?? ''

  const done = experiment.runs.filter((run) => run.status === 'done')
  if (done.length === 0) return []

  // provided면 testIndices는 dataset이 아니라 testDataset의 행 번호다
  // (mlpx-spec.md §1.1) — 학습 때와 같은 판정이다 (ml/experiment.ts).
  // 없으면 대조 자체가 불가능하다 — shared를 null로 만들어 아래에서 잡는다.
  const testSource = settings.split.method === 'provided' ? testDataset : dataset

  // 전처리기는 실험 전체가 공유한다. **학습 때와 같은 인자로 같은 자리에서 만든다** —
  // 파일에 담긴 전처리기를 읽지 않는 이유는, 그것도 대조 대상이기 때문이다. 설정에서
  // 다시 만든 것과 파일의 지표가 맞아야 "그 설정에서 그 숫자가 나온다"가 성립한다.
  const shared = (() => {
    if (!testSource) return null
    try {
      const preprocessor = fitPreprocessor(
        dataset,
        settings.trainIndices,
        settings.data.features,
        settings.data.preprocessing,
      )
      const { categoricalEncoding } = settings.data.preprocessing
      return {
        preprocessor,
        trainFeatures: transform(preprocessor, dataset, settings.trainIndices, categoricalEncoding),
        testFeatures: transform(
          preprocessor,
          testSource,
          settings.testIndices,
          categoricalEncoding,
        ),
        trainTarget: targetValues(dataset, settings.trainIndices, target),
        testTarget: targetValues(testSource, settings.testIndices, target),
      }
    } catch {
      return null
    }
  })()

  return done.map((run): Reproduction => {
    const base = {
      runId: run.id,
      algorithm: run.algorithm,
      stored: run.metrics ?? {},
    }

    const engine = engineOf(run)
    if (!engine || !shared) {
      // 엔진이 다르거나, 전처리가 지금 데이터로는 성립하지 않는다. 둘 다 **대조를 못 한
      // 것이지 어긋난 것이 아니다** - 여기서 NOT_REPRODUCED를 내면 도구가 학생을 지목한다.
      return {
        ...base,
        status: 'ENGINE_UNAVAILABLE',
        ...(run.engine ? { engine: run.engine } : {}),
      }
    }

    try {
      const { predict } = engine.fit(run.algorithm, {
        features: shared.trainFeatures,
        rowIndices: settings.trainIndices,
        target: shared.trainTarget,
        // **파일에 적힌 값을 그대로 먹인다.** 기본값을 다시 채우면 학생이 바꾼 값이
        // 사라지고, 그러면 다른 설정으로 학습해 놓고 "안 맞는다"고 말하게 된다.
        hyperparameters: run.hyperparameters,
        randomState: settings.split.randomState,
      })

      const again = evaluate(
        settings.taskType,
        shared.testTarget,
        predict(shared.testFeatures),
      ).metrics

      const deltas: Record<string, number> = {}
      for (const [name, value] of Object.entries(again)) {
        const stored = base.stored[name]
        if (typeof stored === 'number') deltas[name] = value - stored
      }

      // **차이가 0인가만 본다.** 얼마까지 봐 줄지는 이 층이 정하지 않는다 (#12).
      const same =
        Object.keys(deltas).length > 0 && Object.values(deltas).every((delta) => delta === 0)

      return {
        ...base,
        status: same ? 'REPRODUCED' : 'NOT_REPRODUCED',
        again,
        deltas,
      }
    } catch (error) {
      // 다시 돌리다 터졌다. 눈금 밖 하이퍼파라미터가 파일에 적혀 있는 경우가 대표적이다 -
      // 그건 학습 때도 실패했어야 하는 값이라 "대조 불가"가 아니라 "안 맞는다"에 가깝다.
      // 그래도 지목하지 않는다: 우리가 못 돌린 것과 학생이 고친 것을 여기서 못 가른다.
      if (isClientError(error) || error instanceof Error) {
        return {
          ...base,
          status: 'ENGINE_UNAVAILABLE',
          ...(run.engine ? { engine: run.engine } : {}),
        }
      }
      throw new ClientError('UNEXPECTED_ERROR')
    }
  })
}
