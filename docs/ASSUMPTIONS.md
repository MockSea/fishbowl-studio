# Platform assumptions

Fishbowl Studio was built against a written reference of the MCP, MCP Apps and Cowork plugin formats, not against a running Claude. These are the places where that reference was unverified, or where we had to guess. Each says what we built and what to check first if something misbehaves.

## Packaging and install

1. **Plugin at the repository root, marketplace pointing at `./`.** The reference shows plugins in a `plugins/<name>/` folder. We keep one plugin at the root with `"source": "./"` in `.claude-plugin/marketplace.json`, next to `plugin.json`. *If "Add marketplace" fails:* move the plugin into `plugins/studio/` and point `source` there.
2. **The MCP server is declared inline in `plugin.json` (`mcpServers`), not in a root `.mcp.json`.** Both forms are documented for Claude Code plugins; the inline form was used because of how this repository was built. *If the server doesn't start:* add a root `.mcp.json` with the same `mcpServers` block and remove it from `plugin.json` (keep one, not both).
3. **`"command": "node"` resolves to a working Node.js 20+.** Unverified whether Cowork uses the Node bundled with Claude Desktop or needs a system `node` on the app's PATH (GUI apps on macOS often miss Homebrew and nvm paths). *If the tools never appear:* install Node.js from the official installer (which puts `node` in `/usr/local/bin`), or package the server as an `.mcpb` bundle, which ships Node.
4. **`${CLAUDE_PLUGIN_ROOT}` is substituted in `args`.** Documented for Desktop org plugins. We do **not** use `${CLAUDE_PLUGIN_DATA}` (unverified in Cowork): the data folder defaults to `~/Documents/Fishbowl Studio`, overridable with `STUDIO_HOME`.
5. **The plugin name `studio` gives commands like `/studio:setup`.** Commands are namespaced by plugin name. The name is generic; if it collides with another plugin, rename it (and update the docs) before the first public release, since renaming later breaks installs.
6. **Upload plugin accepts a zip whose root contains `.claude-plugin/`.** `npm run pack` writes `dist/fishbowl-studio.zip` that way. If upload wants a top-level folder, zip the folder instead.
7. **Skill frontmatter uses only `name` and `description`**, and skill folder names match `name`, per the reference's warning that other keys are hard errors outside Claude Code.
8. **Tool names inside Cowork** may carry a prefix (Claude Code uses `mcp__plugin_<plugin>_<server>__<tool>`). Skills refer to tools by their bare `studio_*` names and say a prefix may appear.

## Protocol

9. **Legacy MCP handshake.** The server speaks the `2025-11-25` `initialize` handshake (it echoes 2025-06-18, 2025-03-26 and 2024-11-05 too) and answers `server/discover` and other unknown methods with `-32601`, so a dual-era host falls back to `initialize`. Unverified which era Cowork uses for stdio servers.
10. **`ping`** returns `{}`; **`resources/templates/list`** returns an empty list. Both standard, neither confirmed against Claude.
11. **Non-UI tools return text only**, no `structuredContent`, because some hosts pass the structured JSON to the model instead of the text. The board tools (`studio_board`, `studio_view`, `studio_act`, `studio_proposals`, `studio_proposal_decide`) return both, and their structured content is readable by a model, so item text in it is cleaned to one line but is not fenced.
12. **The host enforces `visibility: ["app"]`.** `studio_proposal_decide` (accept/reject) is marked app-only so only her clicks on the board reach it. The server can't tell who called a tool; if a host lists app-only tools to the model anyway, the model could accept its own proposals. Unverified for Cowork.

## The board (MCP App)

12. **Bridge shape.** The board uses raw JSON-RPC over `window.parent.postMessage` with the SDK's `ui/initialize` shape (`appInfo`, `appCapabilities`, `protocolVersion: "2026-01-26"`). Rebuilt from field names in the ext-apps source, not observed traffic. Unverified whether mobile WebViews need a different transport.
13. **`ui/notifications/tool-input` is never relied on** (reported missing in Cowork). The board waits 0.8 s for `tool-result`, then loads its own data with `studio_view`.
14. **Resource metadata**: `prefersBorder: false`, `csp.resourceDomains: ["https://assets.claude.ai"]` (for host fonts), `permissions.clipboardWrite: {}`, and no `domain` (stdio servers must not set one). Unverified that `clipboardWrite` is honoured. The Copy button falls back to `document.execCommand('copy')`, and if both fail it asks her to select and copy by hand.
15. **`ui/message`** (the "Ask Claude now" buttons) is assumed to post a user message into the chat. If the host refuses, the board shows the exact words to type instead.
16. **`ui/open-link`** opens the story; local servers always get a confirmation prompt. If refused, the board shows the URL.
17. **Every tool call mounts a new board.** Older boards listen on a `BroadcastChannel` and show "a newer board is open" when a newer one announces itself. If `BroadcastChannel` isn't available in the sandbox, old boards stay live; fingerprints still stop them overwriting newer text.
18. **No board in some surfaces.** MCP App panels reportedly don't mount in mobile Cowork or in cloud-run sessions. Every board action is also a model-visible tool, and `studio_board` returns a text list, so the `review` skill works in chat.
19. **HTML size.** The assembled board is about 40 KB; no size limit was found in the reference.

## Scheduling and runtime

20. **Cowork scheduled tasks.** The reference doesn't cover scheduled tasks. The setup command gives best-effort click-by-click steps ("Scheduled → New task, weekdays, 7:00, prompt, folder"). The exact labels may differ. A plugin can't create schedules itself.
21. **The scheduled task can use the plugin's tools and skills.** Assumed, since the task runs a normal Cowork session with the folder attached.
22. **Releases happen lazily.** Batches release whenever any studio tool is called after a release hour (opening the board, the status check, the scheduled run). If nothing touches the studio all afternoon, the 12:00 and 16:00 batches release together the next time she looks. This matches the original's "missed batches run as one".
23. **Local time.** Release hours use the computer's local time zone.
24. **One writer at a time.** If the scheduled run and an open board act at the same moment, a lock in `state/.lock` serialises them (stale locks older than 30 s are broken).
25. **Network.** Only `studio_fetch` and `studio_wander` make network calls (built-in `fetch`, 15 s timeout, 3 MB cap, HTTPS only). Nothing else leaves the machine.
