// @vitest-environment jsdom
/**
 * **어떤 프로젝트 상태에서도 흐름도가 던지지 않는다** (`architecture.md` §8.22).
 *
 * 흐름도는 대시보드와 도구 막대에 들어간다 — 흐름도 쪽 오류가 대시보드나 프로젝트 열기를 막으면 안 된다.
 * 열여섯 경우(`FLOW_CASES`)에 더해 **깨지기 쉬운 가장자리**를 훑는다: 새 프로젝트 직후, 별도 테스트 설정만 있고 파일이
 * 없는 것, 모르는 알고리즘·백본 id, 사진 0장, 옛 형식(마이그레이션)의 파일. 상태마다 모델·배치·수와 세 부품
 * (그림·카드·창)을 지나간다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import FlowCard from '../src/components/flow/FlowCard.vue'
import FlowDialog from '../src/components/flow/FlowDialog.vue'
import FlowDiagram from '../src/components/flow/FlowDiagram.vue'
import { i18n, setLocale } from '../src/i18n'
import { flowModelOf } from '../src/ml/flow'
import { flowCountsLite, flowCountsOf, barValuesOf } from '../src/ml/flow-counts'
import { FLOW_GEOMETRY, layoutOf } from '../src/ml/flow-layout'
import { factsOf } from '../src/project/facts'
import { readProject, type ProjectFile } from '../src/project/format'
import { edit, FLOW_CASES, photos, TWO_CATEGORIES, withTask } from './fixtures/flow-cases'
import { emptyProjectFile, projectFile, projectFileWithTestDataset } from './fixtures/project'

/** 가장자리 상태들. 이름은 위 설명의 목록과 같다. */
const EDGES: readonly (readonly [string, () => ProjectFile])[] = [
  ['새 프로젝트 직후(데이터 없음)', () => emptyProjectFile()],
  [
    '별도 테스트 설정만 있고 파일 없음',
    () =>
      edit(projectFile(), (file) => {
        file.document.settings.split.method = 'provided'
      }),
  ],
  [
    '모르는 알고리즘 id',
    () =>
      edit(projectFile(), (file) => {
        file.document.settings.selectedAlgorithms = [{ algorithm: 'no_such_algorithm' }]
      }),
  ],
  ['표 · 별도 테스트 데이터 · 유형 미정', () => withTask(projectFileWithTestDataset(), undefined)],
  ['사진 0장', () => photos([])],
  ['사진 · 한 범주', () => photos(['개'])],
  [
    '사진 · 모르는 백본 id',
    () =>
      photos(TWO_CATEGORIES, (file) => {
        Object.assign(file.document.settings.data, { backboneId: 'no_such_backbone' })
      }),
  ],
  [
    '사진 · 별도 테스트 설정만 있고 테스트 사진 없음',
    () =>
      photos(TWO_CATEGORIES, (file) => {
        file.document.settings.split.method = 'provided'
      }),
  ],
  ['사진 · 군집화', () => withTask(photos(TWO_CATEGORIES), 'clustering')],
  ['사진 · 유형 미정', () => withTask(photos(TWO_CATEGORIES), undefined)],
]

/** 옛 형식의 골든 파일. 마이그레이션을 지난 문서다. */
const LEGACY_DIR = join(process.cwd(), 'tests', 'fixtures', 'legacy')

async function legacyFiles(): Promise<[string, ProjectFile][]> {
  const found: [string, ProjectFile][] = []
  for (const version of ['0.10.0', '0.22.0', '0.35.5']) {
    for (const kind of ['tabular', 'image']) {
      try {
        const bytes = new Uint8Array(readFileSync(join(LEGACY_DIR, version, `${kind}.mlpx`)))
        const read = await Promise.resolve(readProject(bytes))
        found.push([`옛 형식 ${version} ${kind}`, read.project])
      } catch {
        // 그 버전에 그 종류의 골든이 없다.
      }
    }
  }
  return found
}

function mountEverything(file: ProjectFile): void {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => FLOW_GEOMETRY.width,
  })
  const diagram = mount(FlowDiagram, {
    props: { file, counts: flowCountsLite(file), bars: null, pinned: null },
    global: { plugins: [i18n] },
  })
  diagram.unmount()
  const card = mount(FlowCard, { props: { file }, global: { plugins: [i18n] } })
  card.unmount()
  const dialog = mount(FlowDialog, {
    props: { file, lite: true, open: true },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  dialog.unmount()
}

beforeEach(async () => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
    this.removeAttribute('open')
  }
  await setLocale('ko')
})

afterEach(() => {
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
  document.body.innerHTML = ''
})

const ALL: readonly (readonly [string, () => ProjectFile])[] = [
  ...FLOW_CASES.map((one) => [`경우 ${one.no} ${one.title}`, one.build] as const),
  ...EDGES,
]

describe.each(ALL)('%s', (_name, build) => {
  it('모델·배치·수가 던지지 않는다', async () => {
    const file = build()
    const model = flowModelOf(file, factsOf(file))
    if (model !== null) {
      for (const chipWrap of [false, true]) {
        const found = layoutOf(model, { bars: null, testSize: 0.2, chipWrap })
        expect(found.height).toBeGreaterThan(0)
      }
    }
    const lite = flowCountsLite(file)
    expect(() => barValuesOf(lite)).not.toThrow()
    const full = await flowCountsOf(file)
    expect(() => barValuesOf(full)).not.toThrow()
  })

  it('그림·카드·창이 던지지 않고 마운트된다', async () => {
    mountEverything(build())
    await flushPromises()
  })
})

describe('옛 형식 파일', () => {
  it('마이그레이션을 지난 문서에서도 던지지 않는다', async () => {
    const files = await legacyFiles()
    expect(files.length).toBeGreaterThan(0)
    for (const [, file] of files) {
      const model = flowModelOf(file, factsOf(file))
      if (model !== null) layoutOf(model, { bars: null, testSize: 0.2, chipWrap: false })
      flowCountsLite(file)
      await flowCountsOf(file)
      mountEverything(file)
      await flushPromises()
    }
  })
})
