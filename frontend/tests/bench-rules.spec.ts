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
import { ALL_LADDERS } from '../tools/workloads'

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

  it('그 규칙이 실제로 문다 - 없는 칸을 있다고 하지 않는다', () => {
    expect(covers('없는_알고리즘', 'tabular')).toBe(false)
    expect(covers('linear_regression', 'image')).toBe(false)
  })
})
