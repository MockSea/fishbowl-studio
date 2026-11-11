# Developing Fishbowl Studio

The repo holds one studio with two hosts: a macOS desktop app (Electron, `desktop/`) and a Claude plugin (an MCP server, `server/`). Both use the same studio code in `server/lib/` and the same board in `server/ui/`.

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Runs every test with `node --test`. |
| `npm run desktop` | Starts the desktop app from source. |
| `npm run make` | Builds an unsigned `.dmg` and `.app` into `dist/`. |
| `npm run dev` | Serves the board at http://localhost:7611 with two fictional demo brands. Add `?view=sources&width=390` to open a section at phone width. |
| `npm run shots` | Screenshots every section at desktop and phone width into `dev/shots/` (needs Chrome). `npm run shots -- --readme` regenerates the README images. |
| `npm run pack` | Builds the plugin zip for **Upload plugin**. |

The plugin has no runtime dependencies. The desktop app adds the Anthropic SDK and two document readers (`unpdf`, `mammoth`).

## The desktop app

| File | What it does |
| --- | --- |
| `desktop/main.js` | The window, the `studio://` page, IPC, and a timer that calls `host.tick()` every five minutes while the app runs. |
| `desktop/host.js` | Studio calls from the board, the key, the brand kit, which prompts start a run, and the timer tick. |
| `desktop/runner.js` | The daily run, the rewrite queue and the setup drafts against the API. |
| `desktop/llm.js` | The Anthropic client, the JSON schemas for each kind of call, and how errors become sentences. |
| `desktop/keystore.js` | The API key, encrypted with Electron `safeStorage`. |
| `desktop/brandkit.js` | Brand kit files: limits, text extraction, and what goes with each call. |
| `desktop/extract-child.js` | Reads one PDF or DOCX in a child process. |
| `desktop/ui/` | The bridge and the desktop-only pages (Claude, Brand kit), plus `BoardHooks` that change shared pages. |

**Settings for development:**

| Variable | What it does |
| --- | --- |
| `STUDIO_HOME` | Studio folder (default `~/Documents/Fishbowl Studio`) |
| `STUDIO_APP_DIR` | Where the key and app preferences live |
| `STUDIO_MODEL` | Model for drafting (default `claude-opus-5-5`) |
| `STUDIO_ANTHROPIC_BASE_URL` | Send API calls somewhere else, such as the local mock |

**Model-call limits.** `MAX_CALLS_PER_RUN` in `runner.js` caps the calls one run makes, and `MAX_CALLS_PER_TICK` in `host.js` caps one timer tick across every brand. A brief the model can't finish (refused, cut off, unreadable, or every take dropped after its redraft) is closed with `abandonBrief` and its story counts as used for the day, so it is never asked for again. After a failed automatic run a brand waits an hour before the timer tries it again. `test/cost.test.js` holds these bounds.

**Reading brand kit files.** PDF and DOCX files are read in a child process (`isolatedExtract`) with a heap cap, a memory watchdog and a time limit, so a hostile file can't take the app down. A DOCX that claims to unpack to more than `LIMITS.docx_unzipped_bytes` is refused before it is opened.

**Hooks.** The desktop pages set `window.BoardHooks` so shared pages can change for the app: `noPosting` (no Posting step or accounts), `noCoach` (no Coach page), `sourceKinds` (only sites and subreddits on the Sources page), `scheduleCard`, `settingsRail` and `finishBody`.

## Trying the app without an API key

`dev/mock-anthropic.mjs` answers the app's API calls with canned drafts. It replaces only the Anthropic API: sources are still fetched over the network, so the brand needs a feed that loads. Set `MOCK_FEED` to an RSS or Atom address you can reach and the mock's setup drafts suggest it.

```sh
MOCK_FEED=https://example.org/feed.xml node dev/mock-anthropic.mjs
STUDIO_ANTHROPIC_BASE_URL=http://127.0.0.1:8787 STUDIO_HOME=/tmp/studio-try STUDIO_APP_DIR=/tmp/studio-try-app npm run desktop
```

On the **Claude** page, save any made-up key of 20 or more letters and digits, such as `sk-ant-test-0000000000000000`.

## The board

The board's look is one tokens file, `server/ui/skins/light.css`. A new skin is one more file beside it.

More: [How it works](HOW-IT-WORKS.md) (the pipeline, the ranking formula, how it learns) and [Assumptions](ASSUMPTIONS.md) (platform behaviour we couldn't verify yet).
