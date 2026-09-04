# R27 감사 보고서 — 오늘 나간 것을 학생이 처음 만나는 자리

> 요청서: `docs/audit/request-R27.md` · 공통 절반: `docs/workflow.md` §3
> 대상: `e947e14..91b57ce` (태그 `0.18.0`) · 겨냥점 T1~T4

## 0. 한 줄

**엔진 버전 갈래(T1)는 옳고 못 박혀 있었다. 구멍은 잠금 바깥에 있었다** — `.mlpx`
가져오기와 삭제가 **잠금을 묻지도 않고 저장소를 쓴다.** 그 둘이 정확히 결정문이
막으려던 사고다.

이번 라운드는 방법이 앞 라운드와 갈렸다. **심은 소스 돌연변이 여섯이 전부 울었다.**
R26이 잡은 병("검사가 없다")은 그 자리에서는 닫혔고, 남은 결함은 **아무 검사도 안
지나가는 경로에서 코드가 틀린 것**이다 — 돌연변이로는 안 나오고 경로를 걸어야 나온다.

## 1. 돌연변이 표 — **전체** (운 것 포함)

전부 심고 **즉시** 파일 하나의 정확한 경로로 되돌렸다(`git checkout --`를 안 썼다).
기준선: `npx vitest run` → **154파일 · 3,076통과 · 2건너뜀**.

### 소스 돌연변이 — 여섯, 전부 욺

| # | 무엇을 뭉갰나 | 돌린 스펙 | 결과 |
|---|---|---|---|
| M1 | `ml/reproduce.ts:79` 엔진 조회를 `${kind}@${version}` → `${kind}@3` (버전을 안 보게) | `reproduce` `neural-warning` | **욺** — 1건 (23통과) |
| M2 | `limits.ts:1057` `NEURAL_PARALLEL_CHUNK_ROWS` 50 → 200 (= 엔진 2의 접기 순서) | `versions` `neural-parallel` `mljs` `sklearn-parity` | **욺** — 2건 (113통과) |
| M3 | `project/tab-lock.ts` `acquireOne`의 무조건 `releaseTabLock()` 삭제 | `tab-lock` `project-open-lock` | **욺** — 2건 (15통과) |
| M4 | `views/WelcomeView.vue:184` `await saveProject(opened)` 삭제 | `welcome-fail` `ui-rules` `lifecycle` | **욺** — 2건 (232통과) |
| M7 | `project/tab-lock.ts:76` `{ ifAvailable: true }` → `{}` (**R26 M8 재심기**) | `tab-lock` `project-open-lock` | **욺** — 2건 (15통과) |
| M8 | `ml/worker/handler.ts:33` `knn: knnPoolFactory` 삭제 (**R26 M7 재심기**) | `worker` `knn-parallel` `compute-pools` | **욺** — 1건 (41통과) |

M2·M7·M8은 **R26의 처방이 실제로 무는지**를 재려고 R26에서 조용했던 변형을 그대로
다시 심은 것이다. **셋 다 이제 운다** — R26 A-2·A-5·A-4가 닫혔다는 확인이다.

### 하니스 돌연변이 — 셋, 전부 조용 (T3)

가짜를 **진짜에 더 가깝게** 조인 변형이다. 조용하다는 것은 "지금 그 차이에 걸리는
코드가 없다 = 조이는 비용이 0이다"라는 뜻이다.

| # | 무엇을 바꿨나 | 돌린 스펙 | 결과 |
|---|---|---|---|
| M5 | `tests/fixtures/compute-workers.ts` `terminate()`가 이후 배달을 실제로 멈추게 | `compute-pools` `neural/knn/forest-parallel` `worker` `experiment` | 조용 (163통과) |
| M6 | 같은 파일 `queueMicrotask` → `setTimeout(…, 0)` (진짜 워커의 늦은 답) | 위 여섯 + `train-fail` | 조용 (166통과) |
| M9 | `tests/tab-lock.spec.ts` `FakeLocks`의 `await Promise.resolve()` → `setTimeout(…, 0)` | `tab-lock` | 조용 (13통과) |

### 처방 실측 — 하나

| # | 무엇을 넣었나 | 결과 |
|---|---|---|
| P1 | A-2의 처방(앞 잠금을 성공 뒤에만 놓기)을 `tab-lock.ts`에 임시로 넣음 | **문다** — 아래 재현 스펙이 통과로 바뀌고, 기존 `tab-lock`+`project-open-lock` **17개와 `vue-tsc`가 그대로 초록.** 즉 **지금 동작을 못 박는 검사가 어느 방향으로도 0건이다** |

---

## 2. A급 — 학생이 데이터를 잃는다

### A-1. `.mlpx` 가져오기가 두 탭 잠금을 **묻기 전에** 저장소를 덮는다

**자리** `src/views/WelcomeView.vue:182-188` — `readProject` → `await saveProject(opened)`
→ `openProject(...)`. 잠금은 그 **뒤에** 라우터 가드가 묻는다
(`src/stores/project.ts:132`).

**주장** 결정문이 이 잠금을 세운 이유는 한 문장이다 —
*"탭 A에서 학습을 세 번 돌리고 잊고 있던 탭 B에서 … 저장하면 A의 실험 세 개가 흔적
없이 사라진다"* (`docs/open-decisions/02-tabular.md:1010`). **가져오기 경로가 정확히 그
저장을 하고, 잠금은 그 뒤에 온다.**

탭 A가 프로젝트 P를 열어 실험 셋을 돌리고 자동 저장했다. 탭 B에서 학생이 지난 차시에
내보낸 P의 `.mlpx`를 연다 →
`saveProject(opened)`가 **같은 `projectId`로 `put`** 하여(`src/project/storage.ts:356-374`)
IndexedDB의 실험 셋을 지운다 → 그제야 `acquireTabLock`이 거절하고 학생은 *"이미 다른
탭에서 열려 있습니다"*와 함께 목록으로 돌아간다. **거절이 덮어쓴 뒤에 온다.** 탭 A가
그 뒤로 한 번도 저장하지 않고 닫히면 실험 셋은 영영 없다.

**재현**
- `grep -c "tab-lock" frontend/src/project/storage.ts` → **0.** 저장 계층은 잠금을 모른다.
- 코드 순서 (위 줄 번호).
- M4(그 `saveProject` 줄 삭제) → `welcome-fail` 2건 **욺**. 즉 **그 줄이 있다는 것은
  검사가 알지만, 그것이 잠금보다 앞에 있다는 것은 아무도 안 잰다.**

**이웃** 잠금 밖에서 저장소를 쓰는 자리를 전수로 셌다 —
`grep -rn "saveProject\|deleteProject" frontend/src --include=*.ts --include=*.vue`의
호출 자리는 넷이고 그중 셋이 `WelcomeView.vue`다.

| 자리 | 잠금을 보는가 | 위험 |
|---|---|---|
| `stores/project.ts:208` (`write`) | **본다** — 열 때 잡은 것을 쥔 채다 | 없음 |
| `WelcomeView.vue:149` (새 프로젝트) | 안 본다 | 없음 — `projectId`가 새로 나온다 |
| `WelcomeView.vue:184` (가져오기) | 안 본다 | **A-1** |
| `WelcomeView.vue:202` (삭제) | 안 본다 | **B-1** |

**처방** `openFile`이 `readProject` 뒤 **`saveProject` 앞에서**
`acquireTabLock(opened.document.manifest.projectId)`을 묻고, `false`면 쓰지 않고
`PROJECT_OPEN_ELSEWHERE`를 띄우고 끝낸다. 잡았으면 그대로 `openProject`로 이어지고,
라우터가 곧 부르는 `project.open(id)`은 `acquireOne`의 `heldId === id` 지름길로 통과한다
(`tab-lock.ts:163`). 실패 경로에서는 놓을 것이 없다.
**이 처방은 넣어서 재지 않았다** — §5에 적었다.

---

### A-2. 잠금 요청이 **실패해도** 앞 잠금은 이미 놓였다

**자리** `src/project/tab-lock.ts:163-166`

```
async function acquireOne(id: string): Promise<boolean> {
  if (heldId === id) return true
  releaseTabLock()          // ← 새 잠금을 잡기 전에, 조건 없이
  ...
```

**주장** 탭 A가 P를 쥔 채 Q(다른 탭이 쥔 프로젝트)를 열려 하면 **P의 자물쇠가 먼저
풀리고 Q는 거절된다.** 그 순간부터 **아무도 P를 안 쥐고 있는데 탭 A의 `file.value`는
아직 P이고 `dirty`일 수 있다.** 라우터는 `open`이 `false`를 냈으므로 목록으로
리다이렉트하고, 그 **두 번째 가드 통과에서 `project.flush()`가 P를 쓴 뒤에야**
`project.close()`가 돈다 (`src/router/index.ts:106,118`). 그 사이에 다른 탭이 P를
정상적으로 열 수 있다 — **두 탭이 P를 쓰는 상태**, 이 기능이 막으려던 그것이다.

요청서 T2가 물은 *"`heldId`는 맞고 자물쇠는 없는 상태(또는 그 반대)"*의 답이 이것이다.
여기서는 **자물쇠도 `heldId`도 없는데 화면은 그 프로젝트를 들고 있다.**

**재현 (실측)** 진짜 `tab-lock` 모듈 셋(= 탭 셋)과 `tests/tab-lock.spec.ts`의 `FakeLocks`로
임시 스펙을 세워 잰 값이다.

```
tabA.acquireTabLock('p-1') → true
tabB.acquireTabLock('p-2') → true
locks.held = [p-1, p-2]
tabA.acquireTabLock('p-2') → false      ← 거절
locks.held = ["ml-playgrounds:project:p-2"]   ← p-1이 사라졌다
tabC.acquireTabLock('p-1') → true       ← 탭 A가 아직 p-1 화면인데 탭 C가 가져갔다
```

**이웃** BroadcastChannel 갈래도 같다 — `heldId`가 `null`인 동안 그 탭은 `claim`에
답하지 않으므로(`tab-lock.ts:99`) 남의 탭이 그 프로젝트를 "비었다"고 읽는다. **한
함수의 한 줄이 두 갈래 모두를 낸다.**

**처방 (넣고 쟀다 — P1)** 앞의 `heldId`와 놓는 손잡이를 지역 변수로 들고 있다가,
**새 잠금을 잡은 뒤에만** 앞의 것을 놓는다. 실패하면 둘 다 되돌린다.

```
const previousId = heldId
const previousRelease = releaseHeld
heldId = null
releaseHeld = null
...
if (acquired) { previousRelease?.(); heldId = id; return true }
heldId = previousId; releaseHeld = previousRelease; return false
```

넣으니 위 재현이 통과로 바뀌었고 **기존 17개와 `vue-tsc`가 그대로 초록**이었다.
초록이 양쪽에서 유지된다는 것이 이 지적의 절반이다 — **지금 동작을 못 박는 검사가
어느 방향으로도 없다.** 고칠 때 그 검사를 함께 세워야 한다.

---

## 3. B급 — 결정이 걸리거나 학생이 시간을 잃는다

### B-1. 프로젝트 삭제가 다른 탭이 편집 중인 것을 지운다

**자리** `src/views/WelcomeView.vue:202` (`await deleteProject(target.projectId)`)

목록 화면은 다른 탭이 쥔 프로젝트도 그대로 보이고 삭제 버튼도 산다. 지우면 탭 B의
다음 자동 저장이 `put`으로 **되살린다**(`storage.ts:368`) — 학생이 보는 것은 *"지웠는데
목록에 다시 있다"*이거나, 탭 B가 그 뒤로 저장을 안 하면 *"저 탭에서 하던 것이
사라졌다"*이다. 둘 중 어느 쪽인지는 타이밍이 정한다.

**재현** 코드 대조. `deleteProject`는 `tab-lock`을 안 본다(A-1의 grep과 같은 0건).
경합이라 손으로 재현하지 않았다.

**처방** A-1과 같은 자리에서 함께 닫힌다 — 목록의 두 동작(가져오기·삭제)이 대상
`projectId`의 잠금을 먼저 묻는다. **삭제는 잡은 뒤 곧바로 놓아야 한다**(지운 프로젝트를
쥔 채로 두면 안 된다).

### B-2. 결과 화면은 **엔진이 바뀐 것**을 "설정을 바꾸지 않았습니다"라고 말한다

**자리** `src/ml/experiment.ts:312-336` (`comparable`) · `src/views/results/ExperimentDetail.vue:172`
· `src/locales/ko.json`의 `results.noChange`

**주장** `comparable()`은 `algorithms`에 `알고리즘:실행방법`을 넣으면서 주석으로
*"알고리즘은 그대로인데 엔진만 바꾼 것도 학생이 한 변경이고, **숫자가 움직이는 가장
흔한 이유다**"*라고 적는다. 그런데 **`run.engine.version`은 안 본다.**

0.17.0으로 만든 `.mlpx`(그 안의 run은 전부 `version: '2'`)를 0.18.0에서 열고 같은
설정으로 다시 학습하면 `changed`가 빈 배열이 되고, 화면은
*"설정을 바꾸지 않고 다시 학습했습니다. 무엇이든 바꾸고 다시 학습하면 여기에 그 차이가
나옵니다."*를 띄운다. 같은 저장소의 `reproduce.ts:66-74`는 **똑같은 상황을**
*"버전이 다르면 같은 이름의 다른 계산기다"*로 판정한다. **한 저장소가 같은 사실에
반대말을 한다** (`workflow.md` §3 "되풀이해 잡은 병" 6번).

**재현 (실측, 표본 하나)** 엔진 3의 접기 순서를 엔진 2의 것으로 되돌려 재었다 —
`NEURAL_PARALLEL_CHUNK_ROWS`를 50에서 200으로 두면 배치(200)가 조각 하나가 되어
**엔진 2의 합산 순서와 정확히 같다.** 같은 씨앗(42)·같은 데이터(240행 × 4특성,
200에폭)로 신경망을 돌렸다.

| 접는 순서 | 마지막 손실 | 정확도 |
|---|---|---|
| 조각 50 (엔진 3) | `0.08177436221473347` | 1 |
| 조각 200 (엔진 2) | `0.08177436221473353` | 1 |

**갈리는 것은 확실하고, 이 표본에서 갈린 것은 마지막 두 자리뿐이다.**
*"학생 눈에 띄게 갈린다"*는 이 표본으로는 주장할 수 없다 — 그래서 A가 아니라 B다
([[measurement-claims-match-the-sample]]). 지표가 라벨 경계에서 갈리는 데이터에서는
정확도까지 움직일 수 있지만 **그것은 안 쟀다.**

**처방** 둘 중 하나이고 **결정이 앞선다.** ① `comparable()`이 run의 엔진 버전을 보게
한다(`changed` 경로가 하나 늘고 로케일 키가 필요하다) ② 화면이 "직전 실험과 엔진이
다르다"를 `noChange`와 별개로 말한다. **어느 쪽도 넣어서 재지 않았다.**

### B-3. 병렬 게이트 셋이 계산량만 묻는다 — 표가 워커 수만큼 복제되는 것을 아무도 안 센다

**자리** `src/limits.ts`의 `MLJS_FOREST_PARALLEL_MIN_TREE_ROWS` ·
`MLJS_KNN_PARALLEL_MIN_ROW_PRODUCT` · `MLJS_NEURAL_PARALLEL_MIN_WEIGHT_ROWS` ·
평탄화 세 곳(`knn-pool.ts:27-35,59-68` · `forest-pool.ts:65-88` · `neural-pool.ts:63-88`) ·
워커 쪽 되세우기(`knn-compute.ts:46-55` · `forest-compute.ts:137-144` ·
`neural-compute.ts:70-79`)

**계산** (요청서가 시킨 대로 실측이 아니라 상한끼리의 곱이다)

표 한 벌 = `행 × 열 × 8`바이트(`Float64Array`). `postMessage`에 이관 목록이 **없으므로**
씨앗 표는 워커마다 **복제**되고, 워커는 받은 평탄 배열에서 **중첩 배열을 한 벌 더
세운다.** 부모는 원본 중첩 표와 평탄본을 둘 다 든다. 워커 넷에서

```
최고점 ≈ 표 × (원본 1 + 부모 평탄 1 + 워커 평탄 4 + 워커 중첩 4) = 표 × 10
```

`limits.ts`가 허용하는 가장 큰 표에 넣으면:

| 알고리즘 | 행 상한 | 열 상한 | 표 한 벌 | 최고점 |
|---|---|---|---|---|
| 신경망 (`MLJS_NEURAL_NETWORK_ROW_LIMIT` = `MAX_DATASET_ROWS`) | 100,000 | 1,000 | 800MB | **약 8GB** |
| KNN (`MLJS_KNN_ROW_LIMIT` 50,000, 70/30이면 훈련 35,000) | 35,000 | 1,000 | 280MB | **약 2.8GB** |
| 랜덤포레스트 (`MLJS_RANDOM_FOREST_ROW_LIMIT`) | 5,000 | 1,000 | 40MB | 약 0.4GB |

**게이트는 훨씬 앞에서 통과한다.** 신경망은 `가중치 수 × 배치 ≥ 3,000,000`인데 1,000열에
은닉 100이면 가중치가 10만이라 배치 200에서 **2천만**이다. KNN은 `35,000 × 15,000 =
5억 2,500만`으로 문턱 2백만의 **262배**다. **바이트를 묻는 자리가 한 곳도 없다.**

그리고 `MAX_DATASET_ROWS`와 `MAX_DATASET_COLUMNS`는 **상한 스위치로 끌 수 있다**
(`src/limits-switch.ts:32-38`). 꺼면 위 표의 천장 자체가 없어진다.

**4GB 학교 PC와 휴대폰이 기준이다** (CLAUDE.md §0). 포레스트만 안전하다.

**임계값은 제안하지 않는다** ([[no-arbitrary-thresholds]]). 말할 수 있는 것은 셋이다.

1. 이 곱을 **아무도 안 센다** — 게이트 셋의 문턱은 전부 시간(ms)에서 유도됐다.
2. **워커 쪽 되세우기가 비용을 두 배로 만든다.** 평탄 배열로 보내 놓고 워커가 다시
   `number[][]`를 짓는다 — 세 워커 전부 그렇다.
3. **씨앗을 이관으로 넘길 수는 없다.** 넷에게 같은 표를 보내야 하므로 구조적으로 복제다.
   줄이려면 게이트가 바이트를 묻거나, 워커가 평탄 배열 위에서 바로 읽어야 한다.

---

## 4. C급 — 가짜가 진짜보다 관대한 자리 (T3의 답)

요청서가 열거하라고 한 넷에 대한 답이다. **전부 재고 적었다.**

1. **`terminate()` 뒤에 도착하는 답을 이 가짜는 준다.**
   `tests/fixtures/compute-workers.ts:80-82`의 `terminate()`는 센 것만 늘리고, 이미
   큐에 든 마이크로태스크가 그대로 `message`를 쏜다. 진짜 워커는 아무것도 안 준다.
   **M5(배달을 실제로 멈추게)를 심으니 163개가 전부 조용했다** — 지금 이 차이에 걸리는
   코드는 없다. 다만 `askWorker`에 타임아웃이 없어서(`pool.ts:63-80`) **진짜에서는
   terminate 중이던 요청이 영원히 안 끝난다**는 성질을 이 가짜로는 영영 못 본다.
   파일 머리말이 *"가짜가 진짜보다 관대하면 그 차이만큼이 사각이다"*라고 적어 둔 그
   자리다. **조이는 비용이 0이라는 것은 쟀다.**
2. **이관 목록을 세기만 하고 중립화하지 않는다 — 그런데 지금 가려지는 결함은 없다.**
   `neural-compute.ts:97-109`가 기울기 버퍼를 **스텝마다 새로 할당**하므로 이관 뒤에
   다시 쓰는 코드가 없다(코드 대조). 이관 목록을 채우는 컴퓨트 핸들러는 셋 중
   신경망 하나뿐이다.
3. **복제 불가한 값은 이 가짜도 던진다.** 양쪽 방향 모두 `structuredClone`을 태우므로
   (`postMessage`의 가는 쪽은 동기로 던지고, 오는 쪽은 `error` 이벤트가 된다) 진짜와
   같다. **여기는 사각이 아니다.**
4. **`queueMicrotask`의 이른 답에 걸리는 코드는 없다.** M6(`setTimeout(…, 0)`으로 늦춤)
   → 166개 조용.
5. **`FakeLocks`도 아직 진짜보다 이르다.** R26이 넣은 `await Promise.resolve()`는
   마이크로태스크이고 진짜 Web Locks의 콜백은 태스크다. M9로 늦추니 **13개 조용** —
   *"한 번에 맞췄다고 믿지 마라"*의 답은 **"아직 안 맞았지만 지금은 안 다친다"*이고,
   맞추는 비용이 0이다.

**그리고 유창하게 틀리지 **않은** 자리 하나** — `reproduce.ts` 전체를 부르는 화면이
없다는 것은 결함이 아니라 **문서에 적힌 상태**다
(`docs/roadmap/01-v1-v5.md:392` *"그리고 부르는 화면이 없다"*,
`tests/locales.spec.ts:778`의 `NOT_ON_SCREEN_YET`에 `reproduction.`이 있다).
요청서 T1이 물은 *"화면이 그것을 어떤 문구로 말하는가"*의 답은 **아무 말도 안 한다,
그리고 그것이 기록된 상태다.**

---

## 5. T1의 판정 — **A급이 아니다**

요청서가 *"안 손봤다면 그것이 A급이다"*라고 적은 자리인데, **손볼 것이 없었다.**

- `engineOf`는 처음부터 `kind`와 `version`을 **둘 다** 본다
  (`reproduce.ts:79`, `:92`). 엔진 2 run은 `ENGINE_UNAVAILABLE`로 나가고
  `engine: { kind:'mljs', version:'2' }`가 함께 나간다 — **조용히 대조하고 "값이
  달라졌다"고 말하지 않는다.**
- 그 갈래는 **코드에 있고 검사도 있다.** `tests/reproduce.spec.ts:127-135`가 버전만
  다른 run(`'999'`)을 세운다. **M1로 버전을 무시하게 뭉개니 울었다.**
- 새 run의 각인도 못 박혀 있다 — `tests/experiment.spec.ts:184-192`가
  `{ kind: 'mljs', version: '3' }`를 단언한다.
- **버전을 읽는 자리는 저장소 전체에서 `reproduce.ts:79` 하나뿐이다.**
  `grep -rn "\.engine\b" frontend/src`의 나머지(`results.ts:101`, `:140`)는 `kind`만
  보는데, 그것이 맞다 — 실행 방법 라벨과 손잡이 어휘를 정하는 것은 `kind`다.

**바깥쪽에서 나온 것이 B-2다** — 대조 층은 옳게 갈랐는데 결과 화면이 반대말을 한다.

---

## 6. 못 한 것 · 확인 못 한 것

**여기가 고치는 쪽이 재야 할 자리다.**

- **A-1의 처방을 넣어서 재지 않았다.** `openFile`에 잠금 요청을 앞세웠을 때 라우터의
  두 번째 요청이 `heldId === id` 지름길로 통과하는지, 실패 경로에서 새는 것이 없는지 —
  코드로는 성립하지만 실측이 아니다. **R26에서 처방 둘이 안 물었다는 것을 기억하고
  고치는 쪽이 반드시 재라.**
- **B-2의 처방도 안 쟀다.** 그리고 **실물 `.mlpx`로 밟지 않았다** — 엔진 2 파일을 빚어
  `readProject`로 넣고 재학습해 `changed`가 실제로 비는 것까지는 못 봤다.
  `comparable()`이 엔진 버전을 안 읽는다는 것만 코드로 확정했다.
- **A-2의 스토어 쪽 창은 코드 대조다.** 잠금 계층의 손실은 실측했지만, *"그 사이에
  다른 탭이 실제로 열어 두 탭이 함께 쓴다"*는 경합이라 재현하지 못했다. 이 저장소는
  *"경합은 손으로 재현이 사실상 불가능하다"*는 판정을 이미 갖는다.
- **B-1을 재현하지 않았다.** 삭제 뒤 되살아나는지는 타이밍에 달렸고 코드로만 읽었다.
- **B-3은 계산이지 실측이 아니다** (요청서가 그렇게 시켰다). 실제 기기에서 어디서
  죽는지, 그리고 브라우저의 구조화 복제가 최고점을 내 계산보다 낮게 만드는지는 안 봤다.
- **전 스위트 세 번 중 한 번이 1건 실패했고 그 정체를 못 잡았다.** 돌연변이를 모두
  되돌린 뒤 `npx vitest run`이 `1 failed | 3075 passed`를 냈고, 같은 명령을 다시 돌리니
  **154파일 · 3,076통과 · 2건너뜀**으로 돌아왔으며 세 번째도 초록이었다. 트리는
  `git status --short`가 비어 있었다. [[flaky-gate-under-load]]가 이미 아는 자리이지만
  **이번에는 어느 스펙이었는지 기록을 못 남겼다** — 실패한 실행의 출력을 `tail`로만
  봐서 이름이 잘렸다. 다음에는 첫 실행부터 실패 이름을 잡아라.
- **`.mlpx` 실물을 안 빚었다.** T1이 시킨 것인데, 판정에 필요한 것이 전부 코드 층에서
  결정났고(버전 갈래·검사·화면 부재) 남은 시간을 A-1·A-2에 썼다.
- **`vue-tsc`는 P1(처방)에서만 돌렸다.** 돌연변이 아홉에 대해서는 *"타입이 안 울었다"*를
  주장하지 않는다.
- 요청서 §4가 금한 것은 안 했다 — 성능·계산·중첩 워커 사망은 다시 재지 않았다.
- **이미지 경로는 이 라운드에서 안 봤다.**

---

## 7. 다음 라운드가 겨냥할 것

1. **잠금 밖에서 저장소를 쓰는 자리.** 이번 A·B의 뿌리가 하나다 —
   `saveProject`/`deleteProject`를 부르는 자리가 지금은 넷이고 그중 셋이 잠금을
   안 본다. **자리를 세지 말고 없는 원시 연산을 찾아라**([[missing-primitive-not-scattered-bugs]]) —
   *"저장소에 쓰려면 그 `projectId`의 잠금을 쥐고 있어야 한다"*를 강제하는 것이 하나도
   없다. 화면이 늘면 자리도 는다.
2. **가짜를 조이는 비용이 0인 자리 셋**(M5·M6·M9). 지금 조여 두면 다음에 취소 경로를
   만질 때 그물이 생긴다 — R26이 *"취소 경로를 못 밟았다"*로 남긴 그 자리다.
3. **두 시점 비교는 이번에도 코드까지만 갔다.** 엔진 2 `.mlpx`를 실제로 빚어 여는
   입구로 넣는 것이 다음 라운드의 첫 줄이다. [[audit-blind-axes]]의 축 하나가 두 라운드
   연속으로 안 닫혔다.
4. **이 라운드의 방법은 돌연변이가 아니었다.** 심은 소스 돌연변이 여섯이 전부 울었고,
   A·B는 전부 **경로를 걸어서** 나왔다. R26 이후 이 저장소에서 돌연변이가 잡는 것은
   줄고 있다 — **다음 라운드는 "무엇이 안 우는가"보다 "아무도 안 걸어 본 경로가
   어디인가"로 여는 것이 값이 높다.**
