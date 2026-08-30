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
import { writeProjectBytes } from './fixtures/write'
import { FORMAT_VERSION } from '../src/project/schema'
import {
  experiment,
  datasetBytes,
  emptyProjectFile,
  manifest,
  predictDatasetBytes,
  projectFile,
  projectFileWithPredictDataset,
  projectFileWithTestDataset,
  testDatasetBytes,
  run,
} from './fixtures/project'

const markdown = '# 나의 AI 모델 정리\n'

async function roundTrip(project: ProjectFile): Promise<ProjectFile> {
  const { bytes } = await writeProjectBytes(project, markdown)
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
    expect(reopened.document.settings.data.dataset).toBeUndefined()
  })

  it('zip 안에 dataset/이 아예 없다', async () => {
    const { bytes } = await writeProjectBytes(emptyProjectFile(), markdown)
    const paths = Object.keys(unzipSync(bytes))
    expect(paths.filter((path) => path.startsWith('dataset/'))).toEqual([])
  })

  it('그래도 hashes.json은 나온다 - 나머지 엔트리는 대조할 수 있다', async () => {
    const { bytes, contentHash } = await writeProjectBytes(emptyProjectFile(), markdown)
    expect(contentHash).not.toBe('')
    expect(Object.keys(unzipSync(bytes))).toContain(ENTRY.hashes)
  })

  it('참조만 있고 본체가 없으면 저장을 거부한다', async () => {
    // 우리 버그다. 그대로 쓰면 다시 열리지 않는 파일이 나간다.
    const broken = emptyProjectFile()
    broken.document.settings.data.dataset = projectFile().document.settings.data.dataset

    await expect(writeProjectBytes(broken, markdown)).rejects.toSatisfy(isClientError)
  })

  it('본체만 있고 참조가 없어도 저장을 거부한다', async () => {
    const broken = { ...emptyProjectFile(), dataset: projectFile().dataset }

    await expect(writeProjectBytes(broken, markdown)).rejects.toSatisfy(isClientError)
  })
})

describe('내보내는 길', () => {
  it('나가는 것은 Blob이다 - 완성된 배열을 만들지 않는다', async () => {
    const { blob } = await writeProject(projectFile(), markdown)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(0)
  })

  it('내보내도 원본이 살아 있다 - 두 번째 내보내기가 죽지 않는다', async () => {
    // **비동기 압축기는 넘겨준 버퍼를 워커로 transfer한다.** 원본을 그대로 넘기면
    // 열려 있는 프로젝트의 데이터셋이 그 자리에서 detach되고, 두 번째 내보내기는
    // DataCloneError로 죽는다. 그 사이 화면이 읽는 바이트도 함께 사라진다.
    const project = projectFile()
    const before = project.dataset?.bytes
    expect(before, '검사 자체가 표 있는 프로젝트를 봐야 한다').toBeDefined()
    const length = before?.length ?? 0
    expect(length).toBeGreaterThan(0)

    const first = await writeProject(project, markdown)
    // 원본이 그대로다. detach되면 length가 0이 된다.
    expect(project.dataset?.bytes.length).toBe(length)

    const second = await writeProject(project, markdown)
    expect(second.blob.size).toBe(first.blob.size)

    // 두 번째로 나간 것도 멀쩡히 열린다.
    const reopened = await open(new Uint8Array(await second.blob.arrayBuffer()))
    expect(reopened.dataset?.bytes).toEqual(before)
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
    expect(reopened.document.settings.data.features).toEqual(['꽃받침 길이', 'petal_length'])
    expect(reopened.document.settings.data.target).toBe('품종')
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

  /**
   * 행 표본 뽑기 (open-decisions.md #22).
   *
   * **선택 필드라 두 방향을 다 봐야 한다.** 있으면 살아 돌아오는지, **없으면 없는 채로**
   * 열리는지다. 뒤쪽이 곧 "이 필드를 모르는 옛 `.mlpx`가 그대로 열린다"이고,
   * `formatVersion`을 안 올린 근거가 그것이다.
   */
  it('뽑은 행 수가 왕복한다', async () => {
    const project = projectFile()
    // 제자리에서 고쳐도 다음 projectFile()은 멀쩡하다 - 팩토리가 매번 복사본을 준다
    // (tests/fixtures.spec.ts가 그것을 지킨다). 예전에는 아니었고, 이 검사가 그 오염을
    // 처음 밟았다.
    project.document.settings.nSamples = 3000
    const reopened = await roundTrip(project)
    expect(reopened.document.settings.nSamples).toBe(3000)
  })

  it('뽑지 않은 프로젝트에는 그 키가 아예 없다', async () => {
    const reopened = await roundTrip(projectFile())
    expect(reopened.document.settings).not.toHaveProperty('nSamples')
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

  it('portfolio/document.md가 파일에 들어간다 - 도구 없이 받은 사람도 읽는다', async () => {
    const { bytes } = await writeProjectBytes(projectFile(), markdown)
    const entries = unzipSync(bytes)
    expect(new TextDecoder().decode(entries[ENTRY.portfolioMarkdown])).toBe(markdown)
  })
})

describe('테스트 데이터(test.csv)', () => {
  it('holdout이면 zip에 test.csv가 없다', async () => {
    const { bytes } = await writeProjectBytes(projectFile(), markdown)
    expect(Object.keys(unzipSync(bytes))).not.toContain('dataset/test.csv')
  })

  it('provided면 test.csv가 비트 단위로 왕복한다', async () => {
    const reopened = await roundTrip(projectFileWithTestDataset())
    expect(Array.from(reopened.testDataset?.bytes ?? [])).toEqual(Array.from(testDatasetBytes))
    expect(reopened.document.settings.data.testDataset?.path).toBe('dataset/test.csv')
  })

  it('참조만 있고 본체가 없으면 저장을 거부한다', async () => {
    const broken = { ...projectFileWithTestDataset(), testDataset: undefined }
    await expect(writeProjectBytes(broken, markdown)).rejects.toSatisfy(isClientError)
  })

  it('본체만 있고 참조가 없어도 저장을 거부한다', async () => {
    const withTest = projectFileWithTestDataset()
    const broken = {
      ...projectFile(),
      testDataset: withTest.testDataset,
    }
    await expect(writeProjectBytes(broken, markdown)).rejects.toSatisfy(isClientError)
  })

  it('test.csv가 없으면 열기를 거부한다 - 재현도 재학습도 못 한다', async () => {
    const { bytes } = await writeProjectBytes(projectFileWithTestDataset(), markdown)
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

describe('예측 데이터(predict.csv)', () => {
  it('안 올렸으면 zip에 predict.csv가 없다', async () => {
    const { bytes } = await writeProjectBytes(projectFile(), markdown)
    expect(Object.keys(unzipSync(bytes))).not.toContain('dataset/predict.csv')
  })

  it('올렸으면 predict.csv가 비트 단위로 왕복한다', async () => {
    const reopened = await roundTrip(projectFileWithPredictDataset())
    expect(Array.from(reopened.predictDataset?.bytes ?? [])).toEqual(
      Array.from(predictDatasetBytes),
    )
    expect(reopened.document.settings.data.predictDataset?.path).toBe('dataset/predict.csv')
  })

  it('실험을 지우지 않는다 - applyTestDataset과 결정적으로 다른 지점이다', async () => {
    const reopened = await roundTrip(projectFileWithPredictDataset())
    expect(reopened.document.runs.experiments).toHaveLength(1)
  })

  it('참조만 있고 본체가 없으면 저장을 거부한다', async () => {
    const broken = { ...projectFileWithPredictDataset(), predictDataset: undefined }
    await expect(writeProjectBytes(broken, markdown)).rejects.toSatisfy(isClientError)
  })

  it('본체만 있고 참조가 없어도 저장을 거부한다', async () => {
    const withPredict = projectFileWithPredictDataset()
    const broken = {
      ...projectFile(),
      predictDataset: withPredict.predictDataset,
    }
    await expect(writeProjectBytes(broken, markdown)).rejects.toSatisfy(isClientError)
  })

  it('predict.csv가 없으면 열기를 거부한다', async () => {
    const { bytes } = await writeProjectBytes(projectFileWithPredictDataset(), markdown)
    const entries = unzipSync(bytes)
    delete entries['dataset/predict.csv']

    await expect(readProject(zipSync(entries))).rejects.toSatisfy(
      (error: unknown) =>
        isClientError(error) &&
        error.code === 'PROJECT_FILE_ENTRY_MISSING' &&
        error.params.entry === 'dataset/predict.csv',
    )
  })
})

describe('모르는 엔트리', () => {
  it('쓰레기 엔트리는 다시 저장할 때 사라진다', async () => {
    const { bytes } = await writeProjectBytes(projectFile(), markdown)
    const entries = unzipSync(bytes)
    entries['__MACOSX/._manifest.json'] = new Uint8Array([1, 2, 3])
    entries['.DS_Store'] = new Uint8Array([4, 5])

    const reopened = await open(zipSync(entries))
    const written = unzipSync((await writeProjectBytes(reopened, markdown)).bytes)
    expect(Object.keys(written)).not.toContain('__MACOSX/._manifest.json')
    expect(Object.keys(written)).not.toContain('.DS_Store')
  })

  it('아무도 가리키지 않는 고아 모델이 청소된다', async () => {
    const { bytes } = await writeProjectBytes(projectFile(), markdown)
    const entries = unzipSync(bytes)
    entries['model/run-9.json'] = new TextEncoder().encode('{"orphan":true}')

    const reopened = await open(zipSync(entries))
    expect(reopened.models.has('model/run-9.json')).toBe(false)
  })
})

describe('모델 참조가 어긋난 파일', () => {
  it('모델 파일이 없으면 지표만 남기고 파일은 열린다', async () => {
    const { bytes } = await writeProjectBytes(projectFile(), markdown)
    const entries = unzipSync(bytes)
    delete entries['model/run-1.json']

    const reopened = await open(zipSync(entries))
    const reopenedRun = reopened.document.runs.experiments[0]?.runs[0]
    expect(reopenedRun?.model).toBeUndefined()
    expect(reopenedRun?.metrics?.accuracy).toBe(0.9333)
  })

  it('전처리기가 없으면 그 실험의 모델도 쓸 수 없다', async () => {
    const { bytes } = await writeProjectBytes(projectFile(), markdown)
    const entries = unzipSync(bytes)
    delete entries['model/preprocessor-experiment-1.json']

    const reopened = await open(zipSync(entries))
    expect(reopened.document.runs.experiments[0]?.preprocessor).toBeUndefined()
    expect(reopened.document.runs.experiments[0]?.runs[0]?.model).toBeUndefined()
  })

  it('전처리를 자기 안에 포함한 모델은 전처리기가 없어도 남는다', async () => {
    // 지금 형식은 전부 includesPreprocessing: false라 이 경로가 안 돌지만, mlpx-spec.md 5의
    // onnx-v1은 "전처리 그래프에 포함"이다. 규칙이 없으면 V5에서 멀쩡한 모델이 조용히
    // 떨어지고 아무도 이유를 모른다. 형식 이름이 아니라 모델이 든 불리언이 정한다.
    const project = projectFile()
    const target = project.document.runs.experiments[0]?.runs[0]
    if (target?.model) target.model = { ...target.model, includesPreprocessing: true }

    const { bytes } = await writeProjectBytes(project, markdown)
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

  /**
   * **예산을 정확히 채우는 모델은 담긴다.** 비교를 `>=`로 바꿔도 저장소 전체가
   * 초록이었다 (R9 감사 B-9). 표 상한이 "상한과 같으면 받는다"를 못 박아 둔 것과
   * 같은 경계 규칙이고, 어긋나면 학생 화면에 "담지 못했습니다"가 뜬다.
   */
  it('예산을 정확히 채우면 담긴다 - 경계에서 한 바이트 차이로 빼지 않는다', () => {
    const project = projectFile()
    const target = project.document.runs.experiments[0]?.runs[0]
    if (target?.model) target.model = { ...target.model, includesPreprocessing: true }
    project.models = new Map([['model/run-1.json', filler(40)]])

    const { kept, dropped } = selectModels(project.document, project.models, 40, 60)
    expect([...kept]).toEqual(['model/run-1.json'])
    expect(dropped).toEqual([])
  })
})

describe('크기 예산', () => {
  it('개별 상한을 넘는 모델은 빠지고 저장은 성공한다', async () => {
    const project = projectFile()
    project.models.set('model/run-1.json', filler(MAX_MODEL_BYTES + 1))

    const result = await writeProjectBytes(project, markdown)
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

    const written = unzipSync((await writeProjectBytes(project, markdown)).bytes)
    expect(Object.keys(written)).not.toContain('model/preprocessor-experiment-1.json')
  })
})

describe('모델을 왜 뺐는지 파일에 남는다', () => {
  it('개별 상한을 넘었으면 tooLarge다 - 다시 학습해도 소용없다', async () => {
    const project = projectFile()
    project.models.set('model/run-1.json', filler(MAX_MODEL_BYTES + 1))

    const reopened = await open((await writeProjectBytes(project, markdown)).bytes)
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

    const reopened = await open((await writeProjectBytes(project, markdown)).bytes)
    expect(reopened.document.runs.experiments[0]?.runs[0]?.model).toBeDefined()
    expect(reopened.document.runs.experiments[0]?.runs[0]?.modelOmitted).toBeUndefined()
  })

  it('파일에 모델이 없어서 뗀 것에는 사유를 지어내지 않는다', async () => {
    // 읽을 때는 왜 없는지 모른다. 파일에 적혀 있던 것이 그 답이고, 없으면 없는 것이다.
    const { bytes } = await writeProjectBytes(projectFile(), markdown)
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
    const { bytes } = await writeProjectBytes(projectFile(), markdown)
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
    const { bytes } = await writeProjectBytes(projectFile(), markdown)
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
    const { bytes } = await writeProjectBytes(projectFile(), markdown)
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
    const { bytes } = await writeProjectBytes(project, markdown)

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
    const { bytes } = await writeProjectBytes(project, markdown)
    const entries = unzipSync(bytes)
    delete entries[ENTRY.portfolio]

    await expect(readProject(zipSync(entries))).rejects.toSatisfy(
      (error: unknown) => isClientError(error) && error.code === 'PROJECT_FILE_VERSION_TOO_NEW',
    )
  })
})

describe('경로가 어긋난 파일', () => {
  /** settings.json을 손으로 고친 파일을 만든다. */
  async function withSettings(mutate: (settings: { data: { dataset: { path: string } } }) => void) {
    const { bytes } = await writeProjectBytes(projectFile(), markdown)
    const entries = unzipSync(bytes)
    const settings = JSON.parse(new TextDecoder().decode(entries[ENTRY.settings])) as {
      data: { dataset: { path: string } }
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
    const { bytes } = await writeProjectBytes(projectFile(), markdown)
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
        settings.data.dataset.path = ENTRY.manifest
      }),
      'settings.data.dataset.path',
    )
  })

  it('데이터셋이 hashes.json을 가리켜도 거부한다', async () => {
    await rejectsAt(
      await withSettings((settings) => {
        settings.data.dataset.path = ENTRY.hashes
      }),
      'settings.data.dataset.path',
    )
  })

  it('데이터셋 경로가 dataset/ 밖이면 거부한다', async () => {
    await rejectsAt(
      await withSettings((settings) => {
        settings.data.dataset.path = 'data.csv'
      }),
      'settings.data.dataset.path',
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
        settings.data.dataset.path = 'dataset/../../evil.csv'
      }),
      'settings.data.dataset.path',
    )
  })

  /**
   * **역슬래시도 막는다** (R7 감사 B-15). 위 검사는 `..` 갈래만 지나서, 역슬래시 판정을
   * 지워도 저장소 전체가 침묵했다.
   *
   * **윈도우 압축 해제기가 역슬래시를 구분자로 읽는 것이 이 방어의 이유다** — 디렉터리
   * 안에 얌전히 있는 이름이라도 그쪽에서 풀면 경로가 갈라진다.
   */
  it('역슬래시가 든 경로를 거부한다 - 윈도우가 구분자로 읽는다', async () => {
    await rejectsAt(
      await withSettings((settings) => {
        settings.data.dataset.path = 'dataset/a\\b.csv'
      }),
      'settings.data.dataset.path',
    )
  })

  it('디렉터리 이름 자체는 파일이 아니다', async () => {
    await rejectsAt(
      await withSettings((settings) => {
        settings.data.dataset.path = 'dataset/'
      }),
      'settings.data.dataset.path',
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

describe('포트폴리오 첨부', () => {
  const path = 'portfolio/attachments/1.webp'
  const bytes = new Uint8Array([1, 2, 3, 4])

  /** 사진 한 장이 붙어 있는 프로젝트. */
  function withAttachment(): ProjectFile {
    const project = projectFile()
    return {
      ...project,
      document: {
        ...project.document,
        portfolio: { ...project.document.portfolio, attachments: { motivation: [path] } },
      },
      attachments: new Map([[path, bytes]]),
    }
  }

  it('저장했다 열면 그대로 있다', async () => {
    const reopened = await roundTrip(withAttachment())
    expect(reopened.attachments.get(path)).toEqual(bytes)
    expect(reopened.document.portfolio.attachments).toEqual({ motivation: [path] })
  })

  it('아무도 안 가리키는 사진은 안 담긴다 - 지운 사진만큼 파일이 자라면 안 된다', async () => {
    const project = withAttachment()
    project.attachments.set('portfolio/attachments/2.webp', new Uint8Array([9]))

    const reopened = await roundTrip(project)
    expect([...reopened.attachments.keys()]).toEqual([path])
  })

  it('무결성 대조가 사진을 본다 - 바꿔치기하면 잡힌다', async () => {
    const { bytes: file } = await writeProjectBytes(withAttachment(), markdown)
    const entries = unzipSync(file)
    entries[path] = new Uint8Array([9, 9, 9, 9])

    const { integrity } = await readProject(zipSync(entries))
    expect(integrity.status).toBe('MODIFIED')
    // **엔트리까지 본다.** 파일 전체 상태만 보면 첨부가 대조 대상에서 통째로 빠져도
    // (그때 그 엔트리는 REMOVED다) 똑같이 MODIFIED라서 초록이 나온다.
    expect(integrity.entries).toContainEqual({ path, state: 'MODIFIED' })
  })

  /**
   * **정본 셋과 반대 방향이다.** 저 셋은 참조만 남으면 저장을 거부하는데, 첨부는 떼어낸다
   * (open-decisions.md "본체 없는 첨부는 저장을 막지 않고 참조를 떼어낸다"). 던지면 이미
   * 사진을 잃은 프로젝트가 제출물을 저장도 내보내기도 못 한다.
   */
  it('가리키는 사진이 없으면 참조를 떼고 저장한다 - 거부하지 않는다', async () => {
    const project: ProjectFile = { ...withAttachment(), attachments: new Map() }

    const reopened = await roundTrip(project)
    expect(reopened.document.portfolio.attachments).toEqual({})
    expect(reopened.attachments.size).toBe(0)
  })

  it('한 장만 없어지면 그 한 장만 뗀다', async () => {
    const other = 'portfolio/attachments/2.webp'
    const base = withAttachment()
    const project: ProjectFile = {
      ...base,
      document: {
        ...base.document,
        portfolio: {
          ...base.document.portfolio,
          attachments: { motivation: [path, other] },
        },
      },
    }

    const reopened = await roundTrip(project)
    expect(reopened.document.portfolio.attachments).toEqual({ motivation: [path] })
  })

  it('참조만 남은 파일을 열면 그 자리에서 짝이 맞는다', async () => {
    const { bytes: file } = await writeProjectBytes(withAttachment(), markdown)
    const entries = unzipSync(file)
    delete entries[path]

    const { project } = await readProject(zipSync(entries))
    expect(project.document.portfolio.attachments).toEqual({})
  })
})
