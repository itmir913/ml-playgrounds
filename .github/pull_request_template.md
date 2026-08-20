## What this changes

<!-- One or two sentences, and the issue number if there is one. -->

## Why

<!-- What was wrong, or what this makes possible. -->

## Checks

- [ ] `npm run ci` passes in `frontend/` — the whole thing, not a subset
- [ ] `uv run python scripts/ci.py` passes in `backend/` (only if you touched it)
- [ ] The decision behind this change is in `docs/`, committed before the code —
      or this is a plain bug fix, where the intended behaviour was already written
- [ ] Commits follow Conventional Commits

## Licensing

Tick what applies. If a box does not apply to this change, leave it and say so —
an unticked box with no explanation reads as an unanswered question.

- [ ] My contribution is offered under this project's MIT license and I have the
      right to offer it
- [ ] **New or upgraded dependency:** its SPDX id is on the allowlist in
      `frontend/scripts/notices.ts`, or I added it and explain below why it may
      ship inside an MIT-licensed build — **and I opened the actual license text
      to check it says what `package.json` claims**
- [ ] **Someone else's code copied into a file:** the header carries the source
      (repository, version, file), the license, and every change I made, and the
      reason vendoring beat a dependency is in `docs/open-decisions.md`
- [ ] **Anything new that ships to the browser:** it appears in
      `dist/third-party-notices.txt` after `npm run build`

<!-- Ticked one of the dependency boxes? Name the package and its license here,
     and for a dual license, which side you picked and why. -->

## What the checks could not see

<!-- Screens you looked at, devices or browsers you tried, anything you decided
     by eye. Write "nothing visual" if the change never reaches a screen. -->
