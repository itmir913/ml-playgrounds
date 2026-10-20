# 과거 배포판의 범주 열 `.mlpx` 골든

> 검사는 `frontend/tests/legacy-categorical.spec.ts`. 규칙은 `../legacy/README.md`와 같다 —
> **다시 짓지 마라.** 검사가 울면 깬 쪽을 되돌린다.

## 왜 따로 있나

`../legacy/`의 골든은 붓꽃이라 **수치 열뿐이다.** 그래서 범주 인코딩 경로가 틀어져도 답이 안 바뀌어 울지 못했다
(#45 적대 감사 B). 여기 골든은 범주 열이 든 데이터로, 아래 셋을 지난다.

- v1 전처리기(`mlpx-preprocess-v1`)의 범주 열을 실험의 공통 인코딩으로 채워 읽기 — 서수와 원-핫 둘 다
- v2 전처리기의 열별 인코딩·지정 순서·`none`으로 뺀 열
- 훈련에 없던 범주가 든 질의(원-핫은 모두 0, 서수는 −1)

## 무엇이 들었나

태그마다 디렉터리 하나에 `.mlpx`와 `answers.json`이다. `answers.json`은 **그 파일을 쓴 판의 코드가 다시 열어 낸
답**이고, 파일마다 질의(열 이름 → 값 200개)와 모델마다의 답·확률을 든다.

| 태그      | 파일           | 무엇인가                                                                                                                        |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `0.35.9`  | `titanic.mlpx` | **코드 소유자가 0.35.9로 만든 실제 프로젝트 그대로다.** 타이타닉 1,309행, 범주 열 셋(객실 등급·성별·탑승 항구), 공통 원-핫 분류 |
| `0.35.12` | `zoo.mlpx`     | zoo 101행. 공통 서수 실험과 공통 원-핫 실험 — v1 전처리기의 마지막 배포                                                         |
| `0.36.0`  | `zoo.mlpx`     | zoo 101행. 공통값과 다른 열·같은 덮어쓰기·지정 순서·`none` 열·무시되는 순서를 섞은 실험 둘 — 열별 인코딩의 첫 배포              |

## 데이터 출처

- **zoo** — UCI Machine Learning Repository, [Zoo](https://archive.ics.uci.edu/dataset/111/zoo), CC BY 4.0.
  바꾼 것: 머리글을 `zoo.names`의 순서로 붙였고, 0/1 특성을 `Yes (1)`/`No (0)`로, 유형 번호 1~7을 무리 이름으로 적었다.
  `animal_name`은 특성에서 뺀다.
- **titanic** — Vanderbilt Biostatistics, [titanic3](https://hbiostat.org/data/), 출처를 밝히면 자유롭게 쓸 수 있다.
  바꾼 것: 코드 소유자가 학습용으로 가공했다 — 이름·티켓·객실·구명정·시신 번호·목적지 열을 뺐고, 머리글과 범주 값을
  한국어와 원래 값을 함께 적는 꼴(`여성 (female)`)로 바꿨다. 파일 안의 `dataset/data.csv`가 그것이다.

## 어떻게 지었나

```
LEGACY_GENERATOR=legacy-categorical.mjs LEGACY_REAL=<실제 파일 디렉터리> frontend/scripts/legacy-mlpx/generate.sh <작업 디렉터리> 0.35.9
LEGACY_GENERATOR=legacy-categorical.mjs LEGACY_ZOO=<zoo.csv> frontend/scripts/legacy-mlpx/generate.sh <작업 디렉터리> 0.35.12 0.36.0
```

옛 태그의 트리에는 `frontend/.npmrc`가 없으므로 `npm_config_allow_remote=root`를 붙인다(`../legacy/README.md`).
생성기(`scripts/legacy-mlpx/legacy-categorical.mjs`)는 `LEGACY_REAL`의 파일은 **바이트 그대로 복사하고** 답만 적는다.
