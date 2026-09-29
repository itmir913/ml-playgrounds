/**
 * 서버 학습의 자리. **지금은 코드가 한 줄도 없다** (2026-09-29 감사 F C-4 — 전에 이 자리가
 * *"서버 학습 구현. 업로드 -> WebSocket 진행 구독 -> 결과/모델/서명 수신"*이라고 적어, 있는
 * 구현처럼 읽혔다).
 *
 * 그 길은 학교가 자가호스팅하는 4단계의 일이다 (`docs/open-decisions.md` "백엔드 구현(4단계)").
 * 들어오면 모양은 학습 워커와 같은 메시지 순서를 따른다 (`ml/worker/protocol.ts`).
 *
 * **그때까지 서버 줄을 잠그는 것은 이 파일이 아니다.** 앱이 서버 상태를 아는 곳이 없어
 * `serverStatus`가 늘 `'unknown'`이고(`ml/training-source.ts`의 `runtimeContextFor`,
 * `ml/reproduce.ts`의 `inspectContext`), `ml/backend.ts`의 `runtimeOptions`가 그 값에서
 * 서버 줄을 `SERVER_UNAVAILABLE`로 **이유와 함께** 끈다 (CLAUDE.md §2). 등록부에는 서버 엔진이
 * 없으므로(`ml/engines/index.ts`의 `ENGINES`) 파일에서 온 서버 줄도 학습에서 같은 코드의 실패
 * run이 된다. 무는 검사: `runtime-options.spec.ts`의 *"서버가 없어도 목록에서 사라지지
 * 않는다 - 숨기지 않고 이유를 준다"*, `experiment.spec.ts`의 `SERVER_UNAVAILABLE` 판들.
 */
