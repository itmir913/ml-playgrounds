# Machine Learning Playgrounds

[![CI](https://github.com/itmir913/ml-playgrounds/actions/workflows/ci.yml/badge.svg)](https://github.com/itmir913/ml-playgrounds/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/v/tag/itmir913/ml-playgrounds?sort=semver&label=version)](https://github.com/itmir913/ml-playgrounds/tags)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A machine learning tool for AI and computer science classes. Students bring a
CSV or a folder of images, train and compare models, write up what they found
in a portfolio, and hand in the whole project as one file. It runs in the
browser with no install and no sign-up, in English, Korean and Japanese.

**[Open the app](https://luminousky.com/ml-playgrounds/)** ·
[Homepage](https://luminousky.com/teacher-utility-kit/ml-playgrounds/)

![The Predicting step on the iris data set: four trained models answer the same input, three say Iris-virginica and one says Iris-versicolor](https://github.com/user-attachments/assets/af57695a-d6de-4d60-8285-5e3d85b35857)

## Why

- **Made for the classroom.** It runs on low-spec school PCs and on phones.
  Work is saved in the student's own browser, and a project file carries it
  from one lesson to the next when lab computers are reset.
- **One file is the whole submission.** An `.mlpx` file carries the data, the
  settings, the metrics, the trained models (within a size budget), and the
  student's portfolio. Teachers see the results without retraining.
- **Built for marking.** Open a folder of submissions at once, check whether a
  file was changed after it was saved, train again to see whether the scores
  reproduce, spot files copied from the same project, and download every
  portfolio together.
- **Student data stays on the student's machine.** Data is loaded,
  preprocessed, trained on, and scored in the browser, and the public site has
  no server to send it to. It does need a connection the first time
  scikit-learn or an image model is used, to download them.
- **Real scikit-learn, or plain JavaScript.** Train with scikit-learn running
  in the browser, or with a lighter JavaScript engine for slower devices, and
  compare them on the same screen.
- **Reproducible by default.** The random seed is stored with the project and
  reused, so a score that moves means a setting that moved.

## What you can do

|               |                                                             |
| ------------- | ----------------------------------------------------------- |
| Data          | Tables (`.csv`, `.xlsx`) and images                          |
| Tasks         | Classification, regression, clustering (images: classification and clustering) |
| Along the way | Inspect columns, handle missing values, scale and encode, split train/test, compare runs, predict on new input |
| Portfolio     | A write-up saved with the results in the same `.mlpx` file  |

## Development

Node.js 22.13 or newer, and [uv](https://docs.astral.sh/uv/). The gate also
checks the Python side, and uv fetches the Python it needs. Run everything from
`frontend/`, starting with `npm install`.

| Command         | What it does |
| --------------- | ------------ |
| `npm run dev`   | Starts the local server |
| `npm run ci`    | The full gate, exactly what CI runs: fetches the image backbone and Pyodide, then lint, types, tests, the scikit-learn fixtures, build, the locale contract, and the backend checks |
| `npm run build` | Produces the static site |
| `npm run lint`  | Rewrites what `ci` would flag. It can touch files you did not mean to change |

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

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the one command that is the
gate, and what a pull request has to be true about. That includes signing off
every commit and the licensing terms your contribution comes in under.

## License

[MIT](LICENSE)

This app ships third-party code, and their notices ship with it. Every build
writes `third-party-notices.txt` next to `index.html`, so any deployed copy
serves it alongside the app — for the official one, that is
<https://luminousky.com/ml-playgrounds/third-party-notices.txt>.

The build generates that file from the modules that actually ended up in the
output, and stops if it cannot find a license text for one of them. Nothing in
it applies to Machine Learning Playgrounds itself.
