/**
 * **기기 배수 실측 하니스** (`open-decisions.md` "학습 예상 시간은 실측표에 기기 배수를
 * 곱해 낸다").
 *
 * 예상 시간의 기준표는 개발 PC(i5-1135G7 · RAM 7.7GB)에서 쟀다. 다른 기기가 몇 배
 * 느린지는 **재야 알 수 있고**, 브라우저는 기기 이름을 안 알려준다 — iOS는 UA에 모델이
 * 없고 윈도우는 CPU 정보가 없다. 그래서 이 페이지가 **같은 일감을 그 기기에서 돌려**
 * 절대 시간을 내고, 개발 PC의 값과 나눈 것이 계층 상수가 된다.
 *
 * **배포되지 않는다.** vite의 build 입력이 `index.html` 하나뿐이라 `dist/`에 안 들어가고,
 * `tests/bench-rules.spec.ts`가 그 사실을 지킨다. 앱과 링크로 이어지지도 않는다.
 *
 * **일감은 진짜 엔진을 지나간다** — `ml/engines/mljs.ts`의 `fit`을 그대로 부른다. 여기서
 * 따로 계산을 짜면 재는 것이 앱이 아니라 이 파일이 된다.
 *
 * **문구가 한국어 리터럴인 것은 이 파일이 앱이 아니기 때문이다.** CLAUDE.md §3의 대상은
 * 학생에게 나가는 화면이고, 이 페이지는 코드 소유자만 연다.
 */

import { fit } from '../src/ml/engines/mljs'

/** 기준표와 같은 모양이다 — 8특성 · 3클래스 · 라벨 15% 잡음 (`open-decisions.md` #13). */
const FEATURES = 8
const CLASSES = 3
const NOISE = 0.15

/**
 * 일감. **크기는 개발 PC에서 1~3초 걸리게 골랐다** — 더 짧으면 첫 실행의 JIT가 값을
 * 흔들고, 더 길면 느린 기기에서 한 번 재는 데 몇 분이 든다.
 */
interface Workload {
  readonly id: string
  readonly label: string
  readonly run: () => void
}

/** 결정적 난수. **기기마다 같은 데이터를 봐야 배수가 데이터 차이를 안 담는다.** */
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

function synthetic(rows: number): { features: number[][]; target: string[] } {
  const random = lcg(42)
  const features: number[][] = []
  const target: string[] = []
  for (let row = 0; row < rows; row += 1) {
    const cluster = row % CLASSES
    const values: number[] = []
    for (let column = 0; column < FEATURES; column += 1) {
      values.push(cluster + random() * 2 - 1)
    }
    features.push(values)
    // 라벨의 15%를 흔든다. 완전히 분리되는 데이터는 솔버가 너무 쉽게 끝난다.
    const flipped = random() < NOISE ? (cluster + 1) % CLASSES : cluster
    target.push(String.fromCharCode(97 + flipped))
  }
  return { features, target }
}

function train(
  algorithm: string,
  rows: number,
  hyperparameters: Record<string, number> = {},
): void {
  const { features, target } = synthetic(rows)
  const rowIndices = features.map((_, index) => index)
  const { predict } = fit(algorithm, {
    features,
    rowIndices,
    target,
    hyperparameters,
    randomState: 42,
  })
  // **KNN은 학습이 0초이고 값이 예측에 있다.** 학생이 기다리는 것은 [학습하기]를 누르고
  // 결과가 나올 때까지이므로, 여기서도 평가 예측까지 지나간다 (기준표도 그렇게 쟀다).
  predict(features.slice(0, Math.max(1, Math.round(rows * 0.2))))
}

const WORKLOADS: readonly Workload[] = [
  {
    /**
     * **2,000행은 49ms라 JIT 잡음에 묻힌다** (2026-08-31 실측). 20,000행이 222ms다.
     *
     * **24,000행으로는 올리지 않는다.** 거기서부터 `maxIter`를 다 돌며 16초가 된다 —
     * 수렴 경계를 넘으면 100배가 뛰는 자리이고(아래 결정문), 기기 배수를 재는 데
     * 그 절벽을 태울 이유가 없다.
     */
    id: 'logistic_regression',
    label: '로지스틱 회귀 · 20,000행',
    run: () => train('logistic_regression', 20000),
  },
  { id: 'decision_tree', label: '의사결정트리 · 2,000행', run: () => train('decision_tree', 2000) },
  {
    id: 'random_forest',
    label: '랜덤 포레스트 · 500행 · 10그루',
    run: () => train('random_forest', 500),
  },
  { id: 'knn', label: 'KNN · 8,000행 학습 + 1,600행 예측', run: () => train('knn', 8000) },
]

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
  <main style="font-family: system-ui, sans-serif; font-size: 16px; line-height: 1.6; padding: 16px; max-width: 720px; margin: 0 auto;">
    <h1 style="font-size: 20px;">기기 배수 실측</h1>
    <p>같은 일감을 이 기기에서 돌려 걸린 시간을 잽니다. 개발 PC의 값과 나눈 것이 계층 상수가 됩니다.</p>
    <p><b>돌리는 동안 이 탭을 그대로 두세요.</b> 다른 탭으로 가면 브라우저가 계산을 늦춥니다.</p>
    <button id="run" style="font-size: 16px; padding: 8px 16px;">재기</button>
    <p id="status"></p>
    <table id="result" style="border-collapse: collapse; width: 100%;"></table>
    <h2 style="font-size: 18px;">붙여넣을 것</h2>
    <textarea id="json" rows="12" style="width: 100%; font-family: monospace; font-size: 13px;"></textarea>
  </main>
`

const button = document.getElementById('run') as HTMLButtonElement
const status = document.getElementById('status') as HTMLElement
const table = document.getElementById('result') as HTMLElement
const json = document.getElementById('json') as HTMLTextAreaElement

/** 한 프레임 쉰다. 안 쉬면 진행 표시가 안 그려지고 화면이 멈춘 것처럼 보인다. */
const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

button.addEventListener('click', () => {
  void (async () => {
    button.disabled = true
    table.innerHTML = ''
    const measured: Record<string, number> = {}

    for (const [index, workload] of WORKLOADS.entries()) {
      status.textContent = `${index + 1} / ${WORKLOADS.length} — ${workload.label}`
      await breathe()

      // **한 번만 잰다.** 여러 번 재서 중앙값을 내면 느린 기기에서 몇 분이 되고,
      // 우리가 원하는 정밀도는 "몇 배"이지 "몇 퍼센트"가 아니다.
      const started = performance.now()
      workload.run()
      const elapsed = Math.round(performance.now() - started)
      measured[workload.id] = elapsed

      const row = document.createElement('tr')
      row.innerHTML = `<td style="border-bottom: 1px solid #ddd; padding: 6px;">${workload.label}</td><td style="border-bottom: 1px solid #ddd; padding: 6px; text-align: right;"><b>${elapsed}</b> ms</td>`
      table.append(row)
    }

    status.textContent = '끝났습니다. 아래 상자를 통째로 복사해 주세요.'
    json.value = JSON.stringify({ device: device(), measured }, null, 2)
    button.disabled = false
  })()
})
