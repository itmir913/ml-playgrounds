/**
 * **과거 배포판이 쓴 `.mlpx`를 지금 코드가 연다** (`docs/mlpx-spec/05-versions.md` §9.5,
 * `tests/fixtures/legacy/README.md`).
 *
 * 골든은 태그마다 그 태그의 코드로 지었다(`scripts/legacy-mlpx/generate.sh`). 표 하나·사진 하나를
 * 짓고 그 버전에서 mljs로 학습할 수 있던 모델을 전부 담았으며, **그 버전이 그 파일을 다시 열어 낸
 * 답과 확률**을 `answers.json`에 적었다. 여기서는 넷을 본다.
 *
 * 1. **열린다** — 마이그레이션을 거쳐 스키마를 지나고, 해시 대조가 `UNCHANGED`이고, 백본이 등록부에 있다.
 * 2. **같은 답이다** — 모델마다 그 버전이 적은 답(확률을 내는 모델은 확률까지)과 같다. 다른 것은
 *    `EXPECTED_CHANGES`에 이유와 함께 적힌 것뿐이다.
 * 3. **다시 써도 같다** — 지금 코드로 쓰고 읽은 파일에서도 같은 답이다.
 * 4. **사진을 더하면 KNN만 꺼진다** — 과거 파일에는 행마다의 열쇠가 없다(결정 111).
 *
 * 이 검사가 우는 날은 **과거 파일과의 호환이 깨진 날이다.** 기대값을 고치지 말고 깬 쪽을 되돌려라.
 * 골든은 다시 짓지 않는다 — 역사다.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { hashBytes } from '../src/hash'
import { DEFAULT_BACKBONE_ID, backboneFor } from '../src/ml/backbones'
import { embeddingColumns, imageLoadContext, imageTrainingRows } from '../src/ml/images'
import { transform } from '../src/ml/preprocess'
import { readEmbeddings } from '../src/project/embeddings'
import { readProject, writeProject, type ProjectFile } from '../src/project/format'
import { addImages } from '../src/project/images'
import { dataSettings, dataSnapshot } from '../src/project/schema'

import {
  answersOf,
  expectSameAnswer,
  expectSameProbabilities,
  tabularAnswers,
  type Answers,
} from './fixtures/legacy-answers'

const ROOT = join(__dirname, 'fixtures', 'legacy')
const BACKBONE = backboneFor(DEFAULT_BACKBONE_ID)!
const DIM = BACKBONE.embeddingDim
const NOW = '2026-10-08T09:00:00.000Z'

type Kind = 'tabular' | 'image'

interface Recorded {
  readonly tag: string
  readonly formatVersion: number
  readonly tabular: Answers & { readonly queries: Record<string, string>[] }
  readonly image: Answers & { readonly querySeeds: { weight: number; index: number }[] }
}

/**
 * **그 버전과 다른 답이 맞는 자리.** 열쇠는 `태그/파일/알고리즘`, 값은 지금 코드가 내야 하는 답이다.
 * 여기 줄을 더하는 것은 "이 과거 파일은 이제 이렇게 된다"고 정하는 일이다 — 이유를 함께 적어라.
 */
const EXPECTED_CHANGES: Readonly<
  Record<string, { readonly answer: unknown; readonly why: string }>
> = {
  '0.9.0/image/knn': {
    answer: { error: 'MODEL_TRAINING_DATA_CHANGED' },
    why:
      'v1 파일의 백본 id(mobilenet-v2)는 마이그레이션이 개정판으로 바꾸고, 옛 id의 임베딩은 읽을 때 ' +
      'dropUnknownBackbones가 뗀다. 예측 화면은 훈련 사진을 다시 뽑지 않으므로 KNN은 행을 못 세운다 — ' +
      '0.9.x 자신은 답했고 0.10.0~0.35.4는 MODEL_NEEDS_DATASET이었다. 결정 111의 문구 문단이 정한 답이다.',
  },
}

function tags(): string[] {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
}

function recordedOf(tag: string): Recorded {
  return JSON.parse(readFileSync(join(ROOT, tag, 'answers.json'), 'utf8')) as Recorded
}

async function open(tag: string, kind: Kind) {
  return readProject(new Uint8Array(readFileSync(join(ROOT, tag, `${kind}.mlpx`))))
}

async function rewritten(project: ProjectFile): Promise<ProjectFile> {
  const { blob } = await writeProject(project, '# legacy fixture\n')
  return (await readProject(new Uint8Array(await blob.arrayBuffer()))).project
}

/** 생성기의 `vectorOf`와 같은 식이다 — 질의를 파일 밖에서 똑같이 짓는다. 바꾸면 둘 다 바꿔라. */
function vectorOf(weight: number, index: number): Float32Array {
  const vector = new Float32Array(DIM)
  for (let at = 0; at < DIM; at += 1) {
    const firstHalf = at < DIM / 2
    vector[at] = (firstHalf ? weight : 1 - weight) + ((at * 7 + index * 13) % 17) / 170
  }
  return vector
}

function imageAnswers(project: ProjectFile, seeds: { weight: number; index: number }[]): Answers {
  const vectors = readEmbeddings(project, BACKBONE.id, DIM)
  const queries = {
    columns: embeddingColumns(DIM),
    rows: seeds.map(({ weight, index }) =>
      Array.from(vectorOf(weight, index), (value) => String(value)),
    ),
  }
  return answersOf(
    project,
    (experiment, preprocessor, format) =>
      imageLoadContext(format, () =>
        imageTrainingRows(
          project,
          experiment,
          preprocessor,
          BACKBONE,
          vectors,
          experiment.settings.taskType,
        ),
      ),
    (_, preprocessor) =>
      transform(
        preprocessor,
        queries,
        seeds.map((__, index) => index),
      ),
  )
}

function answersFor(kind: Kind, project: ProjectFile, recorded: Recorded): Answers {
  return kind === 'tabular'
    ? tabularAnswers(project, recorded.tabular.queries)
    : imageAnswers(project, recorded.image.querySeeds)
}

function expectAnswers(tag: string, kind: Kind, actual: Answers, recorded: Answers): void {
  expect(Object.keys(actual.answers).sort(), `${tag}/${kind}: the same models`).toEqual(
    Object.keys(recorded.answers).sort(),
  )
  for (const [key, value] of Object.entries(recorded.answers)) {
    const algorithm = key.split('/').at(-1) ?? ''
    const change = EXPECTED_CHANGES[`${tag}/${kind}/${algorithm}`]
    expectSameAnswer(actual.answers[key], change ? change.answer : value, `${tag}/${kind}/${key}`)
  }
  for (const [key, value] of Object.entries(recorded.probabilities)) {
    const algorithm = key.split('/').at(-1) ?? ''
    if (EXPECTED_CHANGES[`${tag}/${kind}/${algorithm}`]) continue
    expectSameProbabilities(actual.probabilities[key], value, `${tag}/${kind}/${key} (proba)`)
  }
}

describe('과거 배포판의 .mlpx', () => {
  it('골든이 있다 — 비어 있으면 이 검사는 아무것도 안 잰다', () => {
    expect(tags().length).toBeGreaterThan(0)
  })

  /** 확률을 하나도 안 적었으면 2의 확률 대조가 아무것도 안 잰다. */
  it('확률을 내는 모델의 확률이 적혀 있다', () => {
    for (const tag of tags()) {
      const recorded = recordedOf(tag)
      expect(Object.keys(recorded.tabular.probabilities).length, tag).toBeGreaterThan(0)
      expect(Object.keys(recorded.image.probabilities).length, tag).toBeGreaterThan(0)
    }
  })

  /** 적힌 예외가 실재하는 골든을 가리키는가. 오타는 조용히 아무것도 안 바꾼다. */
  it('EXPECTED_CHANGES의 열쇠가 골든에 있다', () => {
    for (const key of Object.keys(EXPECTED_CHANGES)) {
      const [tag, kind, algorithm] = key.split('/')
      const answers = recordedOf(tag!)[kind as Kind].answers
      expect(
        Object.keys(answers).some((one) => one.endsWith(`/${algorithm}`)),
        key,
      ).toBe(true)
    }
  })

  for (const tag of tags()) {
    describe(tag, { timeout: 120_000 }, () => {
      const recorded = recordedOf(tag)

      it('표 파일이 열리고, 해시가 그대로이고, 같은 답을 낸다', async () => {
        const { project, integrity } = await open(tag, 'tabular')
        expect(integrity.status).toBe('UNCHANGED')
        expectAnswers(tag, 'tabular', answersFor('tabular', project, recorded), recorded.tabular)
      })

      it('사진 파일이 열리고, 해시가 그대로이고, 백본을 알고, 같은 답을 낸다', async () => {
        const { project, integrity } = await open(tag, 'image')
        expect(integrity.status).toBe('UNCHANGED')
        // **연 프로젝트의 백본이 등록부에 있다.** 없으면 예측·학습 화면이 `BACKBONE_UNAVAILABLE`로 선다 —
        // v1 파일은 마이그레이션이 옛 id(`mobilenet-v2`)를 개정판으로 바꿔야 여기를 지난다(mlpx-spec.md §9.1).
        const ids = [
          dataSettings('image', project.document.settings).backboneId,
          ...project.document.runs.experiments.map(
            (experiment) => dataSnapshot('image', experiment.settings).backboneId,
          ),
        ]
        for (const id of ids) expect(backboneFor(id), `${tag}: backbone ${id}`).toBeDefined()
        expectAnswers(tag, 'image', answersFor('image', project, recorded), recorded.image)
      })

      it('지금 코드로 다시 쓰고 읽어도 같은 답이다', async () => {
        for (const kind of ['tabular', 'image'] as const) {
          const again = await rewritten((await open(tag, kind)).project)
          expectAnswers(tag, kind, answersFor(kind, again, recorded), recorded[kind])
        }
      })

      /**
       * **골든이 적은 형식 버전이 그 파일의 것이다.** 골든을 바꾸다 v1 파일이 빠지면 마이그레이션
       * 경로를 안 지나가는데, 열기만 보면 그것을 모른다 (코드 감사 C-6). 원본 manifest를 직접 읽는다.
       */
      it('파일의 형식 버전이 골든에 적힌 것과 같다', () => {
        for (const kind of ['tabular', 'image'] as const) {
          const entries = unzipSync(new Uint8Array(readFileSync(join(ROOT, tag, `${kind}.mlpx`))))
          const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json'])) as {
            formatVersion: number
          }
          expect(manifest.formatVersion, `${tag}/${kind}`).toBe(recorded.formatVersion)
        }
      })

      /**
       * **사진을 더하면** 나머지 모델은 훈련 행을 안 쓰므로 그대로다. KNN은 그 실험에 행마다의 열쇠가
       * 있으면(0.35.5~, 결정 111) 같은 답이고, 없으면 "다시 학습하라"로 꺼진다. 어느 쪽인지는 골든의
       * 스냅샷이 말한다 — 태그 번호로 가르지 않는다 (코드 감사 C-5).
       */
      it('사진을 더하면 열쇠가 없는 KNN만 꺼지고 나머지는 그대로다', async () => {
        const { project } = await open(tag, 'image')
        const bytes = new TextEncoder().encode(`legacy-spec:added:${tag}`)
        const more = addImages(project, [{ hash: hashBytes(bytes), bytes, category: '개' }], {
          canonicalSize: BACKBONE.canonicalSize,
          now: NOW,
          format: 'webp',
        }).project
        const actual = imageAnswers(more, recorded.image.querySeeds)
        const keyed = new Set(
          project.document.runs.experiments
            .filter(
              (experiment) => dataSnapshot('image', experiment.settings).rowKeys !== undefined,
            )
            .map((experiment) => experiment.id),
        )
        for (const [key, value] of Object.entries(recorded.image.answers)) {
          const change = EXPECTED_CHANGES[`${tag}/image/${key.split('/').at(-1) ?? ''}`]
          if (key.endsWith('/knn') && !keyed.has(key.split('/')[0] ?? '')) {
            expect(actual.answers[key], `${tag}/${key}`).toEqual({
              error: 'MODEL_TRAINING_DATA_CHANGED',
            })
          } else {
            expectSameAnswer(actual.answers[key], change ? change.answer : value, `${tag}/${key}`)
          }
        }
      })
    })
  }
})
