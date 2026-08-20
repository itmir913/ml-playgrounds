# Contributing

Thanks for looking. ML Playgrounds is a teaching tool for middle and high school
classrooms, so most decisions here are made from a classroom bench rather than a
benchmark: it has to work on a school PC, on a phone, and on a network the
teacher does not control.

**The rules this repository refuses to break live in [CLAUDE.md](CLAUDE.md), and
the design notes in [docs/](docs/) are written in Korean.** This file is the part
an outside contributor needs, in English. CLAUDE.md is the original — where the
two disagree, believe CLAUDE.md. Issues and pull requests are welcome in either
language.

## Five things that are not up for negotiation

Each of these is a section of CLAUDE.md, and the reasoning behind it is in
[docs/architecture.md](docs/architecture.md).

1. **The official deployment has no server** (CLAUDE.md §1.1). It is a static
   page. A backend exists for schools that self-host it, and it only computes —
   it never stores a user, a project, or a dataset past the WebSocket session.
2. **The browser is the storage** (§1.2). Projects live in IndexedDB, and the
   student owns them.
3. **One project is one file** (§1.3). A `.mlpx` is the project, the submission,
   and the portfolio, and a teacher must be able to open it without retraining.
4. **The backend never returns a human-readable string** (§1.4). Status codes and
   structured parameters only; the front end turns them into sentences.
5. **Resources are finite** (§1.5). Every size, count, and time limit is a named
   constant — `frontend/src/limits.ts` on the front end, `config.py` on the back.
   Never write one into a screen or a handler.

A change that needs one of these to bend needs a decision written into
[docs/open-decisions.md](docs/open-decisions.md) first — please open an issue
before you write the code.

## Setting up

Node.js 22.13 or newer. The app is `frontend/`:

```bash
npm install
```

```bash
npm run dev
```

The optional self-hosted backend is Python 3.12+ with
[uv](https://docs.astral.sh/uv/), in `backend/`. Nothing in the app works
differently without it.

## The gate

One command per side. CI runs exactly these and nothing else, so if they pass
locally they pass there.

```bash
npm run ci
```

```bash
uv run python scripts/ci.py
```

The first runs in `frontend/` (lint, types, roughly 2,000 vitest tests, build);
the second in `backend/`. There is also a contract check between the locale files
and the backend error codes, run from the repository root with the standard
library only:

```bash
python scripts/check_locales.py
```

Run the whole gate before every commit, not a subset. Two notes that have cost
people time already:

- **`npm run ci` checks, `npm run lint` rewrites.** `lint` carries `--fix` and
  will reformat files you did not mean to touch. If you only want to know whether
  something is wrong, run `ci`.
- **The first `npm run ci` downloads the MobileNet weights** that the image tests
  read. It is a one-time fetch into a local cache, not part of the shipped site.

## Making a change

- **Docs before code.** If your change settles a question — a limit, a format, a
  behaviour someone could reasonably have built differently — write it into
  `docs/` and commit that first. A plain bug fix, where the intended behaviour is
  already documented, does not need this.
- **Back end: code and tests in the same change.** No backend code without tests.
- **Front end splits in two.** Logic (format parsing, migrations, IndexedDB,
  stores, composables) is covered by vitest. Screens are checked by eye — so pull
  the testable logic out of the component, where a test can reach it.
- **Screens follow written rules,** and `frontend/tests/ui-rules.spec.ts`
  enforces them: stock Tailwind classes only (no `w-[327px]`), `text-base` is the
  smallest type on the site because the readers are teenagers on classroom
  monitors, and a button that runs something long takes `AppButton`'s `action`
  prop so it cannot be double-clicked.
- **No natural-language literal inside a component** (CLAUDE.md §3). Everything
  goes through `t()`, one sentence is one key, and user data goes in parentheses
  at the end of the sentence — Korean particles change with the preceding
  syllable, so a sentence assembled from fragments cannot be translated.
- **Algorithms, metrics, and preprocessing steps are registry entries,** never an
  `if`/`elif` branch. A rule of the form "X only works with Y" belongs in X's
  registry entry, not in Y's screen.
- **Commits follow [Conventional Commits](https://www.conventionalcommits.org/)**
  (`feat:` `fix:` `docs:` `refactor:` `test:` `chore:`).

Fork the repository, work on a branch, and open the pull request against `main`.
Small pull requests get read; large ones wait.

## Licensing

### Your contribution

This project is [MIT](LICENSE). **By opening a pull request you confirm that your
contribution is offered under that same MIT license and that you have the right
to offer it.** There is no CLA and no sign-off bot — if your employer or school
owns what you write, sort that out before you send it.

### Adding a dependency

Every build regenerates `third-party-notices.txt` next to `index.html` by walking
the module graph that actually ended up in the output, so a new dependency's
notice follows it automatically and a dropped one disappears. Two things stop the
build on purpose:

1. **No license text found.** Put the upstream text in
   `frontend/scripts/licenses/` and register it in `SUPPLIED`
   (`frontend/scripts/notices.ts`). Shipping the code without its notice breaks
   the license.
2. **The SPDX id is not on the allowlist** — `MIT`, `ISC`, `Apache-2.0`,
   `BSD-2-Clause`, `OFL-1.1` today. The list is deliberately narrow: adding a
   line is cheap, and a green build nobody read is not. Read the actual license,
   add the id to `ALLOWED_SPDX`, and say in the pull request why it may ship
   inside an MIT-licensed build. Dual-license expressions such as
   `(MIT OR GPL-3.0-or-later)` stop here too — picking one is a decision, not a
   parse, and the decision belongs in the pull request.

If what you need is copyleft and it ships to the browser, please open an issue
before doing the work rather than after.

### Copying someone else's code into a file

Vendoring is the last resort, and the reason a dependency would not do has to be
in `docs/open-decisions.md` first. The file's header then carries three things:

1. **Where it came from** — repository, version, file.
2. **Its license.**
3. **Every change you made**, listed. Without that list nobody can diff against
   the original, and from that moment the code is neither theirs nor ours.

`frontend/src/ml/engines/svm-smo.ts` is the worked example.

### What no check can see

The build counts what ships and the tests guard the hand-written parts, but three
gaps are known and open, which is why the pull request template asks about them:

- **Whether a declared SPDX id matches the actual license text.** A
  `package.json` can say MIT over a LICENSE file that says something else.
- **Licenses inside a pre-built bundle.** `exceljs` carries 68 packages our
  module graph cannot see; that list was read by a person once, in August 2026,
  and goes stale when the package is upgraded.
- **The backend.** It is not redistributed today. The day there is a Docker
  image, the same obligations apply to it.

## Reporting a bug

Say which browser and device, and whether you saw it on a phone — several
failures here appear only off `localhost`, or only on iOS. Steps beat a
description.

**Please do not attach a `.mlpx` from a real class.** The file carries the actual
data a student uploaded. Rebuild the case with something you made up, or describe
the shape of the data instead.
