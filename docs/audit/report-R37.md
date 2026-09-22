# R37 감사 보고서 — `project/` `data/`를 순서와 실물로 봤다

> 요청서 `docs/audit/request-R37.md` · 앞 라운드 `report-R36.md` · 지도 `map-2026-09-21.md`
>
> **HEAD `77db653`**(`0.26.1`). 작업 트리는 시작할 때 깨끗했고 끝날 때도 깨끗하다.
> 기준선 `npm run ci` — **184파일 · 3,814 통과 · 3 건너뜀 · 144.7초**, `build`까지 초록.
> 심은 것은 전부 즉시 되돌렸다(경로 하나 · 문자열 하나 단위, 되돌린 뒤 `git diff`로 확인).
> **소스에 남은 것은 없다.** 임시 스펙 다섯을 심었다가 지웠다.

---

## 0. 요약 — 뿌리 하나

> **`await` 뒤에 "나는 아직 유효한가"를 묻는 자리가 없다. 그리고 남이 준 이름을
> 열쇠로 쓰는 자리에 "이건 내 것이 맞나"를 묻는 자리가 없다.**

둘 다 **한 시점의 계산을 겨냥하는 돌연변이가 원리적으로 못 보는 자리**이고, 그래서
열여덟 라운드가 안 봤다(`roadmap.md`의 사각 둘).

- **여는 중에 떠나면** `close()`의 `releaseTabLock()`이 **없던 일이 되고**, 그 뒤
  `open()`이 닫힌 프로젝트를 되살린다. 두 클릭이면 난다 — A-1.
- **양식의 `{#id}`가 `Object.prototype`의 이름이면** 포트폴리오를 읽는 자리 여섯이
  전부 선다. 문 여덟은 멀쩡하다 — **스키마는 다 통과한다.** 무너지는 것은 읽는 쪽이다 — A-2.
- **같은 흩뿌림을 쓰는 화면 둘이 툴팁에서 갈린다.** 군집 쪽은 되돌리고 데이터 쪽은
  안 되돌린다 — A-3. 2026-08-31 사각 감사 A-3이 닫은 병이 새 화면에서 되살아났다.

**등급 — A 3 · B 2 · C 8.** 그리고 **A-1′ 하나는 커밋 안 된 작업 트리에 대한 것이다** —
라운드가 도는 중에 다른 세션이 A-1을 고치다 **자물쇠를 영영 놓지 못하게 만들었다.**

**방법 하나가 거짓말을 했다.** 돌연변이 러너의 `--silent`가 스펙 경로를 먹어
**50번의 "욺"이 전부 인자 파싱 실패**였다. 아무것도 안 바꾼 대조(C0)를 넣고서야 드러났다.
「돌연변이 러너가 안 돌고 있었다」와 같은 병이고, **이 보고서의 돌연변이 표는 고친 뒤에
다시 잰 값이다**(§3).

---

## 1. 지적

### A-1. 여는 중에 떠나면 프로젝트가 되살아나고 두 탭 잠금이 비켜간다

**자리** `frontend/src/project/tab-lock.ts:240`(`releaseTabLock`) ·
`frontend/src/stores/project.ts:132·144`(`open`) · `frontend/src/router/index.ts:132`(`close`)
— **소유 경로는 첫째 하나다.** 나머지 둘은 읽기만 했고 안 고쳤다.

**주장.** `acquireTabLock`은 요청을 사슬로 줄 세우는데(`:152`, R26 B-11) **`releaseTabLock`은
그 사슬 밖에 있다.** 그래서 잠금을 잡는 중에 놓으라는 말이 오면

- `heldId`가 이미 `null`이고 `releaseHeld`도 아직 `null`이라 **`releaseTabLock()`이 아무 일도
  안 하고**,
- 그 뒤 `acquireOne`이 `heldId = id`를 쓰면서 **놓으라고 한 잠금을 도로 세운다.**

그리고 `stores/project.ts`의 `open()`은 `await` 넷을 지난 뒤 `file.value = loaded`를
**조건 없이** 쓴다. 같은 파일의 `resolve()`가 *"닫혔으면 `null`을 돌려주고 부르는 쪽은
아무것도 안 한다 — 되살리면 목록으로 나간 학생의 화면에 옛 프로젝트가 다시 뜨고 자동
저장이 그것을 쓴다(R20 감사)"*라고 적어 둔 규칙을, **`open()`만 안 지킨다.**

**재현** (`tests/zz-r37-router.spec.ts`, 지운 임시 스펙). 가짜 Web Locks의 허가 시점을
손으로 쥐고 순서를 강제했다. `trace`는 잠금 요청/허가/놓기와 나가는 가드의 통과다.

| | `close()`가 도는 자리 | trace | 주소 | 열린 프로젝트 | 자물쇠 |
|---|---|---|---|---|---|
| 갑 | 잠그기 **전** | `request · granted` | `projects` | **되살아남** | **쥔 채** |
| 을 | 잠근 **직후** | `request · granted · released` | `projects` | **되살아남** | 안 쥠 |
| 병 | 을 뒤 그 프로젝트로 재진입 | **(비었다)** | `projects` | 열림 | 안 쥠 |
| 정 | **라우터 두 클릭** | `request · guard:inspect · granted` | **`inspect`** | **되살아남** | **쥔 채** |

**정이 학생의 손이다** — 목록에서 프로젝트를 누르고 곧이어 레일의 **[점검]**을 누른다.
레일은 `AppShell`에 있어 목록 화면에서도 서 있고(`StepRail.vue:261` *"프로젝트가 없어도
열린다"*), `ROUTE_INSPECT`의 머리말이 *"`projectId`가 없는 주소라 아래 가드가 열려 있던
프로젝트를 닫는다"*고 적어 둔 그 불변식이 여기서 깨진다.

**틀리면 학생에게.** 둘 중 하나이고 **어느 쪽인지는 밀리초가 정한다.**

- **갑·정** — 아무도 편집하지 않는 프로젝트를 이 탭이 계속 쥔다. 다른 탭에서 그 프로젝트를
  열면 *"다른 탭에서 열려 있습니다"*가 뜨고, 탭을 닫기 전에는 안 풀린다.
- **을·병** — **자물쇠 없이 프로젝트를 들고 있다.** 다시 들어가면 `open()`이
  `projectId.value === id` 지름길로 통과해 **잠금을 한 번도 안 묻는다**(병의 빈 trace).
  그동안 다른 탭이 같은 프로젝트를 정상적으로 열 수 있다 — **두 탭이 한 프로젝트를 쓰는
  상태**, 이 잠금이 존재하는 이유 그 자체다(`tab-lock.ts` 머리말: *"잊힌 탭 B의 저장 한
  번이 탭 A의 실험들을 흔적 없이 덮는다"*).

**무는 검사가 있는가.** **없다.** `tests/tab-lock.spec.ts` 열일곱 · `project-open-lock.spec.ts`
넷 · `welcome-fail.spec.ts`가 전부 초록이다 — **잡는 것과 놓는 것을 언제나 차례로만 부른다.**
**세울 수 있다**: 위 표가 그 검사다(가짜 잠금의 허가 시점을 손에 쥐면 결정적이다).

**처방 — 두 쪽이고, 한 쪽만 고치면 화면이 거짓말한다. 재 봤다.**

1. **`tab-lock.ts`(소유 경로).** 세대 번호를 하나 둔다 — `releaseTabLock()`이 올리고,
   `acquireOne`이 끝난 뒤 자기가 시작할 때의 번호와 다르면 **방금 잡은 것과 앞의 것을
   둘 다 놓고 `false`를 돌려준다.**
   - **세대 번호를 `acquireOne` 안에서 잡으면 안 문다.** `releaseTabLock`이 `acquireOne`이
     시작하기 **전에** 올 수 있어서다(사슬의 `.then` 밖). **`acquireTabLock` 진입점에서
     동기로 잡아야** 한다 — 둘 다 심어서 쟀고, 앞엣것은 세 자리 중 하나만 닫았다.
   - 이 한 쪽만 넣으면 위 넷의 **상태는 전부 깨끗해진다**(되살아남 없음, 유령 자물쇠 없음).
2. **`stores/project.ts`(소유 밖 — 고치지 않았다).** 1만 넣으면 갑·정에서 `open()`이
   `false`를 받아 **목록으로 튕기고 `PROJECT_OPEN_ELSEWHERE` 토스트가 뜬다** — 아무도
   안 쥐었는데 그렇게 말한다. `open()`이 **"내가 취소당했는가"와 "남이 쥐었는가"를
   가를 수 있어야** 하고, 그 값을 알 수 있는 자리는 `open()`이다.

### A-1′. 라운드가 도는 중에 들어온 고침이 **자물쇠를 영영 놓지 못하게 한다**

**자리** `frontend/src/project/tab-lock.ts`의 **작업 트리 변경**(커밋 안 됨, 2026-09-22).
**내가 넣은 것이 아니고 건드리지도 않았다** — 병렬 세션의 일이다. 위 처방 1과 모양이
같고, `generation`을 `acquireTabLock` 진입점에서 잡는 것까지 맞다. **취소 갈래의 세 줄이
다르다.**

```ts
  if (generation !== startedAt) {
    releaseHeld = null      // ← 방금 잡은 자물쇠의 **놓는 손잡이를 버린다**
    heldId = null
    previousRelease?.()     // ← 앞의 것만 놓는다
    return false
  }
```

`releaseHeld`는 그 시점에 **방금 잡은** 자물쇠의 손잡이다. `null`로 덮으면 그 자물쇠를
놓을 길이 **이 탭에서 영영 사라진다** — `releaseTabLock()`은 `releaseHeld === null`을 보고
아무 일도 안 한다.

**잰 값**(그 상태의 작업 트리에서 `tests/zz-r37-router.spec.ts`·`zz-r37-lock.spec.ts`):

| | 되살아남 | 자물쇠 | 처방 1(내 판)에서는 |
|---|---|---|---|
| 갑 | **없음** ✓ | **쥔 채** ✗ | 안 쥠 |
| 을 | **없음** ✓ | 안 쥠 ✓ | 안 쥠 |
| 정(라우터 두 클릭) | **없음** ✓ | **쥔 채** ✗ | 안 쥠 |

그리고 그 상태에서 **그 탭은 그 프로젝트를 다시 못 연다**:

```
{ 쥔채: true, 다시열림: false }     // releaseTabLock()을 두 번 불러도 그대로다
```

**이것이 `tab-lock.ts:145–148`이 적어 둔 바로 그 실패다** — *"앞 자물쇠가 놓는 손잡이 없이
브라우저에 남는다. 그 탭은 **그 프로젝트를 다시 못 연다** — 자기가 쥐고 있는데
`ifAvailable`이 `null`을 주기 때문이다. **탭을 닫아야 풀린다.**"* 되살아남은 닫혔지만
**유령 자물쇠가 그 자리를 대신 열었다.**

**처방.** 버리기 전에 부른다 — 한 줄이다.

```ts
    const fresh = releaseHeld
    releaseHeld = null
    heldId = null
    previousRelease?.()
    fresh?.()
```

**그리고 처방 2는 여전히 비어 있다** — `stores/project.ts`도 같은 트리에서 움직이고
있었으므로(작업 트리 변경 있음) 이 보고서를 받는 세션이 확인해야 한다.

**같은 병의 이웃 — `grep`으로 셋을 셌고 하나가 더 물렸다.** `releaseTabLock`을 부르는
자리는 셋이다(`stores/project.ts:144`·`:329`, `tab-lock.ts:230`의 `withTabLock` `finally`).

- `:144`는 잠금이 이미 잡힌 뒤라 안전하다.
- **`withTabLock`의 `finally`는 같은 병이다.** 지우는 중에 다른 프로젝트를 열려다
  거절당하면 **지운 프로젝트의 자물쇠가 그 탭에 남는다**(`tests/zz-r37-lock.spec.ts`에서
  재현). 위 처방 1이 이것도 닫는다.
- **BroadcastChannel 폴백도 같다** — 비보안 컨텍스트(교실의 `http://` 자가호스팅)에서
  놓은 탭이 `claim`에 계속 답한다. 두 경로 다 쟀다.

---

### A-2. 양식의 `{#id}`가 `Object.prototype`의 이름이면 포트폴리오가 통째로 선다

**자리** `frontend/src/project/portfolio.ts:58` · `:245` · `:339` — **읽는 자리 셋뿐이다.**

**문 여덟은 멀쩡하다.** 요청서 §4가 시킨 대로 `withImportedSections`·`withSectionAdded`·
`withSectionRemoved`·`withSectionMoved`·`withSectionText`·`withAnswer`·
`withAttachmentAdded`·`withAttachmentRemoved` 여덟에 적대적 값을 넣고 나온 것을
`portfolioSchema`로 파스했다 — **적대적 값 열일곱 벌이 전부 통과한다.** 지도 §2.1의 *"없다"* 열은
**"문이 모양을 안 지킨다"가 아니라 "그 자리에 검사가 없다"**였고, 실물로 바꾸니 문은
지키고 있었다.

**무너지는 것은 읽는 쪽이다.** `answers`와 `attachments`는 `z.record`가 만든 **평범한
객체**라 `Object.prototype`을 상속한다. 그래서 문항 id가 `constructor`면

```ts
portfolio.answers['constructor'] ?? ''   // → Object 함수. `?? ''`가 안 걸린다
```

**진짜 입구로 닿는다.** `portfolio-form.ts:34`의 `HEADING_ID = /\s*\{#([\w-]+)\}\s*$/`가
`constructor`·`toString`·`valueOf`·`hasOwnProperty`·`__proto__`를 **전부 통과시킨다.**
`{#id}` 표기는 우리가 정한 규약이고(`mlpx-spec.md` §8.2, Pandoc 관행), **교사가 손으로 쓴
양식**과 손으로 고친 `.mlpx`가 그 입구다. 제목 슬러그로도 하나가 들어온다 —
`sectionIdFor('constructor', 0) === 'constructor'`(슬러그가 소문자라 이 이름만 살아남는다).

**재현.** 다섯 이름 × 여섯 자리 = **서른 가지 전부**가 났다. 교사 양식 문자열
`## 느낀 점 {#toString}`을 `parsePortfolioForm`에 넣고 `withImportedSections`로 받은
뒤 재현한 것이다.

| 부르는 자리 | 무슨 일 |
|---|---|
| `isPortfolioAnswered` → `stores/project.ts:72`의 `facts` | `TypeError: (…).trim is not a function` — **라우터 가드의 `resolveStep`과 체크리스트가 함께 선다** |
| `portfolioSections` → `PortfolioView`·점검 화면 | 답 자리에 **함수**가 앉는다 |
| `attachmentsOf` | 배열 대신 **함수** |
| `photosOf` | `TypeError: attachmentsOf(...).map is not a function` |
| `withAttachmentAdded` | `TypeError: … is not iterable` |
| `renderPortfolioMarkdown` | `TypeError: section.answer.trim is not a function` — **내보내기가 죽는다** |

**틀리면 학생에게.** 양식을 가져온 **그 순간** 포트폴리오 화면이 렌더 중에 죽고,
`facts`가 던지므로 **단계 이동도 체크리스트도 함께 선다.** 그 상태가 그대로 저장되므로
**다시 열어도 같은 자리**이고, 내보내기도 안 되니 파일로 빼낼 수도 없다.

**다만 트리거는 드물다.** 그 이름들이 문항 id가 되려면 교사가 `{#constructor}`처럼
적었거나 영어 양식의 제목이 정확히 `Constructor`여야 한다. **내장 프리셋 둘은 안전하다**
(`public/portfolio/default.{ko,en}.md` — `topic`·`motivation`·`data`…).
**빈도가 낮을 뿐 피해는 총체적이고 영구적**이라 A로 적었다. 등급을 내릴 근거가 있으면
코드 소유자가 내려라.

**답을 한 번 쓰면 증상이 사라진다** — `withAnswer`가 own 속성을 만들기 때문이다. 그래서
**가장 나쁜 순간이 양식을 막 가져온 직후**이고, 그 뒤에 재현하려 들면 안 난다.

**무는 검사가 있는가.** **없다** — `tests/` 어디에도 포트폴리오 문을 부른 뒤 스키마를
파스하거나 프로토타입 이름을 넣는 것이 없다(`grep`으로 셌다: `portfolioSchema`를 쓰는
스펙 0건). **세울 수 있다** — 위 표가 그 검사다.

**처방 — 넣어 보고 물리는지까지 쟀다.** 원시 연산 하나를 세우고 읽는 자리 셋이 그것을
쓴다(「흩어진 결함은 빠진 연산이다」).

```ts
function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}
```

`portfolio.answers[…]` 둘과 `portfolio.attachments[…]` 하나를 `own(...)`으로 바꾸니
**서른 가지가 전부 사라지고**(임시 스펙 42개 초록), `vue-tsc` 통과, 포트폴리오 스펙
여섯 파일 149개가 그대로 초록이었다.

**같은 병의 이웃 — 소유 경로 안에서 다섯을 세었고 셋만 진짜다.**

- `portfolio.ts:58`·`:245`·`:339` — **셋 다 진짜.**
- `settings.ts:260`·`:261`(`byAlgorithm[algorithm] ?? {}`) — **안 다친다.** 받은 것을 곧바로
  펼치므로(`{ ...Object }`) 빈 객체가 되고, 쓰는 쪽은 own 속성을 만든다. 다만 알고리즘 id는
  등록부에서 오므로 화면으로는 닿지도 않는다.
- `format.ts:510`·`portfolio-bundle.ts:109`는 `Object.entries`/`Object.values`라 own만 본다.

**소유 경로 밖에서 한 자리가 더 있다** — `ml/engines/mljs.ts:250`과
`ml/engines/pyodide-sklearn.ts:345`의 `PARAMETERS[algorithm] ?? []`. 손으로 고친 `.mlpx`의
`selectedAlgorithms[].algorithm`이 `userString`이라 `constructor`가 통과한다. **안 고쳤고
재현도 안 했다** — 지적만 적어 둔다(C-5).

---

### A-3. 데이터 화면의 산점도 툴팁이 범주 축에서 흩뿌린 수를 읽는다

**자리** `frontend/src/views/data/charts/ScatterChart.vue:127–132` (**소유 경로 밖 — 안 고쳤다**)
· 거짓이 된 주석은 `frontend/src/data/category-axis.ts:29`(소유 경로 안)

**주장.** 범주 축의 점은 칸 안에서 흩뿌려 그린다(`placed()` → `value + jitterOf(row)`).
그 값을 되돌리는 원시 연산이 이미 있고(`ml/clusters.ts:123`의 `axisCellOf` — *"반올림이 이
판정의 전부다"*), **군집 산점도는 그것을 쓴다**(`components/ClusterScatter.vue:88–96`의
`coordinate()`). **데이터 화면의 산점도는 안 쓴다** — `item.parsed.x`를 그대로
`format.prediction`에 넣는다.

```
data.charts.scatter.point = "{name} · 가로 {x} · 세로 {y}"
```

그래서 범주 축에서 툴팁이 **`여` 대신 `1.02`**를 말한다.

**이 병은 닫힌 적이 있다.** `ml/clusters.ts:108–111`이 그 기록이다 — *"화면 둘이 이 규칙을
손으로 다시 쓰고 있었고, 두 갈래를 맞바꿔도 저장소가 조용했다 — 그때 화면에는 `체육`
자리에 `1.02`가 뜬다 (2026-08-31 사각 감사 A-3)."* **2026-09-22에 새로 생긴 화면이 그
자리를 다시 열었다.** 요청서가 *"새것이라고 봐주지 마라"*고 적은 그대로다.

**그리고 주석이 거짓이 됐다.** `data/category-axis.ts:29`는 *"반올림하면 원래 칸으로
정확히 돌아오므로 **툴팁은 참값을 말한다**"*고 단정한다. 그 파일은 **두 화면이 공유하는
자리**라 이 문장은 둘 모두에 대한 약속으로 읽히는데, **한쪽에서만 참이다.**

**재현.** 브라우저로는 **안 봤다**(요청서 §5: 캔버스 뒤는 이 관문이 구조적으로 못 본다).
확인한 것은 셋이다 — ① `placed(1, row, categories)`가 정수가 아니다(흩뿌림이 ±0.3),
② `ScatterChart.vue`가 `axisCellOf`를 임포트하지 않는다(`grep`, 0건), ③ 같은
`scatterOptions`를 쓰는 군집 화면은 그 함수로 되돌린다. **코드 소유자가 브라우저에서
범주 열 둘로 산점도를 열고 점 하나에 커서를 얹으면 10초에 판정된다.**

**무는 검사가 있는가.** **없다.** `tests/chart-config.spec.ts`는 넘어간 `text.point`를 부르지
않고, 툴팁 콜백은 Chart.js 안에서만 불린다. **세울 수 있다** — `scatterOptions`가 만든
`plugins.tooltip.callbacks.label`을 직접 불러(`item` 객체를 손으로 만들어) 나온 문자열을
본다. 지금도 `cluster-chart.spec.ts`가 같은 모양을 한 자리가 있다.

**처방.** `ScatterChart.vue`의 `point()`가 `coordinate()`와 같은 일을 하게 한다 —
`axisCellOf(axes.value.x, x)`. **더 나은 자리는 그 함수를 화면 둘이 공유하는 것**이고,
`ClusterScatter.vue:88`의 `coordinate`가 그대로 옮길 수 있는 모양이다.

---

### B-1. 흩뿌림·글자 크기·여백은 바꿔도 아무도 안 운다

**자리** `frontend/src/data/category-axis.ts:24`(`JITTER_SPREAD`) · `:37`(흩뿌림 해시) ·
`frontend/src/data/chart-config.ts:64`(`FONT_SIZE`) · `:336`(`BOX_PADDING_RATIO`)

**주장.** 넷을 바꿔 심었고 **넷 다 조용하다**(§3의 C1~C4). `JITTER_SPREAD`는 `limits.ts`가
아니라 여기 사는데, 그 이유가 *"이 값이 **그리는 규격**이고 그 규격을 쓰는 두 곳이 이
파일을 통해서만 만난다"*이다 — **규격이라면서 재는 것이 없다.** 흩뿌림 해시의 상수를
바꾸면 **같은 파일이 어제와 다른 그림을 준다**(`jitterOf`의 머리말이 약속하는 재현
가능성이 그 한 줄에 걸려 있다).

**틀리면 학생에게.** 폭이 0.5로 새면 이웃 칸의 구름이 섞여 **범주를 못 가른다.** 해시가
바뀌면 같은 프로젝트를 다시 열었을 때 점이 옮겨 앉는다.

**무는 검사가 있는가.** **없다 · 있다.** `JITTER_SPREAD`는 `|placed(v,row,cats) - v| ≤ 0.3`
한 줄로 닫힌다. 해시는 **골든 값 하나**면 되고(이 저장소가 `cluster-chart.spec.ts`에서
이미 쓰는 모양), 그 값은 재현 가능성의 정의 그 자체다. `FONT_SIZE`·`BOX_PADDING_RATIO`는
지도 §2.3의 *"화면만 소비"* 여덟과 같은 부류라 **사람 몫으로 남기는 것이 맞다** — 다만
`JITTER_SPREAD`는 그 부류가 아니다.

---

### B-2. 앱이 연결을 안 닫아서, 다음 `DB_VERSION` 올리기가 둘째 탭을 영영 멈춘다

**자리** `frontend/src/project/storage.ts:147`(`openDB` — `blocked`·`blocking` 콜백이 없다) ·
`:594`(`closeStorage` — `src`에서 부르는 곳 0건)

**주장.** 앱은 IndexedDB 연결을 **한 번 열고 안 닫는다**(`closeStorage`를 부르는 것은
`tests/` 스물셋뿐이다, `grep`). 그 상태에서 `DB_VERSION`이 오른 배포가 나가면, 학생이
**옛 탭을 열어 둔 채 새 탭을 열 때** 그 탭의 `openDB`가 `blocked`에 걸린다. 우리는
`blocked`도 `blocking`도 안 넘기므로 **약속이 영영 안 풀리고** 화면은 이유 없이 빈
목록으로 남는다.

**재현**(`tests/zz-r37-db.spec.ts`, 지운 임시 스펙. **대조를 먼저 돌려야 한다** — 막힌
요청이 남으면 그 뒤가 오염된다):

| | 결과 |
|---|---|
| 앞 탭이 `closeStorage()`로 놓은 뒤 `DB_VERSION + 1`로 열기 | **30ms에 열린다** (대조) |
| 앱이 평소처럼 연결을 쥔 채 `DB_VERSION + 1`로 열기 | **1초 안에 안 풀린다** |

**틀리면 학생에게.** 배포 직후, 어제 탭을 안 닫은 학생이 새 탭을 열면 목록이 안 뜬다.
아무 말도 없고, 학생이 할 수 있는 일(다른 탭을 닫기)을 화면이 말해 주지 않는다.
**지금은 안 난다** — `DB_VERSION`이 2에서 안 움직였기 때문이고, 움직이는 날 난다.

**무는 검사가 있는가.** **없다 · 있다 — 세워서 쟀다**(위 표). **다만 결정이 먼저다** —
갈래가 둘이고 둘 다 i18n 규칙에 걸린다.

- `blocking` 콜백에서 **옛 탭이 스스로 닫는다**. 그 탭은 그 순간부터 저장을 못 하므로
  *"새 판이 떴습니다. 새로고침하세요"*를 말해야 한다.
- `blocked` 콜백에서 **새 탭이 말한다** — *"다른 탭을 닫아 주세요."*

`open-decisions.md`로 올린다.

**머리말도 함께 고쳐야 한다.** `closeStorage`의 머리말이 *"참조만 버리면 연결이 살아
있어서 버전 업그레이드와 `deleteDatabase`가 blocked 상태로 멈춘다"*고 적는데, **그 일이
실제로 일어나는 자리는 앱이 아니라 검사다** — 앱은 이 함수를 안 부른다. 지금 문장은
앱에 그 경로가 있는 것처럼 읽힌다.

## 2. C — 제안

- **C-1.** `data/category-axis.ts:29`의 *"툴팁은 참값을 말한다"*가 화면 하나에 대해 거짓이다
  (A-3의 짝). **주석을 고치는 것이 아니라 코드를 고쳐야 참이 된다.**
- **C-2.** `project/storage.ts:292`의 `estimate?.usage ?? 0`은 **사용량을 모를 때 0으로
  읽는다** — 여유를 실제보다 크게 잡는 쪽이다. 지금 어느 브라우저가 `quota`만 주고
  `usage`를 안 주는지 **안 재 봤다.** 재고 나서 정할 것이지 지금 바꿀 것은 아니다.
- **C-3.** `project/identity.ts:58`이 `{ student: undefined }`로 **키를 남긴다.**
  `JSON.stringify`가 떨어뜨려 파일은 멀쩡하고 zod도 받지만, **메모리의 문서에는 키가
  있다** — `Object.keys(manifest)`로 무언가를 세는 코드가 생기는 날 갈린다.
- **C-4.** `data/table.ts:166–172`의 주석이 *"읽는 자리는 셋이고 전부 `>= maxRows`로
  비교하므로 상한을 끄면 그대로 통한다"*고 단정하는데, **xlsx 두 갈래는 여전히 소스로만
  확인됐다**(2026-09-01 C-4 이후 그대로). 돌연변이로는 물린다(§3의 M22·M23) — **물리는
  것은 유한한 `maxRows`이고, `Infinity`로 지나가는 검사는 csv 하나뿐이다.**
  한 줄이면 닫힌다: `applyLimitsOff(true)` + xlsx + `MAX_DATASET_ROWS + 5`행.
- **C-5.** `ml/engines/mljs.ts:250`·`pyodide-sklearn.ts:345`의 `PARAMETERS[algorithm] ?? []`가
  A-2와 같은 병이다. **소유 경로 밖이라 재현 안 했다.** R40이 받는다.
- **C-6.** `project/portfolio.ts:283`의 `nextAttachmentPath` — 검사 셋이 **번호에 구멍이 없는
  경우만** 본다. 머리말이 경고하는 되풀이(`[1,3]` → `3`)를 지나가는 줄이 하나도 없다(§3.3).
- **C-7.** `project/export-state.ts:34`의 사전순 폴백은 **닿는 입력을 못 찾았다** — 두 값 다
  스키마나 `toISOString()`을 지난다. 주석이 *"남이 손으로 고친 파일이 이 문을 지난다"*고
  **닿는 것처럼** 적는다. 죽은 가지이거나 주석이 틀렸고, **어느 쪽인지 정해야 한다**(§3.3).
- **C-8.** `data/zip-names.ts:170`의 *"대조가 UTF-8보다 먼저다"*에 그물이 0이다. 뒤집어도
  조용하다 — **CP949 이름이 우연히 UTF-8로도 읽히는 zip**이 그 갈림이고, 그 우연이
  실재하는지는 안 쟀다(§3.3).

---

## 3. 돌연변이 표 — 전부

### 3.1 표

**53개를 심었다**(+ 대조 1). **욺 48 · 조용 5.** 조용한 것만 아래에 사연을 붙인다.

| # | 자리 | 바꾼 것 | 판정 |
|---|---|---|---|
| M1 | `data/stats.ts` `categoriesOf` | 빈 칸도 범주로 | 욺 |
| M2 | `data/stats.ts` `categoryIndex` | 목록에 없는 값도 자리를 줌 | 욺 |
| M3 | `data/stats.ts` `scatterSample` | 씨앗 무시 | 욺 |
| M4 | `data/stats.ts` `scatterSample` | `total`을 행 수로 | 욺 |
| M5 | `data/stats.ts` `isBinCount` | 정수 판정 제거 | 욺 |
| M6 | `data/stats.ts` `histogram` | `capped` 언제나 거짓 | 욺 |
| M7 | `data/stats.ts` `histogram` | 준 구간 수 무시 | 욺 |
| M8 | `data/stats.ts` `autoBinCount` | `min`/`max` 뒤집기 | 욺 |
| M9 | `data/charts.ts` 산점도 | 고른 열이 표에 있는지 안 봄 | 욺 |
| M10 | `data/charts.ts` 산점도 | 열 둘 → 열 하나 | 욺 |
| M11 | `data/category-axis.ts` `placed` | 흩뿌림 끄기 | 욺 |
| M12 | `data/category-axis.ts` `categoryScale` | 반 칸 여유 제거 | 욺 |
| M13 | `data/category-axis.ts` `categoryScale` | 눈금 반올림 제거 | 욺 |
| M14 | `data/chart-config.ts` `colorsAreDistinct` | 경계 `<=` → `<` | 욺 |
| M15 | `project/storage.ts` `roomShortfall` | 안전 계수 제거 | 욺 |
| M16 | `project/storage.ts` `roomShortfall` | 사용량 무시 | 욺 |
| M17 | `project/storage.ts` `roomShortfall` | 못 물으면 거절 | 욺 |
| M18 | `project/storage.ts` `closeStorage` | 실제로 안 닫기 | 욺 |
| M19 | `project/storage.ts` `totalBytes` | 임베딩 안 세기 | 욺 |
| M20 | `project/storage.ts` `saveProject` | 내보낸 시각 보존 제거 | 욺 |
| M21 | `data/table.ts` `checkLimits` | 경계 한 칸 밀기 | 욺 |
| M22 | `data/xlsx.ts` ExcelJS | 훑은 행을 세기 | 욺 |
| M23 | `data/xlsx.ts` SheetJS | `maxRows` 무시 | 욺 |
| M24 | `project/portfolio.ts` `uniqueId` | 번호 안 붙이기 | 욺 |
| M25 | `project/identity.ts` | 빈 칸도 저장 | **욺**(좁은 목록에서는 조용했다 — §3.2) |
| M26 | `project/migrate.ts` | 스냅샷 백본 안 고치기 | 욺 |
| M27 | `project/migrate.ts` `renameBackbone` | 모르는 id도 덮기 | 욺 |
| M28 | `project/format.ts` `dropUnknownBackbones` | 전부 들이기 | 욺 |
| M29 | `data/table.ts` `importTable` | 상한 `+1` 제거 | 욺 |
| M30 | `data/stats.ts` `numericValues` | 못 읽은 칸을 결측으로 | 욺 |
| M31 | `data/stats.ts` `frequencies` | 등장 순서 → 도수 순 | 욺 |
| M32 | `data/stats.ts` `boxSummary` | 수염을 울타리로 | 욺 |
| M33 | `data/columns.ts` `columnNames` | 중복 이름 허용 | 욺 |
| M34 | `project/integrity.ts` `contentHashOf` | 엔트리를 안 보고 해싱 | 욺 |
| M35 | `project/portfolio.ts` `withSectionRemoved` | 첨부 안 지우기 | 욺 |
| **M36** | `project/portfolio.ts` `nextAttachmentPath` | 최대 번호 → 개수 | **조용** |
| M38 | `project/file-size.ts` | 경계 `>` → `>=` | 욺 |
| **M39** | `project/export-state.ts` | 사전순 폴백 제거 | **조용** |
| M40 | `project/export-state.ts` | `stale`/`exported` 뒤집기 | **욺**(좁은 목록에서는 조용했다 — §3.2) |
| M41 | `project/attach.ts` | 전처리기 경로에서 실험 id 빼기 | 욺 |
| **M42** | `data/zip-names.ts` | 대조를 UTF-8 뒤로 | **조용** |
| M43 | `data/zip-names.ts` | 코드 페이지 글자 확인 제거 | 욺 |
| M44 | `data/serialize.ts` | 천 단위 첫 묶음에 `0` 허용 | 욺 |
| M45 | `project/embeddings.ts` | 해시 대신 파일 이름으로 지우기 | 욺 |
| M46 | `data/charts.ts` `defaultChartTool` | 잠금 무시하고 첫 도구 | 욺 |
| M47 | `data/charts.ts` 막대그래프 | 수치 열에도 허용 | 욺 |
| M48 | `data/table.ts` `previewNote` | 언제나 그린 줄 수 | 욺 |
| M49 | `data/table.ts` `probeNote` | 경계 `>` → `>=` | 욺 |
| M50 | `project/storage.ts` `loadProject` | 참조·본체 짝 확인 제거 | 욺 |
| **C1** | `data/chart-config.ts` `FONT_SIZE` | 14 → 13 | **조용** |
| **C2** | `data/chart-config.ts` `BOX_PADDING_RATIO` | 0.08 → 0.2 | **조용** |
| **C3** | `data/category-axis.ts` `JITTER_SPREAD` | 0.3 → 0.25 | **조용** |
| **C4** | `data/category-axis.ts` `jitterOf` | 해시 상수 12.9898 → 11.9898 | **조용** |
| C0 | (대조) `FONT_SIZE` 줄에 주석만 | 아무 뜻도 없음 | **조용** ✓ |

**C1~C4는 조용할 것을 예상하고 고른 자리다.** 생존율을 이 표본으로 말하면 안 된다 —
**눈감고 고른 M계열 49개만 세면 욺 46 · 조용 3으로 6%**이고, 이 저장소의 열여덟 라운드
평균(20~35%)보다 **훨씬 낮다.** `project/`·`data/`의 한 시점 계산은 실제로 잘 덮여 있다.
**이 라운드의 수확이 전부 다른 축에서 나온 이유가 그것이다.**

### 3.2 "조용하다"는 내가 고른 목록만큼만 참이다

처음 돌린 판에서 다섯이 조용했는데, **모듈을 임포트하는 스펙을 `grep`으로 다시 세어
목록을 넓히니 둘이 뒤집혔다.**

- **M25**(`identity` 빈 칸도 저장) — `tests/portfolio.spec.ts`의 *"빈 학번과 이름은
  지운다"*가 문다. 내 첫 목록에 그 파일이 없었다.
- **M40**(`export-state` 뒤집기) — `tests/autosave.spec.ts`의 세 줄이 문다. 같은 이유다.

R36이 *"좁힌 스펙 목록에서 조용했던 45개를 묶어 스위트 전체로 다시 쟀고 하나가
뒤집혔다"*로 남긴 절차가 여기서 **둘을 건졌다.**

### 3.3 조용한 셋 — 사연

- **M36 `nextAttachmentPath`.** 검사는 **있는데** 그 갈래를 안 지난다. 머리말이 경고하는
  것은 *"지웠다 붙일 때 번호가 되풀이되고, 그러면 **옛 무결성 기록과 같은 이름의 다른
  사진**이 생긴다"*인데, 지금 검사 셋(`portfolio.spec.ts:301–306`)은 **번호에 구멍이 없는
  경우만** 본다 — `[1,2]`에서 하나를 빼도 개수와 최대값이 같은 답을 낸다. **가운데를
  빼야** 갈린다: `[1,3]`이면 개수는 `3`(충돌), 최대값은 `4`다.
- **M39 `export-state`의 사전순 폴백.** 조용한 이유가 **닿을 수 없어서**로 보인다 —
  `savedAt`은 `manifest.updatedAt`(스키마의 `TIMESTAMP` 정규식을 지난 값)이거나
  `new Date().toISOString()`이고, `exportedAt`은 `markExported`가 쓴 ISO 문자열이다.
  **둘 다 언제나 `Date.parse`가 읽는다.** 그런데 머리말은 *"남이 손으로 고친 파일과 다른
  도구가 만든 파일이 이 문을 지난다"*고 **닿는 것처럼** 적는다. 그 파일은 스키마에서
  먼저 거절된다. **주석이 코드보다 넓다** — 이 저장소가 되풀이해 잡은 병 1번이다.
  **닿는 입력을 못 찾았다**(§4).
- **M42 `zip-names`의 대조 순서.** 파일이 *"2. 대조가 되면 그것이 답이다. **UTF-8보다 먼저
  본다** — 증명된 것이 순서보다 세다"*라고 적어 둔 그 순서에 그물이 0이다. 뒤집으면
  **CP949 이름이 우연히 UTF-8로도 읽히는 zip**에서 갈린다. 「탐색기 zip은 CP949다」가
  *"바이트만으로 인코딩 맞히기는 불가능하다"*고 적은 자리이고, 그래서 대조가 먼저인
  것이다. **그 우연이 실재하는지는 안 쟀다**(§4).

### 3.4 실물 `.mlpx` — 결함 0

**학생이 걷는 길 그대로 한 벌을 만들어 왕복시켰다**(요청서 §4). CSV 바이트 →
`openTable` → `importTable` → `applyDataset` → 설정 문 일곱 → **진짜 학습** →
`parsePortfolioForm` → 포트폴리오 문 → `identifiedExport` → `writeProject` → `readProject`.
머리글은 한국어이고 한 열에 천 단위 쉼표를 넣었다.

넷 다 통과했다 — **무결성 `UNCHANGED`**, 문서 왕복 무손실(학생 정보·실험·문항 id),
정본에서 `"1,200"`이 `1200`으로 풀려 있음, `document.md`에 갱신된 학번·이름이 있고 답에
안 닫은 코드 울타리가 **답 끝에서 닫혀 있음**(백틱 셋이 정확히 두 쌍).

**포맷 1 마이그레이션도 실물로 걸었다** — 방금 만든 파일의 `manifest.formatVersion`을
손으로 1로 내려 다시 zip으로 말고 열었다. **2로 올라오고**, 무결성이 **내가 손댄
`manifest.json` 하나만** `MODIFIED`로 짚는다.

**즉, 이 축에서는 아무것도 안 나왔다.** 2026-08-15의 실물 감사가 셋을 꺼낸 자리인데
이번에는 0이다 — 적어 둘 값이 있는 음성이다.

### 3.5 순서를 강제한 자리 — 요청서 §3의 넷

| 자리 | 결과 |
|---|---|
| **두 탭 잠금** (Web Locks · BroadcastChannel 둘 다) | **A-1** |
| 자동 저장과 사용자 저장이 겹칠 때 | **아무것도 안 나왔다.** `flush()`가 미뤄 둔 타이머를 끄고, `write()`가 `dirty.value = file.value !== current`로 겹친 쓰기를 가린다. `exportFile`은 저장 실패를 삼키고 나간다(「내보내기는 무조건 성공해야 한다」) |
| 데이터 교체 중 시각화 창 | **오늘 고친 자리가 지금도 산다.** 고른 열이 표에서 사라지면 산점도는 `needsAnotherColumn`으로, 나머지 셋은 `kindOf`가 `undefined`라 각자의 사유로 잠긴다(M9가 운다) |
| 사진 굽기 중 상한 판정 (R22 고침) | **살아 있다.** `ImagePanel`은 확인 판이 있어 **굽기 직전에 다시 묻고**(`:334`), 확인 판이 없는 둘(`ImagePrepPanel`·`ImagePredictPanel`)은 **입구에서 `busy`로 거절하고 그렇다고 말한다.** 셋이 같은 규칙의 다른 모양이다 |

### 3.6 처방을 실측한 기록

- **A-1의 tab-lock 쪽** — 세대 번호를 `acquireOne` 안에서 잡으면 **세 자리 중 하나만
  닫힌다.** `acquireTabLock` 진입점에서 동기로 잡아야 넷이 다 닫힌다. 둘 다 심어서 쟀다.
- **A-2** — `Object.hasOwn` 원시 연산 하나로 읽는 자리 셋을 고치니 서른 가지가 전부
  사라졌다(임시 스펙 42개 초록 · `vue-tsc` 통과 · 포트폴리오 스펙 149개 그대로 초록).


---

## 4. 못 한 것 · 확인 못 한 것

- **브라우저로 아무것도 안 봤다.** A-3의 툴팁이 그 자리다 — 소스 셋으로 좁혔지만
  **화면에서 본 것은 아니다.**
- **사진 경로의 실물 `.mlpx`는 이번에도 안 했다**(R33·R34에 이어 셋째). 표 프로젝트
  한 벌만 실물로 왕복시켰다.
- **`navigator.storage.estimate`가 `usage`를 안 주는 브라우저가 실제로 있는지 안 쟀다**(C-2).
- **백엔드 관문은 안 돌렸다** — 범위 밖이다.

---

## 5. 방법에 대한 기록

**대조군이 없었으면 이 보고서가 통째로 거짓이었다.** 처음 돌린 돌연변이 50개가 전부
*"욺"*으로 나왔는데(생존율 0%, 열여덟 라운드의 20~35%와 안 맞는다) **아무것도 안 바꾼
돌연변이(C0)를 넣으니 그것도 "욺"이었다.** 원인은 러너가 쓴
`npx vitest run --silent <스펙>` 한 줄이다 — vitest의 `--silent`가 뒤의 경로를 값으로
먹어 **모든 실행이 인자 파싱에서 죽었다.**

이 저장소가 「돌연변이 러너가 안 돌고 있었다」로 이미 한 번 앓은 자리다. 그때의 교훈은
*"'욺'이 전부 스폰 실패였다"*였고, 이번에는 **스폰은 됐고 파싱에서 죽었다** — 모양이
달라서 같은 자리인 줄 몰랐다. **그래서 절차로 옮긴다: 돌연변이 묶음마다 "아무것도 안
바꾼 것" 하나를 같이 돌리고, 그것이 조용한지부터 본다.**
