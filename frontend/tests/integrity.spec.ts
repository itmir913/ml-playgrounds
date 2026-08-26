/**
 * 무결성 해시 (docs/mlpx-spec.md 7).
 *
 * 여기서 확인하는 것은 "위조를 막는가"가 아니다. 그건 브라우저에서 도는 코드로는
 * 불가능하다. 확인하는 것은 셋이다.
 *
 *   1. 압축을 풀어 고치고 다시 압축한 흔적이 남는가
 *   2. **어디가** 바뀌었는지 짚어주는가 - 해시가 실제로 값을 하는 자리다
 *   3. 무결성 정보 때문에 파일이 안 열리는 일은 없는가
 */

import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { hashBytes } from '../src/hash'
import { ENTRY, readProject, type ProjectFile } from '../src/project/format'
import { writeProjectBytes } from './fixtures/write'
import { checkHashes, parseHashes, type ProjectHashes } from '../src/project/integrity'
import { dataSettings } from '../src/project/schema'
import {
  datasetBytes,
  predictDataset,
  projectFile,
  projectFileWithTestDataset,
} from './fixtures/project'

const markdown = '# 나의 AI 모델 정리\n'
const DATASET_PATH = 'dataset/data.csv'

async function written(project: ProjectFile = projectFile()): Promise<Record<string, Uint8Array>> {
  const { bytes } = await writeProjectBytes(project, markdown)
  return unzipSync(bytes)
}

function readHashes(entries: Record<string, Uint8Array>): ProjectHashes {
  const parsed = parseHashes(JSON.parse(new TextDecoder().decode(entries[ENTRY.hashes])))
  if (!parsed) throw new Error('hashes.json')
  return parsed
}

function stateOf(entries: { path: string; state: string }[], path: string): string | undefined {
  return entries.find((entry) => entry.path === path)?.state
}

describe('저장할 때 남기는 것', () => {
  it('hashes.json에 엔트리마다 해시가 들어간다', async () => {
    const entries = await written()
    const hashes = readHashes(entries)

    expect(Object.keys(hashes.entries).sort()).toEqual(
      [
        DATASET_PATH,
        ENTRY.manifest,
        'model/preprocessor-experiment-1.json',
        'model/run-1.json',
        ENTRY.portfolioMarkdown,
        ENTRY.portfolio,
        ENTRY.runs,
        ENTRY.settings,
      ].sort(),
    )
  })

  it('hashes.json은 자기 자신을 담지 않는다', async () => {
    const hashes = readHashes(await written())
    expect(hashes.entries[ENTRY.hashes]).toBeUndefined()
  })

  it('저장 결과가 contentHash를 돌려준다 - 교사가 수거 시점에 적어둘 값이다', async () => {
    const result = await writeProjectBytes(projectFile(), markdown)
    expect(result.contentHash).toBe(readHashes(unzipSync(result.bytes)).contentHash)
  })

  it('데이터셋을 다시 해싱하지 않는다 - 가져오기 시점의 값을 그대로 쓴다', async () => {
    // 일부러 틀린 해시를 넘긴다. 저장이 다시 계산한다면 이 값이 살아남을 수 없다.
    // 50MB 데이터셋에서 자동 저장마다 265ms를 쓰지 않기 위한 규칙이다.
    const wrong = { bytes: datasetBytes, hash: 'not-a-real-hash' }
    const hashes = readHashes(await written(projectFile({ dataset: wrong })))
    expect(hashes.entries[DATASET_PATH]).toBe('not-a-real-hash')
  })

  it('내용이 같으면 contentHash가 같다 - 제출물을 가로질러 보는 신호가 된다', async () => {
    const first = await writeProjectBytes(projectFile(), markdown)
    const second = await writeProjectBytes(projectFile(), markdown)
    expect(second.contentHash).toBe(first.contentHash)
  })
})

/**
 * **쓰는 쪽과 읽는 쪽의 비대칭을 막는 트립와이어다.**
 *
 * writeProject는 담을 엔트리 맵을 통째로 buildHashes에 넘기므로 새 엔트리 종류를 더해도
 * 저절로 해싱된다. 반면 대조 대상을 고르는 hashableEntries는 allowlist다 - 거기 넣는 것을
 * 잊으면 갓 저장한 파일에서 그 엔트리가 **REMOVED로, 파일 전체가 MODIFIED로** 뜬다.
 * 학생은 손댄 적이 없는데 화면이 고쳐졌다고 말한다.
 *
 * 종류가 더 늘어날 자리라(음성·텍스트) 사람이 기억하는 데 기대지 않는다. 이미지와
 * 임베딩 쪽은 image-format.spec.ts가 같은 것을 지킨다.
 */
describe('엔트리 종류가 늘어도 빠지지 않는다', () => {
  /** 평가·예측 데이터, 모델, 포트폴리오 첨부까지 한 프로젝트에 모은 것. */
  function everything(): ProjectFile {
    const base = projectFileWithTestDataset()
    const attachment = 'portfolio/attachments/1.webp'
    return {
      ...base,
      document: {
        ...base.document,
        settings: {
          ...base.document.settings,
          data: {
            ...dataSettings('tabular', base.document.settings),
            predictDataset: {
              path: 'dataset/predict.csv',
              originalFileName: 'iris_predict.csv',
              hasHeader: true,
              encoding: 'utf-8',
            },
          },
        },
        portfolio: {
          ...base.document.portfolio,
          attachments: { motivation: [attachment] },
        },
      },
      predictDataset: structuredClone(predictDataset),
      attachments: new Map([[attachment, new TextEncoder().encode('가짜webp')]]),
    }
  }

  it('zip에 담긴 엔트리가 hashes.json에 하나도 빠짐없이 있다', async () => {
    const entries = await written(everything())

    for (const [path, content] of Object.entries(entries)) {
      // 자기 자신만 예외다. 자기 해시를 자기 안에 담을 수 없다.
      if (path === ENTRY.hashes) continue
      expect([path, readHashes(entries).entries[path]]).toEqual([path, hashBytes(content)])
    }
  })

  it('그 파일을 다시 열면 엔트리 전부가 대조 대상이 된다', async () => {
    const { bytes } = await writeProjectBytes(everything(), markdown)
    const { integrity } = await readProject(bytes)

    expect(integrity.status).toBe('UNCHANGED')
    // 읽는 쪽 allowlist가 쓰는 쪽을 따라잡지 못하면 여기서 개수가 어긋난다.
    expect(integrity.entries.map((entry) => entry.path).sort()).toEqual(
      Object.keys(unzipSync(bytes))
        .filter((path) => path !== ENTRY.hashes)
        .sort(),
    )
  })
})

describe('열 때 하는 대조', () => {
  it('손대지 않은 파일은 고쳐진 흔적이 없다', async () => {
    const { bytes } = await writeProjectBytes(projectFile(), markdown)
    const { integrity } = await readProject(bytes)

    expect(integrity.status).toBe('UNCHANGED')
    expect(integrity.contentHash).toBe(integrity.computedContentHash)
    expect(integrity.entries.every((entry) => entry.state === 'UNCHANGED')).toBe(true)
  })

  it('풀어서 지표를 고치고 다시 압축하면 어디가 바뀌었는지 짚어준다', async () => {
    const entries = await written()
    const runs = JSON.parse(new TextDecoder().decode(entries[ENTRY.runs])) as {
      experiments: { runs: { metrics: Record<string, number> }[] }[]
    }
    const target = runs.experiments[0]?.runs[0]
    if (target) target.metrics = { accuracy: 0.99 }
    entries[ENTRY.runs] = new TextEncoder().encode(JSON.stringify(runs, null, 2))

    const { integrity } = await readProject(zipSync(entries))

    expect(integrity.status).toBe('MODIFIED')
    expect(stateOf(integrity.entries, ENTRY.runs)).toBe('MODIFIED')
    // "runs.json은 바뀌었고 dataset/은 그대로"가 교사에게 넘길 신호다.
    expect(stateOf(integrity.entries, DATASET_PATH)).toBe('UNCHANGED')
    expect(stateOf(integrity.entries, ENTRY.manifest)).toBe('UNCHANGED')
  })

  it('데이터셋을 바꿔치기하면 데이터셋이 지목된다', async () => {
    const entries = await written()
    entries[DATASET_PATH] = new TextEncoder().encode('﻿꽃받침,품종\r\n9.9,virginica\r\n')

    const { integrity } = await readProject(zipSync(entries))
    expect(stateOf(integrity.entries, DATASET_PATH)).toBe('MODIFIED')
  })

  it('모델을 끼워넣으면 드러난다', async () => {
    const entries = await written()
    entries['model/run-9.json'] = new TextEncoder().encode('{"orphan":true}')

    const { integrity } = await readProject(zipSync(entries))
    expect(integrity.status).toBe('MODIFIED')
    expect(stateOf(integrity.entries, 'model/run-9.json')).toBe('ADDED')
  })

  it('엔트리를 지우면 드러난다', async () => {
    const entries = await written()
    delete entries[ENTRY.portfolioMarkdown]

    const { integrity } = await readProject(zipSync(entries))
    expect(integrity.status).toBe('MODIFIED')
    expect(stateOf(integrity.entries, ENTRY.portfolioMarkdown)).toBe('REMOVED')
  })

  it('엔트리 해시를 다 맞춰도 contentHash를 고치면 걸린다', async () => {
    const entries = await written()
    const hashes = readHashes(entries)
    entries[ENTRY.hashes] = new TextEncoder().encode(
      JSON.stringify({ ...hashes, contentHash: 'x'.repeat(64) }),
    )

    const { integrity } = await readProject(zipSync(entries))
    expect(integrity.status).toBe('MODIFIED')
  })

  it('맥에서 만들어진 쓰레기 엔트리는 세지 않는다', async () => {
    const entries = await written()
    entries['__MACOSX/._manifest.json'] = new Uint8Array([1, 2, 3])
    entries['.DS_Store'] = new Uint8Array([4, 5])

    const { integrity } = await readProject(zipSync(entries))
    // 압축만 다시 했을 뿐인 파일을 "고쳐졌음"으로 몰면 아무도 이 표시를 안 믿는다.
    expect(integrity.status).toBe('UNCHANGED')
  })

  it('다시 압축해도 contentHash는 그대로다 - zip 바이트가 아니라 내용의 해시다', async () => {
    const { bytes } = await writeProjectBytes(projectFile(), markdown)
    const original = (await readProject(bytes)).integrity.computedContentHash

    const repacked = zipSync(unzipSync(bytes), { level: 0 })
    expect(Array.from(repacked)).not.toEqual(Array.from(bytes))
    expect((await readProject(repacked)).integrity.computedContentHash).toBe(original)
  })

  /**
   * **엔트리 순서까지 뒤집어야 정렬 규칙을 가른다.** 순서를 그대로 두고 되말면 정렬을
   * 하든 말든 결과가 같아서, 위 검사는 `contentHashOf`의 `.sort()`를 한 번도 안 물었다.
   * 순서 보존은 zip 도구가 보장하는 성질이 아니다 - 맥·윈도우 탐색기·7-Zip이 각자 다르다.
   */
  it('엔트리 순서가 뒤집혀도 contentHash는 그대로다', async () => {
    const { bytes } = await writeProjectBytes(projectFile(), markdown)
    const original = (await readProject(bytes)).integrity.computedContentHash

    const unzipped = unzipSync(bytes)
    const reversed: Record<string, Uint8Array> = {}
    for (const path of Object.keys(unzipped).reverse()) {
      reversed[path] = unzipped[path]!
    }

    const { integrity } = await readProject(zipSync(reversed))
    expect(integrity.computedContentHash).toBe(original)
    expect(integrity.status).toBe('UNCHANGED')
  })

  it('데이터셋 해시를 파일에서 다시 계산한다 - 적힌 값을 믿지 않는다', async () => {
    const { project } = await readProject((await writeProjectBytes(projectFile(), markdown)).bytes)
    expect(project.dataset?.hash).toBe(hashBytes(datasetBytes))
  })
})

describe('무결성 정보가 없거나 깨진 파일', () => {
  it('hashes.json이 없으면 확인할 수 없음이고 파일은 열린다', async () => {
    const entries = await written()
    delete entries[ENTRY.hashes]

    const { project, integrity } = await readProject(zipSync(entries))
    expect(integrity.status).toBe('UNKNOWN')
    expect(integrity.contentHash).toBeNull()
    // 지금 이 파일의 내용 해시는 알려준다. 교사가 수거 시점에 적어둘 수 있어야 한다.
    expect(integrity.computedContentHash).toHaveLength(64)
    expect(project.document.manifest.name).toBe('붓꽃 품종 분류')
  })

  it('대조 기준이 없으면 엔트리를 "그대로"라고 말하지 않는다', async () => {
    // hashes.json을 통째로 지우는 것은 변조를 감추는 가장 쉬운 수법이다. 그때 엔트리
    // 목록이 온통 "그대로"로 보이면 상단의 "확인할 수 없음"보다 그 초록색이 눈에 먼저
    // 들어온다. 비교한 적 없는 것을 그대로라고 말하지 않는다 (mlpx-spec.md 7.3).
    const entries = await written()
    delete entries[ENTRY.hashes]

    const { integrity } = await readProject(zipSync(entries))
    expect(integrity.entries).toEqual([])
  })

  /**
   * **값 자체를 못 박는다. 밖에서 계산한 SHA-256이다.**
   *
   * `contentHash`는 쓸 때도 읽을 때도 **같은 함수**가 만든다. 그래서 조립 규칙을
   * 바꿔도 대조는 언제나 자기 자신과 맞는다 — 실제로 구분자 `\n` 둘을 지워도 무결성
   * 계열 191개가 전부 초록이었다 (R9 감사 A-3). 길이가 64인지만 보는 단언으로는
   * 이 축을 못 잡는다.
   *
   * **조용히 달라지면 무슨 일이 나는가.** 그 전에 나간 학생 파일을 새 앱으로 열었을 때
   * 엔트리는 전부 맞는데 `contentHash`만 어긋나 **손댄 적 없는 파일이 "고쳐졌음"으로
   * 뜬다.** 이 파일이 스스로 최악이라고 적어 둔 상태다. 게다가 구분자를 없애면
   * `{a: 'bc'}`와 `{ab: 'c'}`가 같은 해시를 갖는다.
   *
   * 기대값은 파이썬 `hashlib`으로 따로 계산했다 —
   * `sha256("a.json\naa\nb.json\nbb\n")`. 여기서 다시 조립하면 구현으로 구현을 검사하는
   * 것이 된다.
   */
  it('contentHash는 경로로 정렬해 "경로\\n해시\\n"를 이어 붙인 SHA-256이다', () => {
    // 정렬을 함께 본다 - 넣는 순서를 뒤집어도 같은 값이어야 한다.
    const present = new Map([
      ['b.json', 'bb'],
      ['a.json', 'aa'],
    ])
    expect(checkHashes(present, null).computedContentHash).toBe(
      '0452937fce9f5b55a9037a59e281ea773a1f65e3e155df4a23cf895bbfd22d01',
    )
  })

  /**
   * **파일에 `"algorithm": "sha256"`이라고 적어 내보낸다.** 교사가 밖에서 계산해
   * 대조할 수 있다는 공개 주장이고, 그 주장이 참인지를 보는 줄이 저장소에 없었다.
   */
  it('hashBytes가 실제로 SHA-256이다 - 파일에 그렇게 적어 내보낸다', () => {
    expect(hashBytes(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('hashes.json이 깨져 있어도 파일은 열린다', async () => {
    const entries = await written()
    entries[ENTRY.hashes] = new TextEncoder().encode('{ broken')

    const { project, integrity } = await readProject(zipSync(entries))
    expect(integrity.status).toBe('UNKNOWN')
    expect(project.document.manifest.name).toBe('붓꽃 품종 분류')
  })

  it('모르는 알고리즘이 적혀 있으면 확인할 수 없음이다', async () => {
    const entries = await written()
    const hashes = readHashes(entries)
    entries[ENTRY.hashes] = new TextEncoder().encode(
      JSON.stringify({ ...hashes, algorithm: 'md5' }),
    )

    const { integrity } = await readProject(zipSync(entries))
    expect(integrity.status).toBe('UNKNOWN')
  })

  it('다시 저장하면 hashes.json이 생긴다 - 옛 파일도 다음부터는 대조된다', async () => {
    const entries = await written()
    delete entries[ENTRY.hashes]

    const { project } = await readProject(zipSync(entries))
    const { integrity } = await readProject((await writeProjectBytes(project, markdown)).bytes)
    expect(integrity.status).toBe('UNCHANGED')
  })
})

describe('parseHashes', () => {
  it('모양이 아니면 null이다 - 던지지 않는다', () => {
    expect(parseHashes(null)).toBeNull()
    expect(parseHashes('sha256')).toBeNull()
    expect(parseHashes({ algorithm: 'sha256' })).toBeNull()
    expect(parseHashes({ algorithm: 'sha256', entries: {}, contentHash: 42 })).toBeNull()
    expect(parseHashes({ algorithm: 'sha256', entries: { a: 1 }, contentHash: 'x' })).toBeNull()
  })
})

describe('checkHashes', () => {
  it('대조할 것이 없으면 확인할 수 없음이고, 엔트리에 대해서는 아무 말도 하지 않는다', () => {
    // 이 테스트는 한 번 반대로 적혀 있었다 - 엔트리를 전부 'UNCHANGED'로 채우고 그것을
    // 고정했다. 대조한 적이 없는데 "그대로"라고 말하는 것이라 mlpx-spec.md 7.3이 금지한
    // 과신 어휘다. 계산한 내용 해시는 여전히 준다 - 교사가 적어둘 수 있어야 한다.
    const result = checkHashes(new Map([['a.json', 'aa']]), null)
    expect(result.status).toBe('UNKNOWN')
    expect(result.entries).toEqual([])
    expect(result.computedContentHash).toHaveLength(64)
  })

  it('엔트리 결과가 경로 순으로 정렬돼 나온다', () => {
    const present = new Map([
      ['b.json', 'bb'],
      ['a.json', 'aa'],
    ])
    const recorded: ProjectHashes = {
      algorithm: 'sha256',
      entries: { 'a.json': 'aa', 'b.json': 'bb' },
      contentHash: 'ignored',
    }
    expect(checkHashes(present, recorded).entries.map((entry) => entry.path)).toEqual([
      'a.json',
      'b.json',
    ])
  })
})
