# Desktop app QA scripts

Playwright scripts that drive the Electron app end to end and write the QA report in
`docs/qa/electron-0.1.0/`. They have their own `package.json` so the app's dependencies stay
as they are.

## Run

```sh
npm ci && npm run make      # at the repo root; the built-app runs need dist/
cd test/e2e && npm ci
npm run qa                  # all three runs, then rebuilds index.html
```

| Script | What it runs |
| --- | --- |
| `npm run qa:source` | `walk.mjs source`: the app from the repo, like `npm run desktop` |
| `npm run qa:built` | `walk.mjs built`: the packaged binary in `dist/mac-<arch>/` with launchd's PATH, so no node |
| `npm run qa:finder` | `finder.mjs`: opens the `.app` through LaunchServices (`open -n --env ...`) and attaches over a debugging port |
| `node report.mjs` (with `STUDIO_E2E=1`) | rebuilds `index.html` only |

`QA_REAL_API=0` skips the one call to the real Anthropic API. `QA_APP` points at another
`.app`, `QA_OUT` at another screenshot folder.

## What to know before editing

- Every entry script exits at once unless `STUDIO_E2E=1`. The repo's `npm test` runs
  `node --test`, which loads every file under `test/`, including these.
  `playwright-core` is imported lazily for the same reason.
- Each run makes fresh data and app folders under the system temp folder and passes them as
  `STUDIO_HOME` and `STUDIO_APP_DIR`. Nothing touches `~/Documents/Fishbowl Studio`.
- No real key is needed. `api.mjs` starts `dev/mock-anthropic.mjs` for drafting, a refusing
  server for bad-key and rate-limit cases, and uses a closed port for no network.
- `fixtures.mjs` generates the brand kit files (good, too big, wrong type, broken, a zip bomb)
  at run time. Their text describes a fictional shop.
- `dropFiles` uses Chromium's drag events through CDP, so the page gets File objects with
  paths, the way a Finder drag delivers them.
- Checks go to `shots/<mode>-results.json`. Bugs, notes and what was not tested are written by
  hand in `docs/qa/electron-0.1.0/findings.json`; `report.mjs` joins the two.
