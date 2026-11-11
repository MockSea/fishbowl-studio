# Fishbowl Studio

**Your brand's posts, drafted every morning in your brand's voice. You just pick the good ones.**

Fishbowl Studio is for the person who writes a brand's LinkedIn, X, Threads and Bluesky posts. Every weekday it reads the news on your beat and the places your audience actually talks, drafts a few takes on each story worth talking about, and lays them out on a review board inside Claude. You approve the good ones, fix the nearly-good ones and skip the rest. It learns from every one of those, so it writes more like you the longer you use it.

It comes two ways: a desktop app for macOS that drafts through your own Anthropic API key, or a plugin inside the Claude desktop app. Nothing to host, no account to create.

> [!WARNING]
> **Early alpha (v0.0.1).** This is the first public build and it hasn't been tested much on real Cowork installs yet. Expect rough edges, keep **Post for me** off while you try it, and please [open an issue](https://github.com/MockSea/fishbowl-studio/issues) when something breaks.

<p align="center">
  <img src="docs/screenshots/drafts.png" alt="The Drafts page: a feed of post drafts for a bicycle shop, with today's counts and a list of brands on the right" width="100%">
</p>

> **The desktop app needs** an Anthropic API key. **The plugin needs** the Claude desktop app, a paid Claude plan that includes **Cowork**, and Node.js. See [the desktop app](#the-desktop-app) or [install the plugin](#install-the-plugin).

## Your drafts, like a feed

Each draft looks like the post it'll become: your brand's name, the text, a character count, and **Approve**, **Edit**, **Skip** or **Rewrite** (leave a note like "too preachy" and Claude has another go). The story it's about sits underneath, and **Why it wrote this** shows the reasoning.

## Three takes, pick one

<p align="center">
  <img src="docs/screenshots/pick-one.png" alt="Three takes on the same news story, with the first marked Best bet" width="100%">
</p>

For a story worth it, Claude writes a few takes built different ways: one leads with the concrete detail, one asks the question the story raises, one says plainly what the brand thinks. **Best bet** marks its favourite. Not feeling any of them? **None of these** and it tries again.

## Set up a brand in five minutes

<p align="center">
  <img src="docs/screenshots/wizard.png" alt="The setup wizard, showing Claude's suggested voice and topics for a bakery, each with Keep and Drop buttons" width="100%">
</p>

Give it the brand's name and answer four short questions (who it's for, how it should sound, what it talks about, what's off limits). Claude drafts a voice, topics and starter sources, and you keep or drop each line. Write for more than one brand? Each gets its own studio, and the switcher at the top of the sidebar moves between them.

## You choose what it reads

<p align="center">
  <img src="docs/screenshots/sources.png" alt="The Sources page: news sites, a subreddit, watched X and LinkedIn accounts and saved searches, each with an on/off switch and a record like 4 of 5 approved" width="100%">
</p>

News sites, subreddits, X and LinkedIn accounts to watch, X trends and saved searches like "bike commuting". Each source keeps a record ("4 of 5 approved"), so you can see which ones earn their place. Claude can suggest new ones, but nothing gets read until you tap **Add**. Got one article you love? **Draft from a link**.

## It learns what you like

<p align="center">
  <img src="docs/screenshots/topics.png" alt="The Topics page: topics set to Less, Normal or More, and what it has learned from your approvals with the reason for each" width="100%">
</p>

Turn topics up or down. Underneath, it shows what it has picked up from your approvals, skips and edits, and always says why ("you approved 0 of 6 posts about policy in the last 3 weeks").

## A coach every Friday

<p align="center">
  <img src="docs/screenshots/coach.png" alt="The Coach page: a weekly report with what's working, what isn't, things to try, and suggested changes to accept or reject" width="100%">
</p>

A short weekly report per brand: what's working, what isn't, two or three things to try. It also suggests changes to your voice, each with its reason ("you cut the opening question 7 of 9 times"). Nothing about your voice changes until you tap **Accept**.

## Approved, then posted

<p align="center">
  <img src="docs/screenshots/approved.png" alt="The Approved tab: each approved post with a copy button and what happens next" width="100%">
</p>

Copy an approved post and post it yourself. Or turn on **Post for me** for an account, and Claude posts what you approved at the next release time, in your own signed-in browser. If your laptop was asleep, the board tells you the slot was missed. It never posts late or retries on its own.

<p align="center">
  <img src="docs/screenshots/accounts.png" alt="The Accounts section in Settings: X, LinkedIn, Threads, Bluesky and Reddit, each with Add account and a Post for me switch" width="100%">
</p>

**Post for me** is off for every account until you switch it on, and switching it on shows a plain warning first: automated posting breaks LinkedIn's and X's rules and can get an account restricted. Your call, and you can turn it off any time.

## On your phone too

<p align="center">
  <img src="docs/screenshots/phone-drafts.png" alt="The Drafts page at phone width" width="300">
  &nbsp;&nbsp;
  <img src="docs/screenshots/phone-menu.png" alt="The menu open at phone width, listing Drafts, Sources, Topics, Schedule, Settings, Reads, Coach and Playbook" width="300">
</p>

In a narrow Claude window the sidebar shrinks to icons, and on a phone it becomes a menu. If the board can't show at all, say "review my drafts" and do it in chat: *"pass 1a, kill 2, edit 3: …"*.

## Your day with it

- **7:00.** It reads your sources, drops duplicates (the same story from five outlets counts once) and drafts takes on the stories worth it.
- **8:00, 12:00, 16:00, 20:00.** A few drafts land on your board, up to ten a day, best first. Yesterday's news is cleared away.
- **Whenever.** Open the board, pick, tweak, approve.
- **Fridays.** Your coach report.

You can change all of those times on the **Schedule** page, down to reading the news every hour.

## The desktop app

The desktop app runs the same board in its own window, with the studio in-process. It drafts with Claude through the Anthropic API, so usage is billed to your API account.

**Run it from source** (macOS, Node.js 20 or later):

```sh
npm install
npm run desktop
```

**Build an app** with `npm run make`. It writes an unsigned `.dmg` and `.app` to `dist/`. macOS blocks unsigned apps on first open: Control-click the app, choose **Open**, then **Open** again.

**First run.** The app opens on the **Claude** page. Paste an API key from the Anthropic Console. It's encrypted with the macOS keychain (Electron `safeStorage`) and kept in the app's own folder, `~/Library/Application Support/Fishbowl Studio`, never in plain text. Then set up a brand and add a source, as in the plugin.

**Brand kit.** Each brand has a **Brand kit** page. Drop in brand guidelines, a tone-of-voice doc, a logo or on-brand images:

- PDF, Word (.docx), Markdown and plain text are read as text. Scanned PDFs have no text; add those pages as images.
- PNG and JPG are sent as images.
- Up to 10 MB a file (5 MB for images) and 20 files a brand. Long documents are cut to their first part, and the page says so.

Files are copied into the brand's `brand-kit/` folder. The page shows what was read from each one, and **Remove** deletes the copy. Every drafting request includes the kit, marked as reference material and never as instructions.

**Running on its own.** Batches are released at your Schedule times while the app is open; a batch missed while it was closed comes out the next time you open it. Reading the news and drafting by itself is off until you turn on **Run on its own** (Schedule page or the end of setup), because each run uses your API key. **Run it now** works any time.

**What's plugin-only.** Reading X and LinkedIn pages, learning your voice from old posts, the nightly explorations, Cowork scheduled tasks and posting for you all need Claude's browser and tools, so the desktop app leaves them out. You copy an approved draft and post it yourself.

**Settings for trying it out:**

| Variable | What it does |
| --- | --- |
| `STUDIO_HOME` | Studio folder (default `~/Documents/Fishbowl Studio`) |
| `STUDIO_APP_DIR` | Where the key and app preferences live |
| `STUDIO_MODEL` | Model for drafting (default `claude-opus-5-5`) |
| `STUDIO_ANTHROPIC_BASE_URL` | Send API calls somewhere else, such as the local mock |

To try the app without an API key, run the mock in one terminal and the app in another, then save any made-up key of 20 or more letters and digits, such as `sk-ant-test-0000000000000000`:

```sh
node dev/mock-anthropic.mjs
STUDIO_ANTHROPIC_BASE_URL=http://127.0.0.1:8787 STUDIO_HOME=/tmp/studio-try STUDIO_APP_DIR=/tmp/studio-try-app npm run desktop
```

## Install the plugin

1. In the Claude desktop app, open **Customize → Plugins**.
2. Click **Add marketplace** and enter `MockSea/fishbowl-studio`.
3. Install **Fishbowl Studio**.
4. Start a Cowork session and type **/studio:setup**. The setup wizard opens, and at the end one click asks Claude to run it every weekday.

You'll also need **Node.js**, the free LTS installer from [nodejs.org](https://nodejs.org). If it's missing, Claude tells you that one fix instead of showing an error.

Everything it keeps lives in one folder you can open: **Documents → Fishbowl Studio**.

## What it will never do

- **Post without your OK.** Only drafts you approved on the board, exactly as approved, and only on accounts where you turned **Post for me** on. Approving in chat never posts.
- **Read your messages, DMs or inbox.** It reads only the sources you added, and it looks at X and LinkedIn pages logged out. What it reads is treated as text to react to, never as instructions, and it never adds a source by itself.
- **Log in anywhere or keep passwords.** Connecting an account means Claude walks you through signing in yourself. The studio stores no password, token or cookie.
- **Send your stuff anywhere.** No analytics, no tracking, no servers of ours. Your drafts, notes and numbers stay in your Documents folder.
- **Change your voice behind your back.** It suggests; you accept.
- **Name private people.** A draft that names someone who isn't in the story goes back for a rewrite.
- **Make memes or images.** Words only.

<details>
<summary><b>Handy things to say</b></summary>

- "Show my studio board" · "Review my drafts" · "Do my rewrites"
- "Run the studio now" (`/studio:run`)
- "Add this feed: …", "Watch @… on X", "Save a search for …" (`/studio:add-source`; Claude suggests it, you tap Add)
- "Draft a post from this link: …"
- "Set up another brand" (`/studio:setup`) · "Switch to my other brand"
- "Learn my voice from these posts" (`/studio:voice`)
- "Write three evergreen posts" · "Weekly report"
- "Import these numbers" (attach the CSV export from LinkedIn or X analytics)
- "Post my approved posts now" (only what's due, on accounts where Post for me is on)

</details>

<details>
<summary><b>How it runs on its own</b></summary>

A plugin can't start itself: Claude runs it from a scheduled task in Cowork. **Set it up for me** (at the end of setup, or on the Schedule page) asks Claude to create it, and you approve it once. The Schedule page also shows exactly what to type if you'd rather do it by hand. If Post for me is on anywhere, a second task posts a few minutes after each release time.

Your computer has to be awake with Claude open for either to run. If Claude runs more often than your setting (say the task runs hourly and you chose "every 3 hours"), the studio skips reading the news that time and just releases what's due. One task runs all your brands.

Each brand has its own folder inside **Documents → Fishbowl Studio → personas**. If you used an earlier version, your studio moves in there by itself the first time this one starts.

</details>

<details>
<summary><b>For developers</b></summary>

- [How it works](docs/HOW-IT-WORKS.md): the pipeline, the ranking formula, how it learns.
- [Assumptions](docs/ASSUMPTIONS.md): platform behaviour we couldn't verify yet.
- `npm test` runs the tests. The plugin has no runtime dependencies; the desktop app adds the Anthropic SDK and two document readers (`unpdf`, `mammoth`).
- The desktop app is `desktop/`: `main.js` (window and IPC), `host.js` (studio calls, key, brand kit, runs), `runner.js` (the pipeline against the API), `llm.js`, `keystore.js`, `brandkit.js`, and `ui/` (the bridge and the desktop-only pages).
- `npm run dev` serves the board at http://localhost:7611 with two fictional demo brands. Add `?view=sources&width=390` to open a section at phone width.
- `npm run shots` screenshots every section at desktop and phone width into `dev/shots/` (needs Chrome). `npm run shots -- --readme` regenerates the images in this README.
- `npm run pack` builds a zip for **Upload plugin**.
- The board's look is one tokens file, `server/ui/skins/light.css`. A new skin is one more file beside it.

</details>

MIT licence · © Fishbowl Studio contributors
