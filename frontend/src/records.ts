/**
 * **열쇠로 꺼내는 일** — 남이 준 이름이 열쇠가 되는 자리의 유일한 통로.
 *
 * `z.record`가 만든 객체도, 우리가 쓴 객체 리터럴도 `Object.prototype`을 상속한다.
 * 그래서 열쇠가 `constructor`·`toString`·`valueOf`·`hasOwnProperty`·`__proto__`면
 * **`?? 기본값`이 안 걸리고 함수가 나온다** — 그 뒤 `.trim()`·`.map()`이 던지고,
 * 무는 사람은 *"왜 화면 전체가 섰지"*를 묻는다.
 *
 * **자리가 셋이라 함수가 하나다** (2026-09-22 R37 A-2, 2026-09-23 C-5).
 * A-2가 포트폴리오에서 셋을 닫았고, 같은 병이 하이퍼파라미터 표 둘에 더 있었다 —
 * 손으로 고친 `.mlpx`의 `algorithm`이 `userString`이라 `constructor`가 문을 통과한다.
 * 그때 원시 연산을 한 자리로 꺼냈다. **다음에 또 나오면 여기서 가져간다.**
 *
 * `tests/prototype-keys.spec.ts`가 **읽는 자리를 전수로 센다.**
 */

/** 그 열쇠로 **직접 담긴 것**만 꺼낸다. 상속한 것은 없는 것이다. */
export function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

/**
 * 그 열쇠를 **뺀 사본**.
 *
 * **쓰는 쪽에도 같은 병이 있다.** `obj[key] = v`는 열쇠가 `__proto__`일 때 own 속성을
 * 안 만들고 **프로토타입을 바꾼다** — 그러면 `own()`이 못 찾아 방금 담은 것이 조용히
 * 사라진다. 계산된 열쇠를 쓴 객체 리터럴(`{ ...rest, [key]: v }`)은 언제나 own 속성을
 * 만들므로 **담는 쪽은 리터럴로 쓰고, 빼는 쪽이 이 함수다.**
 */
export function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]
  return next
}
