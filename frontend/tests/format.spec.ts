/**
 * .mlpx 저장 -> 열기.
 *
 * CLAUDE.md 4가 필수로 못 박은 것 - 왕복 무손실, 마이그레이션, 상한 초과 시의 동작.
 * 여기서 가장 중요한 것은 **데이터셋 바이트가 비트 단위로 같은가**다.
 * 그게 깨지면 무결성 검증 전체가 무의미해진다.
 */

import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { MAX_MODEL_BYTES } from '../src/limits'
import {
  ENTRY,
  MLPX_EXTENSION,
  type ProjectFile,
  projectFileName,
  readProject,
  selectModels,
  writeProject,
} from '../src/project/format'
import { FORMAT_VERSION } from '../src/project/schema'
import {
  experiment,
  datasetBytes,
  emptyProjectFile,
  manifest,
  projectFile,
  projectFileWithTestDataset,
  testDatasetBytes,
  run,
} from './fixtures/project'

const markdown = '# 나의 AI 모델 정리\n'

async function roundTrip(project: ProjectFile): Promise<ProjectFile> {
  const { bytes } = await writeProject(project, markdown)
  return (await readProject(bytes)).project
}

/** 무결성 대조가 아니라 내용만 볼 때 쓴다. */
async function open(bytes: Uint8Array): Promise<ProjectFile> {
  return (await readProject(bytes)).project
}

function filler(size: number): Uint8Array {
  return new Uint8Array(size).fill(65)
}

describe('표를 아직 안 올린 프로젝트', () => {
  it('저장하고 다시 열린다', async () => {
    // 정상 상태다 (open-decisions.md "데이터 없는 프로젝트는 정상 상태다").
    // 한 차시가 끝나 나가야 하는데 아직 자료를 못 정한 학생이 이 파일을 들고 간다.
    const reopened = await roundTrip(emptyProjectFile())
    expect(reopened.dataset).toBeUndefined()
    expect(reopened.document.settings.dataset).toBeUndefined()
  })

  it('zip 안에 dataset/이 아예 없다', async () => {
    const { bytes } = await writeProject(emptyProjectFile(), markdown)
    const paths = Object.keys(unzipSync(bytes))
    expect(paths.filter((path) => path.startsWith('dataset/'))).toEqual([])
  })

  it('그래도 hashes.json은 나온다 - 나머지 엔트리는 대조할 수 있다', async () => {
    const { bytes, contentHash } = await writeProject(emptyProjectFile(), markdown)
    expect(contentHash).not.toBe('')
    expect(Object.keys(unzipSync(bytes))).toContain(ENTRY.hashes)
  })

  it('참조만 있고 본체가 없으면 저장을 거부한다', async () => {
    // 우리 버그다. 그대로 쓰면 다시 열리지 않는 파일이 나간다.
    const broken = emptyProjectFile()
    broken.document.settings.dataset = projectFile().document.settings.dataset

    await expect(writeProject(broken, markdown)).rejects.toSatisfy(isClientError)
  })

  it('본체만 있고 참조가 없어도 저장을 거부한다', async () => {
    const broken = { ...emptyProjectFile(), dataset: projectFile().dataset }

    await expect(writeProject(broken, markdown)).rejects.toSatisfy(isClientError)
  })
})

describe('왕복', () => {
  it('문서가 그대로 돌아온다', async () => {
    const reopened = await roundTrip(projectFile())
    expect(reopened.document).toEqual(projectFile().document)
  })

  it('데이터셋 바이트가 비트 단위로 같다 - BOM과 CRLF까지', async () => {
    const reopened = await roundTrip(projectFile())
    // Array로 펴서 비교한다. jsdom과 node의 Uint8Array는 realm이 달라
    // toEqual이 내용과 무관하게 어긋난다.
    expect(Array.from(reopened.dataset?.bytes ?? [])).toEqual(Array.from(datasetBytes))
  })

  it('한글 컬럼명과 클래스 라벨이 살아남는다', async () => {
    const reopened = await roundTrip(projectFile())
    expect(reopened.document.settings.features).toEqual(['꽃받침 길이', 'petal_length'])
    expect(reopened.document.settings.target).toBe('품종')
  })

  it('실패한 run이 사유와 함께 남는다', async () => {
    const failed = run('run-2', {
      status: 'failed',
      algorithm: 'svm',
      metrics: undefined,
      model: undefined,
      failure: { code: 'JOB_TIMEOUT', params: { limitSeconds: 120 } },
    })
    const project = projectFile()
    project.document.runs.experiments = [experiment('experiment-1', [run('run-1'), failed])]
    const reopened = await roundTrip(project)
    const reopenedRun = reopened.document.runs.experiments[0]?.runs[1]
    expect(reopenedRun?.status).toBe('failed')
    expect(reopenedRun?.failure?.code).toBe('JOB_TIMEOUT')
  })

  it('실험이 없는 새 프로젝트도 왕복한다', async () => {
    const project = projectFile({ models: new Map() })
    project.document.runs.experiments = []
    const reopened = await roundTrip(project)
    expect(reopened.document.runs.experiments).toEqual([])
  })

  it('모르는 필드가 살아남는다', async () => {
    const project = projectFile()
    const extended = { ...project.document.manifest, futureField: 'keep me' }
    project.document = { ...project.document, manifest: extended }
    const reopened = await roundTrip(project)
    expect(reopened.document.manifest.futureField).toBe('keep me')
  })

  it('portfolio.md가 파일에 들어간다 - 도구 없이 받은 사람도 읽는다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    expect(new TextDecoder().decode(entries[ENTRY.portfolioMarkdown])).toBe(markdown)
  })
})

describe('평가 데이터(test.csv)', () => {
  it('holdout이면 zip에 test.csv가 없다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    expect(Object.keys(unzipSync(bytes))).not.toContain('dataset/test.csv')
  })

  it('provided면 test.csv가 비트 단위로 왕복한다', async () => {
    const reopened = await roundTrip(projectFileWithTestDataset())
    expect(Array.from(reopened.testDataset?.bytes ?? [])).toEqual(Array.from(testDatasetBytes))
    expect(reopened.document.settings.testDataset?.path).toBe('dataset/test.csv')
  })

  it('참조만 있고 본체가 없으면 저장을 거부한다', async () => {
    const broken = { ...projectFileWithTestDataset(), testDataset: undefined }
    await expect(writeProject(broken, markdown)).rejects.toSatisfy(isClientError)
  })

  it('본체만 있고 참조가 없어도 저장을 거부한다', async () => {
    const withTest = projectFileWithTestDataset()
    const broken = {
      ...projectFile(),
      testDataset: withTest.testDataset,
    }
    await expect(writeProject(broken, markdown)).rejects.toSatisfy(isClientError)
  })

  it('test.csv가 없으면 열기를 거부한다 - 재현도 재학습도 못 한다', async () => {
    const { bytes } = await writeProject(projectFileWithTestDataset(), markdown)
    const entries = unzipSync(bytes)
    delete entries['dataset/test.csv']

    await expect(readProject(zipSync(entries))).rejects.toSatisfy(
      (error: unknown) =>
        isClientError(error) &&
        error.code === 'PROJECT_FILE_ENTRY_MISSING' &&
        error.params.entry === 'dataset/test.csv',
    )
  })
})

describe('모르는 엔트리', () => {
  it('쓰레기 엔트리는 다시 저장할 때 사라진다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    entries['__MACOSX/._manifest.json'] = new Uint8Array([1, 2, 3])
    entries['.DS_Store'] = new Uint8Array([4, 5])

    const reopened = await open(zipSync(entries))
    const written = unzipSync((await writeProject(reopened, markdown)).bytes)
    expect(Object.keys(written)).not.toContain('__MACOSX/._manifest.json')
    expect(Object.keys(written)).not.toContain('.DS_Store')
  })

  it('아무도 가리키지 않는 고아 모델이 청소된다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    entries['model/run-9.json'] = new TextEncoder().encode('{"orphan":true}')

    const reopened = await open(zipSync(entries))
    expect(reopened.models.has('model/run-9.json')).toBe(false)
  })
})

describe('모델 참조가 어긋난 파일', () => {
  it('모델 파일이 없으면 지표만 남기고 파일은 열린다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    delete entries['model/run-1.json']

    const reopened = await open(zipSync(entries))
    const reopenedRun = reopened.document.runs.experiments[0]?.runs[0]
    expect(reopenedRun?.model).toBeUndefined()
    expect(reopenedRun?.metrics?.accuracy).toBe(0.9333)
  })

  it('전처리기가 없으면 그 실험의 모델도 쓸 수 없다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    delete entries['model/preprocessor-experiment-1.json']

    const reopened = await open(zipSync(entries))
    expect(reopened.document.runs.experiments[0]?.preprocessor).toBeUndefined()
    expect(reopened.document.runs.experiments[0]?.runs[0]?.model).toBeUndefined()
  })

  it('전처리를 자기 안에 담은 모델은 전처리기가 없어도 남는다', async () => {
    // 지금 형식은 전부 includesPreprocessing: false라 이 경로가 안 돌지만, mlpx-spec.md 5의
    // onnx-v1은 "전처리 그래프에 포함"이다. 규칙이 없으면 V5에서 멀쩡한 모델이 조용히
    // 떨어지고 아무도 이유를 모른다. 형식 이름이 아니라 모델이 든 불리언이 정한다.
    const project = projectFile()
    const target = project.document.runs.experiments[0]?.runs[0]
    if (target?.model) target.model = { ...target.model, includesPreprocessing: true }

    const { bytes } = await writeProject(project, markdown)
    const entries = unzipSync(bytes)
    delete entries['model/preprocessor-experiment-1.json']

    const reopened = await open(zipSync(entries))
    expect(reopened.document.runs.experiments[0]?.preprocessor).toBeUndefined()
    expect(reopened.document.runs.experiments[0]?.runs[0]?.model).toBeDefined()
  })

  it('담긴 모델이 아무도 안 쓰면 전처리기도 담지 않는다', () => {
    // 전처리기가 필요한 모델이 크기에서 빠지면, 남는 것은 혼자 서는 모델뿐이다.
    // 그때 전처리기를 담으면 아무도 안 쓰는 짐이 된다 - 바로 위 규칙과 같은 상황인데
    // 자리를 미리 잡아 둔 탓에 놓치기 쉬운 경로다.
    const project = projectFile()
    const standalone = run('run-1')
    if (standalone.model) {
      standalone.model = { ...standalone.model, includesPreprocessing: true }
    }
    project.document.runs.experiments = [experiment('experiment-1', [standalone, run('run-2')])]
    project.models = new Map([
      ['model/run-1.json', filler(10)],
      ['model/run-2.json', filler(100)],
      ['model/preprocessor-experiment-1.json', filler(10)],
    ])

    // run-2는 개별 상한(60)을 넘어 빠진다. 남는 run-1은 전처리기가 필요 없다.
    const { kept, dropped } = selectModels(project.document, project.models, 30, 60)
    expect([...kept]).toEqual(['model/run-1.json'])
    expect(dropped.map((model) => model.reason)).toEqual(['tooLarge'])
  })

  it('전처리기가 예산에 못 들어가도 혼자 서는 모델은 남는다', () => {
    const project = projectFile()
    const target = project.document.runs.experiments[0]?.runs[0]
    if (target?.model) target.model = { ...target.model, includesPreprocessing: true }
    project.models = new Map([
      ['model/run-1.json', filler(10)],
      ['model/preprocessor-experiment-1.json', filler(90)],
    ])

    // 예산 20바이트에는 전처리기(90)가 못 들어간다. 그래도 모델(10)은 쓸 수 있다.
    const { kept, dropped } = selectModels(project.document, project.models, 20, 60)
    expect([...kept]).toEqual(['model/run-1.json'])
    expect(dropped).toEqual([])
  })
})

describe('크기 예산', () => {
  it('개별 상한을 넘는 모델은 빠지고 저장은 성공한다', async () => {
    const project = projectFile()
    project.models.set('model/run-1.json', filler(MAX_MODEL_BYTES + 1))

    const result = await writeProject(project, markdown)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.reason).toBe('tooLarge')
    expect(result.bytes.length).toBeGreaterThan(0)

    const reopened = await open(result.bytes)
    expect(reopened.document.runs.experiments[0]?.runs[0]?.model).toBeUndefined()
    expect(reopened.document.runs.experiments[0]?.runs[0]?.metrics?.accuracy).toBe(0.9333)
  })

  it('예산이 차면 오래된 실험부터 빠진다', () => {
    const project = projectFile()
    project.document.runs.experiments = [
      experiment('experiment-1', [run('run-1')]),
      experiment('experiment-2', [run('run-2')]),
    ]
    project.models = new Map([
      ['model/run-1.json', filler(60)],
      ['model/preprocessor-experiment-1.json', filler(10)],
      ['model/run-2.json', filler(60)],
      ['model/preprocessor-experiment-2.json', filler(10)],
    ])

    // 예산 100바이트에는 최신 실험(전처리기 10 + 모델 60)만 들어간다.
    const { kept, dropped } = selectModels(project.document, project.models, 100, 60)
    expect([...kept]).toEqual(['model/preprocessor-experiment-2.json', 'model/run-2.json'])
    expect(dropped.map((model) => model.path)).toEqual(['model/run-1.json'])
    expect(dropped[0]?.reason).toBe('overBudget')
  })

  it('작은 모델은 여러 회차가 남는다 - 계수 몇 개짜리를 버릴 이유가 없다', () => {
    const project = projectFile()
    project.document.runs.experiments = [
      experiment('experiment-1', [run('run-1')]),
      experiment('experiment-2', [run('run-2')]),
    ]
    project.models = new Map([
      ['model/run-1.json', filler(10)],
      ['model/preprocessor-experiment-1.json', filler(10)],
      ['model/run-2.json', filler(10)],
      ['model/preprocessor-experiment-2.json', filler(10)],
    ])

    const { kept, dropped } = selectModels(project.document, project.models, 100, 60)
    expect(kept.size).toBe(4)
    expect(dropped).toEqual([])
  })

  it('쓸 모델이 하나도 없으면 전처리기도 담지 않는다', async () => {
    const project = projectFile()
    project.models.set('model/run-1.json', filler(MAX_MODEL_BYTES + 1))

    const written = unzipSync((await writeProject(project, markdown)).bytes)
    expect(Object.keys(written)).not.toContain('model/preprocessor-experiment-1.json')
  })
})

describe('모델을 왜 뺐는지 파일에 남는다', () => {
  it('개별 상한을 넘었으면 tooLarge다 - 다시 학습해도 소용없다', async () => {
    const project = projectFile()
    project.models.set('model/run-1.json', filler(MAX_MODEL_BYTES + 1))

    const reopened = await open((await writeProject(project, markdown)).bytes)
    expect(reopened.document.runs.experiments[0]?.runs[0]?.modelOmitted).toBe('tooLarge')
  })

  it('합계 예산에서 밀렸으면 overBudget이다 - 다시 학습하면 되살아난다', async () => {
    const project = projectFile()
    project.document.runs.experiments = [
      experiment('experiment-1', [run('run-1')]),
      experiment('experiment-2', [run('run-2')]),
    ]
    project.models = new Map([
      ['model/run-1.json', filler(60)],
      ['model/preprocessor-experiment-1.json', filler(10)],
      ['model/run-2.json', filler(60)],
      ['model/preprocessor-experiment-2.json', filler(10)],
    ])

    // selectModels의 판정을 그대로 문서에 옮기는지를 본다. 예산은 인자로 줄 수 없으므로
    // 사유 표를 직접 확인하고, 왕복은 위 tooLarge 테스트가 덮는다.
    const { dropped } = selectModels(project.document, project.models, 100, 60)
    expect(dropped.map((model) => model.reason)).toEqual(['overBudget'])
  })

  it('모델이 담기면 옛 사유가 지워진다 - 담긴 모델 옆에 "담지 못했습니다"가 뜨면 안 된다', async () => {
    const project = projectFile()
    const first = project.document.runs.experiments[0]?.runs[0]
    // 지난번 저장에서 밀렸다가, 이번에는 예산에 여유가 생겨 담기는 상황이다.
    if (first) first.modelOmitted = 'overBudget'

    const reopened = await open((await writeProject(project, markdown)).bytes)
    expect(reopened.document.runs.experiments[0]?.runs[0]?.model).toBeDefined()
    expect(reopened.document.runs.experiments[0]?.runs[0]?.modelOmitted).toBeUndefined()
  })

  it('파일에 모델이 없어서 뗀 것에는 사유를 지어내지 않는다', async () => {
    // 읽을 때는 왜 없는지 모른다. 파일에 적혀 있던 것이 그 답이고, 없으면 없는 것이다.
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    delete entries['model/run-1.json']

    const { project } = await readProject(zipSync(entries))
    const first = project.document.runs.experiments[0]?.runs[0]
    expect(first?.model).toBeUndefined()
    expect(first?.modelOmitted).toBeUndefined()
  })
})

describe('열 수 없는 파일', () => {
  it('zip이 아니면 거부한다', async () => {
    await expect(readProject(new TextEncoder().encode('not a zip at all'))).rejects.toSatisfy(
      (error: unknown) => isClientError(error) && error.code === 'PROJECT_FILE_NOT_ZIP',
    )
  })

  it('필수 엔트리가 없으면 무엇이 없는지 알려준다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    delete entries[ENTRY.manifest]

    await expect(readProject(zipSync(entries))).rejects.toSatisfy(
      (error: unknown) =>
        isClientError(error) &&
        error.code === 'PROJECT_FILE_ENTRY_MISSING' &&
        error.params.entry === ENTRY.manifest,
    )
  })

  it('데이터셋이 없으면 거부한다 - 재학습도 해시 재계산도 불가능하다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    delete entries['dataset/data.csv']

    await expect(readProject(zipSync(entries))).rejects.toSatisfy(
      (error: unknown) =>
        isClientError(error) &&
        error.code === 'PROJECT_FILE_ENTRY_MISSING' &&
        error.params.entry === 'dataset/data.csv',
    )
  })

  it('JSON이 깨졌으면 어느 엔트리인지 알려준다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    entries[ENTRY.settings] = new TextEncoder().encode('{ broken')

    await expect(readProject(zipSync(entries))).rejects.toSatisfy(
      (error: unknown) =>
        isClientError(error) &&
        error.code === 'PROJECT_FILE_INVALID' &&
        error.params.path === ENTRY.settings,
    )
  })

  it('상위 버전 파일은 거부한다', async () => {
    const project = projectFile()
    project.document = {
      ...project.document,
      manifest: { ...manifest, formatVersion: FORMAT_VERSION + 1 },
    }
    const { bytes } = await writeProject(project, markdown)

    await expect(readProject(bytes)).rejects.toSatisfy(
      (error: unknown) => isClientError(error) && error.code === 'PROJECT_FILE_VERSION_TOO_NEW',
    )
  })

  it('상위 버전이면 엔트리가 없어도 버전을 먼저 말한다', async () => {
    // 미래의 v2가 엔트리 구성을 바꾸면(예: portfolio를 manifest에 합침) 이 빌드에는
    // 없는 엔트리가 생긴다. 그때 "manifest.json이 없습니다"를 주면 학생과 교사는 파일이
    // 손상됐다고 결론 내린다. 줘야 할 답은 "앱을 업데이트하세요"다 (mlpx-spec.md 9).
    const project = projectFile()
    project.document = {
      ...project.document,
      manifest: { ...manifest, formatVersion: FORMAT_VERSION + 1 },
    }
    const { bytes } = await writeProject(project, markdown)
    const entries = unzipSync(bytes)
    delete entries[ENTRY.portfolio]

    await expect(readProject(zipSync(entries))).rejects.toSatisfy(
      (error: unknown) => isClientError(error) && error.code === 'PROJECT_FILE_VERSION_TOO_NEW',
    )
  })
})

describe('경로가 어긋난 파일', () => {
  /** settings.json을 손으로 고친 파일을 만든다. */
  async function withSettings(mutate: (settings: { dataset: { path: string } }) => void) {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    const settings = JSON.parse(new TextDecoder().decode(entries[ENTRY.settings])) as {
      dataset: { path: string }
    }
    mutate(settings)
    entries[ENTRY.settings] = new TextEncoder().encode(JSON.stringify(settings, null, 2))
    return zipSync(entries)
  }

  /** runs.json을 손으로 고친 파일을 만든다. */
  async function withRuns(
    mutate: (runs: {
      experiments: { preprocessor?: { path: string }; runs: { model?: { path: string } }[] }[]
    }) => void,
  ) {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    const runs = JSON.parse(new TextDecoder().decode(entries[ENTRY.runs])) as {
      experiments: { preprocessor?: { path: string }; runs: { model?: { path: string } }[] }[]
    }
    mutate(runs)
    entries[ENTRY.runs] = new TextEncoder().encode(JSON.stringify(runs, null, 2))
    return zipSync(entries)
  }

  const rejectsAt = async (bytes: Uint8Array, field: string) =>
    expect(readProject(bytes)).rejects.toSatisfy(
      (error: unknown) =>
        isClientError(error) &&
        error.code === 'PROJECT_FILE_INVALID' &&
        error.params.path === field,
    )

  it('데이터셋이 고정 엔트리를 가리키면 거부한다', async () => {
    // 열리기는 한다 - manifest 바이트가 "데이터셋"으로 읽힐 뿐이다. 그런데 그 프로젝트를
    // 저장하면 데이터셋이 manifest를 덮어써서 **다시 못 여는 파일**이 나간다.
    await rejectsAt(
      await withSettings((settings) => {
        settings.dataset.path = ENTRY.manifest
      }),
      'settings.dataset.path',
    )
  })

  it('데이터셋이 hashes.json을 가리켜도 거부한다', async () => {
    await rejectsAt(
      await withSettings((settings) => {
        settings.dataset.path = ENTRY.hashes
      }),
      'settings.dataset.path',
    )
  })

  it('데이터셋 경로가 dataset/ 밖이면 거부한다', async () => {
    await rejectsAt(
      await withSettings((settings) => {
        settings.dataset.path = 'data.csv'
      }),
      'settings.dataset.path',
    )
  })

  it('전처리기가 고정 엔트리를 가리키면 거부한다', async () => {
    // 이쪽이 더 나쁘다. 저장할 때 방금 만든 설정이 파일에서 읽어 온 옛 바이트로 덮이는데
    // 파일은 멀쩡히 열려서 아무도 못 알아챈다.
    await rejectsAt(
      await withRuns((runs) => {
        const experiment = runs.experiments[0]
        if (experiment?.preprocessor) experiment.preprocessor.path = ENTRY.settings
      }),
      'runs.experiments.0.preprocessor.path',
    )
  })

  it('모델이 model/ 밖을 가리키면 거부한다', async () => {
    await rejectsAt(
      await withRuns((runs) => {
        const model = runs.experiments[0]?.runs[0]?.model
        if (model) model.path = ENTRY.portfolioMarkdown
      }),
      'runs.experiments.0.runs.0.model.path',
    )
  })

  it('상위 디렉터리로 새는 경로를 거부한다 - 학생이 압축을 풀 때 밖으로 나간다', async () => {
    await rejectsAt(
      await withSettings((settings) => {
        settings.dataset.path = 'dataset/../../evil.csv'
      }),
      'settings.dataset.path',
    )
  })

  it('디렉터리 이름 자체는 파일이 아니다', async () => {
    await rejectsAt(
      await withSettings((settings) => {
        settings.dataset.path = 'dataset/'
      }),
      'settings.dataset.path',
    )
  })
})

describe('projectFileName', () => {
  it('학번과 이름이 있으면 앞에 붙는다', () => {
    const named = { ...manifest, student: { studentId: '10203', name: '홍길동' } }
    expect(projectFileName(named)).toBe(`10203_홍길동_붓꽃품종분류${MLPX_EXTENSION}`)
  })

  it('없으면 프로젝트 이름만 남는다 - 학생이 저장할 때 스스로 알아챈다', () => {
    expect(projectFileName(manifest)).toBe(`붓꽃품종분류${MLPX_EXTENSION}`)
  })

  it('하이픈이 든 학번을 지키지 않으면 안 된다', () => {
    const named = { ...manifest, student: { studentId: '1-2-03' } }
    expect(projectFileName(named)).toBe(`1-2-03_붓꽃품종분류${MLPX_EXTENSION}`)
  })

  it('파일명에 쓸 수 없는 문자를 지운다', () => {
    const risky = { ...manifest, name: 'a/b\\c:d*e?f"g<h>i|j' }
    expect(projectFileName(risky)).toBe(`abcdefghij${MLPX_EXTENSION}`)
  })

  it('비어 있는 조각은 통째로 뺀다 - _ 만 남는 이름을 만들지 않는다', () => {
    const spaced = { ...manifest, student: { studentId: '   ', name: '홍길동' } }
    expect(projectFileName(spaced)).toBe(`홍길동_붓꽃품종분류${MLPX_EXTENSION}`)
  })

  it('전부 비면 projectId 앞자리를 쓴다', () => {
    expect(projectFileName({ ...manifest, name: '///' })).toBe(`550e8400${MLPX_EXTENSION}`)
  })

  it('긴 이름은 자른다', () => {
    const long = { ...manifest, name: '가'.repeat(300) }
    expect(projectFileName(long).length).toBeLessThan(120)
  })
})
