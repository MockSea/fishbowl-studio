# Fishbowl Studio

**Your brand's posts, drafted in your brand's voice. You pick the good ones.**

Fishbowl Studio is for the person who writes a brand's LinkedIn, X, Threads and Bluesky posts. It reads the news sites and subreddits you choose, drafts a few takes on each story worth talking about, and lays them out on a review board. You approve the good ones, fix the nearly-good ones and skip the rest. It learns from every one of those, so it writes more like you the longer you use it.

It is a desktop app for macOS that drafts with Claude through your own Anthropic API key. It also comes as a plugin for the Claude desktop app, which adds posting for you, a weekly coach and more kinds of source; see [The plugin](#the-plugin).

> [!WARNING]
> **Early alpha (v0.0.1).** Expect rough edges, and please [open an issue](https://github.com/MockSea/fishbowl-studio/issues) when something breaks.

<p align="center">
  <img src="docs/screenshots/drafts.png" alt="The Drafts page: a feed of post drafts for a bicycle shop, with today's counts and a list of brands on the right" width="100%">
</p>

## What you need

- A Mac with Apple silicon and macOS 13 or later.
- An **Anthropic Console** account with API credit. This is separate from a Claude Pro or Max plan: a Claude subscription does not include API usage, and API calls are billed to the Console account ([why](https://support.claude.com/en/articles/9876003-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan)).
- To build the app: Node.js 20 or later.

## Install

1. Build the app: `npm install`, then `npm run make`. It writes `Fishbowl Studio-0.0.1-arm64.dmg` to `dist/`.
2. Open the `.dmg`, drag **Fishbowl Studio** into **Applications**, then eject the disk image.
3. Open the app from Applications. The build is unsigned, so macOS blocks it the first time. Open **System Settings → Privacy & Security**, scroll to **Security**, click **Open Anyway** next to Fishbowl Studio, and confirm with your password ([Apple's steps](https://support.apple.com/en-us/102445)). After that it opens normally.

To run it from source instead: `npm install`, then `npm run desktop`.

## Get an API key

1. Sign in at [console.anthropic.com](https://console.anthropic.com).
2. Under **Billing**, add credit. The Console also lets you set a monthly spend limit, which is worth doing because the app has no spending cap of its own.
3. Under **API keys**, create a key and copy it.

The app opens on its **Claude** page. Paste the key and save. It is encrypted with the macOS keychain and kept in `~/Library/Application Support/Fishbowl Studio`, never in plain text and never in the studio folder.

## What it costs

Every model call is billed to your API account. Drafting uses `claude-opus-5-5`.

| What you do | Calls it makes |
| --- | --- |
| Setup drafts (**Draft it for me**) | 1 |
| **Run it now** | Up to 40: reading the stories, then one to three for each story it drafts |
| A rewrite, a redo, or a link to draft | Up to 3 each, and up to 40 for the whole queue |
| **Run on its own**, each check | Up to 40, and none when nothing is due |

The API client retries a request that fails to connect or is rate limited, up to twice; the limits above count calls, not those retries. Your brand kit goes with every call, so a big kit makes each call cost more. A story the model can't write well (it refuses, or every take is too long even after one redraft) is closed after those calls and never asked for again.

## From setup to your first drafts

1. **Set up a brand.** Give it the brand's name and, if you like, its website. Answer four short questions: who it's for, how it should sound, what it talks about, what's off limits. Then **Draft it for me** (one paid call).
2. **Keep what's right.** Claude drafts a voice, playbook, topics and starter sources. **Keep**, edit or **Drop** each line, and **Add** the suggested sources you want. **Finish setup**.
3. **Check your sources.** On **Sources**, make sure at least one site or subreddit is under **Daily news** and doesn't say **Not responding**. Add your own with **Add a source**: a news site's address or its RSS feed, or a subreddit like `r/bikecommuting`.
4. **Run it.** On **Schedule**, click **Run it now**. It reads your sources and drafts the stories worth it.
5. **Wait for the release time.** New drafts are held and come out at the next release time (8:00, 12:00, 16:00 and 20:00 unless you change them), best first. They then appear on **Drafts**.

<p align="center">
  <img src="docs/screenshots/wizard.png" alt="The setup wizard, showing Claude's suggested voice and topics for a bakery, each with Keep and Drop buttons" width="100%">
</p>

## Your drafts, like a feed

Each draft looks like the post it'll become: your brand's name, the text, a character count, and **Approve**, **Edit**, **Skip** or **Rewrite** (leave a note like "too preachy" and Claude has another go). The story it's about sits underneath, and **Why it wrote this** shows the reasoning.

For each story it drafts, Claude writes three takes, each built a different way: one leads with the concrete detail, one asks the question the story raises, one says plainly what the brand thinks. **Best bet** marks its favourite. Not feeling any of them? **None of these** and it tries again.

<p align="center">
  <img src="docs/screenshots/pick-one.png" alt="Three takes on the same news story, with the first marked Best bet" width="100%">
</p>

Each source keeps a record ("4 of 5 approved"), so you can see which ones earn their place. Got one article you love? **Draft from a link** on the Sources page.

On **Topics**, turn topics up or down. Underneath, it shows what it has picked up from your approvals, skips and edits, and always says why ("you approved 0 of 6 posts about policy in the last 3 weeks"). Patterns in your edits (say you keep cutting the opening question) become suggested playbook changes on the **Playbook** page. Nothing changes until you accept one.

<p align="center">
  <img src="docs/screenshots/topics.png" alt="The Topics page: topics set to Less, Normal or More, and what it has learned from your approvals with the reason for each" width="100%">
</p>

Copy an approved post and post it yourself. The app never posts.

Write for more than one brand? Each gets its own studio, and the switcher at the top of the sidebar moves between them.

## Brand kit

Each brand has a **Brand kit** page. Drop in brand guidelines, a tone-of-voice doc, a logo or on-brand images.

- PDF, Word (.docx), Markdown and plain text are read as text. Scanned PDFs have no text; add those pages as images.
- PNG and JPG are sent as images.
- Up to 20 files a brand, 10 MB a file, 5 MB an image, and 60 MB in all.
- Each call carries up to 60,000 characters of kit text and up to 6 images, taken in the order the files are listed. Files further down can be left out of a call even when none of them was cut short.

Files are copied into the brand's `brand-kit/` folder. The page shows what was read from each one, and **Remove** deletes the copy. The kit is sent as reference material, never as instructions.

## Running on its own

**Run on its own** is off until you turn it on (on the Schedule page, or at the end of setup). Release times work either way: held drafts come out at your release times while the app is running. If it wasn't running at a release time, that batch comes out the next time it runs the same day.

With it on, the app checks every five minutes. Each check reads the news only when your Schedule setting says it's due (by default once a day on weekdays) and drafts only what's new. A check with nothing due makes no calls. After a run that fails, that brand waits an hour before trying again.

On a Mac, closing the window leaves the app running, and runs carry on. Quit it (Command-Q) to stop them.

**How many drafts a day.** It releases up to ten sets a day, where a set is the takes on one story, so ten sets can be more than ten drafts. A run can write more than that (by default up to 12 stories and 2 evergreen sets); the best are released first. A held draft older than 16 hours is cleared at the next release time instead of released, and sets left over at the day's last release time are cleared too.

## What the app leaves out

These need Claude's browser and tools, so they are in [the plugin](#the-plugin) only:

- Watching X and LinkedIn accounts, X trends and saved web searches as sources.
- The weekly coach report.
- Posting for you (**Post for me**).
- Learning your voice from old posts, and the nightly explorations of your slow reading.
- Asking for things in chat, and the board inside Claude on your phone.

## The plugin

The plugin runs the same studio inside the Claude desktop app, with Claude doing the reading and writing in a Cowork session. It needs a paid Claude plan that includes **Cowork**, and Node.js (the free LTS installer from [nodejs.org](https://nodejs.org)).

1. In the Claude desktop app, open **Customize → Plugins**.
2. Click **Add marketplace** and enter `MockSea/fishbowl-studio`.
3. Install **Fishbowl Studio**.
4. Start a Cowork session and type **/studio:setup**. The setup wizard opens, and at the end one click asks Claude to run it every weekday.

Everything it keeps lives in one folder you can open: **Documents → Fishbowl Studio**.

<p align="center">
  <img src="docs/screenshots/sources.png" alt="The Sources page in the plugin: news sites, a subreddit, watched X and LinkedIn accounts and saved searches, each with an on/off switch and a record like 4 of 5 approved" width="100%">
</p>

**More sources.** Besides news sites and subreddits, the plugin reads X and LinkedIn accounts (logged out), X trends and saved searches like "bike commuting".

<p align="center">
  <img src="docs/screenshots/coach.png" alt="The Coach page: a weekly report with what's working, what isn't, things to try, and suggested changes to accept or reject" width="100%">
</p>

**A coach every Friday.** A short weekly report per brand: what's working, what isn't, two or three things to try. It also suggests changes to your voice, each with its reason ("you cut the opening question 7 of 9 times"). Nothing changes until you tap **Accept**.

<p align="center">
  <img src="docs/screenshots/accounts.png" alt="The Accounts section in Settings: X, LinkedIn, Threads, Bluesky and Reddit, each with Add account and a Post for me switch" width="100%">
</p>

**Post for me.** Turn it on for an account and Claude posts what you approved at the next release time, in your own signed-in browser. It is off for every account until you switch it on, and switching it on shows a plain warning first: automated posting breaks LinkedIn's and X's rules and can get an account restricted. If your computer was asleep, the board tells you the slot was missed. It never posts late or retries on its own. Keep it off while you try the plugin.

<p align="center">
  <img src="docs/screenshots/phone-drafts.png" alt="The Drafts page at phone width" width="300">
  &nbsp;&nbsp;
  <img src="docs/screenshots/phone-menu.png" alt="The menu open at phone width, listing Drafts, Sources, Topics, Schedule, Settings, Reads, Coach and Playbook" width="300">
</p>

**On your phone.** In a narrow Claude window the sidebar shrinks to icons, and on a phone it becomes a menu. If the board can't show at all, say "review my drafts" and do it in chat: *"pass 1a, kill 2, edit 3: …"*.

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
<summary><b>How the plugin runs on its own</b></summary>

A plugin can't start itself: Claude runs it from a scheduled task in Cowork. **Set it up for me** (at the end of setup, or on the Schedule page) asks Claude to create it, and you approve it once. The Schedule page also shows exactly what to type if you'd rather do it by hand. If Post for me is on anywhere, a second task posts a few minutes after each release time.

Your computer has to be awake with Claude open for either to run. If Claude runs more often than your setting (say the task runs hourly and you chose "every 3 hours"), the studio skips reading the news that time and just releases what's due. One task runs all your brands.

</details>

## What it will never do

- **Post without your OK.** The app never posts. The plugin posts only drafts you approved on the board, exactly as approved, and only on accounts where you turned **Post for me** on. Approving in chat never posts.
- **Read your messages, DMs or inbox.** It reads only the sources you added. What it reads is treated as text to react to, never as instructions, and it never adds a source by itself.
- **Log in anywhere or keep passwords.** The studio stores no password, token or cookie. The app keeps only your API key, encrypted.
- **Send your stuff anywhere you didn't choose.** No analytics, no tracking, no servers of ours. The app reads the sources you added and sends each drafting request to the Anthropic API: the stories, your voice, playbook and settings, the draft being rewritten, and your brand kit. Everything else stays in your Documents folder.
- **Change your voice behind your back.** It suggests; you accept.
- **Name private people without telling you.** A draft that names someone who isn't in the story goes back for one rewrite, and if the name is still there the draft is flagged on the board.
- **Make memes or images.** Words only.

## For developers

[Developing](docs/DEVELOPING.md) has the commands, how the desktop app is put together, the settings for trying it, and how to run it against a local mock of the API. [How it works](docs/HOW-IT-WORKS.md) covers the pipeline, the ranking and how it learns.

MIT licence · © Fishbowl Studio contributors
