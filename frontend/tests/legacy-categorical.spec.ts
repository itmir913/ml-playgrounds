/**
 * **과거 배포판이 쓴 범주 열 `.mlpx`를 지금 코드가 연다** (`tests/fixtures/legacy-categorical/README.md`).
 *
 * `legacy-mlpx.spec.ts`의 짝이다. 그 골든은 붓꽃이라 수치 열뿐이어서, 범주 인코딩 경로 — v1 범주 열을 실험의 공통
 * 인코딩으로 채워 읽기, v2의 열별 인코딩·지정 순서 — 가 틀어져도 답이 안 바뀌어 울지 못했다(#45 감사).
 * 여기 골든은 범주 열이 든 데이터이고, 답은 **그 파일을 쓴 판의 코드가** 다시 열어 낸 것이다.
 *
 * 이 검사가 우는 날은 과거 파일과의 호환이 깨진 날이다. 기대값을 고치지 말고 깬 쪽을 되돌려라.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { readPreprocessors } from '../src/ml/predict'
import { readProject, writeProject, type ProjectFile } from '../src/project/format'

import {
  expectSameAnswer,
  expectSameProbabilities,
  tabularAnswers,
  type Answers,
} from './fixtures/legacy-answers'

const ROOT = join(__dirname, 'fixtures', 'legacy-categorical')
/** 생성기(`legacy-categorical.mjs`)가 질의에 넣는 훈련에 없던 값. */
const UNSEEN = '처음 보는 값'

interface Recorded extends Answers {
  readonly formatVersion: number
  readonly queries: Record<string, string>[]
}

interface Golden {
  readonly tag: string
  readonly files: Record<string, Recorded>
}

function tags(): string[] {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function goldenOf(tag: string): Golden {
  return JSON.parse(readFileSync(join(ROOT, tag, 'answers.json'), 'utf8')) as Golden
}

function bytesOf(tag: string, file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(ROOT, tag, file)))
}

async function rewritten(project: ProjectFile): Promise<ProjectFile> {
  const { blob } = await writeProject(project, '# legacy categorical fixture\n')
  return (await readProject(new Uint8Array(await blob.arrayBuffer()))).project
}

function expectAnswers(label: string, actual: Answers, recorded: Answers): void {
  expect(Object.keys(actual.answers).sort(), `${label}: the same models`).toEqual(
    Object.keys(recorded.answers).sort(),
  )
  for (const [key, value] of Object.entries(recorded.answers)) {
    expectSameAnswer(actual.answers[key], value, `${label}/${key}`)
  }
  for (const [key, value] of Object.entries(recorded.probabilities)) {
    expectSameProbabilities(actual.probabilities[key], value, `${label}/${key} (proba)`)
  }
}

/** 골든 전체의 범주 열 — 열마다 인코딩과 순서 지정 여부. */
async function categoricalColumns(): Promise<{ encoding: string; orderSpecified: boolean }[]> {
  const found: { encoding: string; orderSpecified: boolean }[] = []
  for (const tag of tags()) {
    for (const file of Object.keys(goldenOf(tag).files)) {
      const { project } = await readProject(bytesOf(tag, file))
      for (const preprocessor of readPreprocessors(project.document, project.models).values()) {
        for (const column of preprocessor.columns) {
          if (column.kind === 'categorical') {
            found.push({ encoding: column.encoding, orderSpecified: column.orderSpecified })
          }
        }
      }
    }
  }
  return found
}

describe('과거 배포판의 범주 열 .mlpx', () => {
  /**
   * **골든이 범주 경로를 실제로 지난다.** 범주 열이 없거나 한 인코딩뿐이면 이 검사도 붓꽃 골든처럼 아무것도
   * 못 문다. 서수·원-핫·지정 순서가 모두 있고, 질의에 훈련에 없던 값이 있다.
   */
  it('골든에 서수·원-핫·지정 순서 열과 처음 보는 값이 있다', async () => {
    expect(tags().length).toBeGreaterThan(0)
    const columns = await categoricalColumns()
    expect(columns.some((column) => column.encoding === 'ordinal')).toBe(true)
    expect(columns.some((column) => column.encoding === 'onehot')).toBe(true)
    expect(columns.some((column) => column.orderSpecified)).toBe(true)
    for (const tag of tags()) {
      for (const [file, recorded] of Object.entries(goldenOf(tag).files)) {
        const unseen = recorded.queries.some((query) => Object.values(query).includes(UNSEEN))
        expect(unseen, `${tag}/${file}`).toBe(true)
        expect(Object.keys(recorded.probabilities).length, `${tag}/${file}`).toBeGreaterThan(0)
      }
    }
  })

  for (const tag of tags()) {
    const golden = goldenOf(tag)
    for (const [file, recorded] of Object.entries(golden.files)) {
      describe(`${tag}/${file}`, { timeout: 120_000 }, () => {
        it('열리고, 해시가 그대로이고, 그 판과 같은 답을 낸다', async () => {
          const { project, integrity } = await readProject(bytesOf(tag, file))
          expect(integrity.status).toBe('UNCHANGED')
          expectAnswers(`${tag}/${file}`, tabularAnswers(project, recorded.queries), recorded)
        })

        it('지금 코드로 다시 쓰고 읽어도 같은 답이다', async () => {
          const again = await rewritten((await readProject(bytesOf(tag, file))).project)
          expectAnswers(`${tag}/${file}`, tabularAnswers(again, recorded.queries), recorded)
        })

        it('파일의 형식 버전이 골든에 적힌 것과 같다', () => {
          const entries = unzipSync(bytesOf(tag, file))
          const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json'])) as {
            formatVersion: number
          }
          expect(manifest.formatVersion).toBe(recorded.formatVersion)
        })
      })
    }
  }
})
