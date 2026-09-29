// @vitest-environment jsdom
/**
 * **검사의 저장소를 지우는 길은 하나이고, 그 길이 스토어를 먼저 닫는다** (결정문 65 "관문이 흔들린
 * 원인 하나", #33).
 *
 * 앞 검사의 자동 저장 타이머(`AUTOSAVE_DELAY_MS`)가 검사가 끝난 뒤 터져 다음 검사의 저장소에 같은
 * `projectId`의 옛 파일을 덮어썼다. 저장소를 지우는 스펙들이 `afterEach`에 스토어 닫기를 손으로 적어 막았는데,
 * 손으로 적는 줄은 새 스펙이 빠뜨린다. 그래서 아래를 문다.
 *
 * 1. **도우미가 닫는다** — 지금 pinia의 스토어도, `setActivePinia(createPinia())`를 먼저 부른 뒤의 앞
 *    검사 스토어도. 실제로 타이머를 걸어 두고, 지운 저장소에 옛 파일이 안 돌아오는 것을 잰다.
 * 2. **도우미를 안 거치고 지우는 스펙이 없다** — 소스에서 IndexedDB를 지우는 이름이 도우미 밖에 보이면 운다.
 */

import 'fake-indexeddb/auto'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AUTOSAVE_DELAY_MS } from '../src/limits'
import { closeStorage, listProjects, saveProject } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { resetDatabase } from './fixtures/database'
import { emptyProjectFile } from './fixtures/project'
import { sourceFiles, withoutComments } from './fixtures/source'

const TESTS = __dirname
const HELPER = join('fixtures', 'database.ts')
/** 이 파일은 검사기의 표본으로 그 이름들을 글자로 든다. */
const SELF = 'database-reset.spec.ts'

/** IndexedDB를 통째로 지우거나 갈아 끼우는 이름 — 표준 API, `idb`의 도우미, `fake-indexeddb`의 공장. */
const WIPES = /\b(?:deleteDatabase|deleteDB|IDBFactory)\b/

/** 이 소스가 도우미를 안 거치고 저장소를 지우는가. 주석은 안 본다. */
function wipesDirectly(source: string): boolean {
  return WIPES.test(withoutComments(source, false).join('\n'))
}

/** 타이머가 터지고도 남을 만큼. */
function pastAutosave(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, AUTOSAVE_DELAY_MS * 2))
}

describe('도우미가 스토어를 닫고 지운다', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    closeStorage()
    await resetDatabase()
  })

  afterEach(async () => {
    closeStorage()
    await resetDatabase()
  })

  it('지금 스토어의 미뤄 둔 저장이 지운 저장소에 안 돌아온다', async () => {
    useProjectStore().update(emptyProjectFile())
    expect(useProjectStore().dirty).toBe(true)

    closeStorage()
    await resetDatabase()
    await pastAutosave()

    expect(await listProjects()).toEqual([])
  })

  it('새 pinia를 먼저 세워도 앞 검사의 스토어가 닫힌다', async () => {
    // `beforeEach`에서만 지우는 스펙의 순서다 — 새 pinia가 먼저 서고, 타이머는 앞 pinia의 스토어가 쥔다.
    useProjectStore().update(emptyProjectFile())
    const fresh = createPinia()
    setActivePinia(fresh)

    closeStorage()
    await resetDatabase()
    // 옛 스토어의 동작을 부르면 pinia가 옛 pinia를 활성으로 세운다 — 되돌리지 않으면 이 검사의 스토어가
    // 앞 검사의 것이 된다.
    expect(getActivePinia()).toBe(fresh)
    await pastAutosave()

    expect(await listProjects()).toEqual([])
  })

  /**
   * **이미 닫은 옛 스토어는 다시 닫지 않는다.** 탭 잠금은 모듈에 하나라 두 번째 닫기는 지금 스토어가 쥔
   * 잠금을 놓는다. `afterEach`에서 활성으로 닫힌 스토어가 다음 `beforeEach`에서 옛 것이 되는 순서다.
   */
  it('활성일 때 닫은 스토어는 옛 것이 되어도 다시 닫지 않는다', async () => {
    const closes: string[] = []
    useProjectStore().$onAction(({ name }) => {
      if (name === 'close') closes.push(name)
    })
    useProjectStore().update(emptyProjectFile())

    closeStorage()
    await resetDatabase()
    expect(closes).toHaveLength(1)

    setActivePinia(createPinia())
    closeStorage()
    await resetDatabase()
    expect(closes, 'closed an idle store again').toHaveLength(1)
  })

  /**
   * **열기가 아직 도는 옛 스토어도 닫는다.** 파일은 아직 비었어도 여는 중이면 닫을 것이 남았다 — 두면 그
   * 열기가 다음 검사 안에서 끝나 탭 잠금을 잡고 옛 파일을 앉힌다. 닫으면 열기는 낡아 `'cancelled'`로 끝난다.
   */
  it('열기가 아직 도는 옛 스토어도 닫는다', async () => {
    const project = emptyProjectFile()
    await saveProject(project)
    const closes: string[] = []
    useProjectStore().$onAction(({ name }) => {
      if (name === 'close') closes.push(name)
    })
    // 기다리지 않는다 — 열기가 도는 채로 다음 검사로 넘어가는 모양이다.
    const opening = useProjectStore().open(project.document.manifest.projectId)
    expect(useProjectStore().opening).toBe(true)
    expect(useProjectStore().file).toBeNull()

    setActivePinia(createPinia())
    closeStorage()
    await resetDatabase()

    expect(closes, 'the opening store was left open').toHaveLength(1)
    expect(await opening).toBe('cancelled')
  })

  /** 위 검사들이 재는 것이 진짜 누수인지 — 닫지 않으면 옛 파일이 돌아온다. */
  it('닫지 않으면 옛 파일이 돌아온다 - 위 검사들이 헛돌지 않는다', async () => {
    useProjectStore().update(emptyProjectFile())
    await pastAutosave()

    expect((await listProjects()).length).toBe(1)
  })
})

describe('저장소를 지우는 길은 도우미 하나다', () => {
  const files = sourceFiles(TESTS).filter((path) => !path.endsWith(HELPER) && !path.endsWith(SELF))

  it('훑을 파일이 있어야 이 검사가 돈다', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('도우미 밖에서 저장소를 지우지 않는다', () => {
    const found = files
      .filter((path) => wipesDirectly(readFileSync(path, 'utf-8')))
      .map((path) => path.slice(TESTS.length + 1))
    expect(found, 'wipe IndexedDB through tests/fixtures/database.ts').toEqual([])
  })

  it('검사기가 잡는다: 직접 지우는 이름들', () => {
    expect(wipesDirectly('const request = indexedDB.deleteDatabase(DB_NAME)')).toBe(true)
    expect(wipesDirectly("await deleteDB('ml-playgrounds')")).toBe(true)
    expect(wipesDirectly('globalThis.indexedDB = new IDBFactory()')).toBe(true)
  })

  it('검사기가 안 잡는다: 도우미를 부르는 것과 주석', () => {
    expect(wipesDirectly('await resetDatabase()')).toBe(false)
    expect(wipesDirectly('// indexedDB.deleteDatabase를 직접 부르지 않는다')).toBe(false)
  })
})
