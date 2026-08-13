# ML Playgrounds

Train machine learning models in your browser. Bring a CSV or a folder of
images, pick an algorithm, and read the results — no install, no sign-up, and
nothing uploaded anywhere.

## Why

- **Everything runs in the browser.** Your data is loaded, preprocessed,
  trained on, and scored on your own machine. There is no server to send it to.
- **One file is the whole project.** An `.mlpx` file carries the data, the
  settings, the trained models, the metrics, and your write-up. Reopen it later
  — or hand it to someone else — and everything is there without retraining.
- **Two engines, same screen.** Models train in pure JavaScript or in real
  scikit-learn compiled to WebAssembly, so you can compare them side by side.
- **Reproducible by default.** The random seed is stored with the project and
  reused, so a score that moves means a setting that moved.

## What you can do

|            |                                                             |
| ---------- | ----------------------------------------------------------- |
| Data       | Tables (`.csv`, `.xlsx`) and images                          |
| Tasks      | Classification, regression, clustering                       |
| Along the way | Inspect columns, handle missing values, scale and encode, split train/test, compare runs, predict on new input |

## Development

Node.js 22.13 or newer. Everything happens in `frontend/`.

```bash
npm install
```

Three commands, and that is all there is:

```bash
npm run dev
```

```bash
npm run ci
```

```bash
npm run build
```

`dev` starts the local server, `ci` is the full gate (lint, types, tests,
build) and is exactly what CI runs, and `build` produces the static site.

## Layout

```
frontend/   The app. Vue 3 + TypeScript + Vite
backend/    Optional self-hosted compute. Nothing works differently without it
docs/       Design documents and decisions
scripts/    Checks that span both sides
```

## Documentation

Design notes live in [docs/](docs/) and are written in Korean.
[CLAUDE.md](CLAUDE.md) states the principles this repository refuses to break.

## License

[MIT](LICENSE)
