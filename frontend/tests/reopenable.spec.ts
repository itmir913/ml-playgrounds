/**
 * **나가는 문서는 다시 열린다** (2026-09-19 R33, 코드 소유자의 지시).
 *
 * **같은 종류의 A가 두 라운드 연속으로 났다.** R32는 `modelOmittedDetail`이 235자,
 * R33은 `nSamples`가 바닥 아래였다. 모양이 똑같다 — **쓰는 길에는 검증이 없고 읽는 길에만
 * 있어서**, 스키마를 어기는 값이 한 번 담기면 `.mlpx`도 IndexedDB 사본도 **저장은 성공하고
 * 다시는 안 열린다.** 학생은 한 차시가 끝난 뒤에야 안다.
 *
 * **쓰는 길에 검증을 넣는 길은 안 간다** — `내보내기는 무조건 성공해야 한다`가 이 저장소의
 * 규칙이다(`open-decisions.md`). 브라우저에만 있는 프로젝트는 제출을 못 하면 죽은 것이다.
 * **그래서 막는 자리는 값이 문서로 들어가는 문이고, 이 파일이 그 문들을 지킨다.**
 *
 * **문이 둘이다.**
 *
 * 1. **설정** — 설정을 고치는 순수 함수들. 그쪽은 `settings.spec.ts`가 훑는다
 *    (문 목록이 닫혀 있는지까지 센다).
 * 2. **학습 결과** — `applyExperiment`. *"[학습하기]가 끝나면 부르는 것이 이것 하나다."*
 *    **여기가 그 문이다.**
 *
 * **지어낸 run을 넣지 않는다**(`reachability-through-real-entry`). 진짜 학습을 돌려
 * 나온 것을 진짜 문으로 앉히고, 그 문서를 읽는 길이 받는지 본다 — 손으로 조립하면
 * 지표를 짓는 코드와 문을 통째로 건너뛴다.
 *
 * **이 벌들이 실제로 무는 가드** (전부 심어서 확인했다): `metrics.ts`의 `ratio` 0-분모
 * 가드와 `r2`의 `total === 0` 가드와 **실루엣의 `maxAB === 0` 가드**, 그리고
 * `settings.ts`의 문 둘.
 *
 * **실루엣 가드는 한때 "못 닿는다"고 적혀 있었다** — 겹친 점을 두 군집으로 쪼개는 벌로는
 * 원리적으로 못 닿기 때문이다(배정이 `argmin`이라 같은 점은 언제나 같은 라벨을 받는다).
 * **닿는 길은 표본이었고**(2026-09-19 R34가 찾았다) 아래 다섯째 벌이 그 길이다.
 */

import { describe, expect, it } from 'vitest'

import { runExperiment as runExperimentRaw, type ExperimentInput } from '../src/ml/experiment'
import type { Dataset } from '../src/ml/preprocess'
import { applyExperiment } from '../src/project/attach'
import { dataSnapshot, projectDocumentSchema, type Settings } from '../src/project/schema'
import { projectFile } from './fixtures/project'

const NOW = '2026-09-19T00:00:00.000Z'

/** 이 파일이 문서에서 읽는 것만. 스키마 타입을 그대로 쓰면 `unknown`에 걸린다. */
interface Document {
  readonly runs: {
    readonly experiments: readonly {
      readonly runs: readonly {
        readonly status: string
        readonly algorithm?: string
        readonly metrics?: Record<string, number>
      }[]
    }[]
  }
}

/** 표 하나. **열 이름은 짧게, 값은 극단으로.** */
function tableOf(header: readonly string[], rows: readonly (readonly string[])[]): Dataset {
  return { columns: [...header], rows: rows.map((row) => [...row]) }
}

function settingsFor(
  features: readonly string[],
  target: string,
  algorithms: readonly string[],
  taskType: Settings['taskType'] = 'classification',
): Settings {
  return {
    data: {
      features: [...features],
      target,
      preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
    },
    split: { method: 'holdout', testSize: 0.4, stratify: false, randomState: 42 },
    runtime: 'mljs',
    selectedAlgorithms: algorithms.map((algorithm) => ({ algorithm })),
    hyperparameters: {},
    ...(taskType === undefined ? {} : { taskType }),
  } as Settings
}

async function documentAfter(
  dataset: Dataset,
  settings: Settings,
  taskType: ExperimentInput['taskType'],
) {
  const result = await runExperimentRaw(
    {
      dataset,
      testDataset: null,
      taskType,
      dataType: 'tabular',
      settings,
      context: {
        limitsOff: false,
        serverStatus: 'unavailable',
        rowCount: dataset.rows.length,
        dataType: 'tabular',
      },
      snapshot: dataSnapshot('tabular', settings),
    },
    { now: () => NOW },
  )
  const file = projectFile()
  file.document.settings = settings
  file.document.runs = { experiments: [] }
  return applyExperiment(file, result, NOW).document
}

/**
 * **지표가 수가 아니면 파일이 안 열린다.** 스키마의 `z.number()`는 `NaN`도 `Infinity`도
 * 거부한다(둘 다 확인했다). 나눗셈이 들어가는 지표가 열 몇 개이고, **분모가 0이 되는
 * 데이터는 교실에서 흔하다** — 같은 값만 든 열, 두 줄짜리 표, 한 범주만 남은 시험 몫.
 */
/**
 * **시간을 넉넉히 준다.** 아래 다섯째 벌은 실루엣 표본을 켜야 하는데, 표본 크기는
 * `SILHOUETTE_BUDGET_MS`(2초)에서 **거꾸로 계산된 값**이다 — 즉 그 계산은 **설계상 2초를
 * 쓴다.** 기본 5초로는 관문이 174개 워커로 붐빌 때 넘어간다(실제로 넘어갔다). 표본을
 * 켜면서 더 싸게 만드는 모양은 없다 — 예산이 비용을 정하기 때문이다.
 */
describe('망가진 데이터로 학습해도 그 문서는 다시 열린다', { timeout: 30_000 }, () => {
  const CASES: Record<string, () => Promise<unknown>> = {
    '타깃이 전부 같은 값인 회귀 (R²의 분모가 0이다)': () =>
      documentAfter(
        tableOf(
          ['키', '점수'],
          [
            ['1', '5'],
            ['2', '5'],
            ['3', '5'],
            ['4', '5'],
            ['5', '5'],
          ],
        ),
        settingsFor(['키'], '점수', ['linear_regression'], 'regression'),
        'regression',
      ),

    '특성이 전부 같은 값인 분류 (표준화의 분모가 0이다)': () =>
      documentAfter(
        tableOf(
          ['키', '품종'],
          [
            ['7', 'a'],
            ['7', 'b'],
            ['7', 'a'],
            ['7', 'b'],
            ['7', 'a'],
            ['7', 'b'],
          ],
        ),
        settingsFor(['키'], '품종', ['decision_tree', 'knn', 'logistic_regression']),
        'classification',
      ),

    '점이 전부 겹치는 군집 (실루엣의 분모가 0이다)': () =>
      documentAfter(
        tableOf(
          ['x', 'y'],
          [
            ['1', '1'],
            ['1', '1'],
            ['1', '1'],
            ['1', '1'],
            ['1', '1'],
            ['1', '1'],
          ],
        ),
        settingsFor(['x', 'y'], 'x', ['k_means'], 'clustering'),
        'clustering',
      ),

    '겹친 점을 두 군집으로 쪼갠 경우 (실루엣의 분모가 0이다)': () => {
      const settings = settingsFor(['x', 'y'], 'x', ['k_means'], 'clustering')
      return documentAfter(
        tableOf(
          ['x', 'y'],
          [
            ['1', '1'],
            ['1', '1'],
            ['1', '1'],
            ['1', '1'],
          ],
        ),
        { ...settings, hyperparameters: { k_means: { mljs: { nClusters: 2 } } } },
        'clustering',
      )
    },

    '표본이 켜지고 소수 군집이 통째로 빠지는 군집 (실루엣의 분모가 0이다)': () => {
      /**
       * **여기가 그 가드에 닿는 유일한 길이다** (2026-09-19 R34 §3.2가 찾아 줬다).
       *
       * 겹친 점을 두 군집으로 쪼개는 벌로는 **원리적으로 못 닿는다** — 배정이 `argmin`이라
       * 같은 점은 언제나 같은 라벨을 받고, 그러면 위쪽 `filled` 가드가 먼저 막는다.
       * **닿는 길은 표본이었다**: `silhouetteSampleSize(3000, 100) = 2,500 < 3,000`이라
       * 표본이 켜지고, 씨앗 20에서 **외톨이가 표본에서 통째로 빠진다** → `ai = 0`이고
       * 다른 군집의 표본 멤버가 0개라 `bi`도 0 → `maxAB === 0`.
       *
       * **소스의 단정이 반만 맞았다** — *"`filled` 가드가 이미 걸러낸다"*는 **전수일 때만**
       * 참이다. `filled`는 전수를 세고 `members`는 표본을 센다.
       */
      const columns = Array.from({ length: 100 }, (_, index) => `x${index}`)
      const crowd = Array.from({ length: 2999 }, () => columns.map(() => '1'))
      const loner = columns.map(() => '99')
      const settings = settingsFor(columns, 'x0', ['k_means'], 'clustering')
      return documentAfter(
        tableOf(columns, [...crowd, loner]),
        {
          ...settings,
          split: { ...settings.split, randomState: 20 },
          hyperparameters: { k_means: { mljs: { nClusters: 2 } } },
        },
        'clustering',
      )
    },

    '한 범주가 한 줄뿐인 분류 (정밀도의 분모가 0이 될 수 있다)': () =>
      documentAfter(
        tableOf(
          ['키', '품종'],
          [
            ['1', 'a'],
            ['2', 'a'],
            ['3', 'a'],
            ['4', 'a'],
            ['5', 'b'],
          ],
        ),
        settingsFor(['키'], '품종', ['decision_tree', 'naive_bayes']),
        'classification',
      ),
  }

  for (const [name, make] of Object.entries(CASES)) {
    it(name, async () => {
      const document = (await make()) as Document
      const runs = document.runs.experiments[0]?.runs ?? []
      expect(runs.length, `${name}: nothing ran`).toBeGreaterThan(0)

      /**
       * **끝까지 돌아야 한다.** 지표가 수가 아닐 때 이 저장소가 지는 모양은 둘이고,
       * **파일이 안 열리는 것만 막으면 절반이다** — 나머지 절반은 run이 조용히
       * `failed`로 떨어져 **학생이 그 학습을 통째로 잃는 것**이다. 실제로 `r2`의
       * 분모 가드를 지우면 이 벌이 `failed`가 되고, 문서는 멀쩡히 열린다.
       */
      for (const run of runs) {
        expect(run.status, `${name}: ${run.algorithm ?? ''}`).toBe('done')
        for (const [metric, value] of Object.entries(run.metrics ?? {})) {
          expect(Number.isFinite(value), `${name}: ${metric} = ${String(value)}`).toBe(true)
        }
      }

      const parsed = projectDocumentSchema.safeParse(document)
      const where = parsed.success ? '' : (parsed.error.issues[0]?.path.join('.') ?? '')
      const why = parsed.success ? '' : (parsed.error.issues[0]?.message ?? '')
      expect(parsed.success, `${where}: ${why}`).toBe(true)
    })
  }

  /**
   * **그물이 비어 있지 않은지.** 위 벌들이 실제로 학습을 끝내고 run을 남겼어야, 스키마를
   * 통과한 것이 *"아무것도 안 담겨서"*가 아니다 — R12 A-2가 이름 붙인 병이다.
   */
  /**
   * **그물이 비어 있지 않은지.** 위 벌들이 지표를 실제로 냈어야, 스키마를 통과한 것이
   * *"담긴 수가 없어서"*가 아니다 — R12 A-2가 이름 붙인 병이다.
   */
  it('벌마다 지표가 실제로 담겼다 - 빈 문서를 통과시킨 것이 아니다', async () => {
    for (const [name, make] of Object.entries(CASES)) {
      const document = (await make()) as Document
      const counted = (document.runs.experiments[0]?.runs ?? []).flatMap((run) =>
        Object.keys(run.metrics ?? {}),
      )
      expect(counted.length, name).toBeGreaterThan(1)
    }
  })
})
