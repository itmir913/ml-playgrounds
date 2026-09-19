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
 * **이 벌들이 실제로 무는 가드** (심어서 확인했다, 2026-09-19): `metrics.ts`의 `ratio`
 * 0-분모 가드, `r2`의 `total === 0` 가드, `settings.ts`의 문 둘. **안 닿는 것 하나**:
 * 실루엣의 `maxAB === 0` 가드는 겹친 점을 두 군집으로 쪼개도 안 지나간다 — 그 위의
 * `filled` 가드가 먼저 막는다고 소스가 적고 있고, **여기서 확인한 것은 "두 벌로 못
 * 닿았다"까지다.** 닿는 벌을 아는 사람이 채워 넣어라.
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
describe('망가진 데이터로 학습해도 그 문서는 다시 열린다', () => {
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
