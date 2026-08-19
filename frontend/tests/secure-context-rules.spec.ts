/**
 * **보안 컨텍스트에서만 있는 API를 쓰지 않는다.**
 *
 * 공식 배포는 GitHub Pages라 https지만, 이 앱이 도는 곳은 거기만이 아니다 —
 * **자가호스팅한 학교는 대개 `http://192.168.x.x`로 접속한다**(CLAUDE.md §1.1의 두 번째
 * 배포 경로). 거기서는 `window.isSecureContext`가 false이고, 그 조건에 걸린 API는
 * 존재 자체가 없어져 부르는 순간 `undefined is not a function`으로 죽는다.
 *
 * **실제로 그렇게 나갔다** (2026-08-14). `crypto.randomUUID()`로 프로젝트 id를 만들고
 * 있었는데, 아이폰에서 개발 서버(`http://192.168.x.x:5173`)로 들어가니 **새 프로젝트를
 * 만드는 첫 동작이 그 자리에서 죽었다.** 개발 PC의 localhost는 보안 컨텍스트라
 * 데스크톱에서는 한 번도 안 보였다 — 이 검사가 필요한 이유가 그것이다.
 *
 * `hash.ts`는 같은 판단을 이미 해 두었다(`crypto.subtle`을 버리고 라이브러리를 넣은
 * 것). 결정은 있는데 그것을 지키는 장치가 없어서 옆에서 새 것이 들어왔다.
 *
 * ---
 *
 * **이 검사가 못 보는 것을 밝혀 둔다.**
 *
 * - **여기 적힌 둘만 본다.** 보안 컨텍스트 전용 API는 더 있다 —
 *   `navigator.clipboard`, 서비스 워커, `showSaveFilePicker`. 지금 쓰는 곳이 없고
 *   대체 수단도 정해진 것이 없어 규칙으로 세우지 않았다. **쓰게 되는 날 http에서
 *   먼저 확인하고 여기 한 줄을 더해라.**
 * - **`navigator.storage`는 대상이 아니다.** 그것도 보안 컨텍스트 전용이지만
 *   `project/storage.ts`가 이미 없을 때를 다루고 있고(`?.`), 없으면 여유 공간 확인을
 *   건너뛸 뿐 저장은 그대로 된다.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { withoutComments } from './fixtures/source'

const SRC = join(process.cwd(), 'src')
if (!existsSync(SRC)) throw new Error(`src를 찾지 못했다: ${SRC}`)

interface Rule {
  readonly name: string
  readonly why: string
  readonly pattern: RegExp
  readonly violations: readonly string[]
  readonly allowed: readonly string[]
}

const RULES: readonly Rule[] = [
  {
    name: 'crypto.subtle을 쓰지 않는다',
    why: '해시는 `hash.ts` 하나를 지난다. http로 띄운 학교에서만 해시가 없는 상태를 만들지 않는다.',
    pattern: /\bcrypto\s*\.\s*subtle\b/,
    violations: [
      'const digest = await crypto.subtle.digest("SHA-256", bytes)',
      'if (crypto.subtle) return webHash(bytes)',
    ],
    allowed: [
      'return bytesToHex(sha256(bytes))',
      // 이름이 겹치는 우리 값은 상관없다.
      'const subtle = options.subtle ?? false',
    ],
  },
  {
    name: 'crypto.randomUUID을 쓰지 않는다',
    why: '`project/create.ts`의 `newProjectId()`가 같은 모양의 값을 보안 컨텍스트 없이 만든다.',
    pattern: /\bcrypto\s*\.\s*randomUUID\b/,
    violations: ['projectId: crypto.randomUUID(),', 'const id = globalThis.crypto.randomUUID()'],
    allowed: [
      'projectId: newProjectId(),',
      // getRandomValues는 보안 컨텍스트를 안 따진다. 이것이 대체 수단이다.
      'const bytes = crypto.getRandomValues(new Uint8Array(16))',
      'return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0',
    ],
  },
]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|vue)$/.test(entry) && !/\.spec\.ts$/.test(entry) ? [path] : []
  })
}

describe('검사기가 실제로 잡는다', () => {
  for (const rule of RULES) {
    describe(rule.name, () => {
      for (const line of rule.violations) {
        it(`위반을 잡는다: ${line.trim()}`, () => {
          expect(rule.pattern.test(line)).toBe(true)
        })
      }
      for (const line of rule.allowed) {
        it(`정상을 안 잡는다: ${line.trim()}`, () => {
          expect(rule.pattern.test(line)).toBe(false)
        })
      }
    })
  }

  it('주석은 걷어낸다 - 왜 안 쓰는지를 적으려면 그 이름을 적어야 한다', () => {
    const source = [
      '// crypto.randomUUID은 보안 컨텍스트 전용이다',
      'const id = newProjectId()',
    ].join('\n')
    expect(withoutComments(source).join('\n').trim()).toBe('const id = newProjectId()')
  })
})

describe('지금 소스에 위반이 없다', () => {
  /** **빈 목록에서 조용히 통과하지 않는다** (`limits-rules.spec.ts`와 같은 이유). */
  it('훑을 파일을 실제로 찾는다', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(0)
  })

  for (const rule of RULES) {
    it(rule.name, () => {
      const found: string[] = []
      for (const path of sourceFiles(SRC)) {
        withoutComments(readFileSync(path, 'utf-8')).forEach((line, index) => {
          if (rule.pattern.test(line)) {
            found.push(`${path.slice(SRC.length + 1)}:${index + 1}  ${line.trim()}`)
          }
        })
      }
      expect(found).toEqual([])
    })
  }
})
