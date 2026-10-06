# 아키텍처 — 능력 선언과 잠금 (§9~§10)

> `architecture.md`에서 갈라져 나온 절이다. **절 번호는 안 바뀌었다.** 전체 차례는 허브(`../architecture.md`)에 있다.
> **규칙만 적는다.** 이유와 경위는 같은 절 번호로 `docs/cases/architecture.md`에 있다.

## 9. 능력 선언 — 무엇이 무엇에서 되는가 (2026-08-06)

| 축 | 어디서 오는가 | 값 |
|---|---|---|
| `dataType` | 업로드한 데이터 | `tabular` / `image` (`project/schema.ts`의 `DATA_TYPES`) |
| `taskType` | **학생이 고른다** | `classification` / `regression` / `clustering` |
| `runtime` | **항목이 선언한다** — 어느 엔진에 구현이 있는가 | 순수 JS / pyodide / 서버 |

- **`runtime`은 두 겹이다. 섞지 마라.** 등록부는 정적 사실(구현이 있다)만, "지금 서버가 붙어 있다"는 `ml/backend.ts`가 판정해 §10의 gate로 간다.

### 9.1 규칙: 사실은 능력 옆에 적는다

> **"X는 Y에서만 쓸 수 있다"는 X의 등록부 항목에 적는다. Y의 화면에는 절대 적지 않는다.**

- **`v-if="dataType === 'tabular'"`도 `v-if="taskType === 'classification'"`도 금지다.**

#### 9.1.1 전처리 화면에서 공통은 손잡이뿐이다 (2026-08-12에 방향을 뒤집었다)

> **공통인 것은 "얼마나 나눌 것인가"이고, "무엇을 어디서 받나"는 종류별이다.**

| | |
|---|---|
| 공통 (판에 슬롯으로 내려간다) | 홀드아웃 비율 · 층화 켜기 · 난수 씨앗 · 뽑을 표본 수 |
| 종류별 (판이 갖는다) | 정본 받기 · 테스트 데이터 받기 · 특성과 타깃 고르기 · 다듬기 |

- `accept`는 `data/table.ts`의 `TABULAR_ACCEPT` 하나에서 나온다.
- **씨앗이 서는 자리는 판이 정한다** — 처음 무작위가 필요해지는 자리(표는 `사용할 데이터 양`, 이미지는 나누기). 씨앗 설명은 어느 판에서 읽어도 맞아야 한다.

#### 9.1.2 스키마의 갈래와 화면의 갈래는 같지 않다 (2026-08-12)

| 갈래 | 묻는 것 |
|---|---|
| 스키마 (`settings.data` vs 공통) | **이 종류의 프로젝트에 이 필드가 있는가** |
| 화면 (판 vs 슬롯) | **이 컨트롤을 뜻이 통하게 그릴 수 있는가** |

- 층화 판정은 `ml/selection.ts`의 `stratifyBlockFor(taskType, labels, nSamples)` 하나이고, 판이 자기 라벨로 부른다.
- 스코프 슬롯으로 라벨을 올리지 않는다.

> **그래서 종류를 모르는 화면은 데이터 계층과 학습 계층을 import하지 않는다.**

- `tests/ui-rules.spec.ts`가 잡는다(`@/data/*`·`@/ml/*`·`@/project/dataset`·`@/project/images`).

#### 9.1.3 전처리 요약은 학습 경로가 계산한다 (2026-08-13)

```
usableRows → sampleRows → splitRows → fitPreprocessor   ← planRun (여기까지)
                                    → transform → fit   ← runExperiment (그 뒤)
```

- **카드는 아무것도 계산하지 않는다.** 숫자는 `ml/plan.ts`의 `planRun`이 만들고, 두 번째 계산을 두지 않는다.
- **`planRun`은 던지지 않고 사유를 값으로 돌려준다.** `runExperiment`가 그것을 `ClientError`로 던진다.
- 등록부 항목을 새로 만들지 않는다 — 판이 자기 요약을 그린다. 이미지 판에는 아직 요약이 없다.
- 전처리 미리보기와 같은 `planRun`의 `preprocessor`를 받는다.

### 9.2 등록부의 모양은 하나다

- 새 등록부는 `data/kinds.ts`와 같은 모양이다 — **id, 축마다의 칸, 화면.**
- **축은 늘리지 말고 접는다.**
- **모든 축을 반드시 적는다. 옵셔널 필드를 만들지 마라.**
- **화면을 갖는 항목은 지연 로딩한다**(`defineAsyncComponent`).
- **출처 등록부**(양식 가져오기, 사진 입력 방식)는 출처마다 줄을 내고, 줄은 같은 모양의 결과 하나를 돌려준다.
  DOM은 화면이 넘긴다. 사진 입력 방식은 §8.10.5.

### 9.2.1 `false`의 뜻은 하나다 (2026-08-06)

> **`false` = 이 조합에서는 성립하지 않는다.** 그것뿐이다.

- "아직 안 만들었다"는 **줄이 없는 것이다.** **"준비 중입니다" 같은 문구를 만들지 마라.**
- **로드맵을 등록부에 넣지 마라.** 등록부는 지금 참인 것만 담는다.

### 9.2.2 한 줄이 표현하는 것은 직사각형이다 (2026-08-07)

```
dataTypes  { tabular: true, image: true }
taskTypes  { classification: true, regression: false, clustering: false }
                    ↓
        classification  regression  clustering
tabular       ✅           ✕           ✕
image         ✅           ✕           ✕
```

> **그때 필요한 것은 새 필드가 아니라 새 줄이다.**

- **조합마다 값을 지정하는 매트릭스를 만들지 마라.** 칸이 아니라 줄이 늘어나는 쪽으로 간다.

#### 없는 것을 이름으로 말하지 않는다 (2026-08-07)

> **패널이 0개면 그 자리는 없다. 왜 없는지 설명하지 않는다.**

- "안 담긴 것"(§9.5)은 다르다 — 그 말은 그 패널이 한다.

### 9.2.3 데이터 종류의 등록부는 둘이고, 모양이 일부러 다르다 (2026-08-12)

| 등록부 | 무엇을 | 모양 | 빠지면 |
|---|---|---|---|
| `data/kinds.ts` | 화면 판(`panel`·`prepPanel`·`prepContext`)과 `accept` | **배열** | "아직 못 다루는 종류"다. `dataKindFor`가 `undefined`를 준다 |
| `project/schema.ts`의 `DATA_SCHEMAS` | `settings.data`와 `experimentSettings.data`의 스키마 둘, 그리고 **새 프로젝트의 기본 `settings.data`(`initial()`)** | **`Record<DataType, …>`** | **컴파일이 깨진다** |

- **스키마 등록부는 타입 주석 대신 `satisfies`를 쓴다.**
- **기본값도 스키마 쪽 등록부이고, `initial()`은 함수다.**
- **스키마 등록부에 Vue를 들이지 마라.**

### 9.3 놓침은 사람이 아니라 컴파일러가 막는다

**축의 값이 늘어날 때 컴파일이 깨지지 않으면 그 등록부는 실패한 등록부다.**

- **선언형 등록부의 축은 배열이 아니라 exhaustive Record로 적는다.**

```ts
interface Capability {
  readonly id: string
  readonly dataTypes: Readonly<Record<DataType, boolean>>
  readonly taskTypes: Readonly<Record<TaskType, boolean>>
  readonly panel: Component
}

// 결측치 채우기 — 표에서만, 과제 유형과는 무관하다
{
  id: 'missing-values',
  dataTypes: { tabular: true, image: false, audio: false, text: false },
  taskTypes: { classification: true, regression: true, clustering: true },
  panel: …,
}
```

- **등록부 배열에는 타입 주석을 단다. `as const`를 쓰지 마라.**

```ts
export const X: readonly Capability[] = [ … ]   // 축이 늘면 깨진다
export const X = [ … ] as const                 // 조용하다. 강제가 없다
```

- 필터는 등록부가 감춘다(`capabilitiesFor(dataType, taskType)`). 부르는 쪽은 Record를 보지 않는다.
- **타입으로 못 막는 것은 검사가 막는다** — 알고리즘이 서는 조합에서 지표(`METRIC_DISPLAY`)가 0개가 아닌가,
  모든 `panel`이 실제로 import되는가, 모든 `id`에 로케일 키가 있는가.
- **타입과 검사 둘 다 없으면 등록부를 만들지 마라.**
- **선언형은 Record, 열쇠형(`data/kinds.ts`)은 그대로 둔다.**

### 9.3.1 이 원칙을 앞으로 어떻게 관철하는가

강제는 세 층이고, **위층에서 막을 수 있는 것을 아래층에 미루지 마라.**

- **1층 — 타입.** 등록부에서 `Partial<>`, `?`, `[key: string]`, `as`/`as const`, **타입 주석 생략**을 쓰지 마라.
- **2층 — 검사.** **검사기 자체를 먼저 검사한다.** 소스를 글자로 훑는 검사는 패턴의 토큰 사이에 `\s*`를 두고,
  자기검사 표본에 prettier가 실제로 펴는 모양(`npx prettier --stdin-filepath`)을 넣는다. 훑기 구현은
  `tests/fixtures/source.ts` 하나다.
- **3층 — 문서.** 1·2층이 막는 것을 또 쓰지 마라.
- **새 축을 도입할 때**: ① 모든 등록부에 동시에 `Record<새축, boolean>`을 추가 ② 컴파일 에러를 하나도 남김없이
  손으로 판단(일괄 치환 금지) ③ 검사를 먼저 돌려 빨간 줄을 보고 나서 고친다.

### 9.3.2 이 장치가 못 막는 것

- **`true`/`false`를 잘못 판단한 것.**
- **등록 자체를 잊은 것** — 등록부와 컴포넌트 디렉터리를 대조하는 검사가 2층에 있어야 한다.
- **화면이 등록부를 우회하는 것** — §10.3의 `v-if` 규칙이 부분적으로 잡는다.

### 9.4 조합이 비면 화면이 그렇게 말한다

- **빈 화면을 보여주지 마라.** 비활성화하되 숨기지 않고 이유를 준다. 우선순위는 **데이터 타입 > 과제 유형 > 실행 위치.**

### 9.5 축이 맞아도 담겨 있지 않을 수 있다 (2026-08-06)

- **패널 항목은 축과 함께 "이 실행에 담겨 있는가"를 자기 옆에 갖는다.** 화면이 `run.confusionMatrix`를 직접 보지 않는다.
- **축과 이 판정을 한 필드로 합치지 마라.**

---

## 10. 잠금은 gate 하나에서 나온다 (2026-08-06)

### 10.1 조건을 prop으로 내리지 마라

- `:disabled="!hasData || !hasTarget || …"`처럼 조건을 조립해 내리지 않는다.

### 10.2 규칙: 판정은 순수 함수가, 화면은 결과만

> **잠기는 것에는 gate 함수가 하나 있고, 그 함수는 boolean이 아니라 이유 목록을 반환한다.**

```ts
/** 비어 있으면 눌린다. 아니면 첫 번째 이유가 버튼 옆에 문장으로 뜬다. */
function trainGate(input: { taskType: TaskType | undefined; chosen: readonly { algorithm: string }[] })
  : readonly TrainBlock[]   // 'NO_MODEL' | 'NO_TRAINABLE_MODEL'
```

- **컴포넌트 밖의 순수 함수다.** 같은 판정을 두 벌 만들지 마라.
- **화면이 받는 prop은 gate 결과 하나다.**
- **이유는 코드다.** 화면은 **정적인 표**로 코드를 문구 키에 잇는다(`TRAIN_BLOCK_KEYS`). 사용자 데이터는 문장 끝 괄호로.
- **우선순위가 있다** — 근본적인 것이 먼저다.
- `trainGate`(`ml/selection.ts`)의 이유는 `NO_MODEL` · `NO_TRAINABLE_MODEL`(결정문 55)이고, **버튼 잠금과
  `startTraining`의 거절이 이 함수 하나를 본다.**
- **그 밖의 실패는 잠그지 않고 누를 때 알린다** (§10.6). `train-gate.spec.ts`·`option-cascade.spec.ts`가 문다.
- **gate는 잠금이 생길 때 만든다.**

### 10.3 검사가 강제한다

`tests/ui-rules.spec.ts`가 강제한다.

- ~~`:disabled` 바인딩의 `&&`·`||` 금지~~ — **§10.7로 대체됐다.**
- **화면 코드가 `dataType`·`taskType`을 문자열 리터럴과 비교하면 위반이다** (§9.1). `=== undefined`는 뺀다.
- 검사기 자체를 먼저 검사한다 (`violations`/`allowed` 예시).

### 10.4 새 기능을 넣는 사람이 자문할 것

> **"이걸 의존하는 요소는 무엇인가?"**

- 새 **능력** → §9의 등록부에 줄을 더한다. 화면은 손대지 않는다.
- 새 **조건** → `ProjectFacts`에 사실을 더하고 gate에 넣는다. 할 일인지 결과인지 정한다(`DERIVED_FACTS`).
- 새 **축의 값** → 컴파일이 깨지는 곳을 전부 따라간다. 안 깨졌다면 §9.3이 안 지켜진 등록부부터 찾는다.

### 10.5 고르는 화면은 그 선택으로 잠기지 않는다 (2026-09-02)

- **어떤 단계가 어떤 축의 값을 고르는 자리라면, 그 축으로 자기 진입을 판정하지 않는다.** 학습 단계 진입은 유형과 무관하다.
- **축을 고르는 카드도 잠그지 않는다. 못 하는 조합은 [학습하기]가 사유와 함께 세운다.**

| 경우 | 세우는 곳 | 코드 |
|---|---|---|
| 라벨 붙은 사진이 없다 | `ml/training-source.ts` | `IMAGE_TOO_FEW_CATEGORIES` |
| 범주가 하나뿐이라 갈릴 것이 없다 | `ml/training-source.ts` | `IMAGE_TOO_FEW_CATEGORIES` |
| 라벨은 갈리는데 나눌 행이 모자라다 | `ml/split.ts` | `SPLIT_TOO_FEW_ROWS` |

- **이미지 분류는 임베딩 전에 거절한다.**
- **표의 한 종류 타깃은 거절이 아니라 경고다**(`TARGET_TOO_FEW_CLASSES`, `ml/experiment.ts`). `TARGET_SINGLE_CLASS`는 쓰지 않는다(거절의 말이다).

### 10.6 잠금은 보수적으로, 실패는 누를 때 알린다 (2026-09-26)

`open-decisions.md` 60.

- **잠그는 조건을 실패 조건과 따로 적지 않는다.**
- **켜진 버튼을 눌러 실패 알림이 뜨는 것은 결함이 아니다. 결함은 조용한 실패뿐이고, 처방은 실패 알림이다.**
- 남는 잠금은 결정문 55의 잠긴 모델, 담은 모델 0개, **자원이 바쁜 상태**뿐이다. **새 잠금은 코드 소유자에게 먼저 묻는다.**
- §10.2는 있는 잠금의 모양 규칙이다. 잠금을 늘리라는 말로 읽지 마라.

### 10.7 잠금은 등록부 하나가 허락한다 (2026-09-27)

`open-decisions.md` 65. **찾아내는 그물이 아니라 기본 거부다.**

| 층 | 무엇을 막는가 | 어디서 |
|---|---|---|
| **낱말** | 기본 부품 밖의 `src/`에 잠금 낱말(`disabled`·`readonly`·`inert`·`pointer-events`·`not-allowed`·`tabindex`·`setAttribute`, 글자를 밖에 두는 스타일시트의 `@import`(쓰는 셋 말고)·`text/css`·`stylesheet`, 템플릿의 `v-bind:[…]`·`v-once`·`v-memo`)이 **보이기만 하면** 운다. 표기·대소문자·이스케이프·엔티티를 가리지 않는다. 주석은 파서로만 걷는다. `index.html`과 `public/`의 `.css`도 센다. SFC 블록의 `src=`와 `index.html`의 허락 목록 밖 `<script>`·`<link>`도 운다 | `src/locks.ts`의 `LOCK_WORDS`·`LOCK_PRIMITIVES`, `ui-rules.spec.ts`의 *"잠금 낱말은 기본 부품에만 있다"* |
| **잠금 값** | 기본 부품은 잠금을 `Lock`으로만 받고, `Lock`은 `src/locks.ts`만 낸다 — 등록된 판정 함수를 **그 파일이 스스로 불러서**(`lockFor`·`useGate`) 또는 작업 상태에서(`issueBusyLock`, `useWork`만 부른다). 흉내 낸 값(`as`)은 부품이 읽는 순간 던진다 | `src/locks.ts`의 `ISSUED`·`lockReasons`, `locks.spec.ts` |
| **실행 중의 DOM** | 검사가 띄운 화면에서 잠금 속성·클래스·스타일이 **기본 부품 밖의 부품이 그린 요소에** 서면 그 검사가 실패한다 — 글자에 안 남는 이름(`'dis' + 'abled'`)도 여기서 걸린다. **쓰는 길을 세지 않는다** — `MutationObserver`가 속성·자식의 변화를 전부 받고, 검사 끝에 그 화면을 한 번 더 통째로 훑는다. 기본 부품이 **넘겨받은** 잠금 속성과 건네지 못한 속성도 운다 | `tests/setup/lock-net.ts`, `lock-net.spec.ts` |
| **감시자·화면이 뜨는 동안의 쓰기** | 감시자 콜백 안이나 부품이 뜨고 고쳐 그려지는 동안(`setup`·수명주기 훅·그리기) 프로젝트를 쓰거나(`save`·`update`·`file`) 잠그는 일을 시작하면(`useWork().start()`) **실행 중에 던진다.** 예외는 `WATCH_WRITES`에 **제 파일과 함께** 적힌 이름뿐이다 | `locks.ts`의 `appWriteSite`, `stores/project.ts`의 `refuseWatcherWrite`, `composables/useWork.ts`의 `start`, `watch-writes.spec.ts` |

- **동작의 거절도 같은 칸을 부른다**(`refusalFor`·`useGate().refuse`). 잠금과 거절은 한 함수의 한 결과다.
  잠긴 단계로 주소를 치면 라우터가 같은 칸(`step`)으로 이유를 알리고 옮긴다.
  **판정이 모델 층에 있으면 등록부가 그것을 부르고, 동작도 그것을 직접 부른다** — 모델 층은 `@/locks`를 들이지 않는다.
  순서 옮기기의 맨 위·맨 아래는 `project/portfolio.ts`의 `sectionTopBlockers`·`sectionBottomBlockers`이고, 등록부의
  `sectionTop`·`sectionBottom`과 옮기기(`withSectionMoved`)가 함께 부른다. `locks.spec.ts`의 *"순서 옮기기는 잠금과 같은
  판정으로 멈춘다"*가 문다(잠긴 쪽은 안 옮겨지고, 안 잠긴 쪽은 반드시 옮겨진다).
- 낱말 층의 세부 규칙(구조 뒤·배포 승인·최종 승인 감사에서 더한 것):
  - 등록부는 자기 속성만 판정으로 부른다(`LOCK_GATE_UNKNOWN`).
  - `WATCH_WRITES`의 항목은 `{ file, why }`이고, 그 이름은 제 파일 밖의 `src/`에 나오면 안 된다.
    `locks.ts` 밖은 `WATCH_WRITES`를 이름으로 못 든다(`RESTRICTED_NAMES`) — 가드는 `isWatchWrite`로 묻는다.
  - **기본 부품은 넘겨받은 속성을 뿌리에 흘리지 않는다**(`inheritAttrs: false`, `forwardAttrs`, 허락 목록 `FORWARDED_ATTRS`).
    `aria-hidden`과 **눈에서 숨기는 것**(토큰 하나로 판정되는 클래스·스타일과 `type="hidden"` — 목록은 `locks.ts`의
    `hidingAttr`)은 건네지 않는다. 조합으로만 숨는 것(크기 0 + 넘침 숨김, 화면 밖 밀기)은 사각이다(`open-decisions.md` 65).
  - 기본 부품은 `components/App*.vue`이고 잠그는 부품은 `defineProps`가 `Lock`을 받는다(`takesLock`). 그물은 전체 경로로 견준다.
  - `locks.ts`를 `export *`로 이어 주지 않고, 다시 내보내는 모듈을 네임스페이스·동적 `import`로 들이지 않는다.
    `import.meta`는 `env`·`url`만 읽는다. 모듈 지정자의 `?…`·`#…`·확장자·뿌리 경로를 떼고 견준다.
  - CSS 이스케이프를 풀어서 센다. 변종 클래스(`md:`·`!`)도 잠금 모양이다.
  - **주석은 파서가 가른다**(SFC 템플릿 트리, `postcss`, `index.html`은 HTML 파서). **SFC 파서가 오류를 내면 던진다**(`sfcOf`).
  - **`:action`의 맨 위에 조건을 두지 않는다**(`cond ? fn : undefined`·`&&`·`??`, `as`·`satisfies`·`!`·`<T>`로 감싸도).
  - **`lockFor`·`anyLock`은 함수 몸 안에서만 부른다.**
  - 거절 알림은 다음에 할 일까지 한 문장으로 말한다(`…Refused` 키).
- **기본 부품**은 `LOCK_PRIMITIVES`가 이유와 함께 적는다 — `AppButton`·`AppChoices`·`AppPlainButton`·`AppInput`·`AppSelect`·
  `AppLockZone`, 그리고 낱말이 겹쳐 옮겨 온 `AppTeleport`·`AppToast`. **예외를 무늬로 두지 않는다** — 이름을 바꾸거나 기본 부품으로 옮긴다.
  타입의 `readonly`는 문법 트리로 걷어낸 뒤에 센다.
- **누르면 이유가 선다** — `AppPlainButton`의 `announce`(`aria-disabled`). **모달 창 안의 거절과 실패는 창 안의 문장으로 말한다.**
- **새 잠금을 넣는 길은 하나다.** `src/locks.ts`의 `GATES`에 원래 자리의 판정 함수를 부르는 줄을 더하고, 화면은 `lockFor`나 `useGate`로
  기본 부품에 넘긴다. **그 diff를 코드 소유자가 본다.**
- 감시자 가드가 막는 범위: 콜백의 동기 구간, `setup` 몸, 수명주기 훅 여섯, 그리기 함수, 그리기 중에 처음 계산되는 `computed`.
  **이벤트 리스너와 라우터 가드는 일부러 안 본다.** 등록된 자리는 `predictPage`·`batchPage` 둘이다.

**못 보는 것** (`docs/rule-coverage.md`의 그 줄).

- **재료는 믿는다** — 판정 함수에 넘기는 재료를 지어내면 그 조건이 잠금이 된다.
- 조건 하나로 **잠금을 빼는 것**은 막지 않는다(결정문 60의 방향).
- 잠긴 **모양만** 흉내 낸 것(흐린 `<span>`, `v-if`로 감추기).
- 실행 중 그물은 검사가 그린 상태만 본다 — 밖에서 `$el`에 쓴 것, 관찰 사이에 섰다 걷힌 것, 가상 노드 밖 요소, 스타일시트 규칙.
- 실행 중에 조립한 감시자 쓰기 이름.
- 감시자 가드의 사각 — `await` 뒤, 미룬 쓰기, `watch`의 감시 대상 게터, 그리기 밖 `computed`, 파일 객체의 제자리 수정, 사용자 지시자의 훅.
- **낱말 없는 덮개**(`absolute inset-0` 층).
- **동작 안의 조건과 안 끝나는 동작**, `:action`의 식이 아닌 길로 오는 조건부 할 일(`computed`, `v-bind` 펼치기, `h(...)`).
- 한 번만 불리는 함수 안의 잠금.
- 꾸러미의 스타일시트, 되돌리는 핸들러, shadow root 안(지금은 없다, 사람 확인), `public/legal/`의 HTML.

**§10.3의 `:disabled` 조합 규칙은 이것으로 대체됐다.**
