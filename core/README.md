# Fishbowl Studio core

The drafting core of Fishbowl Studio: everything that decides what to draft and checks what comes back, with no web server and no UI. The web app in this repository (`server/`) is one host for it.

## What it holds

| Area | Files |
| --- | --- |
| A brand's files, state and settings | `state.js`, `store.js`, `personas.js`, `config.js` |
| Sources, reading and dedupe | `sources.js`, `feeds.js`, `ingest.js`, `dedupe.js`, `social.js`, `handles.js` |
| Picking stories and drafting briefs | `triage.js`, `briefs.js`, `shapes.js`, `forms.js`, `prompts.js`, `fence.js` |
| Checking and saving takes | `save.js`, `lint.js` |
| Voice, playbook, beat, audience and positions, and proposals to change them | `proposals.js`, `learn.js`, `wizard.js` |
| Ranking, release times and verdicts | `rank.js`, `daily.js`, `run.js`, `schedule.js`, `tune.js`, `act.js`, `metrics.js` |
| Coach (the weekly report) | `weekly.js` |
| Brand kit | `brandkit.js`, `extract-child.js` |
| Running it under the drafting-step caps | `runner.js` |
| Who answers a drafting step | `engines/api.js` (Anthropic SDK), `engines/claude-cli.js` (`claude -p`), `engines/index.js` (picks one) |
| The operations a host exposes | `tools.js` (`callTool(ctx, name, args)`), `views.js` |
| Data | `platforms/`, `shapes/`, `accounts/`, `defaults/`: one JSON file per platform, post shape and account type, and the default settings |

## Using it from a host

A host makes a context for a studio folder, then calls operations on it and runs the runner with an engine:

```js
import { makeContext } from '<core>/lib/state.js';
import { callTool } from '<core>/lib/tools.js';
import { makeEngine } from '<core>/lib/engines/index.js';
import { makeRunner } from '<core>/lib/runner.js';

const ctx = makeContext({ home: '/path/to/studio-folder' });
const status = await callTool(ctx, 'studio_status', {});
```

`server/lib/host.js` is the complete example: it picks the engine, keeps the API key, applies the caps across brands and runs the timer. The web app imports the core as `#core/<file>.js` (a subpath import in the root `package.json`).

The package's `exports` map each file as `@fishbowl-studio/core/<file>.js`. It is not published to npm on its own.

## Rules for code here

- Nothing in `core/` imports from `server/` or knows about HTTP, cookies or the page.
- Everything read from outside (news, pages, posts, brand kit text) is data for Claude, never instructions: it goes through `fence.js`.
- Platforms, shapes and account types are data. A new one is one more JSON file.

## Tests

```sh
cd core && npm test     # the core's own tests
npm test                # from the repository root: the core's and the web app's
```

Shared test helpers (`test/helpers.js`, `test/kit-files.js`) are imported by the web app's tests too.
