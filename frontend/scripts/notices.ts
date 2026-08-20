/**
 * **나가는 산출물에 남의 고지를 함께 굽는다** (`open-decisions.md` "나눠 주는 남의
 * 코드는 산출물이 세어서 고지한다").
 *
 * MIT·ISC·BSD는 저작권 표시와 허가문이 **사본에 함께 갈 것**을 조건으로 걸고,
 * Apache-2.0은 라이선스 사본 동봉을, OFL-1.1은 글꼴과 함께 라이선스를 동봉할 것을
 * 요구한다. 그런데 **번들러는 배너 주석을 지운다** — 2026-08-20에 `dist/`를 훑으니
 * `Evan You`도 `Chart.js`도 `Matthew Holt`도 한 글자가 없었다. 그래서 여기가 필요하다.
 *
 * **목록을 손으로 적지 않는다.** 빌드가 **실제로 산출물에 들어간 모듈**을 세므로,
 * 의존성이 늘면 고지가 저절로 따라오고 안 쓰게 된 것은 저절로 빠진다. 손으로 적은
 * 목록은 반드시 어긋나고, 빠진 줄은 아무도 안 본다.
 *
 * **못 세는 것 둘을 저장소가 채운다.**
 *
 * 1. **전문을 안 들고 오는 패키지.** `@tensorflow/tfjs-*` 여섯은 npm 패키지에 LICENSE
 *    파일이 아예 없다 — 번들에 남은 고지가 "See the LICENSE file."이라 **없는 파일을
 *    가리킨다.** 그런 것들은 `licenses/`가 전문을 갖는다(`SUPPLIED`).
 * 2. **미리 빌드된 번들이 업고 오는 것.** `exceljs`의 브라우저 진입점은 이미 묶인
 *    파일이라 그 안의 68개가 모듈 그래프에 안 잡힌다. 그쪽은 묶음 하나를 통째로
 *    싣는다(`BUNDLED_INSIDE`). 그 목록이 실제와 같은지는 `tests/notices.spec.ts`가 문다.
 *
 * **전문을 못 찾으면 빌드가 선다.** 조용히 빠지는 길을 두지 않는다.
 *
 * **워커도 센다.** `embed.worker`는 별도의 rollup 빌드라 본 빌드의 그래프에 없는데,
 * 하필 TensorFlow.js가 통째로 거기 있다. `worker.plugins`에도 같은 수집기를 걸고
 * (`vite.config.ts`), 본 빌드의 `generateBundle`에서 합쳐 굽는다 — 워커 빌드는 그것을
 * 부르는 모듈을 변환할 때 끝나므로 본 빌드보다 먼저 센다.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Plugin } from 'vite'

const HERE = dirname(fileURLToPath(import.meta.url))
const NODE_MODULES = join(HERE, '..', 'node_modules')

/** 저장소가 채운 전문들이 사는 곳. */
export const SUPPLIED_DIR = join(HERE, 'licenses')

/** 산출물에 굽는 이름. `README.md`가 이 이름으로 가리킨다. */
export const NOTICES_FILE = 'third-party-notices.txt'

/**
 * **패키지가 전문을 안 들고 올 때 저장소가 채우는 것.** 값은 `licenses/`의 파일 이름이다.
 *
 * **패키지 것이 언제나 먼저다.** 여기 있는 이름이 스스로 전문을 들고 오기 시작하면
 * 이 줄은 죽은 줄이 되고, `tests/notices.spec.ts`가 그것을 잡는다.
 */
export const SUPPLIED: Readonly<Record<string, string>> = {
  '@tensorflow/tfjs-backend-cpu': 'tensorflow-tfjs.txt',
  '@tensorflow/tfjs-backend-wasm': 'tensorflow-tfjs.txt',
  '@tensorflow/tfjs-backend-webgl': 'tensorflow-tfjs.txt',
  '@tensorflow/tfjs-backend-webgpu': 'tensorflow-tfjs.txt',
  '@tensorflow/tfjs-converter': 'tensorflow-tfjs.txt',
  '@tensorflow/tfjs-core': 'tensorflow-tfjs.txt',
  'median-quickselect': 'median-quickselect.txt',
  pretendard: 'pretendard.txt',
  seedrandom: 'seedrandom.txt',
}

/**
 * **자기 안에 남의 코드를 구워 넣고 오는 패키지.** 값은 `licenses/`의 묶음 파일이다.
 *
 * 그 안의 이름들은 모듈 그래프에 안 잡힌다 — 우리 번들러가 보는 것은 이미 묶인 파일
 * 하나뿐이기 때문이다. 묶음 파일이 그것들의 고지를 통째로 갖는다.
 */
export const BUNDLED_INSIDE: Readonly<Record<string, string>> = {
  exceljs: 'exceljs-bundled.txt',
}

/**
 * **고지에 적는 미리 학습된 모델.** 우리가 서빙하지 않지만 적는다 — 재배포 여부와
 * "학생이 무엇 위에서 학습하는가"는 다른 질문이다.
 *
 * **원본은 `src/ml/backbones.ts`의 `credit`이고 여기는 그것을 베낀 것이다.**
 * 베끼는 이유는 하나뿐이다 — vite 설정이 물고 들어가는 파일은 상대 경로에 확장자가
 * 있어야 하는데(`configLoader: 'native'`), `src/` 전체에 확장자를 붙일 수는 없다.
 * **두 목록이 같은 말을 하는지는 `tests/notices.spec.ts`가 문다.**
 */
export const MODELS: readonly {
  readonly id: string
  readonly holder: string
  readonly license: string
  readonly url: string
}[] = [
  {
    id: 'mobilenet-v2-r2',
    holder: 'Google LLC (tfjs-models)',
    license: 'Apache-2.0',
    url: 'https://storage.googleapis.com/tfjs-models/savedmodel/mobilenet_v2_1.0_224/model.json',
  },
]

/** 산출물에 들어간 패키지 하나. */
export interface Shipped {
  readonly name: string
  /** `package.json`의 값. 못 읽으면 `null`이고, 그때는 이름만 적는다. */
  readonly version: string | null
  /** `package.json`이 선언한 SPDX 표기. 전문과 맞는지는 기계가 못 본다. */
  readonly spdx: string | null
  /** 라이선스 전문. 패키지 것이 먼저고, 없으면 `SUPPLIED`가 채운다. */
  readonly text: string
}

/**
 * 모듈 id에서 패키지 이름을 뽑는다. `node_modules` 밖이면 `null`이다.
 *
 * **마지막 `node_modules`를 본다** — 중첩 설치(`a/node_modules/b`)에서는 안쪽이 답이다.
 *
 * **앞의 빗금을 요구하지 않는다.** 청크의 모듈은 절대 경로로 오는데 **자산의
 * `originalFileNames`는 프로젝트 상대 경로**라 `node_modules/`로 시작한다. 빗금을
 * 요구했다가 글꼴(Pretendard)이 통째로 빠졌다 — 그 자리가 OFL-1.1이라 가장 또렷한
 * 위반이었는데도 목록은 조용히 48개로 맞아 보였다.
 */
export function packageFromId(id: string): string | null {
  const marker = 'node_modules/'
  const path = id.split('\\').join('/')
  const at = path.lastIndexOf(marker)
  if (at === -1) return null
  if (at > 0 && path[at - 1] !== '/') return null
  const parts = path.slice(at + marker.length).split('/')
  const first = parts[0]
  if (first === undefined || first === '' || first.startsWith('.')) return null
  if (!first.startsWith('@')) return first
  const second = parts[1]
  return second === undefined ? null : `${first}/${second}`
}

function licenseFileIn(dir: string): string | null {
  if (!existsSync(dir)) return null
  const name = readdirSync(dir).find((entry) => /^(licen[cs]e|copying)/i.test(entry))
  return name === undefined ? null : readFileSync(join(dir, name), 'utf8')
}

/** 줄바꿈을 LF로 눕히고 앞뒤를 턴다. 윈도우에서 받은 파일이 섞인다. */
function tidy(text: string): string {
  return text.split('\r\n').join('\n').trim()
}

/**
 * 패키지 하나를 읽는다. **전문이 없으면 던진다** — 부르는 쪽이 빌드를 세운다.
 */
export function readShipped(name: string): Shipped {
  const dir = join(NODE_MODULES, ...name.split('/'))
  const manifest = join(dir, 'package.json')
  let version: string | null = null
  let spdx: string | null = null
  if (existsSync(manifest)) {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
      version?: unknown
      license?: unknown
    }
    version = typeof parsed.version === 'string' ? parsed.version : null
    spdx = typeof parsed.license === 'string' ? parsed.license : null
  }

  const own = licenseFileIn(dir)
  const supplied = SUPPLIED[name]
  const text =
    own ?? (supplied === undefined ? null : readFileSync(join(SUPPLIED_DIR, supplied), 'utf8'))
  if (text === null) {
    throw new Error(
      `No license text for "${name}". Put the upstream text in frontend/scripts/licenses/ ` +
        `and register it in SUPPLIED (frontend/scripts/notices.ts). ` +
        `Shipping the code without its notice breaks the license.`,
    )
  }
  return { name, version, spdx, text: tidy(text) }
}

const RULE = '='.repeat(80)
const THIN = '-'.repeat(80)

/**
 * 고지 파일의 글자를 만든다. **파일을 안 읽는다** — 검사가 부르는 자리다.
 *
 * 전문이 글자 하나까지 같은 패키지들은 **한 벌만 싣고 이름을 나란히 적는다.**
 * TensorFlow.js 여섯이 같은 Apache-2.0 전문을 갖는 식이다.
 */
export function renderNotices(shipped: readonly Shipped[], extras: readonly string[]): string {
  const sorted = [...shipped].sort((a, b) => a.name.localeCompare(b.name))

  const lines: string[] = [
    'ML Playgrounds — third-party notices',
    RULE,
    '',
    'This build includes the third-party packages listed below, and their license',
    'texts follow. None of it applies to ML Playgrounds itself, which is MIT',
    'licensed — see LICENSE in the repository.',
    '',
    'The build generates this file from the modules that actually ended up in the',
    'output. Do not edit it by hand.',
    '',
    'Packages',
    THIN,
    '',
  ]
  for (const one of sorted) {
    lines.push(`  ${one.name}${one.version === null ? '' : ` ${one.version}`}`)
    lines.push(`      ${one.spdx ?? 'no license id declared'}`)
  }

  lines.push(
    '',
    'Pre-trained models',
    THIN,
    '',
    '  This project does not redistribute these weights — the browser fetches them',
    '  from the addresses below. They are listed so it is clear what a project made',
    '  with this tool is built on.',
    '',
  )
  for (const model of MODELS) {
    lines.push(`  ${model.id}`)
    lines.push(`      ${model.license}, ${model.holder}`)
    lines.push(`      ${model.url}`)
  }

  lines.push('', 'License texts', THIN)

  const groups = new Map<string, string[]>()
  for (const one of sorted) {
    const names = groups.get(one.text)
    if (names === undefined) groups.set(one.text, [one.name])
    else names.push(one.name)
  }
  for (const [text, names] of groups) {
    lines.push('', RULE, names.join(', '), RULE, '', text)
  }

  for (const extra of extras) lines.push('', RULE, '', tidy(extra))

  return `${lines.join('\n')}\n`
}

/** 산출물 하나에서 패키지 이름을 긁는다. 청크는 모듈로, 자산은 원본 경로로 잡힌다. */
function namesIn(bundle: Record<string, unknown>): string[] {
  const found: string[] = []
  for (const output of Object.values(bundle)) {
    const one = output as {
      modules?: Record<string, unknown>
      originalFileNames?: readonly string[]
    }
    for (const id of Object.keys(one.modules ?? {})) {
      const name = packageFromId(id)
      if (name !== null) found.push(name)
    }
    for (const id of one.originalFileNames ?? []) {
      const name = packageFromId(id)
      if (name !== null) found.push(name)
    }
  }
  return found
}

/** 수집기와 굽는 이. 둘이 같은 집합을 나눠 갖는다. */
export interface Notices {
  /** 워커 빌드에 건다. 세기만 하고 아무것도 안 굽는다. */
  readonly collect: Plugin
  /** 본 빌드에 건다. 여기서 파일이 나온다. */
  readonly emit: Plugin
}

export function thirdPartyNotices(): Notices {
  const seen = new Set<string>()

  return {
    collect: {
      name: 'ml-playgrounds:notices-collect',
      generateBundle(_options, bundle) {
        for (const name of namesIn(bundle)) seen.add(name)
      },
    },
    emit: {
      name: 'ml-playgrounds:notices',
      generateBundle(_options, bundle) {
        for (const name of namesIn(bundle)) seen.add(name)
        const shipped = [...seen].map(readShipped)
        const extras = [...seen]
          .sort()
          .map((name) => BUNDLED_INSIDE[name])
          .filter((file): file is string => file !== undefined)
          .map((file) => readFileSync(join(SUPPLIED_DIR, file), 'utf8'))
        this.emitFile({
          type: 'asset',
          fileName: NOTICES_FILE,
          source: renderNotices(shipped, extras),
        })
      },
    },
  }
}
