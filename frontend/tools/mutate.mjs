/**
 * **돌연변이 카탈로그를 돌린다.** `npm run mutate`.
 *
 * 스물네 라운드가 찾은 것의 핵심은 **"초록불이 거짓"**이었고, 그것을 찾은 유일한 도구는
 * 돌연변이였다. 검사·타입·린트는 저장소에 남지만 **돌연변이는 사람이 심어야 하고, 감사자가
 * 없어지면 아무도 안 심는다.** 그래서 값이 증명된 것들을 데이터로 굳힌다.
 *
 * `tools/mutants.json`의 항목은 **심었을 때 조용했던 자리**다. 그러니 이 명령의 기대값은
 * **전부 조용**이고, **항목이 '욺'으로 뒤집히면 그 자리에 검사가 생긴 것이다** — 그때 그
 * 줄을 지운다. 목록이 줄어드는 것이 이 도구가 일하는 모양이고, **비어 있는 것이 정상
 * 상태다** (R24의 일곱은 그 라운드를 닫으며 일곱 다 뒤집혀 지웠다).
 *
 * **빈 목록은 아무것도 증명하지 않는다.** "초록불이 참"이 아니라 **아무도 안 심었다**는
 * 뜻이다. 채우는 것은 감사 라운드의 일이다.
 *
 * **관문에 넣지 않는다.** 항목마다 전체 실행이라 느리다 (`open-decisions.md` #38).
 *
 * **StrykerJS를 안 쓰는 이유도 #38에 있다.** 연산자를 기계적으로 뒤집으면 산지가
 * `tests/`가 되고, 수확은 **"이게 틀리면 학생이 무엇을 잃나"**에서 나온다. 그 문장이
 * 항목마다 `loses`로 붙어 있는 것이 이 목록의 값이다.
 *
 * **되돌리기는 이 스크립트가 보장한다.** 심기 전에 원본 바이트를 들고 있다가 그대로 쓰고,
 * 쓴 뒤 바이트가 같은지 확인한다. 하나라도 어긋나면 **그 자리에서 멈춘다** — 이 저장소가
 * 넓은 되돌리기로 두 번 다쳤다 (`git checkout --`와 개수 제한 없는 `replace`).
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const CATALOGUE = join(ROOT, 'tools', 'mutants.json')

/** vitest를 한 번 돌리고 **울었는지**만 돌려준다. */
function cries(specs) {
  try {
    // **셸을 안 쓴다.** 인자가 이어 붙으면서 escape가 안 되는 길이 열린다 (DEP0190).
    execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vitest', 'run', ...specs], {
      cwd: ROOT,
      stdio: 'pipe',
    })
    return false
  } catch {
    return true
  }
}

const { mutants } = JSON.parse(readFileSync(CATALOGUE, 'utf-8'))
const results = []

for (const [index, mutant] of mutants.entries()) {
  const path = join(ROOT, mutant.file)
  const original = readFileSync(path, 'utf-8')

  // **앵커는 정확히 하나여야 한다.** 여럿이면 남의 자리까지 바뀐다.
  const found = original.split(mutant.find).length - 1
  if (found !== 1) {
    console.error(`\n[${index + 1}] ${mutant.file}\n  앵커가 ${found}번 나온다 — 하나여야 한다.`)
    process.exit(1)
  }

  writeFileSync(path, original.replace(mutant.find, mutant.replace), 'utf-8')
  let cried
  try {
    cried = cries(mutant.expectSpecs ?? [])
  } finally {
    writeFileSync(path, original, 'utf-8')
    if (readFileSync(path, 'utf-8') !== original) {
      console.error(`\n[${index + 1}] ${mutant.file}\n  되돌리기가 실패했다. 여기서 멈춘다.`)
      process.exit(1)
    }
  }

  results.push({ index: index + 1, mutant, cried })
  process.stdout.write(
    `[${index + 1}/${mutants.length}] ${cried ? '욺  ' : '조용'} ${mutant.file}\n`,
  )
}

const silent = results.filter((one) => !one.cried)
console.log(
  `\n조용 ${silent.length} · 욺 ${results.length - silent.length} (전체 ${results.length})`,
)

if (silent.length > 0) {
  console.log('\n아직 아무도 안 무는 자리:')
  for (const { index, mutant } of silent) {
    console.log(`  [${index}] ${mutant.file}\n      잃는 것: ${mutant.loses}`)
  }
}

const cried = results.filter((one) => one.cried)
if (cried.length > 0) {
  console.log('\n검사가 생겼다 — 이 줄들을 tools/mutants.json에서 지워라:')
  for (const { index, mutant } of cried) console.log(`  [${index}] ${mutant.file}`)
}
