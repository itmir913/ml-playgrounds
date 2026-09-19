/**
 * Pyodide 배포판의 **자물쇠 파일을 받아 원격을 감시한다.** 산출물에 넣는 장치가 아니다.
 *
 * **27.3MB는 학생 브라우저가 원본에서 직접 받는다** (`open-decisions.md`
 * "scikit-learn(Pyodide)은 원본에서 받고, 시동은 학습마다 낸다"). 우리 Pages로 서빙하면
 * 한 반 한 차시가 820MB이고, 컴퓨터실 PC는 리셋을 전제라 캐시가 차시마다 사라진다.
 *
 * **그래서 여기서 받는 것은 119KB짜리 `pyodide-lock.json` 하나다.** 휠은 안 받는다 —
 * **그 파일이 휠 스물몇 개의 sha256을 들고 있어서** 하나만 지키면 전부를 지킨다.
 *
 * **무엇을 막는가.** 배포판 주소는 버전이 박혀 있어 불변이어야 하지만, 그것은 CDN의
 * 약속이지 우리가 확인한 사실이 아니다. 원격이 조용히 바뀌면 **학생 파일의
 * `run.engine.version`이 가리키는 것이 달라지고, 그 순간 재현 가능성이 무너진다.**
 * 학생 브라우저는 해시를 확인하지 않으므로 **그 순간을 잡는 자리가 여기뿐이다.**
 *
 * **그리고 우리가 문서에 적은 버전이 실제와 같은지도 여기서 본다.** `sklearn 1.8.0`은
 * 우리가 적은 말이고, 이 스크립트는 **락 파일이 그렇게 말하는지**를 묻는다.
 *
 * 이미 받아 둔 파일은 해시만 확인하고 넘어간다. 네트워크를 매번 타지 않는다
 * (`fetch-backbone.mjs`와 같은 규칙이고, GitHub Actions는 캐시 없이 시작하므로 거기서는
 * 언제나 실제로 받는다).
 *
 * **아무 말도 안 하는 것이 정상이다.** 말은 영어다 — 이 출력은 학생이 아니라 이 저장소를
 * 빌드하는 사람이 본다.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, '..', '.cache', 'pyodide')

/**
 * **`src/ml/engines/pyodide-runtime.ts`의 `PYODIDE_VERSION`과 같아야 한다.**
 *
 * 베끼는 이유는 이 파일이 `.mjs`라 타입스크립트를 못 들여오기 때문이다
 * (`fetch-backbone.mjs`가 백본 주소를 베끼는 것과 같은 사정). **두 값이 같은 말을 하는지는
 * `tests/pyodide-runtime.spec.ts`가 문다** — 갈리면 우리는 A를 감시하고 학생은 B를 받는다.
 */
const VERSION = '314.0.7'

const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/`

/** 락 파일 자체의 해시. **이 한 줄이 휠 전부를 덮는다.** */
const LOCK_SHA256 = '5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010'

/**
 * 락 파일이 말해야 하는 것. **우리 문서와 주석이 적은 버전이 이것이다.**
 *
 * 값을 여기 적는 이유는 **해시가 바뀌는 날 무엇이 바뀌었는지 사람이 읽을 수 있어야**
 * 하기 때문이다 — 해시만 있으면 "달라졌다"까지만 알고, 무엇이 달라졌는지는 다시 받아
 * 눈으로 봐야 한다.
 */
const EXPECTED = {
  python: '3.14.2',
  'scikit-learn': '1.8.0',
  numpy: '2.4.6',
  scipy: '1.18.0',
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function readIfPresent(path) {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}

async function fetchFile(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** 락 파일이 말하는 버전들. **우리가 아니라 그쪽이 답하는 값이다.** */
function versionsOf(bytes) {
  const lock = JSON.parse(bytes.toString('utf-8'))
  const found = { python: lock.info?.python }
  for (const name of ['scikit-learn', 'numpy', 'scipy']) {
    found[name] = lock.packages?.[name]?.version
  }
  return found
}

const path = join(OUT_DIR, 'pyodide-lock.json')
await mkdir(OUT_DIR, { recursive: true })

const present = await readIfPresent(path)
let bytes = present
if (present === null || sha256(present) !== LOCK_SHA256) {
  console.log(`Fetching Pyodide lock file: v${VERSION}`)
  bytes = await fetchFile(`${INDEX_URL}pyodide-lock.json`)
  const actual = sha256(bytes)
  if (actual !== LOCK_SHA256) {
    throw new Error(
      `Pyodide lock hash mismatch: v${VERSION}\n` +
        `  expected: ${LOCK_SHA256}\n  actual:   ${actual}\n` +
        `  The remote distribution changed. Do not ship this build until you know why —\n` +
        `  student files record the engine version and reruns are checked against it.`,
    )
  }
  await writeFile(path, bytes)
}

const versions = versionsOf(bytes)
const wrong = Object.entries(EXPECTED)
  .filter(([name, version]) => versions[name] !== version)
  .map(
    ([name, version]) => `  ${name}: expected ${version}, lock says ${versions[name] ?? '(none)'}`,
  )
if (wrong.length > 0) {
  throw new Error(
    `Pyodide distribution does not carry what we documented:\n${wrong.join('\n')}\n` +
      `  Update src/ml/engines/pyodide-runtime.ts and the decision record together.`,
  )
}
