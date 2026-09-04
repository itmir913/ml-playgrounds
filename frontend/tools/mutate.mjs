/**
 * **돌연변이 카탈로그를 돌린다.** `npm run mutate`.
 *
 * 스물네 라운드가 찾은 것의 핵심은 **"초록불이 거짓"**이었고, 그것을 찾은 유일한 도구는
 * 돌연변이였다. 검사·타입·린트는 저장소에 남지만 **돌연변이는 사람이 심어야 하고, 감사자가
 * 없어지면 아무도 안 심는다.** 그래서 값이 증명된 것들을 데이터로 굳힌다.
 *
 * **항목은 두 종류다** (`expect`, 2026-09-03 R24 재검토).
 *
 * - `"cries"` — **값이 증명된 돌연변이.** 심으면 지목한 스펙이 빨개져야 한다. 조용하면 그
 *   검사가 죽은 것이고 **이 명령이 실패한다.** 감사자가 라운드마다 손으로 심어 "운 것"을
 *   확인하던 표가 여기 산다 — 검사를 고치거나 넓힐 때 원래 잡던 것을 놓치지 않았는지를
 *   이 목록이 대신 본다 (R17이 세 번 밟은 병이다).
 * - `"silent"` — **아직 무검사인 자리.** 조용한 것이 정상이고, 울면 그 자리에 검사가 생긴
 *   것이니 `cries`로 바꾸거나 지운다. 없으면 `silent`로 친다.
 *
 * **빈 `silent` 목록은 아무것도 증명하지 않는다.** "초록불이 참"이 아니라 **아무도 안
 * 심었다**는 뜻이다. 채우는 것은 감사 라운드의 일이다.
 *
 * **관문에 넣지 않는다.** 항목마다 스펙 실행이라 느리다 (`open-decisions.md` #38).
 *
 * **StrykerJS를 안 쓰는 이유도 #38에 있다.** 연산자를 기계적으로 뒤집으면 산지가
 * `tests/`가 되고, 수확은 **"이게 틀리면 학생이 무엇을 잃나"**에서 나온다. 그 문장이
 * 항목마다 `loses`로 붙어 있는 것이 이 목록의 값이다.
 *
 * **되돌리기는 이 스크립트가 보장한다.** 심기 전에 원본 바이트를 들고 있다가 그대로 쓰고,
 * 쓴 뒤 바이트가 같은지 확인한다. 하나라도 어긋나면 **그 자리에서 멈춘다** — 이 저장소가
 * 넓은 되돌리기로 두 번 다쳤다 (`git checkout --`와 개수 제한 없는 `replace`).
 *
 * **앵커의 줄 끝은 파일을 따른다.** 여러 줄 앵커는 `\n`으로 적고, 파일이 CRLF로 체크아웃돼
 * 있으면 그것으로 바꿔 찾는다 — 안 그러면 앵커가 조용히 0번이 되어 명령이 서고, 그 이유를
 * 아무도 못 읽는다.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const CATALOGUE = join(ROOT, 'tools', 'mutants.json')
/**
 * **vitest의 진입 파일을 `node`로 직접 띄운다. `npx`를 안 쓴다.**
 *
 * 여기 있던 것은 `execFileSync('npx.cmd', …)`였고 **이 러너는 그것으로 vitest를 한 번도
 * 못 띄웠다** (2026-09-03 R25 B-1). Node 20.12/22부터 `.cmd`는 셸 없이 못 뜬다 —
 * `spawnSync npx.cmd EINVAL`로 던지는데, 아래 `catch`가 그것을 **"울었다"로 셌다.**
 * 첫 커밋부터 같은 호출이었으므로 **이 기기에서 찍힌 "욺"은 전부 스폰 실패였고**,
 * 서른셋짜리 목록이 1.5초에 끝났다(vitest 한 번이 5초가 넘는다).
 *
 * **셸로 되돌리지 마라** — 인자가 이어 붙으면서 escape가 안 되는 길이 열린다(DEP0190).
 * 진입 파일을 직접 띄우면 셸도 `.cmd`도 필요 없다.
 */
const VITEST = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')

/**
 * vitest를 한 번 돌린다. **울음과 오류를 가른다.**
 *
 * 프로세스가 뜨긴 했는데 실패한 것만 울음이다 — `error.status`가 **숫자**다. 스폰 자체가
 * 실패하면(`EINVAL`·`ENOENT`) `status`가 `null`이고, 그건 검사에 대한 아무 말도 아니다.
 * **그 둘을 뭉갠 것이 B-1이었다.**
 */
function cries(specs) {
  try {
    execFileSync(process.execPath, [VITEST, 'run', ...specs], {
      cwd: ROOT,
      stdio: 'pipe',
      maxBuffer: 64 * 1024 * 1024,
    })
    return { cried: false }
  } catch (error) {
    if (typeof error.status !== 'number') {
      return { cried: false, failure: String(error.code ?? error.message) }
    }
    return { cried: true }
  }
}

const { mutants } = JSON.parse(readFileSync(CATALOGUE, 'utf-8'))
const results = []

for (const [index, mutant] of mutants.entries()) {
  const path = join(ROOT, mutant.file)
  const original = readFileSync(path, 'utf-8')
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const find = mutant.find.replaceAll('\n', eol)
  const replace = mutant.replace.replaceAll('\n', eol)
  const expected = mutant.expect ?? 'silent'

  /**
   * **`cries`인데 무는 스펙을 안 적으면 거절한다** (2026-09-04 R26 B-10).
   *
   * 안 적으면 아래가 스위트 전체를 돌린다 — 그러면 **이 돌연변이가 무엇을 증명하는지
   * 아무도 못 말한다.** 다른 이유로 빨개져도 "욺"으로 찍히고, 항목은 영원히 초록이다.
   */
  if (mutant.expect === 'cries' && !(mutant.expectSpecs?.length > 0)) {
    console.error(`
[${index + 1}] ${mutant.file}
  expect가 'cries'인데 expectSpecs가 비었다.`)
    process.exit(1)
  }

  // **앵커는 정확히 하나여야 한다.** 여럿이면 남의 자리까지 바뀐다.
  const found = original.split(find).length - 1
  if (found !== 1) {
    console.error(`\n[${index + 1}] ${mutant.file}\n  앵커가 ${found}번 나온다 — 하나여야 한다.`)
    process.exit(1)
  }

  // 함수로 넘긴다 — 문자열로 넘기면 `$&` 같은 글자가 치환 무늬로 읽힌다.
  writeFileSync(
    path,
    original.replace(find, () => replace),
    'utf-8',
  )
  const started = Date.now()
  let outcome
  try {
    outcome = cries(mutant.expectSpecs ?? [])
  } finally {
    writeFileSync(path, original, 'utf-8')
    if (readFileSync(path, 'utf-8') !== original) {
      console.error(`\n[${index + 1}] ${mutant.file}\n  되돌리기가 실패했다. 여기서 멈춘다.`)
      process.exit(1)
    }
  }

  // **스폰이 실패하면 그 자리에서 멈춘다.** 검사에 대한 아무 말도 아닌 것을 판정으로
  // 흘려보내면 목록 전체가 거짓이 된다 — 그것이 B-1이었다.
  if (outcome.failure !== undefined) {
    console.error(
      `\n[${index + 1}] ${mutant.file}\n  vitest를 못 띄웠다 (${outcome.failure}). 판정이 아니라 오류다.`,
    )
    process.exit(1)
  }

  const seconds = (Date.now() - started) / 1000
  results.push({ index: index + 1, mutant, expected, cried: outcome.cried, seconds })
  process.stdout.write(
    `[${index + 1}/${mutants.length}] ${outcome.cried ? '욺  ' : '조용'} (기대 ${
      expected === 'cries' ? '욺' : '조용'
    }) ${seconds.toFixed(1)}s ${mutant.file}\n`,
  )
}

const criedCount = results.filter((one) => one.cried).length
const total = results.reduce((sum, one) => sum + one.seconds, 0)
// **경과 시간을 찍는다.** 서른셋이 몇 초면 vitest가 안 뜬 것이다 (B-1).
console.log(
  `\n욺 ${criedCount} · 조용 ${results.length - criedCount} (전체 ${results.length}) · ${total.toFixed(0)}초`,
)

const silent = results.filter((one) => one.expected === 'silent' && !one.cried)
if (silent.length > 0) {
  console.log('\n아직 아무도 안 무는 자리:')
  for (const { index, mutant } of silent) {
    console.log(`  [${index}] ${mutant.file}\n      잃는 것: ${mutant.loses}`)
  }
}

const flipped = results.filter((one) => one.expected === 'silent' && one.cried)
if (flipped.length > 0) {
  console.log('\n검사가 생겼다 — 이 줄들을 "cries"로 바꾸거나 tools/mutants.json에서 지워라:')
  for (const { index, mutant } of flipped) console.log(`  [${index}] ${mutant.file}`)
}

const dead = results.filter((one) => one.expected === 'cries' && !one.cried)
if (dead.length > 0) {
  console.error('\n죽은 검사 — 심었는데 조용하다. 지목한 스펙이 이 자리를 더는 안 문다:')
  for (const { index, mutant } of dead) {
    console.error(`  [${index}] ${mutant.file}\n      잃는 것: ${mutant.loses}`)
  }
  process.exit(1)
}
