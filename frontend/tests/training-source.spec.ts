/**
 * 학습 화면이 무엇을 넘길지 준비하는 자리 (`ml/training-source.ts`).
 *
 * **jsdom 선언을 뗐다** (2026-08-19, R7 감사 B-13). 근거로 `ml/embed/client.ts`의
 * `documentUrl`을 들고 있었는데 **그 이름은 저장소 어디에도 없다** — 이 주석 한 줄에만
 * 있었다. 떼고 돌려도 일곱 개가 전부 통과한다.
 *
 * **제일 위험한 줄이 벡터를 자르는 자리다.** 워커는 사진 순서대로 이어 붙은 배열 하나를
 * 주고, 여기서 잘라 해시에 다시 붙인다 — 한 칸이라도 밀리면 **엉뚱한 사진의 임베딩으로
 * 학습하면서 아무 오류도 안 난다.**
 */

import { describe, expect, it } from 'vitest'

import { hashBytes } from '../src/hash'
import { MIN_CLASSIFICATION_CATEGORIES, MIN_SPLIT_ROWS } from '../src/limits'
import { DEFAULT_BACKBONE_ID, backboneFor } from '../src/ml/backbones'
import type { EmbedMessage, EmbedRequest } from '../src/ml/embed/protocol'
import type { EmbedWorker } from '../src/ml/embed/client'
import { tabularPlanOf } from '../src/ml/plan-cache'
import {
  algorithmSelectionFor,
  runtimeContextFor,
  trainableRowsOf,
  trainingClassesOf,
  trainingEstimateInput,
  trainingEstimateShape,
  trainingSourceOf,
} from '../src/ml/training-source'
import { newProjectDocument } from '../src/project/create'
import { surveyCsv, surveyProject, tabularProjectFrom } from './fixtures/prep-kind'
import { addEmbeddings, readEmbeddings } from '../src/project/embeddings'
import { type ProjectFile } from '../src/project/format'
import {
  addCategory,
  addImages,
  applyTestImages,
  moveImages,
  readImages,
  removeCategory,
  removeImages,
  renameCategory,
} from '../src/project/images'
import { isClientError } from '../src/errors'
import { withSplit } from '../src/project/settings'
import { IMAGE_UNLABELED } from '../src/project/format'

/**
 * **`SPLIT_TOO_FEW_ROWS` 가지가 그늘에 든 이유가 이 부등식이다** (2026-09-03 R25 §4.1).
 *
 * 범주가 `MIN_CLASSIFICATION_CATEGORIES`개면 라벨 붙은 사진도 그만큼이라 `usable`이
 * 언제나 `MIN_SPLIT_ROWS` 이상이다 — 그래서 `ml/training-source.ts`의 그 가지는 오늘 안
 * 닿는다. 이 줄이 빨개지는 날 그 가지가 다시 살고, 그때는 그 가지를 무는 검사를 세워야
 * 한다. R25 재검토가 범주 판정을 끄고 밟아 그 가지가 죽은 것이 아니라 그늘에 든 것임을
 * 확인했다(실패 문장이 "데이터가 0개"로 바뀌었다).
 */
describe('범주 최소와 분할 최소의 관계', () => {
  it('범주 최소가 분할 최소보다 작지 않다', () => {
    expect(MIN_CLASSIFICATION_CATEGORIES).toBeGreaterThanOrEqual(MIN_SPLIT_ROWS)
  })
})

const NOW = '2026-08-12T09:00:00.000Z'
const BACKBONE = backboneFor(DEFAULT_BACKBONE_ID)!
const DIM = BACKBONE.embeddingDim

function photo(seed: string): Uint8Array {
  return new TextEncoder().encode(`가짜jpg:${seed}`)
}

function imageProject(seeds: readonly string[]): ProjectFile {
  const document = newProjectDocument(
    { name: '개와 고양이', locale: 'ko', dataType: 'image' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-08-12T08:00:00.000Z',
      randomState: 42,
    },
  )
  const empty: ProjectFile = {
    document,
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
  return addImages(
    empty,
    seeds.map((seed) => {
      const bytes = photo(seed)
      return { hash: hashBytes(bytes), bytes, category: '개' }
    }),
    { canonicalSize: BACKBONE.canonicalSize, now: NOW, format: 'webp' },
  ).project
}

/**
 * 가짜 임베딩 워커. **받은 사진의 첫 바이트를 벡터 전체에 채워 돌려준다** — 어느 사진의
 * 벡터인지 값만 보고 알 수 있어야 자르는 순서를 검사할 수 있다.
 */
function fakeWorker(seen: { requests: EmbedRequest[] }): EmbedWorker {
  const worker: EmbedWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(request) {
      seen.requests.push(request)
      const vectors = new Float32Array(request.images.length * DIM)
      request.images.forEach((image, index) => {
        vectors.fill(image[0] ?? 0, index * DIM, (index + 1) * DIM)
      })
      const message: EmbedMessage = { type: 'done', vectors, dim: DIM }
      queueMicrotask(() => worker.onmessage?.({ data: message } as MessageEvent<EmbedMessage>))
    },
    terminate() {},
  }
  return worker
}

describe('표는 정본을 그대로 넘긴다', () => {
  it('정본이 없으면 거부한다 - 조용히 빈 표로 학습하면 지표가 NaN인 채로 끝난다', async () => {
    const document = newProjectDocument(
      { name: '붓꽃', locale: 'ko', dataType: 'tabular' },
      {
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: '2026-08-12T08:00:00.000Z',
        randomState: 42,
      },
    )
    const empty: ProjectFile = {
      document,
      models: new Map(),
      images: new Map(),
      attachments: new Map(),
      embeddings: new Map(),
    }
    // **던지는 것이 아니라 거부한다.** 둘이 섞이면 부르는 쪽이 한쪽을 빠뜨린다.
    await expect(trainingSourceOf({ project: empty, taskType: 'classification' })).rejects.toThrow()
  })
})

/**
 * **이미지도 유형에 안 맞는 모델을 학습에 안 넘긴다** (`open-decisions.md` 55, R38-D55 N2).
 * 거르는 자리가 종류마다 따로 갈리면 표에서만 걸러도 조용했다.
 */
describe('이미지도 잠긴 모델을 학습에 안 넘긴다', () => {
  it('군집이면 분류 전용 모델은 빠지고 파일의 선택은 그대로다', async () => {
    const base = imageProject(['a', 'b'])
    const project: ProjectFile = {
      ...base,
      document: {
        ...base.document,
        settings: {
          ...base.document.settings,
          selectedAlgorithms: [{ algorithm: 'k_means' }, { algorithm: 'knn' }],
        },
      },
    }
    const vectors = new Map(
      readImages(project).map((entry, index) => [entry.hash, new Float32Array(DIM).fill(index)]),
    )
    const source = await trainingSourceOf({
      project: addEmbeddings(project, BACKBONE.id, vectors),
      taskType: 'clustering',
      createEmbedWorker: () => fakeWorker({ requests: [] }),
    })
    expect(source.settings.selectedAlgorithms.map((one) => one.algorithm)).toEqual(['k_means'])
    expect(project.document.settings.selectedAlgorithms).toHaveLength(2)
  })
})

describe('이미지는 없는 것만 뽑는다', () => {
  it('다 있으면 워커를 안 띄운다', async () => {
    const project = imageProject(['a', 'b'])
    const vectors = new Map(
      readImages(project).map((entry, index) => [
        entry.hash,
        new Float32Array(DIM).fill(index + 1),
      ]),
    )
    const seen = { requests: [] as EmbedRequest[] }
    const source = await trainingSourceOf({
      project: addEmbeddings(project, BACKBONE.id, vectors),
      taskType: 'clustering',
      createEmbedWorker: () => fakeWorker(seen),
    })
    expect(seen.requests).toEqual([])
    expect(source.dataset.rows).toHaveLength(2)
  })

  it('없는 것만 워커에 넘긴다', async () => {
    const project = imageProject(['a', 'b', 'c'])
    const [first] = readImages(project)
    const seen = { requests: [] as EmbedRequest[] }
    await trainingSourceOf({
      project: addEmbeddings(
        project,
        BACKBONE.id,
        new Map([[first!.hash, new Float32Array(DIM).fill(9)]]),
      ),
      taskType: 'clustering',
      createEmbedWorker: () => fakeWorker(seen),
    })
    expect(seen.requests[0]?.images).toHaveLength(2)
  })

  /**
   * **여기가 조용히 틀리는 자리다.** 워커는 벡터를 이어 붙여 하나로 주고, 그것을 잘라
   * 해시에 다시 붙인다. 한 칸 밀리면 개 사진이 고양이의 벡터를 갖는다.
   */
  it('이어 붙은 벡터를 사진마다 제 몫으로 자른다', async () => {
    const project = imageProject(['a', 'b', 'c'])
    const seen = { requests: [] as EmbedRequest[] }
    const source = await trainingSourceOf({
      project,
      taskType: 'clustering',
      createEmbedWorker: () => fakeWorker(seen),
    })

    const stored = readEmbeddings(source.project, BACKBONE.id, DIM)
    for (const entry of readImages(project)) {
      // 가짜 워커가 채워 준 값은 그 사진의 첫 바이트다.
      expect(stored.get(entry.hash)?.[0], entry.hash).toBe(entry.bytes[0])
    }
  })

  /** 뽑은 것이 프로젝트에 남아야 다음 학습에서 다시 안 뽑는다 (mlpx-spec.md §1.3). */
  it('뽑은 임베딩이 프로젝트에 붙어서 나온다', async () => {
    const project = imageProject(['a', 'b'])
    const seen = { requests: [] as EmbedRequest[] }
    const source = await trainingSourceOf({
      project,
      taskType: 'clustering',
      createEmbedWorker: () => fakeWorker(seen),
    })
    expect(project.embeddings.size).toBe(0)
    expect(readEmbeddings(source.project, BACKBONE.id, DIM).size).toBe(2)
  })

  /** 테스트 사진을 안 올렸으면 나눌 것도 채점할 것도 파일에서 안 온다. */
  it('테스트 사진이 없으면 테스트 표도 없다', async () => {
    const seen = { requests: [] as EmbedRequest[] }
    const source = await trainingSourceOf({
      project: imageProject(['a']),
      taskType: 'clustering',
      createEmbedWorker: () => fakeWorker(seen),
    })
    expect(source.testDataset).toBeNull()
  })

  /** 표의 행 번호를 사진으로 되돌리는 값이다. 지금 읽는 화면은 없다(`TrainingSource.rowHashes`). */
  it('행 번호가 사진 해시로 되돌아간다', async () => {
    const project = imageProject(['a', 'b'])
    const seen = { requests: [] as EmbedRequest[] }
    const source = await trainingSourceOf({
      project,
      taskType: 'clustering',
      createEmbedWorker: () => fakeWorker(seen),
    })
    expect(source.rowHashes).toEqual(readImages(project).map((entry) => entry.hash))
  })
})

/**
 * **테스트용 사진이 학습까지 닿는가** (R11 감사 A-1·A-2).
 *
 * **임베딩을 미리 채우지 않는다.** 그것이 이 블록의 전부다 — 미리 채운 픽스처는 뽑는
 * 경로를 한 번도 안 지나가므로, **테스트 사진의 임베딩을 안 뽑는 돌연변이가 초록으로
 * 살아남았다.** 그 돌연변이가 만드는 동작이 정확히 R10 A-1(배포되어 나갔던 결함)이다.
 *
 * 사진마다 첫 바이트를 달리 준다 — 가짜 워커가 그 값을 벡터에 채우므로 **어느 사진의
 * 벡터가 어느 줄에 앉았는지**를 값만 보고 가를 수 있다.
 */
describe('테스트용 사진이 학습까지 닿는다', () => {
  const SIZE = BACKBONE.canonicalSize

  function baked(mark: number, category: string) {
    const bytes = new Uint8Array([mark, 2, 3])
    return { hash: hashBytes(bytes), bytes, category }
  }

  /** 훈련 둘·테스트 둘. **임베딩은 하나도 없다** — 실물에서 막 올린 상태다. */
  function project(): ProjectFile {
    const document = newProjectDocument(
      { name: '개와 고양이', locale: 'ko', dataType: 'image' },
      {
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: '2026-08-12T08:00:00.000Z',
        randomState: 42,
      },
    )
    const empty: ProjectFile = {
      document,
      models: new Map(),
      images: new Map(),
      attachments: new Map(),
      embeddings: new Map(),
    }
    const base = addImages(empty, [baked(1, '개'), baked(2, '고양이')], {
      canonicalSize: SIZE,
      now: NOW,
      format: 'webp',
    }).project
    return applyTestImages(base, [baked(3, '개'), baked(4, '고양이')], {
      canonicalSize: SIZE,
      now: NOW,
      format: 'webp',
    }).project
  }

  it('테스트 사진의 임베딩도 함께 뽑는다 - 안 뽑으면 채점할 것이 없다', async () => {
    const seen = { requests: [] as EmbedRequest[] }
    const source = await trainingSourceOf({
      project: project(),
      taskType: 'classification',
      createEmbedWorker: () => fakeWorker(seen),
    })

    // 넷 다 뽑혀야 한다. 훈련 둘만 뽑으면 아래 표가 비고 학습이 곱게 선다.
    expect(seen.requests[0]?.images).toHaveLength(4)
    expect(source.testDataset, 'test photos were added but there is no table').not.toBeNull()
    expect(source.testDataset?.rows).toHaveLength(2)
  })

  /**
   * **채점할 자리가 없으면 안 뽑는다** (2026-08-30, R12 감사 C-5).
   *
   * `scored`의 `split.method === 'provided'` 조건을 떼도 저장소 전체가 초록이었다.
   * 떼면 holdout 분류에서도 테스트 자리를 훑어 **백본을 그만큼 더 돌린다** — 사진이
   * 많은 프로젝트에서 그것이 곧 학생이 기다리는 시간이다. 점수가 틀려지지는 않는다
   * (`experiment.ts`의 `testSource`가 같은 조건을 한 번 더 본다).
   */
  it('holdout이면 테스트 사진의 임베딩을 안 뽑는다', async () => {
    const base = project()
    const holdout: ProjectFile = {
      ...base,
      document: withSplit(base.document, { method: 'holdout' }, NOW),
    }
    const seen = { requests: [] as EmbedRequest[] }

    await trainingSourceOf({
      project: holdout,
      taskType: 'classification',
      createEmbedWorker: () => fakeWorker(seen),
    })

    // 훈련 둘만이다. 넷이면 테스트 자리까지 훑은 것이다.
    expect(seen.requests[0]?.images).toHaveLength(2)
  })

  /**
   * **라벨 없는 사진은 분류의 훈련 행이 아니다** (2026-08-30, R12 감사 C-5).
   *
   * 이 수가 `ml/backend.ts`의 실행 위치·상한 판정으로 간다 — R12-4 A-1이 잡은 것과
   * 같은 계통이라 **틀려도 예외가 안 나고 카드의 숫자만 조용히 어긋난다.**
   * 군집화에는 라벨이 없으므로 그때는 전부 센다.
   */
  it('라벨 없는 사진을 분류는 안 세고 군집은 센다', () => {
    const base = project()
    const withUnlabeled = addImages(base, [baked(9, IMAGE_UNLABELED)], {
      canonicalSize: SIZE,
      now: NOW,
      format: 'webp',
    }).project

    expect(trainableRowsOf(withUnlabeled, 'classification')).toBe(2)
    expect(trainableRowsOf(withUnlabeled, 'clustering')).toBe(3)
  })

  /**
   * **예상 시간의 클래스 수는 라벨 붙은 범주 수이고, 분류에서만 선다**
   * (`open-decisions.md` "88. 학습 예상 시간이 클래스 수를 보는가"). 군집에 수를 넘기면
   * 클래스 배수가 없는 자리에 붙는다.
   */
  it('사진의 클래스 수는 라벨 붙은 범주만 세고 분류에서만 낸다', () => {
    const withUnlabeled = addImages(project(), [baked(9, IMAGE_UNLABELED)], {
      canonicalSize: SIZE,
      now: NOW,
      format: 'webp',
    }).project

    expect(trainingClassesOf(withUnlabeled, 'classification')).toBe(2)
    expect(trainingClassesOf(withUnlabeled, 'clustering')).toBeUndefined()
    expect(trainingClassesOf(withUnlabeled, undefined)).toBeUndefined()
  })

  /** 표는 타깃 열의 값 종류 수다 — **빈 칸은 종류가 아니다.** */
  it('표의 클래스 수는 타깃 값 종류이고 빈 칸을 안 센다', async () => {
    const survey = await surveyProject(true)
    expect(trainingClassesOf(survey, 'classification')).toBe(2)
    expect(trainingClassesOf(survey, 'regression')).toBeUndefined()
  })

  /**
   * **학습과 같은 규칙으로 센다** (G 검토 B3). 학습은 타깃을 `trim()`해 읽고 공백뿐인 칸을 결측으로
   * 본다(`ml/preprocess.ts`의 `targetValues`·`isMissing`). 따로 세면 `'남 '`이 셋째 클래스가 되고
   * 공백 칸이 넷째가 된다.
   */
  it('표의 클래스 수는 앞뒤 공백을 떼고 공백 칸을 결측으로 센다', async () => {
    const lines = ['키,성별']
    const sexes = ['남', '여', '남 ', ' 여', '   ', '']
    sexes.forEach((sex, index) => lines.push(`${150 + index},"${sex}"`))
    const csv = new TextEncoder().encode(`${lines.join('\n')}\n`)
    const project = await tabularProjectFrom(csv, '공백.csv', {
      taskType: 'classification',
      target: '성별',
      features: ['키'],
      preprocessing: {},
    })
    expect(trainingClassesOf(project, 'classification')).toBe(2)
  })

  /**
   * **값이 옳은 자리에 앉는가.** 열 이름과 줄 수만 보면 라벨을 앞에 붙여도 통과한다 —
   * 그 상태에서 학습은 예외 없이 끝까지 돌고 **정확도만 바닥으로 나온다.**
   */
  it('테스트 표는 벡터 뒤에 라벨이다', async () => {
    const seen = { requests: [] as EmbedRequest[] }
    const source = await trainingSourceOf({
      project: project(),
      taskType: 'classification',
      createEmbedWorker: () => fakeWorker(seen),
    })

    const rows = source.testDataset?.rows ?? []
    for (const row of rows) {
      // 마지막 칸이 라벨, 나머지가 벡터다.
      expect(row).toHaveLength(DIM + 1)
      expect(row[DIM], 'the last cell is not the label').toMatch(/개|고양이/)
      expect(Number(row[0]), 'the first cell is not the vector').toBeGreaterThan(0)
    }
    // 3번 사진이 개, 4번이 고양이 - 벡터 값과 라벨이 짝을 지켜야 한다.
    expect(rows.map((row) => [row[0], row[DIM]])).toEqual([
      ['3', '개'],
      ['4', '고양이'],
    ])
  })

  /** 훈련 표에는 테스트 사진이 섞이지 않는다. 섞이면 점수가 자기 답을 다시 맞힌 값이 된다. */
  it('훈련 표에는 테스트 사진이 없다', async () => {
    const seen = { requests: [] as EmbedRequest[] }
    const source = await trainingSourceOf({
      project: project(),
      taskType: 'classification',
      createEmbedWorker: () => fakeWorker(seen),
    })
    expect(source.dataset.rows.map((row) => row[0])).toEqual(['1', '2'])
  })
})

/**
 * **결정 106 — 테스트 사진을 받은 뒤 범주를 고치면 학습이 이유와 함께 거절한다** (R43-1 감사 A-1).
 *
 * 올릴 때만 범주를 대조하던 동안, 데이터 화면에서 범주를 고친 뒤 학습하면 테스트 자리가 옛 이름 그대로라
 * **모델이 낼 수 없는 라벨로 채점되어** 완벽한 모델이 정확도 0.5로 나왔다. 던지지 않았다. 편집은 전부
 * 진짜 입구(`project/images.ts`)로 하고, 거절은 백본을 부르기 **전**이어야 한다 — 받은 뒤에 서면 학생은
 * 몇 분을 기다린 끝에 거절을 읽는다.
 */
describe('결정 106 — 테스트 사진을 받은 뒤 범주를 고치면 학습이 거절한다 (이름 바꾸기·지우기는 개정 2로 학습한다)', () => {
  const SIZE = BACKBONE.canonicalSize
  const options = { canonicalSize: SIZE, now: NOW, format: 'webp' as const }

  function baked(mark: number, category: string) {
    const bytes = new Uint8Array([mark, 7, 7])
    return { hash: hashBytes(bytes), bytes, category }
  }

  const fox = baked(3, '여우')

  /** 훈련 셋·테스트 셋, 범주 셋. **범주가 둘로 줄어도 분류가 성립하게** 셋으로 둔다. */
  function project(): ProjectFile {
    const document = newProjectDocument(
      { name: '동물', locale: 'ko', dataType: 'image' },
      {
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: '2026-08-12T08:00:00.000Z',
        randomState: 42,
      },
    )
    const empty: ProjectFile = {
      document,
      models: new Map(),
      images: new Map(),
      attachments: new Map(),
      embeddings: new Map(),
    }
    const base = addImages(empty, [baked(1, '개'), baked(2, '고양이'), fox], options).project
    return applyTestImages(base, [baked(4, '개'), baked(5, '고양이'), baked(6, '여우')], options)
      .project
  }

  /** 학습을 시작해 본다. 결과를 낱말로 줄인다 — 거절이면 그 코드와 인자, 아니면 `'started'`. */
  async function attempt(edited: ProjectFile) {
    const seen = { requests: [] as EmbedRequest[] }
    const outcome = await trainingSourceOf({
      project: edited,
      taskType: 'classification',
      createEmbedWorker: () => fakeWorker(seen),
    }).then(
      () => ({ code: 'started', params: {} as unknown }),
      (error: unknown) =>
        isClientError(error)
          ? { code: error.code as string, params: error.params as unknown }
          : { code: 'other error', params: {} as unknown },
    )
    return { ...outcome, embedded: seen.requests.length }
  }

  it('고치지 않았으면 학습한다', async () => {
    expect((await attempt(project())).code).toBe('started')
  })

  /**
   * **이름 바꾸기와 범주 지우기는 테스트 자리도 고치므로 학습한다** (106 개정 2). 전에는 둘 다 여기서 거절됐다 — 테스트 자리가
   * 옛 이름 그대로였다. 대조는 아래 셋(새 범주로 옮기기·한 범주 비우기)에 안전망으로 남는다.
   */
  it('범주 이름을 바꿔도 학습한다 — 테스트 사진이 따라간다', async () => {
    expect((await attempt(renameCategory(project(), '개', '강아지', NOW))).code).toBe('started')
  })

  it('범주를 지워도 학습한다 — 그 범주의 테스트 사진이 함께 지워진다', async () => {
    expect((await attempt(removeCategory(project(), '여우', NOW))).code).toBe('started')
  })

  it('사진을 새 범주로 옮기면 거절한다', async () => {
    const result = await attempt(
      moveImages(addCategory(project(), '늑대', NOW), [fox.hash], '늑대', NOW),
    )
    expect(result).toEqual({
      code: 'TEST_IMAGES_CATEGORY_MISSING',
      params: { categories: '늑대' },
      embedded: 0,
    })
  })

  /**
   * **빈 칸으로 남은 범주는 훈련에 없는 범주다.** 사진을 다 지워도 범주 목록에는 남으므로(`removeImages`) 화면의
   * 목록과 견주면 통과했다 — 그러면 모델이 한 번도 못 본 `여우`로 채점된다.
   */
  it('한 범주의 사진을 다 지우면 거절한다', async () => {
    const result = await attempt(removeImages(project(), [fox.hash], NOW))
    expect(result).toEqual({
      code: 'TEST_IMAGES_CATEGORY_UNKNOWN',
      params: { categories: '여우' },
      embedded: 0,
    })
  })

  /**
   * **빈 범주가 있어도 학습한다** (결정 106 개정, 0.34.2 diff 감사 B-1). 빈 범주는 훈련 사진이 든 범주가 아니므로 테스트 사진도 그
   * 폴더를 안 갖는다 — 올릴 때(`ImagePrepPanel.vue`)가 같은 목록(`trainedCategories`)으로 그렇게 받는다.
   */
  it('빈 범주가 있어도 학습한다 - 올릴 때와 같은 목록이다', async () => {
    expect((await attempt(addCategory(project(), '늑대', NOW))).code).toBe('started')
  })

  it('holdout이면 테스트 자리를 대조하지 않는다', async () => {
    const renamed = renameCategory(project(), '개', '강아지', NOW)
    const holdout: ProjectFile = {
      ...renamed,
      document: withSplit(renamed.document, { method: 'holdout' }, NOW),
    }
    expect((await attempt(holdout)).code).toBe('started')
  })
})

/**
 * **화면이 등록부에 넘기는 것.**
 *
 * 학습 화면 안의 computed로 있던 동안 `dataType`을 기본 종류로 고정해도 저장소 전체가
 * 초록이었고 타입도 조용했다 (R13-3 감사 A-2). 타입이 필수로 만들어 두어 빠뜨릴 수는
 * 없지만 **틀린 값을 넣는 것은 아무도 안 봤다** — 그러면 사진 프로젝트가 표의 상한
 * 칸으로 재어지고, 사유 코드가 갈려 사진을 지워야 할 학생이 "행을 줄이라"를 읽는다.
 */
describe('실행 방법 판정에 넘기는 것', () => {
  it('이미지 프로젝트는 이미지 종류로 넘어간다', () => {
    const context = runtimeContextFor(imageProject(['a', 'b']), 'tabular')

    expect(context.dataType).toBe('image')
  })

  it('사진 수를 센다 - 파일의 행 수가 아니다', () => {
    // **`trainableRowsOf`와 견주지 않는다** — 같은 함수를 두 번 부르는 자기 대조라
    // 둘이 함께 틀리면 언제나 맞는다 (R13-5 감사). 손으로 적은 수와 견준다.
    expect(runtimeContextFor(imageProject(['a', 'b', 'c']), 'tabular').rowCount).toBe(3)
  })

  /**
   * **과제 유형도 파일에서 뽑는다.** 화면이 넘기게 두었을 때 그 인자가 검사 밖이었고,
   * `undefined`로 고정해도 저장소 전체가 초록이었다 (R13-5 감사 A-6).
   *
   * 틀리면 군집화 이미지 프로젝트의 사진 수가 **라벨 붙은 것만으로 줄어든다.** 그러면
   * 500장이 상한인 이미지 랜덤포레스트 카드가 열린 채로 서고, 학생이 누르면 700장으로
   * 학습이 돈다 — `limits.ts`가 그 자리를 막으려고 세운 값이 지나간다.
   */
  it('군집이면 라벨 없는 사진도 센다 - 유형을 파일에서 뽑는다', () => {
    const bytes = photo('unlabeled')
    const base = addImages(
      imageProject(['a', 'b']),
      [{ hash: hashBytes(bytes), bytes, category: IMAGE_UNLABELED }],
      { canonicalSize: BACKBONE.canonicalSize, now: NOW, format: 'webp' },
    ).project

    const withTask = (taskType: 'classification' | 'clustering'): ProjectFile => ({
      ...base,
      document: {
        ...base.document,
        manifest: { ...base.document.manifest, taskType },
      },
    })

    expect(runtimeContextFor(withTask('clustering'), 'tabular').rowCount).toBe(3)
    expect(runtimeContextFor(withTask('classification'), 'tabular').rowCount).toBe(2)
  })

  it('프로젝트가 없으면 0행이고 서버 상태는 모른다', () => {
    const context = runtimeContextFor(null, 'tabular')

    expect(context.rowCount).toBe(0)
    expect(context.serverStatus).toBe('unknown')
  })
})

/**
 * **모델 목록을 고르는 축도 화면 몫이 아니다.**
 *
 * `runtimeContextFor`를 밖으로 뺀 뒤에도 **같은 호출의 첫째 인자가 화면에 남아 검사
 * 밖이었다** (R14-3 감사 A-4). 종류가 틀리면 `supports(algorithm.dataTypes, …)`가
 * 뒤집혀 이미지 프로젝트에 표 전용 알고리즘 카드가 켜진 채로 선다.
 *
 * **종류를 뽑는 자리가 `runtimeContextFor`와 같은지도 함께 본다** — 둘이 갈리면
 * 카드가 열리는 판정과 그 카드의 상한이 서로 다른 종류를 본다.
 */
describe('모델 목록에 넘기는 선택 축', () => {
  it('열린 프로젝트의 종류를 쓴다', () => {
    const project = imageProject(['a'])
    expect(algorithmSelectionFor(project, 'classification', 'tabular')).toEqual({
      dataType: 'image',
      taskType: 'classification',
    })
  })

  it('프로젝트가 없으면 화면이 준 것으로 떨어진다', () => {
    expect(algorithmSelectionFor(null, 'clustering', 'tabular')).toEqual({
      dataType: 'tabular',
      taskType: 'clustering',
    })
  })

  it('실행 방법 판정과 같은 종류를 본다', () => {
    const project = imageProject(['a'])
    expect(algorithmSelectionFor(project, 'classification', 'tabular').dataType).toBe(
      runtimeContextFor(project, 'tabular').dataType,
    )
  })
})

/**
 * **떠나면 끊을 수 있어야 한다** (2026-09-02 R20 A-3).
 *
 * 백본 12.4MB를 받는 동안 학생이 화면을 떠나면, 손잡이가 없던 때는 아무도 안 듣는
 * 내려받기가 계속 돌고 **끝나서는 닫힌 스토어에 옛 프로젝트를 앉혔다.** 화면이 끊으려면
 * 준비가 **기다리기 시작하기 전에** 손잡이를 건네야 한다.
 */
describe('준비를 끊는 손잡이', () => {
  /** 답하지 않는 워커. 끊지 않으면 이 약속은 영원히 안 끝난다. */
  function silentWorker(): EmbedWorker {
    return {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage() {},
      terminate() {},
    }
  }

  it('기다리기 전에 건네므로 그 사이에 떠난 화면도 끊을 수 있다', async () => {
    let handle: { cancel: () => void } | null = null
    const pending = trainingSourceOf({
      project: imageProject(['a']),
      taskType: 'clustering',
      createEmbedWorker: silentWorker,
      onHandle: (given) => {
        handle = given
      },
    })
    // **`await`을 한 번도 안 걸고 본다** — 기다린 뒤에 건네면 여기서 아직 `null`이다.
    expect(handle).not.toBeNull()

    handle!.cancel()
    await expect(pending).rejects.toMatchObject({ code: 'JOB_CANCELLED' })
  })

  it('뽑을 것이 없으면 손잡이도 없다 - 워커를 안 띄우기 때문이다', async () => {
    const project = imageProject(['a'])
    const vectors = new Map(
      readImages(project).map((entry) => [entry.hash, new Float32Array(DIM).fill(1)]),
    )
    let called = false
    await trainingSourceOf({
      project: addEmbeddings(project, BACKBONE.id, vectors),
      taskType: 'clustering',
      createEmbedWorker: silentWorker,
      onHandle: () => {
        called = true
      },
    })
    expect(called).toBe(false)
  })
})

/**
 * **학습 화면이 예상 시간에 넘기는 입력** (`trainingEstimateShape`·`trainingEstimateInput`). 누르기 전의
 * 예상과 학습 뒤의 배수 보정이 이 둘을 함께 부른다. 화면 안에 있을 때는 두 자리에서 `classes` 줄을
 * 지워도 아무 검사도 안 울었다 — 그러면 클래스 배수가 예상에서 빠지고, 배운 배수가 그 몫을 담는다.
 */
describe('예상 입력', () => {
  it('표 분류의 몫은 계획의 훈련 행·학습이 쓰는 특성 폭·타깃 값 종류다', async () => {
    const survey = await surveyProject(true)
    const plan = tabularPlanOf(survey)
    if (!plan?.ok) throw new Error('the survey plan must stand')

    expect(trainingEstimateShape(survey)).toEqual({
      dataType: 'tabular',
      rows: plan.split.trainIndices.length,
      // `키`의 `모름` 행은 타깃이 비어 빠지므로 두 특성 다 수치다 — 인코딩을 꺼도 한 칸씩이다.
      columns: 2,
      classes: 2,
    })
    expect(trainingEstimateShape(survey).classes).toBe(trainingClassesOf(survey, 'classification'))
  })

  /** **유형은 파일에서 뽑는다.** 군집에는 클래스가 없고, 나누지 않으므로 쓸 수 있는 행이 전부다. */
  it('군집의 몫은 클래스 수가 비고 행이 전부다', async () => {
    const file = await tabularProjectFrom(surveyCsv(false), '설문.csv', {
      taskType: 'clustering',
      target: '성별',
      features: ['몸무게'],
      preprocessing: {},
    })
    const shape = trainingEstimateShape(file)
    expect(shape.classes).toBeUndefined()
    expect(shape.rows).toBe(trainableRowsOf(file, 'clustering'))
    expect(shape.rows).toBe(40)
  })

  it('한 줄의 입력은 몫 전부에 그 알고리즘·그 실행 방법의 손잡이를 붙인다', () => {
    const shape = { dataType: 'tabular', rows: 120, columns: 5, classes: 4 } as const
    const hyperparameters = {
      decision_tree: { mljs: { maxDepth: 3 }, 'pyodide-sklearn': { max_depth: 9 } },
      knn: { mljs: { k: 7 } },
    }
    expect(
      trainingEstimateInput(
        shape,
        { algorithm: 'decision_tree', runtime: 'mljs' },
        hyperparameters,
      ),
    ).toEqual({
      algorithm: 'decision_tree',
      dataType: 'tabular',
      rows: 120,
      columns: 5,
      hyperparameters: { maxDepth: 3 },
      runtime: 'mljs',
      classes: 4,
    })
    // 손잡이가 없는 조합은 빈 것이다 — 기본값으로 본다.
    expect(
      trainingEstimateInput(shape, { algorithm: 'svm', runtime: 'server' }, hyperparameters)
        .hyperparameters,
    ).toEqual({})
  })

  /** 분류가 아니면 칸이 비어 있어야 클래스 배수가 안 붙는다 — 칸을 지어내지 않는다. */
  it('클래스 수가 빈 몫은 입력에도 빈다', () => {
    const shape = { dataType: 'image', rows: 30, columns: 0, classes: undefined } as const
    const input = trainingEstimateInput(shape, { algorithm: 'knn', runtime: 'mljs' }, {})
    expect(input.classes).toBeUndefined()
  })
})
