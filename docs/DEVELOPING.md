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

The repository holds two things: the **drafting core** (`core/`), a package with no server and no UI, and the **web app** (`bin/`, `server/`), which serves the board on 127.0.0.1 and imports the core. The web app reaches core modules as `#core/<file>.js`, a subpath import declared in the root `package.json` that maps to `core/lib/`. The core never imports from `server/`. [core/README.md](../core/README.md) lists what the core holds and how a host uses it.

| File | What it does |
| --- | --- |
| `core/lib/` | The studio itself: sources, triage, ranking, drafting briefs, voice and playbook, proposals, release batches, learning, the brand kit and Coach. [How it works](HOW-IT-WORKS.md) covers them. |
| `core/lib/runner.js` | The daily run, the rewrite queue, the setup drafts and the weekly report, under the per-run and per-day caps on drafting steps. |
| `core/lib/engines/` | Who answers a drafting step: `claude-cli.js` (`claude -p`), `api.js` (the Anthropic SDK) and `index.js`, which picks one. |
| `core/lib/brandkit.js`, `extract-child.js` | Brand kit files: limits, reading PDF and DOCX in a child process, and what goes with each step. |
| `core/lib/files.js` | Reads files shipped inside a package (the core's platforms, shapes, accounts and defaults; the web app's board). In the standalone build they come from the bundle instead of the disk. |
| `core/platforms/`, `core/shapes/`, `core/accounts/`, `core/defaults/` | Data: one file per platform, post shape and account type, and the default settings. |
| `core/test/` | The core's own tests. `cd core && npm test` runs only these; `npm test` at the root runs them with the web app's. |
| `bin/fishbowl-studio.js` | The command. Checks the Node version and the packages (stopping with a repair sentence when any are missing, see `heal.js`), then runs `server/cli.js`. With `--extract-child` it runs the brand kit reader instead (the standalone build starts itself that way). |
| `server/cli.js` | Options, the lock file a second copy reads, catching up missed release times on start, opening the browser, and the five-minute timer. |
| `server/lib/web.js` | The HTTP server: launch token, session cookie, Host and Origin checks, the JSON API, the event stream and kit uploads. Its header says what keeps other people and other pages out. |
| `server/lib/heal.js` | The checks and repairs a start makes. Packages are loaded in a separate Node process; when any are missing it stops with one sentence naming npm's copy of the app (`_npx/<hash>`) to delete, and never installs anything itself, so the only install is npx's own from the release's lock file. A check that doesn't finish cleanly counts as nothing missing. Our own stuck studio is stopped with SIGTERM then SIGKILL; ours means its whole command line is a studio's (`STUDIO_COMMAND`), it isn't this process or an ancestor (npx, the shell), and, for the pid in the lock file, its start time (`ps -o lstart`) is the one the lock recorded. The port holder (`lsof`) is checked the same way minus the start time. Built-in modules only. |
| `server/lib/control.js` | How a second copy of the command and the running studio prove to each other that they hold the lock file's control secret, without sending it. |
| `server/lib/host.js` | Everything the page can ask for, as plain functions over the core: studio tools, the engine, the key, the brand kit, preferences, the timer tick. |
| `server/lib/keystore.js` | The API key in the system's secret store (`security`, `secret-tool`, DPAPI through PowerShell) or a 0600 file. |
| `server/lib/files.js`, `page.js` | The web app's own files, and the board page assembled from them. |
| `server/ui/` | The board. `board-*.js` are the shared pages; `web-bridge.js` talks to the server and `web-pages.js` adds the Claude and Brand kit pages and the `BoardHooks` below. |
| `test/` | The web app's tests: the server, the command, the host, the engines against a fake `claude`, the board, the caps and the release pins. |
| `skills/fishbowl-studio/` | The skill for Claude (Cowork or Claude Code): it installs and starts this web app for the person. See [The skill](#the-skill). |

**Settings for development:**

| Variable | What it does |
| --- | --- |
| `STUDIO_HOME` | Studio folder when `--home` isn't given (default `~/Documents/Fishbowl Studio`). |
| `STUDIO_MODEL` | Model for drafting, for both engines. Without it the API engine uses `claude-opus-5-5` and Claude Code uses its own configured default. |
| `STUDIO_ANTHROPIC_BASE_URL` | Send API requests somewhere else, such as the local mock. |
| `ANTHROPIC_API_KEY` | Used when no key is saved. |

**Engines.** `engines/index.js` decides who answers: Claude Code when the `claude` command is on `PATH` (on Windows only `claude.exe` counts), otherwise the saved key. In Automatic, if `claude -p` can't start or can't finish a call (a `ModelError` of kind `cli`) and a key is saved, that call and later ones go to the API until the studio restarts or the engine or key changes, and the page is told once. An answer that isn't valid JSON or a refusal fails that step without switching. `claude-cli.js` is the only file that knows the `claude -p` call shape: no tools, no MCP servers, no setting sources (`--setting-sources ''`, so no settings files and no `CLAUDE.md` from any folder), no saved session, a new empty folder under the studio's `app/claude-runs/`, and the answer as structured output. `test/engines.test.js` runs that adapter against a fake `claude`.

**Drafting-step limits.** The caps count budgeted drafting steps: each `engine.ask()` the runner makes. `MAX_CALLS_PER_RUN` in `core/lib/runner.js` caps the steps in one run (40), `MAX_CALLS_PER_DAY` caps a day (150, kept in `app/usage.json`), and `MAX_CALLS_PER_TICK` in `server/lib/host.js` caps one timer tick across every brand. Both engines count against the same caps. One step can be more than one request underneath (SDK retries, several Claude Code turns, or a failed Claude Code attempt followed by the API), so these are not hard limits on requests or charges. A brief the model can't finish (refused, cut off, unreadable, or every take dropped after its redraft) is closed with `abandonBrief` and its story counts as used for the day. After a failed automatic daily run a brand waits an hour before the timer tries it again. The automatic weekly report is tried once per Friday, recorded in `app/weekly.json` whether it works or not, and its failure never holds back the daily run. `test/cost.test.js` holds these bounds.

**Reading brand kit files.** PDF and DOCX files are read in a child process (`isolatedExtract`) with a heap cap (through `NODE_OPTIONS`), a memory watchdog and a time limit. A DOCX that claims to unpack to more than `LIMITS.docx_unzipped_bytes` is refused before it is opened. Uploads arrive as raw bytes in a random temporary file; the person's file name is only ever shown.

**Hooks.** `web-pages.js` sets `window.BoardHooks` so shared pages fit the web app: `noPosting` (no Posting step or accounts), `noCoach` (no Coach page; the web app shows Coach, so it doesn't set this), `sourceKinds` (only sites and subreddits on the Sources page), `scheduleCard`, `settingsRail` and `finishBody`.

**Security tests.** `test/web.test.js` covers the server's rules (token, cookie, Host, Origin, methods, body types, uploads, the control proof), `test/cli.test.js` the command and its lock file (including a stale lock pointing at a listener that isn't the studio), `test/heal.test.js` the repairs on start (which processes may be stopped, and that other programs on the port are left alone), `test/keystore.test.js` each secret store.

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

The `npx` command in the README and in the skill (`skills/fishbowl-studio/SKILL.md`) names a release tag (`#v0.1.0`), so people run a tagged release, not whatever is on `main`. `test/release.test.js` fails when those commands don't match `package.json`'s version. The install-script URLs in the README and the skill name the same tag, and each install script's own default release (`release=` in `install.sh`, `$release` in `install.ps1`) is that tag too, so a script fetched from a tag installs that tag's build; the test checks those as well. To release: bump the version, update the commands, URLs and both scripts' `release` to the new tag, merge, then push the tag `v<version>`. Between the merge and the tag, the command points at a tag that doesn't exist yet. The release also carries `fishbowl-studio-skill.zip`, the skill folder zipped, for people to add to Claude.

An install from GitHub carries the versions in `package-lock.json`: `package.json` lists every runtime dependency under `bundleDependencies`, and the `prepare` script (it does nothing itself) makes npm install its clone from the lock file before packing it. npm ignores a lock file or `npm-shrinkwrap.json` in a package installed from git, so without this each person would get a fresh dependency tree.

## The skill

`skills/fishbowl-studio/SKILL.md` is for people who would rather have Claude (in Cowork or Claude Code) set the studio up than run a command. It tells Claude to check Node.js (or install the standalone build), pick a studio folder that lasts between sessions, run `npx --yes github:MockSea/fishbowl-studio#v0.2.0 --no-open --link-file --home <folder>` in the background, read the one-time link from the file `--link-file` names (readable only by this user, so the link stays out of the log), and hand it to the person. It never has Claude build an interface, call the studio's API, read the studio folder (beyond that link file) or open the link. `test/skill.test.js` checks its frontmatter and that every option it passes is one the command accepts.

To try it as Claude would on a fresh computer, run its steps with a new empty `HOME` and a new studio folder, using a local `npm pack` tarball in place of the GitHub address.

## The board

The board's look is one tokens file, `server/ui/skins/light.css`. A new skin is one more file beside it.

More: [How it works](HOW-IT-WORKS.md) (the pipeline, the ranking formula, how it learns).
