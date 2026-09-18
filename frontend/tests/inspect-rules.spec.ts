/**
 * **점검 경로가 지켜야 하는 것 둘** — 읽기 전용이고, 학습의 사본을 두지 않는다.
 *
 * 둘 다 **눈으로는 안 보이는 규칙이다.** 쓰기 한 줄이 섞여도 화면은 멀쩡히 돌고, 계산을
 * 한 벌 더 지어도 그날은 같은 숫자가 나온다 — 갈라지는 것은 학습이 다음에 움직일 때다.
 * 실제로 두 번 그랬다: 채점이 `predictBatch ?? predict`로 바뀔 때도, 학습에 풀이 붙을
 * 때도 재실행만 안 따라갔다 (open-decisions.md "재실행은 학습 경로를 그대로 탄다").
 *
 * **화면이 생기면 `INSPECT`에 그 디렉터리를 더한다** (계획 2단계). 규칙은 그대로다.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { withoutComments } from './fixtures/source'

const SRC = join(process.cwd(), 'src')

/** 점검이 사는 자리. 화면은 2단계에서 `views/inspect`로 온다. */
const INSPECT: readonly string[] = [join(SRC, 'ml', 'reproduce.ts'), join(SRC, 'views', 'inspect')]

function sourcesOf(path: string): string[] {
  if (!existsSync(path)) return []
  if (!statSync(path).isDirectory()) return [path]
  return readdirSync(path).flatMap((entry) => sourcesOf(join(path, entry)))
}

const FILES = INSPECT.flatMap(sourcesOf).filter(
  (path) => path.endsWith('.ts') || path.endsWith('.vue'),
)

/** 주석을 뺀 본문. **주석이 규칙을 가리키는 것은 옳은 일이다.** */
function body(path: string): string {
  return withoutComments(readFileSync(path, 'utf-8')).join(String.fromCharCode(10))
}

describe('점검 경로', () => {
  /** 훑을 파일이 실제로 있어야 한다. 0개면 판정이 썩은 것이지 규칙이 지켜진 게 아니다. */
  it('검사할 파일을 실제로 찾는다', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(1)
  })

  /**
   * **원본 `.mlpx`를 고칠 길을 안 만든다** (open-decisions.md "점검은 읽기 전용
   * 열람기다"의 "원본을 고칠 길을 안 만든다").
   *
   * **금지는 모듈이 아니라 이름이다.** 읽기와 쓰기가 한 모듈에 사는 자리가 둘이라
   * (`readProject`/`writeProject`, `readFileBytes`/`downloadBlob`) 모듈로 막으면
   * 점검이 파일을 못 읽는다.
   */
  const FORBIDDEN: readonly string[] = [
    'writeProject',
    'downloadBlob',
    'downloadBytes',
    'project/storage',
    'stores/project',
    'tab-lock',
  ]

  for (const path of FILES) {
    it(`${path.slice(SRC.length + 1)}가 쓰는 길을 안 연다`, () => {
      const source = body(path)
      for (const name of FORBIDDEN) expect(source, name).not.toContain(name)
      // **네임스페이스 임포트도 막는다** — `import * as format`으로 들이면 이름이 안 보인다.
      expect(source).not.toMatch(/import\s+\*\s+as/)
    })
  }

  /**
   * **학습의 사본을 두지 않는다.** 여기 있는 이름들은 전부 "다시 계산한다"는 뜻이고,
   * 그것이 `runExperiment` 밖에서 한 벌 더 생기는 순간 재실행이 다시 뒤처지기 시작한다.
   *
   * **등록부를 읽는 것은 사본이 아니다** — `engineFor(id)?.engine`처럼 "무엇이 있는가"를
   * 묻는 조회는 계산이 아니라서 막지 않는다. 막는 것은 **부름**이다.
   */
  const COMPUTE: readonly string[] = [
    '.fit(',
    'evaluate(',
    'evaluateCluster(',
    'fitPreprocessor(',
    'transform(',
    'splitRows(',
    'sampleRows(',
    'planRun(',
  ]

  /**
   * **계산이 사는 모듈은 아예 안 들인다.** 부름만 보면 `const run = evaluate`처럼 이름을
   * 옮겨 담아 빠져나갈 수 있고, 무엇보다 **들이지 않으면 부를 수가 없다.**
   *
   * `./plan`은 예외다 — 조립이 기록된 분할을 만들 때 그 브랜드를 쓴다(계산이 아니다).
   */
  const COMPUTE_MODULES: readonly string[] = ['/metrics', '/split', '/sample', '/models']

  for (const path of FILES) {
    it(`${path.slice(SRC.length + 1)}가 학습을 다시 짓지 않는다`, () => {
      const source = body(path)
      for (const call of COMPUTE) expect(source, call).not.toContain(call)
      for (const line of source.split(String.fromCharCode(10))) {
        if (!line.trimStart().startsWith('import')) continue
        for (const module of COMPUTE_MODULES) expect(line, module).not.toContain(module)
      }
      // **저장된 모델로 채점하는 것은 다른 층이다** (위 `/models`). 열어 두면 "담긴
      // 모델이 그 숫자를 내는가"라는 다른 질문이 이 파일에 섞인다.
      // 검사용 훅으로 다른 등록부를 넣으면 대조가 다른 세상을 돈다.
      expect(source).not.toMatch(/algorithms\s*:/)
      // 동적 임포트로 위의 전부를 우회할 수 있다.
      expect(source).not.toMatch(/\bimport\s*\(/)
    })
  }

  /**
   * **규칙이 실제로 무는지 확인한다.** 이 저장소는 "0개를 찾았다"로 초록인 검사를
   * 여러 번 만났다.
   */
  it('그 규칙들이 실제로 문다', () => {
    const sample = "import { writeProject } from '@/project/format'"
    expect(FORBIDDEN.some((name) => sample.includes(name))).toBe(true)
    expect(COMPUTE.some((call) => 'const again = evaluate(taskType, y, p)'.includes(call))).toBe(
      true,
    )
    // 주석은 안 본다 - 규칙을 가리키는 주석까지 물면 그 주석을 못 쓰게 된다.
    expect(withoutComments('// writeProject를 부르지 마라').join('')).not.toContain('writeProject')
  })
})
