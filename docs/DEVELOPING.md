# Developing Fishbowl Studio

The studio is one Node program: a local web server (`server/`) that serves the review board to the person's browser and runs the drafting pipeline in the same process. It has no native modules, so the same code runs on macOS, Windows and Linux, from `npx` or as a standalone executable.

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Runs every test with `node --test`. |
| `npm start -- --home <folder>` | Starts the studio from source with its files in that folder. Same options as the published command. |
| `npm run seed` | Writes two fictional demo brands into `dev/.demo-home/`. Then `npm start -- --home dev/.demo-home` opens them. |
| `npm run shots` | Screenshots every section at desktop and phone width into `dev/shots/` (needs Chrome). `npm run shots -- --readme` regenerates the README images. |
| `npm run build:standalone` | Builds the standalone executable for this computer into `dist/`. See [Standalone builds](#standalone-builds). |

Use `--home` while developing, so nothing touches your real `Documents/Fishbowl Studio`.

## How it fits together

| File | What it does |
| --- | --- |
| `bin/fishbowl-studio.js` | The command. Checks the Node version, then runs `server/cli.js`. With `--extract-child` it runs the brand kit reader instead (the standalone build starts itself that way). |
| `server/cli.js` | Options, the lock file a second copy reads, catching up missed release times on start, opening the browser, and the five-minute timer. |
| `server/lib/web.js` | The HTTP server: launch token, session cookie, Host and Origin checks, the JSON API, the event stream and kit uploads. Its header says what keeps other people and other pages out. |
| `server/lib/control.js` | How a second copy of the command and the running studio prove to each other that they hold the lock file's control secret, without sending it. |
| `server/lib/host.js` | Everything the page can ask for, as plain functions: studio tools, the engine, the key, the brand kit, preferences, the timer tick. |
| `server/lib/runner.js` | The daily run, the rewrite queue and the setup drafts, under the per-run and per-day caps on drafting steps. |
| `server/lib/engines/` | Who answers a drafting step: `claude-cli.js` (`claude -p`), `api.js` (the Anthropic SDK) and `index.js`, which picks one. |
| `server/lib/keystore.js` | The API key in the system's secret store (`security`, `secret-tool`, DPAPI through PowerShell) or a 0600 file. |
| `server/lib/brandkit.js`, `extract-child.js` | Brand kit files: limits, reading PDF and DOCX in a child process, and what goes with each step. |
| `server/lib/files.js` | Reads the studio's own files (board, platforms, defaults). In the standalone build they come from the bundle instead of the disk. |
| `server/lib/` (the rest) | The studio itself: sources, triage, ranking, drafting briefs, release batches, learning. [How it works](HOW-IT-WORKS.md) covers them. |
| `server/ui/` | The board. `board-*.js` are the shared pages; `web-bridge.js` talks to the server and `web-pages.js` adds the Claude and Brand kit pages and the `BoardHooks` below. |
| `commands/fishbowl.md`, `.claude-plugin/` | The Claude Code plugin: one command that runs `npx github:MockSea/fishbowl-studio#v0.1.0`. |

**Settings for development:**

| Variable | What it does |
| --- | --- |
| `STUDIO_HOME` | Studio folder when `--home` isn't given (default `~/Documents/Fishbowl Studio`). |
| `STUDIO_MODEL` | Model for drafting, for both engines. Without it the API engine uses `claude-opus-5-5` and Claude Code uses its own configured default. |
| `STUDIO_ANTHROPIC_BASE_URL` | Send API requests somewhere else, such as the local mock. |
| `ANTHROPIC_API_KEY` | Used when no key is saved. |

**Engines.** `engines/index.js` decides who answers: Claude Code when the `claude` command is on `PATH` (on Windows only `claude.exe` counts), otherwise the saved key. In Automatic, if `claude -p` can't start or can't finish a call (a `ModelError` of kind `cli`) and a key is saved, that call and later ones go to the API until the studio restarts or the engine or key changes, and the page is told once. An answer that isn't valid JSON or a refusal fails that step without switching. `claude-cli.js` is the only file that knows the `claude -p` call shape: no tools, no MCP servers, no setting sources (`--setting-sources ''`, so no settings files and no `CLAUDE.md` from any folder), no saved session, a new empty folder under the studio's `app/claude-runs/`, and the answer as structured output. `test/engines.test.js` runs that adapter against a fake `claude`.

**Drafting-step limits.** The caps count budgeted drafting steps: each `engine.ask()` the runner makes. `MAX_CALLS_PER_RUN` in `runner.js` caps the steps in one run (40), `MAX_CALLS_PER_DAY` caps a day (150, kept in `app/usage.json`), and `MAX_CALLS_PER_TICK` in `host.js` caps one timer tick across every brand. Both engines count against the same caps. One step can be more than one request underneath (SDK retries, several Claude Code turns, or a failed Claude Code attempt followed by the API), so these are not hard limits on requests or charges. A brief the model can't finish (refused, cut off, unreadable, or every take dropped after its redraft) is closed with `abandonBrief` and its story counts as used for the day. After a failed automatic daily run a brand waits an hour before the timer tries it again. The automatic weekly report is tried once per Friday, recorded in `app/weekly.json` whether it works or not, and its failure never holds back the daily run. `test/cost.test.js` holds these bounds.

**Reading brand kit files.** PDF and DOCX files are read in a child process (`isolatedExtract`) with a heap cap (through `NODE_OPTIONS`), a memory watchdog and a time limit. A DOCX that claims to unpack to more than `LIMITS.docx_unzipped_bytes` is refused before it is opened. Uploads arrive as raw bytes in a random temporary file; the person's file name is only ever shown.

**Hooks.** `web-pages.js` sets `window.BoardHooks` so shared pages fit the web app: `noPosting` (no Posting step or accounts), `noCoach` (no Coach page; the web app shows Coach, so it doesn't set this), `sourceKinds` (only sites and subreddits on the Sources page), `scheduleCard`, `settingsRail` and `finishBody`.

**Security tests.** `test/web.test.js` covers the server's rules (token, cookie, Host, Origin, methods, body types, uploads, the control proof), `test/cli.test.js` the command and its lock file (including a stale lock pointing at a listener that isn't the studio), `test/keystore.test.js` each secret store.

## Trying it without Claude

`dev/mock-anthropic.mjs` answers API calls with canned drafts. It replaces only the Anthropic API: sources are still fetched over the network, so the brand needs a feed that loads. Set `MOCK_FEED` to an RSS or Atom address you can reach and the mock's setup drafts suggest it.

The mock keeps running, so it needs a terminal of its own.

```sh
# Terminal 1: the mock
MOCK_FEED=https://example.org/feed.xml node dev/mock-anthropic.mjs
```

```sh
# Terminal 2: the studio, pointed at the mock
STUDIO_ANTHROPIC_BASE_URL=http://127.0.0.1:8787 node bin/fishbowl-studio.js --home /tmp/studio-try
```

On the Claude page, choose **API key** as the engine (so a `claude` command on this computer isn't used), then save any made-up key of 20 or more letters and digits, such as `sk-ant-test-0000000000000000`.

## Standalone builds

`scripts/build-standalone.mjs` bundles the studio and its own files into one script with esbuild and builds a [single executable application](https://nodejs.org/api/single-executable-applications.html) from it with `node --build-sea`. It needs Node 25.5 or later, and an official Node build: Homebrew's `node` is built without single executable support and stops with "Single executable application is disabled." Each build is for the system it runs on.

`.github/workflows/release.yml` runs the tests, builds on macOS (arm64 and x64), Windows and Linux, starts each build and checks it answers, and on a `v*` tag publishes them with `SHA256SUMS`. A tag must match `package.json`'s version, or the workflow stops. `scripts/install.sh` and `scripts/install.ps1` download a release build, check it against `SHA256SUMS` and start it.

## Releasing

The `npx` command in the README and in `commands/fishbowl.md` names a release tag (`#v0.1.0`), so people run a tagged release, not whatever is on `main`. `test/release.test.js` fails when those commands don't match `package.json`'s version. To release: bump the version, update the commands to the new tag, merge, then push the tag `v<version>`. Between the merge and the tag, the command points at a tag that doesn't exist yet.

An install from GitHub carries the versions in `package-lock.json`: `package.json` lists every runtime dependency under `bundleDependencies`, and the `prepare` script (it does nothing itself) makes npm install its clone from the lock file before packing it. npm ignores a lock file or `npm-shrinkwrap.json` in a package installed from git, so without this each person would get a fresh dependency tree.

## The board

The board's look is one tokens file, `server/ui/skins/light.css`. A new skin is one more file beside it.

More: [How it works](HOW-IT-WORKS.md) (the pipeline, the ranking formula, how it learns).
