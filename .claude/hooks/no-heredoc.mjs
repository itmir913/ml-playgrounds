/**
 * Bash 도구의 **셸 힙독을 막는다** (`CLAUDE.md` §4).
 *
 * **규칙으로는 안 고쳐졌다.** §4가 *"소스 파일을 셸 힙독으로 쓰지 마라"*라고 적은 뒤에도
 * 2026-09-22에 또 밟았다 — `\b`가 제어문자(0x08)가 되고 `\n`이 진짜 줄바꿈이 되어
 * 검사 파일이 파스조차 안 됐다. 그래서 **사람이 지키는 것에서 도구가 막는 것으로** 옮긴다
 * (이 저장소가 화면 규칙에 쓰는 것과 같은 판단).
 *
 * **무엇을 막는가.** `<<EOF` · `<< EOF` · `<<'PY'` · `<<"X"` · `<<-EOF`.
 * **히어스트링(`<<<`)은 통과시킨다** — 백슬래시를 안 먹고, 처음 정규식이 그것까지
 * 잡아서 좁혔다(앞뒤의 `<`를 각각 내다본다).
 *
 * **셸을 안 거친다.** `settings.json`이 `args` 꼴로 부르므로 이 파일의 따옴표와
 * 백슬래시가 셸 파서에 닿지 않는다 — 막으려는 병을 막는 도구가 같은 병에 걸리면 안 된다.
 */

let input = ''

process.stdin
  .on('data', (chunk) => {
    input += chunk
  })
  .on('end', () => {
    try {
      const command = (JSON.parse(input || '{}').tool_input || {}).command || ''
      if (!/(?<!<)<<(?!<)-?[ \t]*['"]?[A-Za-z_]/.test(command)) return
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              '힙독 금지 (CLAUDE.md §4). 셸 힙독은 백슬래시를 조용히 먹는다 — `\\b`가 제어문자가 되고 `\\n`이 줄바꿈이 되어, 문법 오류로 서면 다행이고 정규식은 안 서고 아무것도 안 잡는 채로 초록불이 된다. 파일은 Write/Edit 도구로 써라. 여러 줄을 꼭 셸로 넘겨야 하면 파일로 쓰고 그 경로를 넘겨라(`git commit -F <파일>`처럼).',
          },
        }),
      )
    } catch {
      // 입력이 JSON이 아니면 판정하지 않는다 — 막는 쪽으로 기울면 멀쩡한 명령이 선다.
    }
  })
