/**
 * 실측 하니스(`tools/bench.html`)는 **앱이 아니다** (`open-decisions.md` "학습 예상 시간은
 * 실측표에 기기 배수를 곱해 낸다").
 *
 * 코드 소유자가 개발 서버로만 여는 페이지이고, 학생에게 나가면 안 된다 — 몇 분씩 CPU를
 * 태우는 버튼이 배포본에 있을 이유가 없다. vite는 `index.html` 하나만 빌드 입력으로
 * 잡으므로 지금은 `dist/`에 안 들어가는데, **그 사실은 설정 한 줄로 깨진다.**
 *
 * **여기서 지키는 것은 둘이다** — 빌드 입력이 늘지 않았는가, 앱에서 이 페이지로 가는
 * 길이 생기지 않았는가.
 *
 * **못 보는 것: vite의 기본 동작이 바뀌는 것.** 다중 페이지가 기본이 되면 이 검사는
 * 초록인 채로 하니스가 배포된다. 그때는 `dist/`를 직접 보는 검사로 옮겨야 한다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ALGORITHMS } from '../src/ml/algorithms'
import { backboneFor, DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import type { DataType } from '../src/project/schema'
import {
  ALL_LADDERS,
  benchOutcome,
  CALIBRATION,
  CEILING_MS,
  FAILURE_CEILING_MS,
  ladderPoint,
  measureCalibration,
  PROJECTION_MS,
  stopsBefore,
} from '../tools/workloads'

import { sourceFiles, withoutComments as stripComments } from './fixtures/source'

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')

/**
 * 주석을 걷어낸다. 규칙이 보려는 것은 코드이지 그것을 설명하는 글이 아니다.
 *
 * **공유 구현을 쓴다** (2026-09-01 감사 A-3). 여기 정규식 두 줄짜리 복사본이 있었는데,
 * 그것은 **문자열 안의 `/*`를 블록 주석의 시작으로 읽어** 다음 `*` `/`까지를 통째로
 * 삼켰다 — 감사자가 실제 소스 여섯에서 코드가 사라지는 것을 확인했고, 그중 둘에서는
 * 아래 "앱에서 하니스로 가는 길이 없다"가 심어 둔 위반을 못 봤다.
 *
 * **`fixtures/source.ts`가 그 사고에 이름을 붙여 두었다** (R8 감사 A-1) — 한 줄짜리
 * 복사본이 `https://`가 든 줄에서 화면 규칙 열둘을 껐던 일이다. 구현은 하나여야 한다.
 */
function withoutComments(source: string): string {
  return stripComments(source).join('\n')
}

describe('실측 하니스는 배포본에 안 들어간다', () => {
  /**
   * **주석을 걷고 본다** (2026-09-01 감사, 돌연변이 18). 이 파일의 머리에는 여는 방법을
   * 적은 HTML 주석이 있고 거기 `./bench.ts`가 글자로 들어 있다 — 걷지 않으면 `<script>`가
   * 다른 파일을 가리켜도 **주석만 보고 통과한다.**
   */
  it('하니스가 제자리에 있다 - 파일이 사라지면 이 검사가 조용히 통과하지 않는다', () => {
    const html = readFileSync(join(ROOT, 'tools', 'bench.html'), 'utf-8').replaceAll(
      /<!--[\s\S]*?-->/g,
      '',
    )
    expect(html).toContain('./bench.ts')
  })

  /**
   * **계산은 워커가 한다** (2026-09-01). 메인 스레드에서 재면 *"오래 걸린다"*와
   * *"탭이 죽는다"*가 똑같이 멈춘 화면으로 보이는데, **앞은 상한이 아니고 뒤는 상한이다**
   * (`open-decisions.md` "그러면 상한은 시간으로 정하는 것이 아니다").
   *
   * **되돌리기 쉬운 종류의 변경이라 검사가 있다** — `measure(job)` 한 줄이면 화면이 다시
   * 메인에서 돌고, 결과 JSON은 똑같이 생겼다. 틀린 것이 값이 아니라 **구분**이라 안 보인다.
   */
  it('하니스가 계산을 워커에서 돌린다', () => {
    const harness = withoutComments(readFileSync(join(ROOT, 'tools', 'bench.ts'), 'utf-8'))
    expect(harness).toContain('./bench.worker.ts')
    // 워커를 띄워 놓고 옆에서 메인으로도 재면 그 점만 조용히 다른 것을 잰다.
    expect(harness).not.toMatch(/\bmeasure\s*\(/)
    /**
     * **이름을 바꿔 들여와도 막는다** (2026-09-01 감사, 돌연변이 17).
     * `import { measure as runHere }` 한 줄이면 위 규칙을 그대로 비껴간다 — 이름이 아니라
     * **일감을 재는 함수를 들여왔는가**를 봐야 한다. `workloads`에서 오는 것 중 화면이
     * 부를 일이 없는 것은 `measure` 하나뿐이다.
     */
    expect(harness).not.toMatch(/\bmeasure\s+as\s+\w+/)
  })

  it('빌드 입력이 index.html 하나뿐이다', () => {
    const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf-8')
    // `rollupOptions.input`이 생기는 순간 페이지가 여럿이 된다.
    expect(config).not.toMatch(/\binput\s*:/)
  })

  /**
   * **주석은 안 본다.** 앱 코드가 하니스를 **가리키는** 것은 옳은 일이다 — 기준표를
   * 고치려면 그것을 돌려야 한다고 `limits.ts`가 적어 두는 자리가 그렇다. 막으려는 것은
   * 산출물에 하니스를 끌어들이는 **코드**다.
   *
   * 글자만 보던 규칙이 그 주석을 물었고(2026-08-31), 그때 넓히지 않고 좁혔다.
   */
  it('앱에서 하니스로 가는 길이 없다', () => {
    const reached = sourceFiles(SRC)
      .filter((path) =>
        /(?:from|import|URL)\s*\(?\s*['"`][^'"`]*(?:tools\/|bench)/i.test(
          withoutComments(readFileSync(path, 'utf-8')),
        ),
      )
      .map((path) => path.slice(SRC.length + 1))
    expect(reached).toEqual([])
  })

  it('그 규칙이 실제로 문다 - 주석만 보고 통과하지 않는다', () => {
    expect(withoutComments("import { x } from '../tools/workloads'")).toContain('tools/')
    expect(withoutComments('/* tools/bench.html */')).not.toContain('bench')
    expect(withoutComments('// tools/bench.html')).not.toContain('bench')
  })
})

/**
 * **재는 도구에 칸이 없으면 그 칸은 안 재진다.**
 *
 * 사진 칸 일곱이 그렇게 2026-08-14의 근거로 남았다 — 2026-09-01에 표 쪽 상한을 다시
 * 재면서 사진은 손대지 않았는데, **하니스에 사진 사다리가 하나도 없었기 때문이다.**
 * 재려면 먼저 코드를 써야 하고, 그 자리에서는 그게 "지금 할 일"로 안 보인다.
 *
 * 그래서 **등록부가 이 도구의 목록을 정한다.** 알고리즘이나 데이터 종류가 하나 늘면
 * 여기가 먼저 운다.
 */
describe('등록부의 칸마다 사다리가 있다', () => {
  const IMAGE_FEATURES = backboneFor(DEFAULT_BACKBONE_ID)?.embeddingDim

  /** 사다리가 실제로 만드는 일감으로 판정한다. **이름이 아니라 일감이 무엇을 재는가다.** */
  function covers(algorithm: string, dataType: DataType): boolean {
    return ALL_LADDERS.some((ladder) =>
      ladder.points.some((point) => {
        const job = ladder.job(point)
        if (job.algorithm !== algorithm) return false
        return dataType === 'image'
          ? job.columns === IMAGE_FEATURES
          : job.columns !== IMAGE_FEATURES
      }),
    )
  }

  it('백본의 특성 수를 읽었다 - 못 읽으면 위 판정이 통째로 헐거워진다', () => {
    expect(IMAGE_FEATURES).toBeTypeOf('number')
  })

  /**
   * **`id`가 겹치면 워커가 다른 것을 잰다.** `bench.worker.ts`는 `id`로 `find`하므로
   * 앞의 것만 돌고, 결과는 **겹친 이름 아래 덮여** 마지막 것만 남는다
   * (`measured[ladder.id]`). 둘 다 조용해서 표만 보고는 못 알아챈다.
   */
  it('사다리 이름이 겹치지 않는다', () => {
    const ids = ALL_LADDERS.map((ladder) => ladder.id)
    expect(ids).toHaveLength(new Set(ids).size)
  })

  it('등록부가 쓸 수 있다고 한 (알고리즘 × 종류)에 사다리가 있다', () => {
    const missing: string[] = []
    for (const algorithm of ALGORITHMS) {
      for (const dataType of ['tabular', 'image'] as const) {
        if (!algorithm.dataTypes[dataType]) continue
        if (!covers(algorithm.id, dataType)) missing.push(`${algorithm.id}/${dataType}`)
      }
    }
    expect(missing).toEqual([])
  })

  /**
   * **자기검사는 등록부의 사실에 안 매달린다** (2026-09-01 감사 C-6). `linear_regression`이
   * 사진에서 안 열린다는 것은 **오늘의 사실**이라, 언젠가 정당하게 열리면 이 검사가 먼저
   * 빨개진다 — 규칙이 아니라 사실이 바뀐 것인데 규칙이 우는 꼴이다.
   */
  it('그 규칙이 실제로 문다 - 없는 칸을 있다고 하지 않는다', () => {
    expect(covers('없는_알고리즘', 'tabular')).toBe(false)
    expect(covers('없는_알고리즘', 'image')).toBe(false)
  })
})

/**
 * **하니스의 판정** (2026-09-01 감사 C-3·C-4, 돌연변이 9·15).
 *
 * 화면 안에 있을 때는 **두 천장을 맞바꿔도, 없는 사다리에 0ms를 적어도 아무것도 안
 * 울었다.** 여기서 재는 것은 값이 아니라 **어느 점을 돌리고 어디서 멈추는가**이고,
 * 그것이 틀리면 기준표가 조용히 짧아지거나 상한을 아예 못 찾는다.
 */
describe('사다리 판정', () => {
  const rows = (findsLimit?: true) =>
    ({
      id: 'probe',
      label: 'probe',
      axis: 'rows',
      points: [1, 2],
      job: (point: number) => ({ algorithm: 'naive_bayes', rows: point }),
      ...(findsLimit ? { findsLimit } : {}),
    }) as const

  it('첫 점은 언제나 돈다 - 앞 점이 없으면 판정할 것이 없다', () => {
    expect(stopsBefore(rows(), null, 1)).toBe(false)
  })

  /**
   * **같은 점을 다시 재는 것으로 어림을 뺀다.** 증가율이 1이면 어림이 앞 점의 시간
   * 그대로라, 여기서 갈리는 것은 20초 천장 하나다 — 안 그러면 두 갈래가 같은 검사에
   * 섞여 무엇이 물었는지 모른다.
   */
  it('기준표 사다리는 20초를 넘긴 뒤에 멈춘다', () => {
    expect(stopsBefore(rows(), { point: 1, elapsed: CEILING_MS - 1 }, 1)).toBe(false)
    expect(stopsBefore(rows(), { point: 1, elapsed: CEILING_MS + 1 }, 1)).toBe(true)
  })

  /**
   * **상한을 찾는 사다리는 그 천장을 안 쓴다.** 오래 걸리는 것이 답의 일부다 — 이것이
   * 뒤집히면 [상한 찾기]가 20초에서 멈춰 **깨지는 지점을 영영 못 만난다.**
   */
  it('상한 사다리는 20초에서 안 멈춘다', () => {
    expect(stopsBefore(rows(true), { point: 1, elapsed: CEILING_MS * 10 }, 2)).toBe(false)
    expect(stopsBefore(rows(true), { point: 1, elapsed: FAILURE_CEILING_MS + 1 }, 2)).toBe(true)
  })

  /**
   * **어림의 지수를 축이 정한다.** 행 축만 제곱이고 나머지는 선형이다 — 전부 제곱으로
   * 어림하면 폭주는 안 나지만 **표가 조용히 짧아진다.**
   */
  it('행 축은 제곱으로, 다른 축은 선형으로 어림한다', () => {
    const elapsed = PROJECTION_MS / 3
    const previous = { point: 1, elapsed }
    // 2배 지점: 행 축이면 4배(넘는다), 특성 축이면 2배(안 넘는다).
    expect(stopsBefore(rows(), previous, 2)).toBe(true)
    expect(stopsBefore({ ...rows(), axis: 'columns' }, previous, 2)).toBe(false)
  })

  it('모르는 사다리는 던진다 - 조용한 0은 그대로 기준표가 된다', () => {
    expect(() => ladderPoint('no_such_ladder', 100)).toThrow()
  })

  it('상한 사다리는 전부 그 표시를 달고 온다', () => {
    const limits = ALL_LADDERS.filter((ladder) => ladder.id.startsWith('limit_'))
    expect(limits.length).toBeGreaterThan(0)
    expect(limits.every((ladder) => ladder.findsLimit === true)).toBe(true)
  })
})

/**
 * **하니스가 앱과 같은 절차로 잰다** (2026-09-01 감사 B-4).
 *
 * 한동안 일감 **목록**만 앱 것이고 **재는 절차**는 두 벌이었다 — 감사자가 하니스의
 * `PREDICT_RATIO`를 0.2에서 0.01로 바꾸고 `evaluate`를 지워도 아무것도 안 우는 것을
 * 보였다. 그 갈라짐은 **기기 배수를 통째로 어긋나게 한다**: 기준값을 잰 절차와 앱이
 * 도는 절차가 다르면 나눗셈의 두 항이 다른 것을 잰다.
 */
describe('교정은 앱의 함수로 잰다', () => {
  it('하니스가 앱의 `measureJob`을 그대로 부른다', () => {
    const harness = withoutComments(readFileSync(join(ROOT, 'tools', 'workloads.ts'), 'utf-8'))
    expect(harness).toContain('measureJob(job)')
    // 사다리용 `measure`로 교정을 재면 절차가 다시 갈린다.
    expect(harness).not.toMatch(/measureCalibration[\s\S]{0,200}?\bmeasure\(/)
  })

  it('실제로 돌고 숫자를 준다', () => {
    const job = CALIBRATION[0]
    expect(job).toBeDefined()
    const elapsed = measureCalibration(job!)
    expect(Number.isFinite(elapsed)).toBe(true)
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })
})

/**
 * **R16-B가 안 울린 자리들** (2026-09-01). 전부 "한 줄 지우면 앞 라운드가 잡은 결함이
 * 그대로 돌아온다"는 모양이다.
 */
describe('사다리와 워커의 계약', () => {
  /**
   * **K-평균은 자기 데이터로 재야 한다** (R15-A-1이 잡은 결함, R16-B-1이 되돌아오는 것을
   * 보였다). `run`이 없으면 `measure()`로 가고, 그것은 **군집이 이미 갈린 데이터**에
   * **분류 지표**를 얹는다 — 앱이 하는 일도 기준표를 잰 방식도 아니다.
   *
   * **등록부의 사실이 아니라 일감으로 판정한다.**
   */
  it('K-평균 사다리는 전부 자기 데이터로 잰다', () => {
    const withoutRun = ALL_LADDERS.filter((ladder) => {
      const first = ladder.points[0]
      return (
        first !== undefined && ladder.job(first).algorithm === 'k_means' && ladder.run === undefined
      )
    }).map((ladder) => ladder.id)
    expect(withoutRun, 'k_means ladders must measure with their own data').toEqual([])
  })

  /**
   * **던진 것은 성공으로 안 나간다** (R16-B-2). 워커 안에 있던 동안은 `elapsed: 0`으로
   * 바꿔도 아무것도 안 울었다 — 0ms는 기준표에 들어갈 뿐 아니라 `stopsBefore`의
   * `previous`가 되어 **그 사다리를 맨 위까지 전부 돌게 한다.**
   */
  it('모르는 사다리는 실패로 나간다 - 0ms 성공이 아니다', () => {
    const outcome = benchOutcome({ kind: 'ladder', ladderId: 'no_such_ladder', point: 1 })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toContain('no_such_ladder')
  })

  it('아는 사다리는 시간을 준다', () => {
    const outcome = benchOutcome({ kind: 'ladder', ladderId: 'naive_bayes', point: 100 })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.elapsed).toBeGreaterThanOrEqual(0)
  })

  /**
   * **사다리도 앱의 절차로 잰다** (R16-B-4). R15가 교정 경로만 고쳤더니 병이 사다리로
   * 옮겨 갔다 — `evaluate`를 지우거나 예측 비율을 0.01로 해도 안 울었다.
   */
  it('`measure`가 학습·예측·평가를 다 지나간다', () => {
    const source = readFileSync(join(ROOT, 'tools', 'workloads.ts'), 'utf-8')
    const body =
      /export function measure\(job: Job\): number \{[\s\S]*?\n\}/.exec(source)?.[0] ?? ''
    expect(body, 'measure() not found').not.toBe('')
    expect(body).toMatch(/\bfit\(/)
    expect(body).toMatch(/\bpredict\(/)
    expect(body).toMatch(/\bevaluate\(/)
    expect(body).toContain('PREDICT_RATIO')
  })

  /**
   * **천장 셋의 순서가 규칙이다.** `CEILING_MS`는 기준표용, `PROJECTION_MS`는 다음 점의
   * 어림, `FAILURE_CEILING_MS`는 상한 사다리의 폭주 방지다. 순서가 뒤집히면 각자의 뜻이
   * 사라진다 — 값 자체는 조율이라 못 박지 않는다 (R16-B-C6).
   */
  it('천장 셋의 순서가 뜻과 맞는다', () => {
    expect(CEILING_MS).toBeLessThan(PROJECTION_MS)
    expect(PROJECTION_MS).toBeLessThan(FAILURE_CEILING_MS)
  })

  /**
   * **점은 오름차순이다** (R16-B-C3). 내려가는 점이 섞이면 증가율이 1보다 작아져 어림이
   * 조용히 무력해지고, 첫 점이 0이면 증가율이 `Infinity`다.
   */
  it('사다리의 점이 오름차순이고 0이 없다', () => {
    const wrong = ALL_LADDERS.filter((ladder) =>
      ladder.points.some(
        (point, index) => point <= 0 || (index > 0 && point <= (ladder.points[index - 1] ?? 0)),
      ),
    ).map((ladder) => ladder.id)
    expect(wrong).toEqual([])
  })

  /**
   * **[상한 찾기]의 라벨이 지금 상한을 말한다** (R16-B-3). 사다리가 난 뒤 상한 셋이
   * 올랐는데 라벨은 옛 수를 들고 있었다 — **화면을 보고 "올리면" 실제로는 내리는 것**이다.
   */
  it('상한 사다리의 라벨이 등록부와 같은 수를 말한다', () => {
    const wrong: string[] = []
    for (const ladder of ALL_LADDERS.filter((one) => one.findsLimit)) {
      const said = /지금 ([\d,]+)/.exec(ladder.label)?.[1]?.replaceAll(',', '')
      const first = ladder.points[0]
      if (said === undefined || first === undefined) {
        wrong.push(`${ladder.id}: 라벨에 상한이 없다`)
        continue
      }
      const job = ladder.job(first)
      const dataType =
        job.columns === backboneFor(DEFAULT_BACKBONE_ID)?.embeddingDim ? 'image' : 'tabular'
      const limit = ALGORITHMS.find((one) => one.id === job.algorithm)?.maxRows[dataType].mljs
      if (Number(said) !== limit) wrong.push(`${ladder.id}: 라벨 ${said} · 등록부 ${limit}`)
    }
    expect(wrong).toEqual([])
  })
})
