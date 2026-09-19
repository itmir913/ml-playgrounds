#!/usr/bin/env python3
"""sklearn 대조 픽스처를 생성/검증한다.

`frontend/tests/sklearn-parity.spec.ts`가 순수 JS 엔진을 이 픽스처와 대조한다
(open-decisions.md "sklearn 대조 픽스처가 CI 관문에 들어간다"). 붓꽃 하나만 보면
지나가는 종류의 결함을 아홉 가지 데이터 모양으로 잡는다 - V2 감사 1단계-A가 실제로
결함 셋(나이브베이즈 특성 2개, 로지스틱 원좌표 발산, SMO의 H 수식)을 잡은 그 모양들이다.

픽스처의 구조 (frontend/tests/fixtures/sklearn/):

- data/*.csv          - 데이터. 감사 때 생성했고 그 뒤로 손대지 않는다.
- expected.json       - 분할 인덱스 + sklearn 기대값 + 다수 클래스 기준선.

**분할 인덱스는 이 스크립트가 만들지 않는다.** 인덱스는 JS 쪽 분할(ml/split.ts,
시드 42)이 만든 기록이고, 여기서는 그대로 보존하며 sklearn 기대값만 다시 계산한다.
양쪽이 같은 행을 봐야 대조가 성립한다.

**하이퍼파라미터 대응** - 우리 엔진의 기본값에 맞춘 sklearn 설정이다:

- decision_tree: min_samples_split=4 (ml-cart minNumSamples=3은 "행 수 <= 3이면 잎"이라
  분할에 4행이 필요하다), max_depth=100, random_state=42
- random_forest: n_estimators=10, random_state=42
- knn: n_neighbors=5 / svm: SVC(kernel='linear', C=1) / logistic·naive_bayes·linreg: 기본값

사용법:
  uv run --project backend python scripts/generate_sklearn_fixtures.py          # 재생성
  uv run --project backend python scripts/generate_sklearn_fixtures.py --check  # CI: 낡음 검사

--check는 커밋된 기대값과 다시 계산한 값을 수치 비교(상대 1e-9)한다. 문자열 diff가
아닌 이유는 부동소수의 마지막 자리가 플랫폼(BLAS)에 따라 흔들릴 수 있어서다.
"""

from __future__ import annotations

import csv
import json
import sys
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import sklearn
from sklearn.exceptions import ConvergenceWarning
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import accuracy_score, r2_score
from sklearn.naive_bayes import GaussianNB
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.neighbors import KNeighborsClassifier
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "frontend" / "tests" / "fixtures" / "sklearn"
EXPECTED = FIXTURES / "expected.json"

CLASSIFIERS = [
    "decision_tree",
    "random_forest",
    "naive_bayes",
    "knn",
    "svm",
    "logistic_regression",
]

# 인공신경망을 돌리는 씨앗들. **다섯인 이유는 구간을 보려면 하나로는 모자라고, 이 값이
# 관문의 시간이 되기 때문이다.**
#
# **여기만 씨앗을 여럿 돌린다.** 다른 알고리즘은 도착점이 하나라 씨앗이 결과를 안 바꾸지만
# (또는 바꿔도 규제가 최적점을 유일하게 만든다), MLP는 목적함수가 비볼록이라 **초기화가
# 어디로 갈지를 정한다.** 그래서 이 알고리즘의 기대값은 수 하나가 아니라 구간이다
# (open-decisions.md "인공신경망을 넣는다 — 손잡이는 층 수와 뉴런 수 둘").
NEURAL_SEEDS = [0, 1, 2, 3, 4]


def read_csv(name: str) -> tuple[list[str], list[list[str]]]:
    with open(FIXTURES / "data" / f"{name}.csv", encoding="utf-8", newline="") as f:
        rows = list(csv.reader(f))
    return rows[0], rows[1:]


def build_model(algorithm: str, random_state: int) -> Any:
    if algorithm == "decision_tree":
        return DecisionTreeClassifier(
            min_samples_split=4, max_depth=100, random_state=random_state
        )
    if algorithm == "random_forest":
        return RandomForestClassifier(n_estimators=10, random_state=random_state)
    if algorithm == "naive_bayes":
        return GaussianNB()
    if algorithm == "knn":
        return KNeighborsClassifier(n_neighbors=5)
    if algorithm == "svm":
        return SVC(kernel="linear", C=1.0, random_state=random_state)
    if algorithm == "logistic_regression":
        return LogisticRegression(random_state=random_state)
    raise ValueError(algorithm)


def matrices_for(
    header: list[str], body: list[list[str]], entry: dict[str, Any]
) -> tuple[np.ndarray, np.ndarray]:
    """JS 전처리(스케일링 none, onehot)와 같은 행렬을 만든다.

    수치 열은 값 그대로, 범주 열은 **훈련 데이터 등장 순서**의 원-핫이다 - ml/preprocess.ts의
    규약과 같아야 같은 행렬 위에서 대조가 성립한다 (감사에서 최대차 1e-15로 확인했다).
    """
    cols = {c: i for i, c in enumerate(header)}
    features: list[str] = entry["meta"]["features"]
    train_idx: list[int] = entry["trainIndices"]

    def cell(row: int, feature: str) -> str:
        return body[row][cols[feature]].strip()

    def numeric(feature: str) -> bool:
        seen = False
        for i in train_idx:
            value = cell(i, feature)
            if value == "":
                continue
            try:
                float(value)
            except ValueError:
                return False
            seen = True
        return seen

    plans: list[tuple[str, list[str] | None]] = []
    for feature in features:
        if numeric(feature):
            plans.append((feature, None))
        else:
            categories: list[str] = []
            for i in train_idx:
                value = cell(i, feature)
                if value not in categories:
                    categories.append(value)
            plans.append((feature, categories))

    def take(indices: list[int]) -> np.ndarray:
        out: list[list[float]] = []
        for i in indices:
            row: list[float] = []
            for feature, categories in plans:
                value = cell(i, feature)
                if categories is None:
                    row.append(float(value) if value != "" else 0.0)
                else:
                    row.extend(1.0 if value == c else 0.0 for c in categories)
            out.append(row)
        return np.array(out)

    return take(entry["trainIndices"]), take(entry["testIndices"])


def targets_for(
    header: list[str], body: list[list[str]], entry: dict[str, Any]
) -> tuple[list[str], list[str]]:
    column = header.index(entry["meta"]["target"])
    train = [body[i][column].strip() for i in entry["trainIndices"]]
    test = [body[i][column].strip() for i in entry["testIndices"]]
    return train, test



def split_boundary(threshold: np.ndarray) -> np.ndarray:
    """sklearn의 갈림을 **우리 해석기의 규칙으로 옮긴 값**.

    둘이 두 군데서 다르다.

    1. sklearn은 `x <= t`면 왼쪽이고 **우리는 `x < t`면 왼쪽이다**
       (`ml/models/tree.ts`의 `classify`).
    2. **sklearn은 나무를 float32로 비교한다** - `DecisionTreeClassifier`가 X를
       `np.float32`로 바꿔 배우고 예측한다. 우리 해석기는 배정도 그대로 본다.

    그래서 경계는 **`float32(x) > t`가 되는 가장 작은 배정도**다: t보다 큰 첫 float32를
    찾고, 그 앞 float32와의 중점을 잡는다. 그 아래는 반올림해서 t 이하가 되고 위는
    넘어간다.

    **2번을 빼먹으면 실물에서 갈린다** (2026-09-19에 실제로 걸렸다). `categorical` 벌의
    한 행이 `주당활동시간 = 5.6`인데 임계값이 정확히 `float32(5.6)`이라, 배정도로 재면
    오른쪽이고 sklearn은 왼쪽이었다.

    **앱의 어댑터와 같은 식이어야 한다** (`ml/engines/pyodide-sklearn.ts`의
    `TREE_DUMP_HELPER`). 갈리면 여기서 굳힌 것이 앱이 만드는 것과 다른 물건이 된다.
    """
    t = np.asarray(threshold, dtype=np.float64)
    upper = np.float32(np.inf)
    lower = np.float32(-np.inf)
    nearest = t.astype(np.float32)
    # 반올림이 t 아래로 떨어졌으면 한 칸 올려 "t보다 큰 첫 float32"로 만든다.
    above = np.where(nearest.astype(np.float64) <= t, np.nextafter(nearest, upper), nearest)
    below = np.nextafter(above, lower)
    return (above.astype(np.float64) + below.astype(np.float64)) / 2.0


def tree_dump(tree: Any) -> dict[str, Any]:
    """나무 하나를 그대로 받아쓴다. 판단은 `split_boundary` 하나뿐이다."""
    return {
        "left": tree.children_left.tolist(),
        "right": tree.children_right.tolist(),
        "feature": tree.feature.tolist(),
        "threshold": split_boundary(tree.threshold).tolist(),
        "leafClass": tree.value[:, 0, :].argmax(axis=1).tolist(),
    }


def model_dump(algorithm: str, model: Any) -> dict[str, Any] | None:
    """직렬화기가 있는 알고리즘만 받아쓴다. 없으면 `None`이고 그때는 안 굳힌다."""
    classes = [str(one) for one in getattr(model, "classes_", [])]
    if algorithm == "decision_tree":
        return {"trees": [tree_dump(model.tree_)], "classes": classes}
    if algorithm == "random_forest":
        return {
            "trees": [tree_dump(one.tree_) for one in model.estimators_],
            "classes": classes,
        }
    return None


def expectations_for(name: str, entry: dict[str, Any]) -> dict[str, Any]:
    header, body = read_csv(name)
    x_train, x_test = matrices_for(header, body, entry)
    y_train, y_test = targets_for(header, body, entry)
    random_state: int = entry["randomState"]

    if entry["meta"]["taskType"] == "regression":
        regression = LinearRegression().fit(x_train, np.array(y_train, dtype=float))
        prediction = regression.predict(x_test)
        return {
            "linear_regression": {
                "coefficients": regression.coef_.tolist(),
                "intercept": float(regression.intercept_),
                "r2": float(r2_score(np.array(y_test, dtype=float), prediction)),
                # **예측값 자체를 굳힌다** (2026-09-19). 계수만으로는 "옮긴 모델이 같은 답을
                # 내는가"를 물을 수 없다 - 그 물음의 답은 계수를 곱한 결과이고, 곱하는 쪽이
                # 우리 해석기다 (`tests/sklearn-serialize.spec.ts`).
                "dumpValues": prediction.tolist(),
            },
            "neural_network": neural_regression_distribution(
                x_train, y_train, x_test, y_test
            ),
        }

    counts: dict[str, int] = {}
    for label in y_train:
        counts[label] = counts.get(label, 0) + 1
    majority = max(counts, key=lambda label: counts[label])
    baseline = sum(1 for label in y_test if label == majority) / len(y_test)

    out: dict[str, Any] = {"__baseline": baseline}
    for algorithm in CLASSIFIERS:
        model = build_model(algorithm, random_state)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            model.fit(x_train, y_train)
        sk_converged = not any(
            issubclass(one.category, ConvergenceWarning) for one in caught
        )
        predicted = [str(one) for one in model.predict(x_test)]
        record: dict[str, Any] = {"accuracy": accuracy_score(y_test, predicted)}
        # **배운 것을 그대로 받아쓴다** (`ml/engines/pyodide-serialize.ts`).
        #
        # Pyodide는 검사가 못 띄우므로(27.3MB) **sklearn이 배운 모양을 우리 형식으로
        # 옮기는 일이 맞는지**를 여기서 굳힌다. `sklearn-serialize.spec.ts`가 이 덤프로
        # 우리 모델 파일을 만들어 해석기에 먹이고, **그 예측이 아래 `labels`와 같은지**
        # 본다 - 같지 않으면 학생 파일이 자기 run과 다른 답을 내는 것이다.
        dumped = model_dump(algorithm, model)
        if dumped is not None:
            record["dump"] = dumped
            record["dumpLabels"] = predicted
        if algorithm == "logistic_regression":
            # 수렴 상태를 담는다 (1단계-C) - 관문이 빨개졌을 때 "진짜 결함인가, 경로가
            # 조금 움직인 것인가"를 가를 근거가 파일 안에 있어야 한다. 라벨 완전 일치
            # 관문은 양쪽이 수렴했을 때만 구조적으로 정당하다(L2의 유일 최적점).
            record["converged"] = sk_converged
            record["nIter"] = int(np.max(model.n_iter_))
        # 답이 하나뿐인 알고리즘은 라벨 전체를 굳힌다 - 정확도가 같아도 라벨이 다를 수 있다.
        if algorithm == "naive_bayes":
            record["labels"] = predicted
        if algorithm == "logistic_regression":
            # L2가 최적점을 유일하게 만들었으므로 로지스틱도 라벨을 굳힌다 (1단계-B,
            # 솔버 교체 뒤 11개 데이터셋에서 라벨 완전 일치·확률 최대차 8.4e-4 실측).
            # **경계 위의 행은 굳히지 않는다(null)** - 1·2등 확률 차가 1e-2 아래인 행은
            # tol 수준(실측 최대차의 10배 여유)의 솔버 잔차로도 뒤집힐 수 있고, 그건
            # 결함이 아니라 판정 불능이다.
            proba = model.predict_proba(x_test)
            top2 = np.sort(proba, axis=1)[:, -2:]
            margin = top2[:, 1] - top2[:, 0]
            record["labels"] = [
                label if margin[row] >= 1e-2 else None
                for row, label in enumerate(predicted)
            ]
        if algorithm == "knn":
            # **이웃 선택 동점은 sklearn이 규약을 정의하지 않는 자리다** (자료구조에 따라
            # 다르다). k번째와 k+1번째 이웃의 거리가 같은 행은 라벨을 굳히지 않는다(null) -
            # 그 행의 답은 어느 쪽이든 규약 차이이지 결함이 아니다.
            # **가린 것과 안 가린 것을 함께 굳힌다** (2026-09-19). 가린 쪽은 "우리 엔진이
            # sklearn과 같은가"를 묻는 자리가 쓰고(`sklearn-parity.spec.ts`), 안 가린 쪽은
            # **동점 행에서 실제로 몇 줄이 갈리는지**를 세는 자리가 쓴다
            # (`sklearn-serialize.spec.ts`) - 규약이 없다는 사실만으로는 그 수를 모른다.
            record["dumpLabels"] = list(predicted)
            record["labels"] = list(predicted)
            if len(x_train) > 5:
                distances, _ = model.kneighbors(x_test, n_neighbors=6)
                for row in range(len(x_test)):
                    boundary, beyond = distances[row][4], distances[row][5]
                    if np.isclose(boundary, beyond, rtol=1e-12, atol=1e-12):
                        record["labels"][row] = None
        if algorithm == "naive_bayes":
            record["params"] = {
                "theta": model.theta_.tolist(),
                "var": model.var_.tolist(),
                "classLogPrior": np.log(model.class_prior_).tolist(),
            }
        if algorithm == "svm":
            # **계수와 라벨을 굳힌다** (2026-09-19). 옮긴 모델의 대조가 이 둘 위에 선다 -
            # 계수는 `mlpx-svm-v1`이 담는 것 자체이고, 라벨은 그것으로 우리 해석기가 낸
            # 답과 견줄 자리다 (`tests/sklearn-serialize.spec.ts`).
            #
            # **이진과 다중 클래스에서 부호가 갈린다** - libsvm은 양수면 앞 클래스인데
            # sklearn이 클래스 둘일 때만 `coef_`에 -1을 곱해 내놓는다. 그 사실이 맞는지는
            # 여기 굳힌 라벨이 판정한다.
            record["params"] = {
                "coef": model.coef_.tolist(),
                "intercept": model.intercept_.tolist(),
            }
            record["dumpLabels"] = predicted
        if algorithm == "logistic_regression":
            # 계수와 절편을 굳힌다 (2026-08-31). 화면이 이 값을 학생에게 보여주기로 했고
            # (open-decisions.md "모델이 무엇을 배웠는지 화면이 보여준다"), 보여주는 숫자는
            # 대조되고 있어야 한다. L2가 최적점을 유일하게 만들므로 양쪽이 수렴하면 계수
            # 자체가 같아야 한다 - 라벨 일치보다 강한 판정이다.
            #
            # **이진은 sklearn이 한 줄, 우리는 +-절반 두 줄이다** (mlpx-spec.md 5.4.1).
            # 여기는 sklearn의 모양 그대로 담고, 견주는 쪽(sklearn-parity.spec.ts)이 우리
            # 두 줄을 합쳐 맞춘다 - 픽스처는 sklearn이 말한 것을 적는 자리이지 우리 형식으로
            # 번역하는 자리가 아니다.
            record["params"] = {
                "coef": model.coef_.tolist(),
                "intercept": model.intercept_.tolist(),
            }
        out[algorithm] = record

    out["neural_network"] = neural_distribution(x_train, y_train, x_test, y_test)
    return out


def neural_distribution(
    x_train: np.ndarray,
    y_train: list[str],
    x_test: np.ndarray,
    y_test: list[str],
) -> dict[str, Any]:
    """MLPClassifier를 씨앗마다 돌려 **정확도의 구간**을 적는다.

    **계수도 손실 곡선도 안 적는다.** 우리 엔진은 numpy의 난수열을 재현하지 않으므로 그
    값들이 같을 수 없고, **같은 척하는 숫자를 픽스처에 넣으면 그것이 거짓말이 된다.**
    적는 것은 "이 데이터에서 sklearn의 MLP가 어디쯤을 내는가"뿐이다.

    손잡이는 우리 화면의 기본값과 같다 - `hidden_layer_sizes=(100,)`은 sklearn의
    기본값이기도 하다.
    """
    accuracies: list[float] = []
    for seed in NEURAL_SEEDS:
        model = MLPClassifier(hidden_layer_sizes=(100,), random_state=seed)
        with warnings.catch_warnings():
            # 200 에폭 안에 안 멈추는 것은 정상이다 - 우리 엔진도 그때 경고를 붙인다.
            warnings.simplefilter("ignore", ConvergenceWarning)
            model.fit(x_train, y_train)
        predicted = [str(one) for one in model.predict(x_test)]
        accuracies.append(accuracy_score(y_test, predicted))

    return {
        "seeds": list(NEURAL_SEEDS),
        "accuracies": accuracies,
        "accuracyMin": float(min(accuracies)),
        "accuracyMax": float(max(accuracies)),
        "accuracyMedian": float(np.median(accuracies)),
        "hiddenLayerSizes": [100],
    }


def neural_regression_distribution(
    x_train: np.ndarray,
    y_train: list[str],
    x_test: np.ndarray,
    y_test: list[str],
) -> dict[str, Any]:
    """MLPRegressor를 씨앗마다 돌려 **R2의 구간**을 적는다.

    분류 쪽(`neural_distribution`)과 같은 이유로 값 하나가 아니라 구간이다 - 목적함수가
    비볼록이고 도착점이 초기화에 달렸다.

    **`r2Min`이 음수일 수 있다.** R2는 "평균만 내는 모델"이 0이고 그보다 못하면 음수라,
    타깃의 크기가 큰 벌에서는 에폭 상한 안에 못 닿아 음수가 나온다 - 그때 sklearn도
    같은 자리에 있다는 것이 이 표의 값이다.
    """
    train = np.array(y_train, dtype=float)
    test = np.array(y_test, dtype=float)
    scores: list[float] = []
    for seed in NEURAL_SEEDS:
        model = MLPRegressor(hidden_layer_sizes=(100,), random_state=seed)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", ConvergenceWarning)
            model.fit(x_train, train)
        scores.append(float(r2_score(test, model.predict(x_test))))

    # **평균만 내는 모델의 R2는 정의상 0이다.** 분류의 다수 클래스 기준선과 같은 자리이고,
    # 견주는 쪽이 그 사실을 알아야 "찍기보다 낫다"를 물을 수 있다.
    return {
        "seeds": list(NEURAL_SEEDS),
        # **`r2Values`다. `r2`가 아니다** - 선형 회귀 항목이 그 이름으로 수 하나를 갖고
        # 있고, 같은 이름이 한 파일에서 배열과 수를 함께 뜻하면 읽는 쪽의 타입이 갈린다.
        "r2Values": scores,
        "r2Min": float(min(scores)),
        "r2Max": float(max(scores)),
        "r2Median": float(np.median(scores)),
        "hiddenLayerSizes": [100],
    }


# 반복 솔버가 낸 값의 허용차. **닫힌 식과 같은 자를 쓸 수 없다** (2026-08-31).
#
# 로지스틱 계수는 L-BFGS가 걸어가서 멈춘 자리라 **플랫폼(BLAS·스레드)마다 마지막 자리가
# 다르다.** 실제로 이 값을 픽스처에 넣은 날 리눅스 CI가 `Stale fixtures: iris`로 섰다 -
# iris는 sklearn이 83회에 아슬아슬하게 수렴하는 벌이라 가장 먼저 흔들린다.
#
# **값은 스펙의 허용차와 같다** (`sklearn-parity.spec.ts`의 `PARAM_ABS_TOLERANCE`·
# `PARAM_REL_TOLERANCE`). 그 안에서 흔들리는 픽스처는 스펙의 판정을 못 바꾸므로 낡은 것이
# 아니고, 그보다 크게 움직였으면 그때는 정말로 다시 만들어야 한다. **둘을 따로 고르면
# 한쪽만 움직였을 때 아무도 안 운다.**
SOLVER_ABS = 5e-3
SOLVER_REL = 5e-3


def close(a: Any, b: Any, rel: float = 1e-9, atol: float = 1e-12, path: str = "") -> bool:
    if isinstance(a, float) or isinstance(b, float):
        if bool(np.isclose(float(a), float(b), rtol=rel, atol=atol)):
            return True
        # **어디가 어긋났는지 적는다.** 이름만 부르면 다음 사람이 재현부터 다시 짠다.
        print(f"  {path or '(root)'}: {a} != {b}")
        return False
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            print(f"  {path or '(root)'}: 길이 {len(a)} != {len(b)}")
            return False
        return all(
            close(x, y, rel, atol, f"{path}[{i}]") for i, (x, y) in enumerate(zip(a, b))
        )
    if isinstance(a, dict) and isinstance(b, dict):
        if a.keys() != b.keys():
            print(f"  {path or '(root)'}: 키가 다르다 {sorted(a)} != {sorted(b)}")
            return False
        return all(
            # **반복 솔버가 낸 값만 자가 다르다.** 나이브베이즈 파라미터는 닫힌 식이라
            # 그대로 1e-9이고, 여기서 넓히면 그쪽 대조가 함께 무뎌진다.
            close(
                a[k],
                b[k],
                SOLVER_REL if k == "params" and "coef" in (a[k] or {}) else rel,
                SOLVER_ABS if k == "params" and "coef" in (a[k] or {}) else atol,
                f"{path}.{k}" if path else k,
            )
            for k in a
        )
    if bool(a == b):
        return True
    print(f"  {path or '(root)'}: {a!r} != {b!r}")
    return False


def main() -> int:
    check = "--check" in sys.argv
    document = json.loads(EXPECTED.read_text(encoding="utf-8"))

    stale: list[str] = []
    for name, entry in document["datasets"].items():
        fresh = expectations_for(name, entry)
        baseline = fresh.pop("__baseline", None)
        if check:
            recorded = {"baseline": entry.get("baseline"), "sklearn": entry["sklearn"]}
            renewed = {"baseline": baseline, "sklearn": fresh}
            if entry["meta"]["taskType"] == "regression":
                recorded["baseline"] = renewed["baseline"] = None
            if not close(recorded, renewed):
                stale.append(name)
        else:
            if baseline is not None:
                entry["baseline"] = baseline
            entry["sklearn"] = fresh

    if check:
        if stale:
            print(f"Stale fixtures: {', '.join(stale)}")
            print("Regenerate with: uv run --project backend python scripts/generate_sklearn_fixtures.py")
            return 1
        print(f"Fixtures match a fresh run of sklearn {sklearn.__version__}.")
        return 0

    document["sklearnVersion"] = sklearn.__version__
    # **줄 끝을 LF로 못 박는다.** 윈도우에서 기본값으로 쓰면 CRLF가 되고, 이 저장소는
    # 같은 함정에서 여러 번 넘어졌다(메모리 `crlf-breaks-source-checks`). 커밋은 git이
    # 정규화해 조용하지만, 작업 사본이 매번 통째로 달라 보인다.
    EXPECTED.write_text(
        json.dumps(document, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"Wrote fixtures from sklearn {sklearn.__version__} -> {EXPECTED}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
