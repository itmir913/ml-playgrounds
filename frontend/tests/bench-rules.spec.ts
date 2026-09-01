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

import { sourceFiles } from './fixtures/source'

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')

/** 주석을 걷어낸다. 규칙이 보려는 것은 코드이지 그것을 설명하는 글이 아니다. */
function withoutComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*/g, '')
}

describe('실측 하니스는 배포본에 안 들어간다', () => {
  it('하니스가 제자리에 있다 - 파일이 사라지면 이 검사가 조용히 통과하지 않는다', () => {
    expect(readFileSync(join(ROOT, 'tools', 'bench.html'), 'utf-8')).toContain('./bench.ts')
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
