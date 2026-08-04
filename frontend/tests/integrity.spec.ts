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
import { ENTRY, readProject, writeProject, type ProjectFile } from '../src/project/format'
import { checkHashes, parseHashes, type ProjectHashes } from '../src/project/integrity'
import { datasetBytes, projectFile } from './fixtures/project'

const markdown = '# 나의 AI 모델 정리\n'
const DATASET_PATH = 'dataset/data.csv'

async function written(project: ProjectFile = projectFile()): Promise<Record<string, Uint8Array>> {
  const { bytes } = await writeProject(project, markdown)
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
        'model/preprocessor-batch-1.json',
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
    const result = await writeProject(projectFile(), markdown)
    expect(result.contentHash).toBe(readHashes(unzipSync(result.bytes)).contentHash)
  })

  it('데이터셋을 다시 해싱하지 않는다 - 가져오기 시점의 값을 그대로 쓴다', async () => {
    // 일부러 틀린 해시를 넘긴다. 저장이 다시 계산한다면 이 값이 살아남을 수 없다.
    // 50MB 데이터셋에서 자동 저장마다 265ms를 쓰지 않기 위한 규칙이다.
    const hashes = readHashes(await written(projectFile({ datasetHash: 'not-a-real-hash' })))
    expect(hashes.entries[DATASET_PATH]).toBe('not-a-real-hash')
  })

  it('내용이 같으면 contentHash가 같다 - 제출물을 가로질러 보는 신호가 된다', async () => {
    const first = await writeProject(projectFile(), markdown)
    const second = await writeProject(projectFile(), markdown)
    expect(second.contentHash).toBe(first.contentHash)
  })
})

describe('열 때 하는 대조', () => {
  it('손대지 않은 파일은 고쳐진 흔적이 없다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    const { integrity } = await readProject(bytes)

    expect(integrity.status).toBe('UNCHANGED')
    expect(integrity.contentHash).toBe(integrity.computedContentHash)
    expect(integrity.entries.every((entry) => entry.state === 'UNCHANGED')).toBe(true)
  })

  it('풀어서 지표를 고치고 다시 압축하면 어디가 바뀌었는지 짚어준다', async () => {
    const entries = await written()
    const runs = JSON.parse(new TextDecoder().decode(entries[ENTRY.runs])) as {
      batches: { runs: { metrics: Record<string, number> }[] }[]
    }
    const target = runs.batches[0]?.runs[0]
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
    const { bytes } = await writeProject(projectFile(), markdown)
    const original = (await readProject(bytes)).integrity.computedContentHash

    const repacked = zipSync(unzipSync(bytes), { level: 0 })
    expect(Array.from(repacked)).not.toEqual(Array.from(bytes))
    expect((await readProject(repacked)).integrity.computedContentHash).toBe(original)
  })

  it('데이터셋 해시를 파일에서 다시 계산한다 - 적힌 값을 믿지 않는다', async () => {
    const { project } = await readProject((await writeProject(projectFile(), markdown)).bytes)
    expect(project.datasetHash).toBe(hashBytes(datasetBytes))
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
    const { integrity } = await readProject((await writeProject(project, markdown)).bytes)
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
