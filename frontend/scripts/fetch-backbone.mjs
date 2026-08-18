/**
 * 백본 가중치를 받아 **원격을 감시한다.** 산출물에 넣는 장치가 아니다.
 *
 * **가중치는 학생 브라우저가 원본에서 직접 받는다** (open-decisions.md "백본을 붙이는
 * 방법", 2026-08-12에 뒤집었다). 우리 Pages로 서빙하면 한 반 한 차시가 335MB이고,
 * 컴퓨터실 PC는 리셋을 전제라 캐시가 차시마다 사라진다 — 전국 단위에서 월 100GB
 * 소프트 상한에 며칠이면 닿는다.
 *
 * **그래서 여기서 받은 파일은 `dist/`에 안 들어간다.** `public/`이 아니라 캐시
 * 디렉터리에 놓고, 쓰는 것은 `tests/backbones.spec.ts` 하나다 — 등록부에 적힌
 * 노드 이름과 임베딩 차원을 **실제 `model.json`과 대조한다.**
 *
 * **SHA-256이 안 맞으면 CI가 선다.** 원격 파일이 조용히 바뀌면 학생 파일의
 * `backboneId`가 가리키는 것이 달라지고, 그 순간 재현 가능성이 무너진다. 학생
 * 브라우저는 해시를 확인하지 않으므로, **그 순간을 잡는 자리가 여기뿐이다.**
 *
 * 이미 받아 둔 파일은 해시만 확인하고 넘어간다. 네트워크를 매번 타지 않는다.
 *
 * **아무 말도 안 하는 것이 정상이다.** 이 스크립트는 `dev`와 `build` 앞에 매번 붙는데,
 * 거의 언제나 하는 일이 "다섯 파일의 해시가 맞다"뿐이다. 그걸 매번 한 줄로 알리면
 * 진짜 할 말(내려받기·해시 불일치)이 그 줄에 묻힌다. **말은 영어다** — 여기 출력은
 * 학생이 아니라 이 저장소를 빌드하는 사람이 보고, 그 옆줄은 vite와 npm이 채운다.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_ROOT = join(HERE, '..', '.cache', 'backbones')

/**
 * 받을 것들. **`ml/backbones.ts`의 `modelUrl`과 같은 원본을 가리켜야 한다** — 갈리면
 * 우리는 A를 감시하고 학생은 B를 받는다.
 *
 * **`id`도 그쪽과 같아야 한다.** 그 값이 캐시 디렉터리 이름이고
 * `tests/backbones.spec.ts`가 등록부의 id로 그 디렉터리를 연다 — 갈리면 검사가 없는
 * 폴더를 열고 "가중치를 받아라"라고 말한다. 실제로 받아 놓았는데도 그렇다.
 * **두 목록이 같은 말을 하는지는 그 검사가 문다** (2026-08-19).
 */
const BACKBONES = [
  {
    id: 'mobilenet-v2-r2',
    baseUrl: 'https://storage.googleapis.com/tfjs-models/savedmodel/mobilenet_v2_1.0_224/',
    files: {
      'model.json': '12e180771864a87473ae06988b8564d9fd077b11c1854030e90509917203cf6f',
      'group1-shard1of4': 'b837ab72b76b59e217750e0afed94b8f877fce7fff71b8d9cead71fc11612d8c',
      'group1-shard2of4': '4b9b02a59ecfea1a698a576f1400e876170ef78abe0e06b16195ebfe2983f6d5',
      'group1-shard3of4': 'fab6533531d17b78ad67223c82d9a452263ccc4d309a20db91a5de3714aa6a00',
      'group1-shard4of4': '617fd3639ac5cfb94a971bef032fcdfa7690816d524117f54a9cc693d0b2c5f4',
    },
  },
]

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

for (const backbone of BACKBONES) {
  const dir = join(OUT_ROOT, backbone.id)
  await mkdir(dir, { recursive: true })

  for (const [name, expected] of Object.entries(backbone.files)) {
    const path = join(dir, name)
    const present = await readIfPresent(path)
    if (present && sha256(present) === expected) continue

    // 받을 때만 말한다. 12.4MB가 오는 동안 아무 말이 없으면 멈춘 것으로 보인다.
    console.log(`Fetching backbone weights: ${backbone.id}/${name}`)
    const bytes = await fetchFile(backbone.baseUrl + name)
    const actual = sha256(bytes)
    if (actual !== expected) {
      throw new Error(
        `Backbone weight hash mismatch: ${backbone.id}/${name}\n` +
          `  expected: ${expected}\n  actual:   ${actual}\n` +
          `  The remote file changed. Do not ship this build until you know why.`,
      )
    }
    await writeFile(path, bytes)
  }
}
