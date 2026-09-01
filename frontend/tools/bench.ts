/**
 * **실측 하니스의 화면** (`open-decisions.md` "학습 예상 시간은 실측표에 기기 배수를
 * 곱해 낸다").
 *
 * **두 가지를 잰다.**
 *
 * 1. **기준표** — 개발 PC의 브라우저에서 (알고리즘 × 행 수)마다 걸리는 시간. 예상 시간이
 *    보간하는 표가 이것이다. **Node가 아니라 브라우저에서 잰다** — 학생이 도는 곳이
 *    브라우저이고, 2026-08-31에 같은 기계의 브라우저끼리 12배가 갈렸다.
 * 2. **교정 일감** — 앱이 학습 화면에서 배수를 내려고 돌릴 짧은 일감. 여기서는 그것이
 *    **얼마나 걸리는지**를 확인한다(개발 PC에서 100ms 안쪽이어야 한다).
 *
 * **일감 정의는 `workloads.ts`에 있다** — DOM 없이도 같은 사다리를 돌릴 수 있어야 한다.
 *
 * **배포되지 않는다.** vite의 build 입력이 `index.html` 하나뿐이라 `dist/`에 안 들어가고,
 * `tests/bench-rules.spec.ts`가 그 사실을 지킨다. 앱과 링크로 이어지지도 않는다.
 *
 * **문구가 한국어 리터럴인 것은 이 파일이 앱이 아니기 때문이다.** CLAUDE.md §3의 대상은
 * 학생에게 나가는 화면이고, 이 페이지는 코드 소유자만 연다.
 */

import {
  ALL_LADDERS,
  CALIBRATION,
  CEILING_MS,
  FAILURE_CEILING_MS,
  LADDERS,
  PROJECTION_MS,
  measure,
  type Ladder,
} from './workloads'

/** 이 기기가 스스로 말해 주는 것 전부. **이름은 없다 — 성질만 있다.** */
function device(): Record<string, unknown> {
  const data = (navigator as { userAgentData?: { mobile?: boolean; platform?: string } })
    .userAgentData
  return {
    cores: navigator.hardwareConcurrency ?? null,
    memoryGb: (navigator as { deviceMemory?: number }).deviceMemory ?? null,
    mobile: data?.mobile ?? null,
    platform: data?.platform ?? null,
    touchPoints: navigator.maxTouchPoints,
    userAgent: navigator.userAgent,
  }
}

const app = document.getElementById('app') as HTMLElement
app.innerHTML = `
  <main style="font-family: system-ui, sans-serif; font-size: 16px; line-height: 1.6; padding: 16px; max-width: 760px; margin: 0 auto;">
    <h1 style="font-size: 20px;">실측 하니스</h1>
    <p><b>개발자 도구를 닫고, 돌리는 동안 이 탭을 그대로 두세요.</b> 개발자 도구가 열려 있으면 JIT가 꺼져 열 배 넘게 느려지고, 다른 탭으로 가면 브라우저가 계산을 늦춥니다.</p>
    <p id="controls"></p>
    <p><button id="all" style="font-size: 16px; padding: 8px 16px;">전부 훑기</button>
       <button id="limits" style="font-size: 16px; padding: 8px 16px;">상한 찾기 (몇 시간)</button>
       <button id="calibrate" style="font-size: 16px; padding: 8px 16px;">교정 일감만</button></p>
    <p style="color: #666;">[상한 찾기]는 <b>깨지는 지점을 찾는 것</b>이라 탭이 죽을 수 있습니다. 점을 하나 잴 때마다 저장하므로, 죽었으면 이 페이지를 다시 열어 아래 상자를 확인하세요.</p>
    <p id="status"></p>
    <table id="result" style="border-collapse: collapse; width: 100%;"></table>
    <h2 style="font-size: 18px;">붙여넣을 것</h2>
    <textarea id="json" rows="14" style="width: 100%; font-family: monospace; font-size: 13px;"></textarea>
  </main>
`

const controls = document.getElementById('controls') as HTMLElement
const allButton = document.getElementById('all') as HTMLButtonElement
const limitsButton = document.getElementById('limits') as HTMLButtonElement
const calibrateButton = document.getElementById('calibrate') as HTMLButtonElement
const status = document.getElementById('status') as HTMLElement
const table = document.getElementById('result') as HTMLElement
const json = document.getElementById('json') as HTMLTextAreaElement

/** 한 프레임 쉰다. 안 쉬면 진행 표시가 안 그려지고 화면이 멈춘 것처럼 보인다. */
const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

/**
 * **탭이 한 번이라도 뒤로 갔는지 기억한다.** 브라우저는 안 보이는 탭의 계산을 늦추고,
 * 그렇게 나온 값은 그 기기가 아니라 **그때의 사정**을 잰 것이다. 값만 남으면 그 사정이
 * 조용히 기준표로 굳으므로 결과에 함께 싣는다.
 */
let wentHidden = false
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') wentHidden = true
})

const measured: Record<string, Record<string, number>> = {}
const calibration: Record<string, number[]> = {}
const stopped: string[] = []
/** 던진 자리. **여기가 곧 상한이다** — 메모리 부족이 이렇게 온다. */
const failed: Record<string, string> = {}

/**
 * **점을 하나 잴 때마다 남기는 자리.**
 *
 * [상한 찾기]는 **탭이 죽는 것이 답인** 실측이라, 죽으면 잰 것이 통째로 사라지면 안 된다
 * (`open-decisions.md` "그러면 상한은 시간으로 정하는 것이 아니다"). 페이지를 다시 열면
 * 여기서 되살린다.
 */
const SAVE_KEY = 'ml-playgrounds:bench'

/** 크로미움만 준다. 없으면 없는 대로 둔다 — 지어내지 않는다. */
function heapMb(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory
  return memory ? Math.round(memory.usedJSHeapSize / 1_000_000) : null
}

function snapshot(): Record<string, unknown> {
  return {
    device: device(),
    wentHidden,
    ceilingMs: CEILING_MS,
    failureCeilingMs: FAILURE_CEILING_MS,
    heapMb: heapMb(),
    stopped,
    failed,
    measured,
    calibration,
  }
}

function publish(): void {
  const text = JSON.stringify(snapshot(), null, 2)
  json.value = text
  try {
    window.localStorage.setItem(SAVE_KEY, text)
  } catch {
    // 저장에 실패해도 상자에는 있다. 탭이 죽었을 때만 잃는다.
  }
}

function addRow(label: string, point: string, elapsed: number): void {
  const row = document.createElement('tr')
  const cell = 'border-bottom: 1px solid #ddd; padding: 6px;'
  row.innerHTML =
    `<td style="${cell}">${label}</td>` +
    `<td style="${cell} text-align: right;">${point}</td>` +
    `<td style="${cell} text-align: right;"><b>${elapsed}</b> ms</td>`
  table.append(row)
}

async function runLadder(ladder: Ladder): Promise<void> {
  const results: Record<string, number> = {}
  measured[ladder.id] = results
  let previous: { point: number; elapsed: number } | null = null
  // 상한을 찾는 사다리는 오래 걸리는 것이 답의 일부라 20초에서 안 멈춘다.
  const ceiling = ladder.findsLimit ? FAILURE_CEILING_MS : CEILING_MS

  for (const point of ladder.points) {
    if (previous !== null && !ladder.findsLimit) {
      // **다음 점을 시작하기 전에 얼마나 걸릴지 어림한다.** 마지막 두 점의 증가율을 쓰고,
      // 첫 점 뒤에는 아직 기울기를 모르니 마지막 값만 본다.
      const growth = point / previous.point
      const projected = previous.elapsed * growth * growth
      if (previous.elapsed > CEILING_MS || projected > PROJECTION_MS) {
        stopped.push(`${ladder.id}@${point}`)
        break
      }
    }
    if (previous !== null && ladder.findsLimit && previous.elapsed > ceiling) {
      stopped.push(`${ladder.id}@${point}`)
      break
    }

    status.textContent = `${ladder.label} — ${ladder.axis} ${point.toLocaleString()}`
    await breathe()

    /**
     * **던지는 것이 답인 사다리가 있다.** 메모리가 모자라면 여기서 오고, 그 자리가 곧
     * 상한이다. 삼키지 않고 **적고 멈춘다** — 그 위를 더 재 봐야 같은 실패다.
     */
    let elapsed: number
    try {
      elapsed = ladder.run ? ladder.run(point) : measure(ladder.job(point))
    } catch (error) {
      failed[`${ladder.id}@${point}`] = String(error)
      addRow(ladder.label, point.toLocaleString(), -1)
      publish()
      break
    }

    results[String(point)] = elapsed
    previous = { point, elapsed }
    addRow(ladder.label, point.toLocaleString(), elapsed)
    publish()
  }
}

async function runCalibration(): Promise<void> {
  for (const job of CALIBRATION) {
    const id = `${job.algorithm}@${job.rows}`
    status.textContent = `교정 일감 — ${id}`
    await breathe()
    // **세 번 잰다.** 앱이 실제로 쓸 값이라 흔들리면 배수가 흔들린다. 짧으니 싸다.
    const times = [measure(job), measure(job), measure(job)]
    calibration[id] = times
    addRow('교정 일감', id, Math.min(...times))
    publish()
  }
}

function busy(disabled: boolean): void {
  allButton.disabled = disabled
  limitsButton.disabled = disabled
  calibrateButton.disabled = disabled
  for (const node of controls.querySelectorAll('button')) node.disabled = disabled
}

function start(work: () => Promise<void>): void {
  void (async () => {
    busy(true)
    wentHidden = document.visibilityState === 'hidden'
    await work()
    status.textContent = wentHidden
      ? '탭이 뒤로 간 적이 있습니다. 이 값은 쓸 수 없으니 다시 재 주세요.'
      : '끝났습니다. 아래 상자를 통째로 복사해 주세요.'
    publish()
    busy(false)
  })()
}

for (const ladder of ALL_LADDERS) {
  const button = document.createElement('button')
  button.textContent = ladder.label
  button.style.cssText = 'font-size: 14px; padding: 6px 10px; margin: 0 6px 6px 0;'
  button.addEventListener('click', () => start(() => runLadder(ladder)))
  controls.append(button)
}

// **[전부 훑기]에 상한 사다리는 안 들어간다.** 몇 시간짜리라 따로 돌린다.
allButton.addEventListener('click', () =>
  start(async () => {
    for (const ladder of LADDERS) await runLadder(ladder)
    await runCalibration()
  }),
)

limitsButton.addEventListener('click', () =>
  start(async () => {
    for (const ladder of ALL_LADDERS.filter((one) => one.findsLimit)) await runLadder(ladder)
  }),
)

calibrateButton.addEventListener('click', () => start(runCalibration))

/**
 * **죽은 뒤 되살린다.** 저장만 하고 되살리지 않으면 그 저장이 쓸모가 없다 — [상한 찾기]는
 * **탭이 죽는 것이 답인** 실측이라, 다시 열었을 때 어디까지 살아 있었는지가 상자에
 * 있어야 한다.
 *
 * **덮어쓰지 않는다.** 새로 돌리면 `publish()`가 그 위에 쓴다. 여기서 하는 일은
 * 빈 상자를 채우는 것뿐이다.
 */
try {
  const saved = window.localStorage.getItem(SAVE_KEY)
  if (saved !== null) {
    json.value = saved
    status.textContent = '지난 실측이 남아 있습니다. 새로 돌리면 덮어씁니다.'
  }
} catch {
  // 못 읽으면 빈 상자다. 그것도 사실이다.
}
