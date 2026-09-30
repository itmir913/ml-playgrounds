// @vitest-environment jsdom
/**
 * 자동 저장과 `.mlpx` 내보내기.
 *
 * **컴퓨터실 PC는 전원을 끄면 디스크가 되돌아간다.** 그래서 이 둘이 이 도구에서
 * 특별히 중요하다 — 브라우저 저장은 새로고침과 크래시까지 지켜 주고, 차시를 넘기는
 * 것은 내보낸 파일뿐이다 (architecture.md §8.8).
 *
 * 여기서 보는 것 셋.
 *
 * 1. 미뤄 둔 저장이 **실제로 도착하는가**, 그리고 그 사이 상태가 정직한가
 * 2. 내보내기 전에 **미뤄 둔 것을 먼저 쓰는가** - 방금 쓴 글이 빠진 파일이 나가면 안 된다
 * 3. 내보낸 시각을 저장이 **덮어쓰지 않는가** - 저장은 자주, 내보내기는 가끔이다
 */

import 'fake-indexeddb/auto'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import { AUTOSAVE_DELAY_MS, AUTOSAVE_MAX_WAIT_MS } from '../src/limits'
import { exportStateOf } from '../src/project/export-state'
import { readProject } from '../src/project/format'
import { closeStorage, loadProject, readExportedAt, saveProject } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import { emptyProjectFile, manifest, projectFile } from './fixtures/project'
import { refuseWrites } from './fixtures/storage-refusal'
import { hashBytes } from '../src/hash'
import type { ProjectFile } from '../src/project/format'
import { resetDatabase } from './fixtures/database'

const downloads: { fileName: string; blob: Blob }[] = []

vi.mock('../src/project/download', () => ({
  // 나가는 것은 이제 Blob이다 - 완성된 배열을 만들지 않는다 (project/format.ts의 zipToBlob).
  downloadBlob: (blob: Blob, fileName: string) => {
    downloads.push({ blob, fileName })
  },
  readFileBytes: async (file: File) => new Uint8Array(await file.arrayBuffer()),
}))

/**
 * **저장을 붙드는 손잡이.** 쓰기 전에 여유를 재던 검사(`estimate()`)가 빠진 뒤로(open-decisions.md
 * 71) `saveProject`에는 흉내 낼 기다림이 없다 — 그래서 **진짜 `saveProject` 앞에서** 붙든다.
 * `hold`가 약속을 돌려주면 그 호출은 그것을 기다린 뒤 진짜로 쓴다. 저장 자체는 흉내 내지 않는다.
 */
const gate = vi.hoisted(() => ({
  calls: 0,
  hold: null as ((call: number) => Promise<void> | null) | null,
}))

vi.mock('../src/project/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/project/storage')>()
  return {
    ...actual,
    saveProject: async (...args: Parameters<typeof actual.saveProject>) => {
      gate.calls += 1
      const wait = gate.hold?.(gate.calls) ?? null
      if (wait !== null) await wait
      return actual.saveProject(...args)
    },
  }
})

/** 내려간 파일의 바이트. **여기서만 전체를 편다** - 나가는 경로는 안 그런다. */
async function downloadedBytes(index: number): Promise<Uint8Array> {
  const entry = downloads[index]
  if (entry === undefined) throw new Error(`no file was handed down: ${index}`)
  return new Uint8Array(await entry.blob.arrayBuffer())
}

/**
 * 여기서부터 브라우저가 쓰기를 쿼터로 거절한다(`fixtures/storage-refusal.ts`). 되돌리는 것은
 * `allow()`나 afterEach다.
 */
let refusal: { restore: () => void } | null = null

function refuse(): void {
  refusal ??= refuseWrites()
}

function allow(): void {
  refusal?.restore()
  refusal = null
}

/** 새 이름을 붙인 사본. 값이 바뀐 것을 흉내낸다. */
function renamed(name: string) {
  const base = projectFile()
  return {
    ...base,
    document: { ...base.document, manifest: { ...base.document.manifest, name } },
  }
}

beforeEach(async () => {
  downloads.length = 0
  setActivePinia(createPinia())
  closeStorage()
  await resetDatabase()
  // setTimeout만 가짜로 바꾼다. 전부 바꾸면 fake-indexeddb가 자기 이벤트 루프를
  // 돌리지 못해 모든 요청이 영원히 안 끝난다.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(async () => {
  allow()
  gate.hold = null
  gate.calls = 0
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  vi.useRealTimers()
  closeStorage()
  await resetDatabase()
})

describe('자동 저장', () => {
  it('바꾸면 화면은 즉시, 저장은 나중에', async () => {
    const project = useProjectStore()
    project.update(renamed('바뀐 이름'))

    // 화면은 벌써 새 값을 본다. 기다리게 하면 입력이 끊긴다.
    expect(project.name).toBe('바뀐 이름')
    expect(project.dirty).toBe(true)
    expect(await loadProject(manifest.projectId)).toBeNull()
  })

  it('시간이 지나면 도착한다', async () => {
    const project = useProjectStore()
    project.update(renamed('바뀐 이름'))

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)

    // 값을 먼저 확인한다. 타이머는 깨웠지만 IndexedDB 왕복은 실제 비동기라
    // advanceTimersByTimeAsync가 그것까지 기다려 주지는 않는다.
    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe('바뀐 이름')
    expect(project.dirty).toBe(false)
  })

  it('연달아 바꾸면 마지막 것만 쓴다', async () => {
    // 슬라이더를 끄는 동안 한 픽셀마다 수십 MB를 쓰면 교실 PC가 멈춘다.
    const project = useProjectStore()
    project.update(renamed('하나'))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS / 2)
    project.update(renamed('둘'))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS / 2)

    // 아직 첫 타이머만 지났다. 두 번째가 앞의 것을 밀어냈으므로 안 써 있어야 한다.
    expect(await loadProject(manifest.projectId)).toBeNull()

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe('둘')
  })

  /**
   * **쉬지 않고 쳐도 최대 대기가 지나면 한 번 쓴다** (open-decisions.md 81).
   *
   * 매 입력이 타이머를 다시 걸기만 하던 때는 디바운스보다 짧은 간격으로 계속 치는 동안 한 번도 안
   * 썼다 — 그 사이 새로고침하면 마지막 쉼 뒤의 입력이 전부 사라졌다(2026-09-29 야간 감사 N3 #3).
   */
  it('쉬지 않고 바꿔도 최대 대기가 지나면 쓴다', async () => {
    const project = useProjectStore()
    const step = AUTOSAVE_DELAY_MS / 2
    let typed = 0
    // 디바운스가 한 번도 안 터지는 간격으로, 최대 대기 바로 앞까지 친다.
    for (let elapsed = 0; elapsed + step < AUTOSAVE_MAX_WAIT_MS; elapsed += step) {
      project.update(renamed(`입력 ${String(typed)}`))
      typed += 1
      await vi.advanceTimersByTimeAsync(step)
    }
    expect(await loadProject(manifest.projectId), 'nothing is due before the max wait').toBeNull()

    project.update(renamed(`입력 ${String(typed)}`))
    await vi.advanceTimersByTimeAsync(step)

    // 최대 대기가 지난 순간 **열려 있던 값**이 쓰인다.
    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe(
      `입력 ${String(typed)}`,
    )
    expect(gate.calls).toBe(1)
  })

  /**
   * **최대 대기로 쓴 뒤에도 최대 대기가 다시 걸린다** (2026-09-30 감사 a3 C-1). 쓸 때 최대 대기 타이머만 지우고
   * 그 자리를 비우지 않으면 `update`의 `deadline ??=`가 다음 것을 안 건다 — 첫 최대 대기 뒤로는 쉬지 않는
   * 입력이 다시 디바운스만 기다린다.
   */
  it('쉬지 않고 최대 대기 두 번을 넘기면 두 번 쓴다', async () => {
    const project = useProjectStore()
    const step = AUTOSAVE_DELAY_MS / 2
    let typed = 0
    for (let elapsed = 0; elapsed <= 2 * AUTOSAVE_MAX_WAIT_MS; elapsed += step) {
      project.update(renamed(`입력 ${String(typed)}`))
      typed += 1
      await vi.advanceTimersByTimeAsync(step)
    }
    // 끝 상태를 `vi.waitFor`로 기다리지 않는다 — 가짜 타이머를 밀어 디바운스가 터지면 최대 대기 없이도 둘이 된다.
    // 센 것은 쓰기에 **들어간** 횟수라 두 번째 최대 대기가 터진 그 전진 안에서 선다.
    expect(gate.calls, 'the max wait re-arms after it writes').toBe(2)
  })

  it('최대 대기로 쓴 뒤에도 손을 떼면 마지막 값이 디바운스로 앉는다', async () => {
    const project = useProjectStore()
    const step = AUTOSAVE_DELAY_MS / 2
    for (let elapsed = 0; elapsed <= AUTOSAVE_MAX_WAIT_MS; elapsed += step) {
      project.update(renamed(`입력 ${String(elapsed)}`))
      await vi.advanceTimersByTimeAsync(step)
    }
    expect(gate.calls, 'the max wait fired once').toBe(1)

    project.update(renamed('마지막'))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    // 이 쓰기는 최대 대기가 건 쓰기 뒤에 줄을 선다(`write`). 앞의 것이 끝나야 트랜잭션을 세우므로
    // 한 번 읽어서는 앞의 값을 볼 수 있다 — 앉을 때까지 기다린다. 남은 타이머는 없다.
    await vi.waitFor(async () => {
      expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe('마지막')
      expect(project.dirty).toBe(false)
    })
    expect(gate.calls).toBe(2)
  })

  /**
   * **쉬어 가며 치는 보통 입력에서는 쓰기가 늘지 않는다.** 최대 대기의 타이머가 디바운스로 쓴 뒤에도
   * 남아 있으면, 다음 입력의 최대 대기가 그 입력이 아니라 옛 시각부터 재진다.
   */
  it('디바운스로 쓰면 최대 대기도 처음부터 다시 잰다', async () => {
    const project = useProjectStore()
    project.update(renamed('하나'))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    expect(gate.calls).toBe(1)

    // 첫 입력의 최대 대기가 다 되기 직전에 다시 치기 시작한다. 옛 타이머가 남았으면 곧 터진다.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS - 2 * AUTOSAVE_DELAY_MS)
    const step = AUTOSAVE_DELAY_MS / 2
    for (let elapsed = 0; elapsed + step < AUTOSAVE_MAX_WAIT_MS; elapsed += step) {
      project.update(renamed(`둘 ${String(elapsed)}`))
      await vi.advanceTimersByTimeAsync(step)
    }
    expect(gate.calls, 'no early write from a stale max-wait timer').toBe(1)
  })

  /**
   * **닫거나 flush하면 최대 대기도 거둔다** (open-decisions.md 81). 남은 최대 대기는 닫힌 스토어에서는
   * 헛돌지만, 다음 입력의 최대 대기를 옛 시각부터 재게 만든다. 남은 타이머를 직접 센다.
   */
  it('닫거나 flush하면 최대 대기도 거둔다', async () => {
    const project = useProjectStore()
    project.update(renamed('하나'))
    expect(vi.getTimerCount(), 'debounce and max wait are armed').toBe(2)
    await project.flush()
    expect(vi.getTimerCount(), 'after flush').toBe(0)

    project.update(renamed('둘'))
    expect(vi.getTimerCount()).toBe(2)
    project.close()
    expect(vi.getTimerCount(), 'after close').toBe(0)
  })

  it('flush는 기다리지 않고 지금 쓴다', async () => {
    const project = useProjectStore()
    project.update(renamed('바뀐 이름'))
    await project.flush()

    expect(project.dirty).toBe(false)
    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe('바뀐 이름')
  })

  it('바꾼 것이 없으면 flush가 아무것도 안 한다', async () => {
    const project = useProjectStore()
    await project.flush()
    expect(project.savedAt).toBeNull()
  })

  it('닫으면 미뤄 둔 저장이 취소된다', async () => {
    // 프로젝트를 놓아준 뒤에 옛 값이 뒤늦게 도착하면 안 된다.
    const project = useProjectStore()
    project.update(renamed('바뀐 이름'))
    project.close()

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2)
    expect(await loadProject(manifest.projectId)).toBeNull()
  })

  it('save는 미뤄 둔 것을 밀어내고 즉시 쓴다', async () => {
    const project = useProjectStore()
    project.update(renamed('미뤄진 것'))
    await project.save(renamed('즉시'))

    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe('즉시')

    // 취소되지 않았다면 여기서 옛 값이 덮어쓴다.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2)
    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe('즉시')
  })
})

/**
 * **다른 프로젝트로 갈아 끼우면 미뤄 둔 저장을 거둔다** (open-decisions.md 81의 개정, 감사 슬라이스 3 C-2).
 *
 * 라우터 가드는 떠나기 전에 `flush()`로 미뤄 둔 저장을 끝내지만, [저장하지 않고 이동](`leave.consume`)은 그
 * `flush()`를 건너뛰고 곧장 `open(B)`를 부른다. 전에는 `open()`이 타이머를 안 거둬서, 앞 프로젝트의 디바운스·
 * 최대 대기가 남아 여는 사이에 앞 프로젝트를 썼고, 그 쓰기가 쿼터로 거절되면 앞 프로젝트의
 * `STORAGE_QUOTA_EXCEEDED` 알림이 새 프로젝트 화면에 섰다. 순서는 가짜 타이머로 고정한다.
 */
describe('다른 프로젝트로 갈아 끼우면', () => {
  const OTHER_ID = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f'

  /** 이 기기에 저장된 다른 프로젝트 하나. */
  async function seedOther(): Promise<void> {
    const base = renamed('뒤 프로젝트')
    await saveProject({
      ...base,
      document: {
        ...base.document,
        manifest: { ...base.document.manifest, projectId: OTHER_ID },
      },
    })
  }

  it('앞 프로젝트의 디바운스와 최대 대기가 남지 않는다', async () => {
    const project = useProjectStore()
    await project.save(renamed('앞 프로젝트'))
    await seedOther()
    project.update(renamed('앞에서 고친 것'))
    expect(vi.getTimerCount(), 'debounce and max wait are armed').toBe(2)

    expect(await project.open(OTHER_ID)).toBe('opened')
    expect(vi.getTimerCount(), 'timers left after the swap').toBe(0)
  })

  it('쓰기가 거절되는 중에 여는 사이 디바운스가 지나도 앞 프로젝트를 안 쓰고 알리지 않는다', async () => {
    const project = useProjectStore()
    await project.save(renamed('앞 프로젝트'))
    await seedOther()
    refuse()
    project.update(renamed('앞에서 고친 것'))
    const before = gate.calls

    const opening = project.open(OTHER_ID)
    // `open()`이 첫 `await`에 선 사이 앞 프로젝트의 디바운스 시각이 지난다.
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS)
    expect(await opening).toBe('opened')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS)

    expect(gate.calls, 'the previous project was written after the swap began').toBe(before)
    expect(project.name).toBe('뒤 프로젝트')
    expect(project.saveFailed).toBe(false)
    expect(useToastStore().items.map((item) => item.key)).toEqual([])
  })

  /**
   * **같은 프로젝트를 다시 여는 것은 갈아 끼우기가 아니다.** 라우터 가드는 단계를 옮길 때마다 `open()`을
   * 부르는데, 그때 거두면 방금 친 글이 디바운스를 잃는다 — 그 판은 다음 입력이나 떠날 때의 `flush()`까지
   * 브라우저에 안 간다.
   */
  it('같은 프로젝트를 다시 열면 미뤄 둔 저장이 그대로 도착한다', async () => {
    const project = useProjectStore()
    await project.save(renamed('앞 프로젝트'))
    project.update(renamed('단계를 옮기기 전에 고친 것'))

    expect(await project.open(manifest.projectId)).toBe('opened')
    expect(vi.getTimerCount(), 'debounce and max wait survive').toBe(2)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    await vi.waitFor(async () =>
      expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe(
        '단계를 옮기기 전에 고친 것',
      ),
    )
  })
})

/**
 * **쓰기가 도는 동안 학생이 또 바꾸는 것은 흔한 일이다** — 슬라이더를 끌거나 글을 쓰면
 * 800ms 타이머가 도는 사이에도 값이 계속 바뀐다. 그때 `dirty`를 그냥 내리면 그 변경분이
 * 덮이고, 다음 `write()`는 조기 반환에 걸려 **아무것도 안 쓴다.** 학생이 거기서 손을
 * 떼면 그 편집은 IndexedDB에 영영 안 들어간다.
 */
describe('쓰는 동안 또 바뀐 것', () => {
  it('다시 쓸 것으로 남는다', async () => {
    const project = useProjectStore()
    // 저장이 IndexedDB에서 기다리는 사이에 끼어든다.
    //
    // **쓰기가 시작된 뒤에 끼어든다** (2026-09-28 감사 C, C-2). 쓰기는 이제 줄을 서고 **차례가
    // 왔을 때** 값을 읽으므로, 부른 직후에 고치면 고친 값이 그대로 쓰여 "다시 쓸 것"이 안 생긴다
    // (그것도 옳다 — 잃은 것이 없다). 이 검사가 보려는 것은 쓰는 도중의 편집이라 `saving`이 선
    // 뒤에 고친다.
    const writing = project.save(projectFile())
    for (let round = 0; round < 50 && !project.saving; round += 1) await Promise.resolve()
    expect(project.saving, 'the write must have started').toBe(true)
    project.update(renamed('쓰는 동안 고친 이름'))
    await writing

    expect(project.dirty).toBe(true)

    await project.flush()
    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe(
      '쓰는 동안 고친 이름',
    )
  })

  it('안 바뀌었으면 다시 안 쓴다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    expect(project.dirty).toBe(false)
  })

  /**
   * **쓰기는 온 순서대로 하나씩 한다** (2026-09-28 감사 C, C-2).
   *
   * `saveProject`는 트랜잭션을 세우기 전에 여유 공간을 물었다(`estimate()`, 결정 73이 뺐다). 겹친
   * 두 쓰기에서 먼저 시작한 쪽의 답이 늦으면 **나중 값이 먼저 들어가고 옛 값이 그 위를 덮었다** — 화면은
   * 나중 값, 저장소는 옛 값, `dirty`는 참인데 다시 쓸 타이머가 없었다(실측: 화면 B · 저장소 A).
   */
  it('겹친 두 쓰기는 나중 값을 남긴다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())

    let release = (): void => {}
    // 이 뒤의 첫 쓰기만 붙든다. 줄이 없으면 둘째가 먼저 들어가고 첫째가 그 위를 덮는다.
    gate.calls = 0
    gate.hold = (call) =>
      call === 1
        ? new Promise<void>((resolve) => {
            release = resolve
          })
        : null

    project.update(renamed('먼저 쓴 이름'))
    const first = project.flush()
    for (let round = 0; round < 50 && gate.calls === 0; round += 1) await Promise.resolve()
    expect(gate.calls, 'the first write must be held').toBe(1)

    project.update(renamed('나중에 쓴 이름'))
    const second = project.flush()
    release()
    await Promise.all([first, second])

    expect(project.name).toBe('나중에 쓴 이름')
    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe('나중에 쓴 이름')
    expect(project.dirty).toBe(false)
  })

  /** **줄은 실패로 끊기지 않고, 실패는 부른 쪽에 간다** — `save`·`flush`가 던지는 약속이다. */
  it('앞의 쓰기가 실패해도 다음 쓰기는 돈다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())

    refuse()
    await expect(project.save(renamed('거절당한 이름'))).rejects.toThrow()
    allow()

    await project.flush()
    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe('거절당한 이름')
    expect(project.dirty).toBe(false)
  })
})

/**
 * **라우터 가드는 앱 안의 이동만 비운다.** 탭을 닫거나 주소를 바꿔 나가면 마지막
 * `AUTOSAVE_DELAY_MS`만큼의 편집이 그대로 사라졌다 (V11 R4 C-3). 여기서 보는 것은
 * **배선**이다 — 브라우저가 쓰기를 끝까지 시켜 주는지는 우리가 못 정한다.
 */
/**
 * **저장이 거절돼도 화면은 새 값을 들고 있는다**
 * (`open-decisions.md` "저장은 화면을 먼저 바꾸고, 실패는 알림과 상태 표시줄이 말한다").
 *
 * `save()`의 머리말이 2026-08-30까지 **반대로** 적혀 있었고(*"던지면 아무것도 바꾸지
 * 않는다"*), 어느 쪽이 참인지 말하는 검사가 하나도 없었다 (R12 감사 B-1). 코드는 처음부터
 * 화면을 먼저 바꿨다.
 *
 * **되돌리는 쪽을 안 택한 이유는 내보내기다.** 이 경로가 실제로 던지는 가장 흔한 자리가
 * 사진 저장인데(다 굽고 나서 쿼터에 걸린다), 되돌리면 방금 구운 것이 화면에서도 사라져
 * **그 세션에 제출할 길이 없어진다.**
 *
 * **진짜 입구로 던지게 한다** — 쓰기가 `QuotaExceededError`를 던지면 진짜 `saveProject`가
 * `STORAGE_QUOTA_EXCEEDED`로 바꾼다. 스토어를 흉내 내지 않는다.
 */
describe('저장이 거절됐을 때', () => {
  it('화면은 새 값을 들고 있고 dirty가 남는다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    expect(project.dirty).toBe(false)

    refuse()
    await expect(project.save(renamed('굽고 나서 거절당함'))).rejects.toThrow()

    // 화면은 새 값이다. 되돌리지 않는다.
    expect(project.name).toBe('굽고 나서 거절당함')
    // 상태 표시줄이 계속 말하도록 dirty가 남는다. 이것이 위 결정의 짝이다.
    expect(project.dirty).toBe(true)
  })

  it('저장 못 한 값이 그대로 내보내진다 - 제출을 못 하면 그 프로젝트는 죽은 것이다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())

    refuse()
    await expect(project.save(renamed('굽고 나서 거절당함'))).rejects.toThrow()

    // exportFile은 저장을 기다리지 않고 쥔 값으로 내보낸다. 저장의 실패는 뒤에서 알린다.
    await project.exportFile('# 정리\n')

    expect(downloads).toHaveLength(1)
    const { project: reopened } = await readProject(await downloadedBytes(0))
    expect(reopened.document.manifest.name).toBe('굽고 나서 거절당함')
  })
})

describe('탭을 떠날 때', () => {
  it('미뤄 둔 저장을 지금 한다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    project.update(renamed('떠나기 직전에 고친 이름'))

    // 타이머는 아직 안 돌았다. 이 상태로 탭이 닫히면 그대로 사라진다.
    expect(project.dirty).toBe(true)

    await project.flush()

    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe(
      '떠나기 직전에 고친 이름',
    )
  })
})

describe('내보내기', () => {
  const markdown = '# 나의 AI 모델 정리\n'

  it('파일 하나를 내려보낸다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    await project.exportFile(markdown)

    expect(downloads).toHaveLength(1)
    expect(downloads[0]?.fileName.endsWith('.mlpx')).toBe(true)
    expect((downloads[0]?.blob.size ?? 0) > 0).toBe(true)
  })

  /**
   * **받은 마크다운과 파일은 같은 프로젝트의 것이어야 한다.** 저장을 기다리는 사이 다른
   * 프로젝트가 열리면, 그 뒤에 파일을 다시 읽는 순서에서는 앞 프로젝트의 글이 뒤 프로젝트의
   * 파일에 실려 나간다(R39b C-7).
   */
  it('저장을 기다리는 사이 프로젝트가 바뀌어도 쥔 프로젝트를 내보낸다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    project.update(renamed('앞 프로젝트'))
    const base = projectFile()
    const other: ProjectFile = {
      ...base,
      document: {
        ...base.document,
        manifest: {
          ...base.document.manifest,
          projectId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
          name: '뒤 프로젝트',
        },
      },
    }

    const pending = project.exportFile(markdown)
    void project.save(other)
    await pending

    const { project: reopened } = await readProject(await downloadedBytes(0))
    expect(reopened.document.manifest.name, 'the file handed down').toBe('앞 프로젝트')
    // 내보낸 시각은 뒤에서 적는다 — **적힌 뒤에** 봐야 이 단언이 무엇을 잰다.
    await vi.waitFor(async () => expect(await readExportedAt(manifest.projectId)).not.toBeNull())
    expect(project.exportedAt, 'export time on the other project').toBeNull()
  })

  /**
   * **방금 쓴 글은 파일에도, 끝내 IndexedDB에도 앉는다.** 파일은 쥔 `current`로 만들고, 미뤄 둔
   * 저장은 내보내기가 시작만 해 둔다(2026-09-28 감사 A B-1) — 그래서 저장이 끝나기를
   * 기다려서 본다.
   */
  it('미뤄 둔 저장도 끝내 앉는다 - 방금 쓴 글은 파일과 브라우저 둘 다에 있다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    project.update(renamed('마지막 순간에 고친 이름'))

    await project.exportFile(markdown)

    const { project: reopened } = await readProject(await downloadedBytes(0))
    expect(reopened.document.manifest.name).toBe('마지막 순간에 고친 이름')
    await vi.waitFor(() => expect(project.dirty).toBe(false))
    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe(
      '마지막 순간에 고친 이름',
    )
  })

  /**
   * **저장이 끝나지 않아도 파일은 나간다** (2026-09-28 감사 A B-1). 파일의 내용은 쥔 `current`가
   * 정하므로 IndexedDB를 기다릴 이유가 없다. 전에는 `await flush()`가 앞에 있어서 저장이
   * 멈추면 파일을 만드는 줄에 영영 닿지 못했다. 끝나지 않는 `saveProject`로 멈춘 저장을
   * 흉내낸다(위 `gate`).
   */
  it('저장이 끝나지 않아도 파일은 나간다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    project.update(renamed('저장이 멈춰도 나가야 하는 이름'))
    gate.hold = () => new Promise<never>(() => {})

    await project.exportFile(markdown)

    expect(downloads).toHaveLength(1)
    const { project: reopened } = await readProject(await downloadedBytes(0))
    expect(reopened.document.manifest.name).toBe('저장이 멈춰도 나가야 하는 이름')
    // 내보낸 시각은 저장 뒤에 적으므로 아직 없다 — 그래도 파일은 나갔다.
    expect(project.exportedAt).toBeNull()
  })

  /**
   * **나간 바이트를 실제로 다시 연다.**
   *
   * 위 검사들이 보는 것은 `downloads`의 개수·파일 이름·길이가 0보다 큰가, 그리고
   * **IndexedDB**다. 그런데 `exportFile`은 IndexedDB가 아니라 메모리의 `file.value`로
   * 파일을 만든다 — 그래서 저 단언들은 `flush()`를 검사할 뿐 **나간 바이트에 대해
   * 아무 말도 하지 않았다.** 나가는 바이트를 4바이트로 잘라도 `npm run ci`가
   * 통째로 초록이었다 (R9 감사 A-1).
   *
   * **이것이 마지막 한 걸음이다.** `CLAUDE.md` §1.3이 "교사는 이 파일 하나만 열면
   * 재학습 없이 모든 것을 볼 수 있어야 한다"고 못 박았고, 브라우저에만 있는
   * 프로젝트는 제출을 못 하니 죽은 것이다.
   */
  it('나간 파일을 다시 열면 지금 작업이 그대로 있다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    project.update(renamed('나간 파일에 담겨야 하는 이름'))

    await project.exportFile(markdown)

    expect(downloads[0]?.blob, 'the file handed down').toBeDefined()
    const bytes = await downloadedBytes(0)

    // 여는 것 자체가 zip과 필수 엔트리를 다 요구한다. 그 위에 무게가 있는 것 둘을 본다 -
    // 미뤄 둔 저장이 반영된 이름과, 표가 통째로 실려 나갔는가.
    const { project: reopened, integrity } = await readProject(bytes)
    expect(reopened.document.manifest.name).toBe('나간 파일에 담겨야 하는 이름')
    // jsdom에서는 zip이 돌려준 배열과 픽스처의 배열이 다른 realm의 Uint8Array라
    // toEqual이 내용이 같아도 운다 - 이 파일이 jsdom으로 옮겨 오며(가드 규칙) 드러났다.
    // 같은 realm으로 감싸 바이트만 견준다.
    expect(new Uint8Array(reopened.dataset?.bytes ?? [])).toEqual(
      new Uint8Array(projectFile().dataset?.bytes ?? []),
    )
    expect(reopened.models.size).toBe(projectFile().models.size)
    expect(integrity.status).toBe('UNCHANGED')
  })

  it('내보낸 시각을 남긴다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    expect(project.exportedAt).toBeNull()

    await project.exportFile(markdown)

    // 내보낸 시각은 파일이 나간 뒤 저장이 끝나면 뒤에서 적는다.
    await vi.waitFor(() => expect(project.exportedAt).not.toBeNull())
    expect(await readExportedAt(manifest.projectId)).toBe(project.exportedAt)
  })

  it('그 뒤의 저장이 내보낸 시각을 지우지 않는다', async () => {
    // 자동 저장은 자주 돌고 내보내기는 학생이 일부러 하는 일이다. 덮어쓰면
    // "아직 안 내보냈습니다"가 계속 다시 뜬다.
    const project = useProjectStore()
    await project.save(projectFile())
    await project.exportFile(markdown)
    await vi.waitFor(() => expect(project.exportedAt).not.toBeNull())
    const at = project.exportedAt

    await project.save(renamed('그 뒤에 고친 이름'))

    expect(await readExportedAt(manifest.projectId)).toBe(at)
  })

  /**
   * **학생이 작업을 기기 밖으로 꺼내는 유일한 길이다** (CLAUDE.md §1.1). 저장소가
   * 모자라 자동 저장이 실패한 학생이 "그럼 파일로 저장해야지"라며 누르는 것이 바로
   * 이 버튼인데, 저장 실패가 여기까지 올라오면 그 순간 꺼낼 길이 없어진다 —
   * 파일을 만들 재료는 전부 메모리에 있고 저장소를 한 바이트도 안 쓰는데도.
   */
  it('저장이 실패해도 파일은 나간다 - 꺼낼 길이 없어지면 안 된다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    project.update(renamed('저장은 못 하지만 내보내야 하는 이름'))

    // 여기서부터 저장소가 모자라다.
    refuse()
    const toasts = useToastStore()

    await project.exportFile(markdown)

    expect(downloads).toHaveLength(1)
    // 그리고 저장이 실패했다는 사실은 학생에게 도달한다. 저장은 뒤에서 돌므로 기다려 본다.
    await vi.waitFor(() => expect(toasts.items.at(-1)?.tone).toBe('danger'))
    expect(toasts.items.at(-1)?.key).toContain('STORAGE_QUOTA_EXCEEDED')
  })

  it('저장이 한 번 실패해도 다음 내보내기가 막히지 않는다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    project.update(renamed('고친 이름'))

    refuse()
    await project.exportFile(markdown)
    await project.exportFile(markdown)

    // write()가 실패해도 dirty를 안 내리므로, 막는 구조였다면 둘째도 죽는다.
    expect(downloads).toHaveLength(2)
  })

  it('프로젝트가 없으면 아무것도 내려보내지 않는다', async () => {
    const project = useProjectStore()
    await expect(project.exportFile(markdown)).resolves.toEqual([])
    expect(downloads).toHaveLength(0)
  })
})

/**
 * 저장소를 지우지 말아 달라는 요청 (`open-decisions.md` #7).
 *
 * **안 부르면 IndexedDB는 "지워도 되는 데이터"다.** iOS Safari는 일정 기간 방문이 없으면
 * 통째로 지운다 — 수행평가 제출물이 조용히 사라지는 모양이다.
 *
 * 여기서 보는 것 셋. **셋 다 "언제 부르는가"이지 "허락받았는가"가 아니다** — 허락은
 * 브라우저가 정하고 우리가 할 수 있는 일이 없다.
 */
/**
 * 사진이 든 이미지 프로젝트. **표의 정본 칸(`dataset`)은 비어 있는 것이 정상이다** —
 * 사진은 `images` 맵에 산다 (`tests/image-format.spec.ts`가 그것을 못 박아 두었다).
 */
function imageProjectFile(): ProjectFile {
  const base = emptyProjectFile()
  const bytes = new TextEncoder().encode('가짜webp')
  return {
    ...base,
    document: {
      ...base.document,
      manifest: { ...base.document.manifest, dataType: 'image' },
      settings: {
        ...base.document.settings,
        data: {
          dataset: { path: 'dataset/data/', canonicalSize: 224, format: 'webp', quality: 0.65 },
          categories: ['개'],
          backboneId: DEFAULT_BACKBONE_ID,
        },
      },
    },
    images: new Map([[`dataset/data/개/${hashBytes(bytes)}.webp`, bytes]]),
  }
}

describe('저장소를 지우지 말아 달라고 청한다', () => {
  let asked = 0

  beforeEach(() => {
    asked = 0
    vi.stubGlobal('navigator', {
      storage: {
        persisted: async () => false,
        persist: async () => {
          asked += 1
          return true
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('표가 들어간 저장에서 청한다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    expect(asked).toBe(1)
  })

  it('빈 프로젝트에서는 안 청한다 - 아직 지킬 것이 없다', async () => {
    // 프로젝트를 만들면 빈 문서가 곧장 쓰인다. 거기서 청하면 학생이 아무것도 안 한
    // 시점에 브라우저 팝업을 보게 되고(파이어폭스), 정작 지킬 것은 없다.
    const project = useProjectStore()
    await project.save(emptyProjectFile())
    expect(asked).toBe(0)
  })

  it('표가 들어온 뒤에는 청한다 - 빈 채로 시작했어도', async () => {
    const project = useProjectStore()
    await project.save(emptyProjectFile())
    expect(asked).toBe(0)

    await project.save(projectFile())
    expect(asked).toBe(1)
  })

  it('여러 번 저장해도 한 번만 청한다', async () => {
    // 자동저장은 슬라이더를 끌 때마다 돈다. 그때마다 물으면 브라우저에 계속 묻는 꼴이다.
    const project = useProjectStore()
    await project.save(projectFile())
    await project.save(renamed('둘'))
    await project.save(renamed('셋'))
    expect(asked).toBe(1)
  })

  it('브라우저가 이 API를 몰라도 저장은 그대로 된다', async () => {
    // 이건 저장의 전제 조건이 아니라 저장된 것을 오래 살게 하는 요청이다.
    vi.stubGlobal('navigator', {})
    const project = useProjectStore()
    await expect(project.save(projectFile())).resolves.toBeUndefined()
    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe(
      projectFile().document.manifest.name,
    )
  })

  it('거절당해도 저장은 그대로 된다', async () => {
    vi.stubGlobal('navigator', {
      storage: { persisted: async () => false, persist: async () => false },
    })
    const project = useProjectStore()
    await expect(project.save(projectFile())).resolves.toBeUndefined()
    expect(await loadProject(manifest.projectId)).not.toBeNull()
  })

  it('던져도 저장은 그대로 된다', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: async () => false,
        persist: async () => {
          throw new Error('the user declined')
        },
      },
    })
    const project = useProjectStore()
    await expect(project.save(projectFile())).resolves.toBeUndefined()
    expect(await loadProject(manifest.projectId)).not.toBeNull()
  })

  /**
   * **"올린 것이 있는가"는 종류가 답한다.** 예전에는 `saved.dataset !== undefined`로 물었는데
   * 그 칸은 표의 정본 한 자리라 **이미지 프로젝트에서는 언제나 비어 있었고, 그래서 한 번도
   * 안 청했다** (V11 R1 감사 B-11). 이미지가 이 앱에서 제일 큰 프로젝트다 — 사진 5,000장이면
   * 80~100MB이고 그것이 계속 "지워도 되는 데이터"로 남았다.
   */
  it('사진이 들어간 저장에서도 청한다 - 표만 보지 않는다', async () => {
    const project = useProjectStore()
    await project.save(imageProjectFile())
    expect(asked).toBe(1)
  })

  it('사진도 표도 없으면 안 청한다 - 종류와 무관하다', async () => {
    const project = useProjectStore()
    await project.save({ ...imageProjectFile(), images: new Map() })
    expect(asked).toBe(0)
  })

  it('이미 허락받았으면 다시 묻지 않는다', async () => {
    // 파이어폭스는 이 호출에 권한 팝업을 띄운다. 물어보는 횟수 자체를 줄인다.
    vi.stubGlobal('navigator', {
      storage: {
        persisted: async () => true,
        persist: async () => {
          asked += 1
          return true
        },
      },
    })
    const project = useProjectStore()
    await project.save(projectFile())
    expect(asked).toBe(0)
  })
})

/**
 * 상태 표시줄이 읽는 판정 (`AppStatusBar`). **가운데("저장했지만 파일은 옛것")가
 * 이 함수가 화면에서 빠져나온 이유다** — 그것만 검사가 못 닿는 자리에 있었다.
 */
describe('내보낸 파일이 지금 작업과 얼마나 어긋나 있는가', () => {
  it('한 번도 안 내보냈으면 notExported다', () => {
    expect(exportStateOf('2026-08-18T10:00:00.000Z', null, false)).toBe('notExported')
    expect(exportStateOf(null, null, false)).toBe('notExported')
    // 안 쓴 편집이 있어도 한 번도 안 내보낸 것이 먼저다.
    expect(exportStateOf(null, null, true)).toBe('notExported')
  })

  it('내보낸 뒤로 저장한 적이 없으면 exported다', () => {
    expect(exportStateOf('2026-08-18T09:00:00.000Z', '2026-08-18T10:00:00.000Z', false)).toBe(
      'exported',
    )
    expect(exportStateOf(null, '2026-08-18T10:00:00.000Z', false)).toBe('exported')
  })

  it('내보낸 뒤에 또 작업했으면 stale이다 - 여기서 안 알리면 학생이 안심하고 끈다', () => {
    expect(exportStateOf('2026-08-18T11:00:00.000Z', '2026-08-18T10:00:00.000Z', false)).toBe(
      'stale',
    )
  })

  /**
   * **안 쓴 편집은 시각이 못 말한다** (2026-09-28 감사 C, A-2). 시각은 브라우저에 쓴 때만
   * 오르므로, 내보낸 뒤 고친 것이 저장에 실패하면 `savedAt`이 내보낸 시각보다 앞에 멈춘 채
   * "exported"가 섰다 — 그 편집은 파일에도 브라우저에도 없었다.
   */
  it('안 쓴 편집이 있으면 시각과 무관하게 stale이다', () => {
    expect(exportStateOf('2026-08-18T09:00:00.000Z', '2026-08-18T10:00:00.000Z', true)).toBe(
      'stale',
    )
    expect(exportStateOf(null, '2026-08-18T10:00:00.000Z', true)).toBe('stale')
  })

  /**
   * `savedAt`은 파일을 열었을 때 `manifest.updatedAt`에서 온다. 스키마가 받는 것은
   * `z.iso.datetime({ offset: true })`라 우리가 안 쓴 표기가 들어올 수 있고, 사전순으로
   * 재면 실제 시각과 순서가 어긋난다.
   */
  it('오프셋이 든 시각도 실제 시각으로 잰다', () => {
    // 05:00-09:00 = 14:00Z 저장 > 10:00Z 내보냄. 사전순이면 '05' < '10'이라 뒤집힌다.
    expect(exportStateOf('2026-08-18T05:00:00-09:00', '2026-08-18T10:00:00.000Z', false)).toBe(
      'stale',
    )
    // 다음 날 05:00+09:00 = 20:00Z 저장 < 21:00Z 내보냄. 사전순이면 날짜가 커서 뒤집힌다.
    expect(exportStateOf('2026-08-19T05:00:00+09:00', '2026-08-18T21:00:00.000Z', false)).toBe(
      'exported',
    )
  })
})

/**
 * 긴 계산이 파일을 쓰는 모양 (architecture.md §8.10.3).
 *
 * **붙든 파일에 쓰면 그 사이의 편집이 사라진다.** 예측이 도는 동안 놓은 사진, 백본을
 * 받는 동안 뺀 모델 — R20 감사가 둘 다 실측했다. 그래서 `save`·`update`가 함수를 받고,
 * 스토어가 **부르는 순간의 값**에 적용한다.
 *
 * **닫힌 뒤에 앉히지 않는 것이 짝이다.** 늦게 도착한 계산이 스토어를 되살리면 목록으로
 * 나간 학생의 화면에 옛 프로젝트가 뜨고 자동 저장이 그것을 쓴다.
 */
describe('스토어에 함수로 쓰면', () => {
  /** 이름 뒤에 표를 하나 붙인다. **어느 값에 적용됐는지가 이름에 남는다.** */
  const marked = (current: ProjectFile): ProjectFile => ({
    ...current,
    document: {
      ...current.document,
      manifest: { ...current.document.manifest, name: `${current.document.manifest.name}!` },
    },
  })

  it('붙든 값이 아니라 지금 값에 적용한다', async () => {
    const project = useProjectStore()
    await project.save(renamed('처음'))
    // 긴 계산이 도는 동안 학생이 고친 것에 해당한다.
    await project.save(renamed('학생이 고친 것'))

    await project.save(marked)

    expect(project.name).toBe('학생이 고친 것!')
    const stored = await loadProject(manifest.projectId)
    expect(stored?.document.manifest.name).toBe('학생이 고친 것!')
  })

  it('닫힌 뒤에는 아무것도 안 앉는다', async () => {
    const project = useProjectStore()
    await project.save(renamed('처음'))
    project.close()

    await project.save(marked)

    expect(project.file).toBeNull()
    expect(project.dirty).toBe(false)
    // 디스크에는 닫기 전의 것만 남는다.
    const stored = await loadProject(manifest.projectId)
    expect(stored?.document.manifest.name).toBe('처음')
  })

  it('`update`도 같은 규칙이다', async () => {
    const project = useProjectStore()
    await project.save(renamed('처음'))

    project.update(marked)
    expect(project.name).toBe('처음!')

    project.close()
    project.update(marked)
    expect(project.file).toBeNull()
    // **`dirty`까지 본다.** `file`만 보면 가드를 빼도 `null`을 다시 써 넣는 것이라
    // 안 운다 — 그 검사가 절반이었다 (R21 B-5).
    expect(project.dirty).toBe(false)
  })
})
