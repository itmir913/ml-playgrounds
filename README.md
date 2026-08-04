# ML Playgrounds

학생이 데이터를 올려 머신러닝 모델을 만들고, 결과를 분석하고, 포트폴리오를 작성해
**하나의 프로젝트 파일**로 저장·제출·공유하는 교육용 AI 플랫폼.

중·고등학교 정보/인공지능 수업의 교사와 학생을 위해 만듭니다.

- 서버는 계산만 합니다. 계정도, 프로젝트도, 학생의 인적사항도 저장하지 않습니다.
- 프로젝트는 브라우저(IndexedDB)에 보관되고 `.mlpx` 파일 하나로 내보내집니다.
- 교사는 그 파일 하나만 열면 재학습 없이 결과를 확인하고 무결성을 검증할 수 있습니다.

---

## 요구 사항

| 도구 | 버전 | 확인 |
|---|---|---|
| Node.js | 20 이상 | `node --version` |
| Python | 3.12 이상 | `python --version` |
| [uv](https://docs.astral.sh/uv/) | 최신 | `uv --version` |

uv가 없다면:

```bash
winget install --id=astral-sh.uv -e
```

**도커는 로컬 개발에 필요하지 않습니다.** 배포 패키징은 배포 단계에서 구성합니다.

---

## 명령어

### 백엔드 (`backend/`)

```bash
uv sync
```

```bash
uv run uvicorn app.main:app --reload --port 8000
```

```bash
uv run pytest
```

```bash
uv run ruff check . && uv run ruff format --check . && uv run mypy .
```

### 프런트엔드 (`frontend/`)

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run lint && npm run typecheck && npm run build
```

### IDE 실행 구성

`.idea/runConfigurations/`에 `dev` / `build` / `test`가 있습니다.
`dev`는 `dev-backend`(uvicorn)와 `dev-frontend`(vite)를 묶은 Compound 구성으로,
RUN 탭 안에서 두 서버가 각각 탭으로 동시에 실행됩니다.

---

## 저장소 구조

```
backend/    FastAPI + scikit-learn. 계산만 하고 아무것도 저장하지 않는다
frontend/   Vue 3 + TypeScript + Vite. 프로젝트 저장소이자 UI
docs/       설계 문서
scripts/    CI 검사 스크립트
```

---

## 문서

작업 전에 [CLAUDE.md](CLAUDE.md)의 절대 원칙 다섯 가지를 먼저 읽으십시오.

| 문서 | 내용 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | 설계 원칙과 개발 규약 |
| [docs/architecture.md](docs/architecture.md) | 큐, 세션 수명주기, 자원 관리, 로컬 개발 |
| [docs/mlpx-spec.md](docs/mlpx-spec.md) | `.mlpx` 포맷과 무결성 검증 |
| [docs/roadmap.md](docs/roadmap.md) | 범위와 구현 순서 |
| [docs/open-decisions.md](docs/open-decisions.md) | 아직 결정되지 않은 항목 |
| [docs/error-codes.md](docs/error-codes.md) | 에러 코드 레퍼런스 |
| [docs/privacy.md](docs/privacy.md) | 로깅·개인정보 정책 |

---

## 라이선스

[MIT](LICENSE)
