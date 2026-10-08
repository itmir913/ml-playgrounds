#!/usr/bin/env bash
# 과거 배포판의 코드로 `.mlpx` 골든 파일을 짓는다 (tests/fixtures/legacy/README.md).
#
#   frontend/scripts/legacy-mlpx/generate.sh <작업 디렉터리> <태그>...
#
# 태그마다 저장소를 `git worktree`로 꺼내 그 태그의 의존성을 깔고, 이 디렉터리의 생성기를
# 그 트리의 `tests/`에 복사해 vitest로 돌린다. 결과는 `<작업 디렉터리>/out/<태그>/`에 남고,
# 꺼낸 트리는 지운다. **한 번 지은 골든은 다시 짓지 않는다** — 역사다(README).
#
# Node가 내장 fetch로 받는 스크립트가 없으므로 프록시 설정은 npm의 것으로 충분하다.
set -euo pipefail

work=$1
shift
here=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
mkdir -p "$work/out"

for tag in "$@"; do
  tree="$work/tree-$tag"
  out="$work/out/$tag"
  echo "== $tag"
  rm -rf "$tree"
  git -C "$repo" worktree add --detach "$tree" "$tag" >/dev/null
  (
    cd "$tree/frontend"
    # 내려받기 훅(백본·Pyodide)은 생성에 쓰지 않는다.
    npm ci --ignore-scripts --no-audit --no-fund >"$work/npm-$tag.log" 2>&1
    # JS 생성기를 `.spec.ts` 이름으로 놓는다 — 그 태그의 vitest가 `tests/**/*.spec.ts`만 집는다.
    cp "$here/legacy-generate.mjs" tests/zz-legacy-generate.spec.ts
    LEGACY_OUT="$out" LEGACY_TAG="$tag" npx vitest run tests/zz-legacy-generate.spec.ts \
      >"$work/vitest-$tag.log" 2>&1 || { echo "   FAILED — $work/vitest-$tag.log"; exit 1; }
  ) && echo "   ok — $(ls "$out" | tr '\n' ' ')" || true
  git -C "$repo" worktree remove --force "$tree"
done
