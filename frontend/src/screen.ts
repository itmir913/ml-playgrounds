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
