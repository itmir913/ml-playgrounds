/**
 * **`gate.yml`이 동시에 돌리는 조각이 `npm run ci`가 잇는 조각과 같다**
 * (`docs/open-decisions.md` "관문은 npm run ci 하나다"의 2026-10-22 개정).
 *
 * 정의는 `ci` 하나이고 CI는 그 조각을 matrix로 나눠 돈다. 한쪽에만 조각을 더하면 그 검사가
 * **push 관문에서만 조용히 빠지거나**, 로컬에서는 안 도는 검사가 CI에만 생긴다.
 *
 * **필수 체크 `Gate / Frontend`가 조각 실패에 빨개지는지도 본다.** 집계 잡이 `needs`만
 * 걸고 `if: always()`가 없으면 조각이 실패할 때 건너뛰어지고, 필수 체크는 건너뛴 잡을
 * 통과로 친다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
  scripts: Record<string, string>
}
const gate = readFileSync(join(process.cwd(), '..', '.github', 'workflows', 'gate.yml'), 'utf-8')

/** `ci`가 `&&`로 잇는 `npm run <조각>`들. 다른 모양이 섞이면 그 자리를 그대로 남긴다. */
function ciPieces(): string[] {
  return (pkg.scripts.ci ?? '').split('&&').map((part) => part.trim().replace(/^npm run /, ''))
}

/** `frontend:` 잡의 본문 — 다음 최상위 잡이나 파일 끝까지. */
function frontendJob(): string {
  const start = gate.indexOf('\n  frontend:\n')
  expect(start, 'gate.yml has a frontend job').toBeGreaterThan(-1)
  const rest = gate.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

describe('관문 조각', () => {
  it('ci는 ci: 조각만 잇는다', () => {
    for (const piece of ciPieces()) {
      expect(piece, `ci chains only ci: pieces (got "${piece}")`).toMatch(/^ci:[\w-]+$/)
      expect(pkg.scripts[piece], `script ${piece} exists`).toBeDefined()
    }
  })

  it('gate.yml의 matrix가 ci의 조각과 같은 순서로 같다', () => {
    const m = gate.match(/^ {8}piece: \[([^\]]*)\]$/m)
    expect(m, 'gate.yml declares matrix.piece as a flow list').not.toBeNull()
    const matrix = (m?.[1] ?? '').split(',').map((s) => s.trim())
    expect(matrix, 'gate.yml matrix.piece equals the pieces npm run ci chains').toEqual(ciPieces())
  })

  it('필수 체크 Frontend는 조각 결과를 직접 보고 늘 돈다', () => {
    const job = frontendJob()
    expect(job, 'frontend job keeps the required-check name').toMatch(/^ {4}name: Frontend$/m)
    expect(job, 'frontend job waits for the pieces').toMatch(/^ {4}needs: piece$/m)
    expect(job, 'frontend job runs even when a piece fails').toMatch(/^ {4}if: always\(\)$/m)
    expect(job, 'frontend job fails unless the pieces succeeded').toMatch(
      /needs\.piece\.result[\s\S]*= "success"/,
    )
  })
})
