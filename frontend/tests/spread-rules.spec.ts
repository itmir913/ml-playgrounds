/**
 * **행 규모 배열을 함수 인자로 펼치지 않는다** (2026-09-01 감사 A-1·A-2).
 *
 * `push(...배열)`과 `Math.min(...배열)`은 배열을 **통째로 함수 인자**로 만든다. V8이 받는
 * 인자 수는 스택 크기가 정하고, 브라우저 주 스레드(약 1MB)에서는 **12만 개 언저리가
 * 절벽**이다 — 이 기기에서 12만 `ok` · 12만5천 `RangeError`로 쟀다. 그 위는
 * `RangeError: Maximum call stack size exceeded`이고, Vue `computed` 안에서 터지면
 * `ml/plan.ts`의 `catch`가 `ClientError`만 사유로 바꾸므로 **사유 없는 죽은 화면**이 된다.
 *
 * **상한 해제가 그 자리를 열었다** (`limits-switch.ts`). 켜 두어도 멀지 않다 — 데이터셋
 * 천장이 10만이고 `testSize`를 0.05로 두면 훈련 몫이 9만5천이다. **그리고 임계값은 호출
 * 스택이 깊을수록 낮아진다.**
 *
 * ---
 *
 * **왜 값이 아니라 표기를 보는가.** 이 저장소의 vitest는 `pool: 'threads'`이고 Node
 * worker_thread의 기본 스택은 **4MB**다 — 브라우저 주 스레드의 네 배다. 그래서 같은
 * 코드가 러너에서는 30만 행까지 초록이고 `--pool=forks`에서는 18만에서 빨강이다.
 * **스택을 태우는 병은 이 관문이 구조적으로 못 본다**(감사 C-5). 값으로 물 수 없으니
 * 표기를 문다.
 *
 * **못 보는 것**: 스프레드를 변수로 우회하는 것(`const args = [...rows]; f(...args)`),
 * 그리고 `apply(null, 배열)`. 둘 다 지금 저장소에 없고, 이 규칙은 **흔한 쪽**을 막는다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { sourceFiles, withoutComments } from './fixtures/source'

const SRC = join(process.cwd(), 'src')

/** `f(...무엇)` 꼴. 배열 리터럴을 펼치는 것(`[...a, ...b]`)은 인자가 아니라 요소다. */
const SPREAD_ARGUMENT = /\.(?:push|unshift|concat)\s*\(\s*\.\.\.|Math\.(?:min|max)\s*\(\s*\.\.\./

/**
 * **여기 있는 것은 행 규모가 아니라고 사람이 판정한 자리다.** 새로 더할 때는 **무엇의
 * 개수인지**를 적어라 — 그 수가 상한 해제로 열리는 축이면 여기 올 자리가 아니다.
 *
 * 판정 근거는 전부 "상한을 꺼도 이 수는 안 커진다"이다.
 */
const ALLOWED = new Map<string, string>([
  ['ml/engines/pyodide-sklearn.ts', '하이퍼파라미터 이름 몇 개. 등록부가 정하는 고정 목록이다'],
  ['ml/metrics.ts', '지표 이름의 개수. 등록부가 정한다'],
  ['ml/parameters.ts', '범주(클래스) 수. 타깃이 정하고 상한이 따로 있다'],
  ['ml/results.ts', '한 지표의 실험별 값. 실험 수는 학생이 손으로 만든다'],
])

describe('행 규모 배열을 인자로 펼치지 않는다', () => {
  const offenders = sourceFiles(SRC)
    .map((path) => ({
      where: path
        .slice(SRC.length + 1)
        .split('\\')
        .join('/'),
      hit: SPREAD_ARGUMENT.test(withoutComments(readFileSync(path, 'utf-8')).join('\n')),
    }))
    .filter((one) => one.hit)
    .map((one) => one.where)

  it('훑을 파일을 실제로 찾는다', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(50)
  })

  it('검사기가 실제로 잡는다', () => {
    for (const line of [
      'trainIndices.push(...order.slice(take))',
      'const low = Math.min(...values)',
      'answers.push(...(await ensurePage(index)))',
      'names.concat(...groups)',
    ]) {
      expect(SPREAD_ARGUMENT.test(line), line).toBe(true)
    }
  })

  it('검사기가 정상을 안 잡는다', () => {
    for (const line of [
      'const merged = [...left, ...right]',
      'for (const row of rows) target.push(row)',
      'appendAll(trainIndices, order, take, order.length)',
      'const sorted = [...values].sort(ascending)',
    ]) {
      expect(SPREAD_ARGUMENT.test(line), line).toBe(false)
    }
  })

  it('허용한 자리 밖에서는 펼치지 않는다', () => {
    expect(offenders.filter((where) => !ALLOWED.has(where))).toEqual([])
  })

  /**
   * **허용 목록이 실재하는 자리를 가리키는가.** 안 그러면 다음 사람이 그 파일을 고친
   * 뒤에도 목록만 남아 "여기는 봤다"고 거짓말한다.
   */
  it('허용한 자리가 실제로 그 자리에 있다', () => {
    expect([...ALLOWED.keys()].filter((where) => !offenders.includes(where))).toEqual([])
  })
})
