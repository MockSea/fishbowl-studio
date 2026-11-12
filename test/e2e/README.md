# Web build QA scripts

Playwright scripts that drive the studio's local web app in a headless Chrome, check its HTTP
front door, and run `/fishbowl` from Claude Code. They write the QA report in
`docs/qa/web-0.1.0/`. They have their own `package.json` so the app's dependencies stay as
they are.

## Run

```sh
npm ci                          # at the repo root
npm run build:standalone        # only for the standalone runs; needs Node with SEA enabled
cd test/e2e && npm ci
npm run qa                      # every run below, one at a time, then rebuilds index.html
```

| Script | What it runs |
| --- | --- |
| `npm run qa:source` | `walk.mjs source`: `node bin/fishbowl-studio.js` from this checkout |
| `npm run qa:npx` | `walk.mjs npx`: `npx --yes <QA_NPX_SPEC>` with a fresh npm cache |
| `npm run qa:standalone` | `walk.mjs standalone`: the binary in `dist/`, with no node on PATH |
| `npm run qa:launch` | `launch.mjs`: raw HTTP checks of the link, cookie, Host, Origin, API rules, headers, control route and bound address, from source and standalone |
| `npm run qa:plugin` | `plugin.mjs`: `claude -p "/studio:fishbowl" --plugin-dir <checkout>` with a stand-in `npx` |
| `node report.mjs` (with `STUDIO_E2E=1`) | rebuilds `index.html` only |

Settings:

- `QA_REAL_API=0` skips the one call to the real Anthropic API (made with a made-up key).
- `QA_REAL_CLAUDE=0` skips drafting through the installed Claude Code.
- `QA_NPX_SPEC` is what the npx run installs. The default is a pinned commit.
- `QA_STANDALONE` points at another binary, `QA_CHROME` at another Chrome, `QA_CLAUDE` at
  another `claude`, `QA_DOCS` at another report folder.

## What to know before editing

- Every entry script exits at once unless `STUDIO_E2E=1`. The repo's `npm test` loads every
  file under `test/`, including these. `playwright-core` is imported lazily for the same reason.
- Each run makes a fresh studio folder under the system temp folder and passes it with
  `--home`. The studio always starts with `--no-open`; the scripts open its link in their own
  browser context. The temp folder is taken by its real path: with npm 11, an npm cache reached
  through a symlink (macOS's `/var`) gives a GitHub install without its bundled dependencies.
- On macOS the studio keeps the API key in the login Keychain, one entry per app folder (the
  account ends in a hash of the folder's real path). The walk saves made-up keys for its two
  studio folders and deletes both entries at the end.
- No real key is needed. `api.mjs` starts `dev/mock-anthropic.mjs` (port 18797) for drafting, a
  refusing server for bad-key (18798) and rate-limit (18799) cases, and uses a closed port for
  no network.
- `fixtures.mjs` generates the brand kit files (good, too big, wrong type, broken, a zip bomb)
  at run time. Their text describes a fictional shop.
- `dropFiles` uses Chrome's drag events through CDP, so the page gets real File objects;
  `chooseFiles` answers the browser's file picker.
- `plugin.mjs` uses the installed Claude Code's own sign-in. The plugin is loaded with
  `--plugin-dir` for that one run, so nothing is installed. Print mode stays open while the
  studio it started runs, so the script ends the run 15 seconds after the reply arrives.
- Checks go to `shots/<run>-results.json`. The WS-102 recheck, bugs, notes and what was not
  tested are written by hand in `docs/qa/web-0.1.0/findings.json`; `report.mjs` joins the two.
