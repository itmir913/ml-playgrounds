/**
 * 화면에 양보한다. **오래 도는 계산이 메인 스레드에 있을 때 쓴다.**
 *
 * **이것이 없으면 [예측] 같은 단추의 이중 실행 방지가 통째로 무력해진다.** `AppButton`은
 * `action`이 끝날 때까지 스스로 꺼지는데(CLAUDE.md §4), 그 꺼짐은 **다음 작업(task)에서야
 * 화면에 반영되고** 꺼짐 상태 자체도 `finally`가 마이크로태스크에서 푼다. 그래서 일이
 * **한 작업 안에서 동기로 끝나면** 눌린 순간부터 끝날 때까지 버튼은 한 번도 꺼진 적이
 * 없고, 그동안 쌓인 클릭이 전부 한 번씩 더 돈다 — 연타하면 브라우저가 먹통이 된다
 * (2026-08-14, 사용자가 이미지 예측 화면에서 겪었다).
 *
 * 그래서 오래 걸리는 일은 **시작하자마자 한 번, 그리고 단위마다 한 번** 양보한다.
 * 양보하는 순간 꺼짐이 화면에 서고, 그 뒤의 클릭은 꺼진 단추에 떨어진다.
 *
 * `setTimeout(0)`이 `requestAnimationFrame`보다 테스트 환경을 덜 가린다 — 보이지 않는
 * 탭에서도 돌고, jsdom에 그대로 있다.
 */
export function yieldToScreen(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 팝오버가 설 자리를 고를 때 재는 것. 단위는 픽셀이다. */
export interface SidePlacement {
  /** 트리거 위에 남은 자리. */
  readonly above: number
  /** 트리거 아래에 남은 자리. */
  readonly below: number
  /** 패널의 지금 높이. */
  readonly height: number
  /** 부르는 쪽이 요청한 방향이 위인가. */
  readonly wantsTop: boolean
}

/**
 * 위로 열 것인가. **요청한 쪽이 원칙이고, 그쪽에 안 들어갈 때만 반대쪽을 본다.**
 *
 * **둘 다 모자라면 요청한 쪽으로 돌아온다** (2026-08-14, 사용자). 이유 둘이다.
 *
 * 1. **`side`는 취향이 아니라 사실에서 나온다** — "이 트리거 아래가 전부 답이다"라서
 *    위로 여는 것이다. 모자라다고 아래로 뒤집으면 **읽으려고 연 것이 읽으려던 답을
 *    가리면서 스크롤도 그대로 생긴다.** 둘 다 잃는다.
 * 2. **더 넓은 쪽을 고르면 방향이 1픽셀에 뒤집힌다.** 위아래가 330 대 331인 자리가
 *    실제로 흔하고(답 카드가 세로로 늘어선다), 그러면 같은 팝오버가 줄마다 위로 갔다
 *    아래로 갔다 한다 — 학생 눈에는 아무 규칙이 없다.
 *
 * **대가는 요청한 쪽이 아주 좁을 때다.** 그때는 낮은 상자가 서고 그 안에서 스크롤한다 —
 * 넘치는 것은 천장이 막으므로(`popover-panel`의 `--popover-room`) **잘리지는 않는다.**
 * "아래가 뚜렷하게 넓으면 아래로"라는 단서를 달 수도 있지만, 그 '뚜렷하게'가 곧 근거
 * 없는 상수다. 낮은 상자는 드물고 굴리면 복구되지만, 방향이 뒤집히는 것은 매번 일어나고
 * 복구할 방법이 없다.
 */
export function prefersTop({ above, below, height, wantsTop }: SidePlacement): boolean {
  const requested = wantsTop ? above : below
  const other = wantsTop ? below : above
  if (requested >= height) return wantsTop
  return other >= height ? !wantsTop : wantsTop
}

/**
 * 이 요소를 굴리는 상자. **없으면 `null`이고 그때 굴리는 것은 문서다.**
 *
 * `overflow`가 `auto`·`scroll`인 조상 중 가장 가까운 것을 찾는다. `hidden`은 아니다 -
 * 그건 잘라낼 뿐 굴리지 않는다.
 */
export function nearestScrollport(element: Element): Element | null {
  let current = element.parentElement
  while (current !== null) {
    const { overflowY } = getComputedStyle(current)
    if (overflowY === 'auto' || overflowY === 'scroll') return current
    current = current.parentElement
  }
  return null
}

/**
 * **붙박이 바가 덮는 만큼**을 뷰포트 좌표의 픽셀로 준다. 요소가 이미 갖고 있는
 * `scroll-margin-top`을 읽고, 그 값이 사는 좌표계를 뷰포트로 옮긴다
 * (`styles/utilities.css`의 `under-step-bar`).
 *
 * 쓰는 곳은 "지금 보고 있는 것"을 판정하는 자리다. 뷰포트를 그대로 기준으로 삼으면
 * **바에 가려 안 보이는 것도 보이는 것으로 센다** — 붙박이 바는 화면을 덮을 뿐 뷰포트를
 * 잘라내지 않기 때문이다. 목차에서 8번을 눌렀는데 7번이 표시되던 것이 그것이다
 * (2026-08-15, 사용자).
 *
 * **숫자를 새로 만들지 않는다.** 스크롤이 멈추는 선과 "여기부터가 지금 것"인 선은 같은
 * 선이어야 하고, 그 값은 이미 요소에 붙어 있다. 여기서 따로 재면 그 순간 둘이 갈리고,
 * 바가 두 줄로 접히는 좁은 화면에서만 어긋난다.
 *
 * **더하는 것은 좌표 변환뿐이다.** `scroll-margin-top`은 **굴리는 상자**의 기준이고
 * `IntersectionObserver`의 여백은 **뷰포트** 기준이다. 넓은 화면에서 굴리는 것은 문서가
 * 아니라 `<main>`이고(`AppShell`의 `md:overflow-auto`) 그 상자는 도구 막대 높이만큼
 * 내려와 있다 — **한 번 고쳤는데도 넓은 화면에서만 여전히 어긋났던 이유가 이것이다.**
 * 좁은 화면에서는 문서가 굴러서 두 좌표계가 같고, 그래서 거기서는 우연히 맞았다.
 *
 * **읽을 수 없으면 0이다.** 이 속성을 모르는 브라우저는 빈 문자열을 주는데, 그때 판정이
 * `NaN`으로 죽는 것보다 **덮는 것이 없다고 보는 쪽**이 낫다 — 표시만 예전처럼 돌아간다.
 */
export function stickyCover(element: Element): number {
  const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop)
  const scrollport = nearestScrollport(element)
  return (
    (Number.isFinite(margin) ? margin : 0) +
    (scrollport === null ? 0 : scrollport.getBoundingClientRect().top)
  )
}

/**
 * 글 칸을 **내용만큼** 키운다 (architecture.md §8.18).
 *
 * 높이를 줄 수로 박으면 긴 답은 칸 안에서 굴러야 하고 — 쓴 글 전체를 한 번에 볼 수 없다 —
 * 짧은 답 아래에는 빈 상자가 남는다. **최소 높이는 CSS가 갖는다**(`min-h-*`): `min-height`가
 * 여기서 넣는 `height`를 이긴다.
 *
 * **먼저 `auto`로 풀고 잰다.** 안 풀면 `scrollHeight`가 지금 높이 아래로 안 내려가서
 * **줄을 지워도 칸이 안 줄어든다.**
 */
export function growToFit(element: HTMLTextAreaElement): void {
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight}px`
}
