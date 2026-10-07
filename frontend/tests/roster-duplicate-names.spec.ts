/**
 * **이름이 같은 제출물 둘** (architecture.md §8.21 "명렬의 이름표는 겹치지 않는다").
 *
 * 명렬의 모든 기억 — 요약·교사의 고침·같은 프로젝트 묶음·큐·묶음 굽기 — 이 이름표를 열쇠로
 * 쓴다. 폴더째 고르면 상대 경로라 안 겹치지만 **파일 여럿 고르기와 끌어다 놓기는 이름만 온다** —
 * 탐색기의 검색 결과처럼 다른 폴더의 파일이 한 번에 오면 이름이 겹칠 수 있고, 학번·이름을 안
 * 적은 제출물은 파일 이름이 프로젝트 이름뿐이라(mlpx-spec.md §6.2) 교사가 나눠 준 주제면
 * 반 전체가 같은 이름이다.
 *
 * 겹치면 **다른 학생의 두 파일이 한 요약을 나눠 가지고, 자기 자신과 짝이 되어 `같은 프로젝트`로
 * 묶인다** — 이 화면이 가장 하면 안 되는 거짓 양성이다. 진짜 입구(`rosterOf` → `useRoster`의
 * 실제 읽기)로 재현한다.
 */

import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { useRoster } from '../src/composables/useRoster'
import { writeProject } from '../src/project/format'
import { rosterOf, sameProjectsOf } from '../src/project/roster'
import { emptyProjectFile } from './fixtures/project'

/** 다른 프로젝트를 같은 이름의 파일로 낸다. */
async function submission(projectId: string, name: string): Promise<File> {
  const project = emptyProjectFile()
  project.document.manifest = { ...project.document.manifest, projectId }
  const { blob } = await writeProject(project, '')
  return new File([new Uint8Array(await blob.arrayBuffer()) as BlobPart], name)
}

const FIRST = '11111111-1111-4111-8111-111111111111'
const SECOND = '22222222-2222-4222-8222-222222222222'

/**
 * 명렬이 다 읽힐 때까지 기다린다. 읽기는 진짜라 틱 수를 정할 수 없다 — 끝 상태를 기다린다
 * (workflow.md §3 "단언 실패는 검사의 경합이다"). 이름표가 겹치면 요약이 한 칸에 겹쳐 앉아
 * 이 수가 끝내 안 맞고, 그것이 이 파일이 잡는 병이다.
 */
async function readAll(roster: ReturnType<typeof useRoster>): Promise<void> {
  await vi.waitFor(
    () => {
      expect(roster.summaries.value.size).toBe(roster.items.value.length)
    },
    { timeout: 3000 },
  )
  await flushPromises()
}

describe('이름이 같은 제출물 둘', () => {
  it('명렬의 두 줄이 서로 다른 이름표를 갖는다', async () => {
    const items = rosterOf([
      await submission(FIRST, '붓꽃품종분류.mlpx'),
      await submission(SECOND, '붓꽃품종분류.mlpx'),
    ])
    expect(items).toHaveLength(2)
    expect(new Set(items.map((item) => item.label)).size).toBe(2)
  })

  it('붙는 번호는 확장자 앞이고, 이미 있는 이름을 피한다', async () => {
    // **진짜 `kim (2).mlpx`가 겹친 것보다 뒤에 온다** — 번호를 붙일 때 원래 이름을 먼저 안 잡아
    // 두면 겹친 쪽이 그 이름을 가져가고, 진짜 파일과 다시 겹친다.
    const items = rosterOf([
      new File([], 'kim.mlpx'),
      new File([], 'kim.mlpx'),
      new File([], 'kim (2).mlpx'),
      new File([], 'kim.mlpx.zip'),
      new File([], 'kim.mlpx.zip'),
    ])
    expect(items.map((item) => item.label).sort()).toEqual(
      ['kim (2).mlpx', 'kim (2).mlpx.zip', 'kim (3).mlpx', 'kim.mlpx', 'kim.mlpx.zip'].sort(),
    )
  })

  /**
   * **셋째부터도 서로 다르다** (R43-1 감사 C-2). 붙인 이름을 잡아 두는 줄을 지워도 전에는 둘만 보는 검사가
   * 초록이었고, 그 상태에서 셋째가 둘째와 같은 `kim (2).mlpx`를 받아 두 학생이 한 줄로 합쳐졌다.
   */
  it('같은 이름 셋은 셋 모두 다른 이름표를 갖는다', () => {
    const items = rosterOf([
      new File([], 'kim.mlpx'),
      new File([], 'kim.mlpx'),
      new File([], 'kim.mlpx'),
    ])
    expect(items.map((item) => item.label).sort()).toEqual(
      ['kim (2).mlpx', 'kim (3).mlpx', 'kim.mlpx'].sort(),
    )
  })

  /**
   * **같은 이름이 많아도 번호를 처음부터 다시 세지 않는다** (R43-1 감사 C-1의 이웃). 매번 2부터 세면 같은 이름
   * N개가 N²이다 — 교사가 나눠 준 주제 하나로 학년 전체를 모으면 이름이 전부 같다. 한도는 고친 뒤 값의 수십
   * 배이고 고치기 전 값보다 한참 아래다.
   */
  it('같은 이름이 많아도 이름표가 곧 나온다', () => {
    const COUNT = 20_000
    const BUDGET_MS = 3_000
    const files = Array.from({ length: COUNT }, () => new File([], 'topic.mlpx'))
    const started = performance.now()
    const items = rosterOf(files)
    const elapsed = performance.now() - started
    expect(new Set(items.map((item) => item.label)).size).toBe(COUNT)
    expect(elapsed, `${String(Math.round(elapsed))} ms`).toBeLessThan(BUDGET_MS)
  })

  it('이름이 안 겹치면 이름표는 파일 이름 그대로다', () => {
    const items = rosterOf([new File([], 'b.mlpx'), new File([], 'a.mlpx')])
    expect(items.map((item) => item.label)).toEqual(['a.mlpx', 'b.mlpx'])
  })

  it('다른 프로젝트의 두 파일이 같은 프로젝트로 묶이지 않고, 각자 자기 요약을 갖는다', async () => {
    const roster = useRoster()
    roster.show(
      rosterOf([
        await submission(FIRST, '붓꽃품종분류.mlpx'),
        await submission(SECOND, '붓꽃품종분류.mlpx'),
      ]),
    )
    await readAll(roster)

    const ids = roster.items.value.map((item) => {
      const summary = roster.summaries.value.get(item.label)
      return summary?.state === 'read' ? summary.projectId : null
    })
    expect(ids.sort()).toEqual([FIRST, SECOND])
    expect(sameProjectsOf(roster.items.value, roster.summaries.value).groups.size).toBe(0)
    roster.stop()
  })
})
