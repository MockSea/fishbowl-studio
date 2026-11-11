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
| `server/lib/web.js` | The HTTP server: launch token, session cookie, Host and Origin checks, the JSON API, the event stream and kit uploads. Its header lists every rule. |
| `server/lib/host.js` | Everything the page can ask for, as plain functions: studio tools, the engine, the key, the brand kit, preferences, the timer tick. |
| `server/lib/runner.js` | The daily run, the rewrite queue and the setup drafts, under the per-run and per-day call caps. |
| `server/lib/engines/` | Who answers a model call: `claude-cli.js` (`claude -p`), `api.js` (the Anthropic SDK) and `index.js`, which picks one. |
| `server/lib/keystore.js` | The API key in the system's secret store (`security`, `secret-tool`, DPAPI through PowerShell) or a 0600 file. |
| `server/lib/brandkit.js`, `extract-child.js` | Brand kit files: limits, reading PDF and DOCX in a child process, and what goes with each call. |
| `server/lib/files.js` | Reads the studio's own files (board, platforms, defaults). In the standalone build they come from the bundle instead of the disk. |
| `server/lib/` (the rest) | The studio itself: sources, triage, ranking, drafting briefs, release batches, learning. [How it works](HOW-IT-WORKS.md) covers them. |
| `server/ui/` | The board. `board-*.js` are the shared pages; `web-bridge.js` talks to the server and `web-pages.js` adds the Claude and Brand kit pages and the `BoardHooks` below. |
| `commands/fishbowl.md`, `.claude-plugin/` | The Claude Code plugin: one command that runs `npx github:MockSea/fishbowl-studio`. |

**Settings for development:**

| Variable | What it does |
| --- | --- |
| `STUDIO_HOME` | Studio folder when `--home` isn't given (default `~/Documents/Fishbowl Studio`). |
| `STUDIO_MODEL` | Model for drafting (default `claude-opus-5-5`), for both engines. |
| `STUDIO_ANTHROPIC_BASE_URL` | Send API calls somewhere else, such as the local mock. |
| `ANTHROPIC_API_KEY` | Used when no key is saved. |

**Engines.** `engines/index.js` decides who answers: Claude Code when the `claude` command is on `PATH` (on Windows only `claude.exe` counts), otherwise the saved key. In Automatic, a failed `claude -p` call with a key saved moves that call and the rest of the session to the API, and the page is told once. `claude-cli.js` is the only file that knows the `claude -p` call shape: no tools, no MCP servers, no saved session, an empty temporary folder, and the answer as structured output. `test/engines.test.js` runs that adapter against a fake `claude`.

**Model-call limits.** `MAX_CALLS_PER_RUN` in `runner.js` caps the calls one run makes, `MAX_CALLS_PER_DAY` caps a day (kept in `app/usage.json`), and `MAX_CALLS_PER_TICK` in `host.js` caps one timer tick across every brand. Both engines count against the same caps. A brief the model can't finish (refused, cut off, unreadable, or every take dropped after its redraft) is closed with `abandonBrief` and its story counts as used for the day. After a failed automatic run a brand waits an hour before the timer tries it again. `test/cost.test.js` holds these bounds.

**Reading brand kit files.** PDF and DOCX files are read in a child process (`isolatedExtract`) with a heap cap (through `NODE_OPTIONS`), a memory watchdog and a time limit. A DOCX that claims to unpack to more than `LIMITS.docx_unzipped_bytes` is refused before it is opened. Uploads arrive as raw bytes in a random temporary file; the person's file name is only ever shown.

**Hooks.** `web-pages.js` sets `window.BoardHooks` so shared pages fit the web app: `noPosting` (no Posting step or accounts), `noCoach` (no Coach page), `sourceKinds` (only sites and subreddits on the Sources page), `scheduleCard`, `settingsRail` and `finishBody`.

**Security tests.** `test/web.test.js` covers the server's rules (token, cookie, Host, Origin, methods, body types, uploads), `test/cli.test.js` the command and its lock file, `test/keystore.test.js` each secret store.

## Trying it without Claude

`dev/mock-anthropic.mjs` answers API calls with canned drafts. It replaces only the Anthropic API: sources are still fetched over the network, so the brand needs a feed that loads. Set `MOCK_FEED` to an RSS or Atom address you can reach and the mock's setup drafts suggest it.

```sh
MOCK_FEED=https://example.org/feed.xml node dev/mock-anthropic.mjs
STUDIO_ANTHROPIC_BASE_URL=http://127.0.0.1:8787 PATH=/usr/bin:/bin node bin/fishbowl-studio.js --home /tmp/studio-try
```

The narrow `PATH` keeps `claude` out of reach so the API engine is used. Start Node by its full path if it isn't in `/usr/bin`. On the Claude page, save any made-up key of 20 or more letters and digits, such as `sk-ant-test-0000000000000000`.

## Standalone builds

`scripts/build-standalone.mjs` bundles the studio and its own files into one script with esbuild and builds a [single executable application](https://nodejs.org/api/single-executable-applications.html) from it with `node --build-sea`. It needs Node 25.5 or later, and an official Node build: Homebrew's `node` is built without single executable support and stops with "Single executable application is disabled." Each build is for the system it runs on.

`.github/workflows/release.yml` runs the tests, builds on macOS (arm64 and x64), Windows and Linux, starts each build and checks it answers, and on a `v*` tag publishes them with `SHA256SUMS`. `scripts/install.sh` and `scripts/install.ps1` download a release build, check it against `SHA256SUMS` and start it.

## The board

The board's look is one tokens file, `server/ui/skins/light.css`. A new skin is one more file beside it.

More: [How it works](HOW-IT-WORKS.md) (the pipeline, the ranking formula, how it learns).
