# How Fishbowl Studio works

Fishbowl Studio is one Node program the person starts on their own computer. It has three parts:

1. **The studio** (`server/lib/`). It does the bookkeeping: reading feeds, dedupe, ranking, release times, verdicts, caps and learning, as small functions with tests. The board reaches it through the `studio_*` operations listed under [Tools](#tools); the runner calls the same modules directly.
2. **The runner and the engines** (`server/lib/runner.js`, `server/lib/engines/`). The runner drives a run (fetch, triage, draft, release) and hands each writing step to Claude: through `claude -p` on the person's Claude plan, or the Anthropic API with their key. The studio builds each brief (the story, the brand's voice and rules, the chosen shapes, the brand kit) and validates the answer before saving it.
3. **The board** (`server/ui/`), one HTML page served by the local web server (`server/lib/web.js`) to the person's browser, assembled at read time from small files (no build step): the skin (`skins/*.css`), the component CSS (`board.css`), the bridge and the page scripts. The board's actions go to the server's JSON API, which calls the studio operations.

The server selects and formats context, Claude generates drafts, and the server validates and saves them.

## The data folder

The brand files and the app's own settings live in one folder, `~/Documents/Fishbowl Studio/` by default (`--home` or `STUDIO_HOME` moves it). The program's own files (key marker, preferences, the day's step count, when each brand's automatic weekly report was last tried, the lock file a second copy reads, the empty folders Claude Code runs in) are in its `app/` folder. The API key may instead be in the system's secret store (see the README), and uploads and document reading use short-lived files in the system's temporary folder. The folder holds one folder per brand, `personas/<slug>/`, and `personas.json`, which lists them and names the active one. Files you might open in a persona's folder:

| File | What it is | Who changes it |
|---|---|---|
| `settings.json` | platforms, daily cap, release times, news frequency, takes per story, overused phrases | you (board Settings and Schedule) |
| `voice.md` | the brand and its voice | you (setup, or the voice proposals you accept) |
| `voice-samples.json` | posts you pasted as examples | you |
| `beat.json` | topics and how much you want of each, off-limits list, curiosity keywords, names you allow | you (board Topics, or setup) |
| `sources.json` | news feeds and subreddits (and the kinds the web app doesn't read, below); each can be paused | you, on the board's Sources page; Claude can only suggest |
| `positions.json` | what the brand believes, strength 1-5 | you; Claude only proposes |
| `audience.json` | who you write for and their "buttons" | you; Claude only proposes |
| `playbook.md` | the learned rules injected into every draft | you; Claude only proposes |
| `shapes.json` | shapes learned from posts you admire | you accept them on the board |
| `state/*.json` | bookkeeping: items, drafts, verdicts, skip reasons, edits, notes, hearts, jobs, proposals, weights, the setup wizard's answers and step (`wizard.json`) | the studio |

All writes are atomic (temp file + rename) under a folder lock, so a run and the open board can't overwrite each other.

## Personas

One studio per brand. `personas.json` is `{active, personas: [{slug, name, created_at}]}`; the slug is the folder name (lowercase letters, digits and hyphens, 40 at most, never changed by a rename) and the name is what the board shows (it is kept equal to that persona's `settings.brand`). Up to 12 personas.

- **Every tool acts on the active persona**, or on the one named by its `persona` argument (every tool except `studio_personas` accepts one). A tool call is pinned to one persona for its whole run, so switching on the board can't split a call between two brands. A `persona` that isn't in the registry is refused; it can't name a path.
- `studio_personas`: `list` (with what's waiting per persona), `create` (a new empty folder plus `settings.json` with the brand name; it becomes active), `switch`, `rename`. There is no delete. To remove a brand by hand, stop the studio, move its folder out of `personas/`, and take its entry out of `personas.json` (pointing `active` at another brand if it was the active one). On the board, **Add persona** goes through the setup wizard (below), which creates the persona when they send step 1.
- **Manual runs process the active brand. Automatic checks process all eligible brands** under one shared tick budget, so one timer serves all brands. The board's switcher only changes which brand the board works on.
- **Migration.** If configuration files and `state/` exist at the studio folder's root, startup moves them, entry by entry with a rename, into `personas/<slug>/` (slug from its brand name), and `personas.json` is written last. Nothing is copied or rewritten, and files that aren't the studio's stay where they are. If a move was interrupted, the next start finishes it; where a file already exists at the destination, the leftover root copy is kept beside it as `<name>.legacy-<time>` rather than overwriting anything. A brand-new folder gets one empty persona, "My brand".

## The setup wizard

One setup flow for every brand: the board's **Add persona**, a new brand's first-run card and **Run setup again** in Settings all open the same wizard. The studio keeps its state per persona in `state/wizard.json` (`step`, brand, link, their answers, when they asked for drafts, which proposals they became), written as they go, so closing the tab or stopping the studio loses nothing: the Drafts page offers **Pick up where you left off** at the same step until they finish.

1. **Brand.** A name (checked like any persona name) and an optional website or LinkedIn address (`https://` added if they leave it off, then the usual public-HTTPS check). For a new brand, `studio_wizard {action: "create"}` makes the persona and switches to it; for the active one, `start` renames it if they changed the name.
2. **Questions.** Who the posts are for, how it should sound, what it should talk about, what's off limits: each with an example, each skippable (an empty answer), each saved on change, at most 600 characters, control characters stripped.
3. **Drafts.** **Draft it for me** sets the step to `drafting` and the runner makes one model call. `wizardBrief` only answers while the step is `drafting`. It reads the linked page once through the same safe fetch path as Draft from a link (LinkedIn pages aren't fetched: they need a login) and hands Claude **their answers in one fenced block and the page in another** (fresh nonce, guard sentence, fence tags neutralised, the page capped at 2,000 characters). The answer is checked by `wizardSave`: a voice (markdown, 40-2,400 characters), up to 6 playbook bullets, 8 topics, 8 off-limits lines, 3 audience lines and 10 starter sources. Every one becomes an **open proposal** (origin `wizard`) or a **suggested source**, through the same validators as any proposal: the own-words check rejects text matching known instruction patterns, links and handles, and nothing is applied until they keep it. A source pointing at the page they linked is refused; any other address is only ever a suggestion, never fetched before their tap. A new draft request supersedes what's still open from the last. Nothing is written to `voice.md`, `playbook.md`, `beat.json`, `audience.json` or `sources.json` by any of this.
   On the board each draft shows in an editable field: **Keep** applies it (their edited text, if they changed it, re-checked like a proposal and kept beside the suggestion), **Drop** rejects it, **Keep everything** keeps the rest; starter sources have **Add** (test-fetched, as on Sources) and **Dismiss**. The same proposals also wait on Playbook, marked "From setup".

**Finish** offers **Run on its own** and marks the brand set up (`setup_complete`).

## The daily pipeline

**Run it now** runs the active brand; the timer, when **Run on its own** is on, runs every eligible brand. A run does:

1. Any release that is due.
2. **Fetch**: every feed in `sources.json` that isn't paused (websites and subreddits). It first checks their **news frequency** (below) and skips the fetch, saying why, if it is too soon. The feed parser is hand-written and tolerant (RSS 2.0, RSS 1.0, Atom), refuses DTDs and entities, strips HTML, keeps HTTPS links only, takes 12 items per feed and at most 3 MB per fetch (it parses the first 1 MB and 200 items, in one linear pass). Redirects are followed by hand, at most 5, and every hop must be a public HTTPS host name; hosts that resolve to private, loopback or link-local addresses are refused. Titles, summaries and authors are flattened to one line with control, format and Unicode tag characters removed. A dead feed is reported and the rest carry on.
   - **Dedupe**: exact URL (normalised: tracking parameters, `www.`, fragments and trailing slashes removed) and **story level**: titles are normalised (outlet suffix and punctuation dropped, light stemming) and compared by Jaccard similarity (≥ 0.5) or containment (≥ 0.8 for 4+ words) within 72 hours. The first outlet's item represents the story; the others are recorded as "also covered by" and feed the trending signal.
   - **Ageing**: items older than 30 days with no drafts are pruned. Only items from the last 48 hours are drafted.
3. **Triage**: the newest 40 untriaged stories, one per story cluster, in rounds. Claude writes a one-line private reaction, a 0-10 interest score and a topic. The queue also says, in one line, why they skipped posts lately ("wrong topic 3 (policy 3)"). These show on the Reads tab and feed the taste log.
4. **Drafting**, one brief at a time, each checked by `saveTakes`. The work queue is: queued rewrites, redos and "draft this" requests, then stories with interest ≥ 6 (after their topic weights and what it has learned, below; up to `drafts_per_run`, 12 by default), then evergreen posts (2 a day by default).
5. **Release**: rank and release the due batch.

The whole run shares one budget of 40 drafting steps and the day's cap of 150, whichever engine answers. On a Friday the timer's run also writes the weekly coach report (two steps) from the same budget. A step is one request the runner hands to an engine; underneath it can be more than one (retries, Claude Code turns, a fallback to the API), so the caps aren't exact limits on requests or charges. Running twice is harmless: fetched items dedupe, triaged items aren't re-queued, drafted stories aren't drafted again, and each batch releases once.

## How often it reads the news

The studio only works while it's running. While it runs, a timer ticks every five minutes: it releases due batches for every brand and, when **Run on its own** is on, starts a run. On start it catches up batches whose release time passed while it was closed and says how many. `settings.fetch_every` is one of five presets, validated on save; anything else is refused. Each sets the least time between two fetches:

| Preset | Fetches when |
|---|---|
| `hourly` | 45 min or more since the last fetch |
| `every_3h` | 2 h 45 min or more since the last fetch |
| `twice_daily` | 5 h or more |
| `daily` | 20 h or more |
| `weekdays` (default) | 20 h or more, never on Saturday or Sunday |

The gaps are a little under the interval so a tick a few minutes early still fetches. When fetching is skipped (too soon, or no feeds) and no jobs are queued, an automatic run only releases due drafts and asks Claude for nothing. With jobs queued it goes on to triage and drafting. **Run it now** reads the news regardless.

## Sources, topics and links from the board

- **Sources.** They add them on the board (`studio_source_add`). Claude can only **suggest** one, in the setup drafts: it waits under Suggested sources until they tap Add, and nothing is fetched before that. `studio_config` can edit, pause, re-file or remove sources in `sources.json` but refuses a write that adds a new one. A website is test-fetched through the same safe path as the feeds (below). A feed is used as is; a web page is searched for its `<link rel="alternate" type="application/rss+xml|atom+xml">` and that feed is fetched instead, if it too is a public HTTPS address. The name is theirs if given, else the feed's title (flattened to one line, capped at 80, and replaced by the host name if it reads like an instruction), else the host. `pause`, `resume`, `remove` and `topic` (re-file under one of their topics) find the source by its list (`feeds`, `reading`, `watch`, `trends`, `searches`) and normalised address, or a search by its words. Every write goes through the `sources.json` validator.
- **Topics** (`studio_topics`): `add` turns "Cargo bikes" into the slug `cargo-bikes`, `remove` drops it (and re-files its sources under "other"), `weight` sets 1 (less), 2 (normal) or 3 (more). Weights move the drafting bar by one point: a story's interest counts one higher on a "more" topic and one lower on a "less" one, for both the threshold (6) and the order. The triage queue tells Claude plainly which topics they want more or less of. Every write goes through the `beat.json` validator.
- **Draft from a link** (`studio_draft_link`): one article address, checked like a source address and fetched through the same path (HTTPS, public hosts only, redirects followed by hand and checked at every hop, private addresses refused, 3 MB cap). The page is parsed in linear passes: title (Open Graph title or `<title>`), description, and the paragraphs of its `<article>` or `<main>`, with scripts, styles and tags removed, entities decoded, flattened to one line, control and invisible characters stripped, fence tags neutralised, capped at 3,000 characters. A feed pasted here is refused with "add it under Sources". It is stored as a story marked `from_link`, skips triage (they chose it), and is queued as a "draft this" job; the brief fences the page exactly like a feed item and adds one line, outside the fence, that they sent the link themselves. Pasting the same article again while it waits queues it once; an article already read from a feed is reused rather than fetched again.

## Supported sources

| Kind | They paste | Stored as |
|---|---|---|
| Website | a page or feed address | the feed's `https://` address |
| Subreddit | `r/name` or a reddit.com/r/name address | `https://www.reddit.com/r/<name>/.rss`, always rebuilt from the name. The poster's username and the "submitted by … [link] [comments]" footer are dropped: Reddit users are private people |

The source model in `handles.js` and `config.js` also has X accounts, LinkedIn pages, X trending topics and saved web searches. Reading those needs a browser and web search, which the web app's runner doesn't have, so the Sources page offers only the two kinds above (the `sourceKinds` board hook) and a run leaves the others out.

## What it has learned, in their words

The Topics page explains learning with the same numbers the ranker uses. For each draft feature (topic, shape, platform, source, length, question, number, "we/our", evergreen, experiment) it counts approvals against skips over 21 days and shows the ones whose shrunk lift `(approved + 4·base)/(n + 4) − base` has magnitude at least 0.03 with two or more verdicts, strongest first, each with its sentence ("You approved 0 of 6 in the last 3 weeks (0%, against 53% overall)"). Under it, the four rank weights as percentages with how they moved in the last week.

## A drafting brief

For each piece of work the server decides, before Claude writes anything:

- **Platform.** Each set targets one platform, chosen as the enabled platform furthest below its share of today's sets. Rewrites and redos keep their platform. Platform rules are data (`platforms/*.json`: `linkedin` 3,000 characters, `x` 280, `threads` 500, `bluesky` 300): limits, target length, register and formatting. Adding a platform means adding a file (and tagging the shapes that suit it). Threads and Bluesky are off until they switch them on in Settings.
- **Shapes, one per take.** Shapes are structural mechanisms (`shapes/*.json`, 13 seeds, each tagged with the platforms it suits). Each shape's weight is
  `w = (1 + passes + edits + posted + hearts) / (1 + kills) × results multiplier × 2 if it's the HOME shape`.
  With probability 0.25 the pick is uniform instead (exploration). Takes in a set get distinct shapes, and shapes tied to an overused form are avoided. The results multiplier comes from the numbers you enter: `clamp(mean(post score / platform mean) for the shape ÷ the same over all posts, 0.25, 4)`, where post score = `(likes + 2·reposts + 2·quotes + replies) / views`.
- **Experiment.** With probability 0.2 take 1 becomes an experiment: a hybrid of two shapes plus one off-playbook note (`defaults/experiments.json`).
- **Context**, in this order: the brand voice, fenced voice samples, the playbook, their recent verdicts (6 passed, 6 killed), kills they restored with their reasons, their recent notes, lines and thoughts they hearted, the brand's top positions, the safety guard, the audience and buttons, platform rules, the writing instruction, the story and the triage reaction, the shapes, and the "overused lately" list.

## Checking the takes

`saveTakes` (`save.js`) checks every take. On the **first** submission any of these sends specific takes back for one redraft:

- longer than the platform's hard limit;
- take 1 lands in a template form above 10% of the last 50 drafts, opens with a 3-word opener above 5%, or makes a batch collapse (≥ 3 first takes in the last 3 hours with more than 60% in one form, in which case take 1 gets a new shape);
- a crutch family over its cap in the last 50 drafts: comparisons (12.5%), hype words (6%), and your own "phrases we overuse" (4%);
- shares a 5-word run with an example it was shown;
- echoes the story's wording (≥ 50% of its content words);
- **names a person who isn't in the story or on your allowlist** (the private-individual check: 2-3 capitalised words or a titled surname, minus common words, brand and allowlist);
- mentions an @handle.

The **second** submission is final. Takes still over the length limit, or still stuck on a "drop if stuck" crutch (hype), are dropped. Everything else is saved with **lint flags**, which show on the card and cost ×0.85 each in rank: hashtag, link, long for the platform, ties back to an earlier post, reads like a news report, @handle, number not in the source, quote not in the source, names someone not in the source, and for uncited evergreen posts: a statistic, quotation or name with nothing cited.

## The day's ten

Drafts land **held**. At each release hour (8, 12, 16, 20 by default) the held pool is ranked and a share is released to **Waiting**. The release runs on the five-minute timer, at the end of every run, when the board asks for `studio_status` and on `studio_release`, so batches appear on time while the studio is running; batches missed while it was closed run when it starts.

- **Quota** for batch k of n: `min(left, ceil(left / (n − k)), ceil(2·cap / n))`. A share a thin pool can't fill rolls on.
- **Stale**: held longer than `held_max_hours` (16 by default) is scrapped first.
- **Rank**: `score = Σ w_k·s_k / Σ w_k × 0.85^lint_flags`. A set ranks by its best take, which is marked "our pick".
  - **hot** = 0.5·freshness + 0.5·velocity, freshness = `0.5^(age_h / 6)` from the earlier of published and fetched. Velocity needs engagement counts on the source; feeds have none, so it is neutral (0.5).
  - **trending**: for each term in the title (lowercase, 4+ letters or containing a digit, not a stopword), other voices = other sources using it in the last 24 h, burst = `(recent + 1) / (base/7 + 1)` against the 7 days before; value = max over terms of `(1 − 0.5^others) · clip((burst − 1)/2, 0, 1)`.
  - **interest** = triage interest / 10.
  - **entertaining**: each draft's features (shape, topic, form, platform, length bucket, question, number, first person, source, experiment…) are scored by a shrunk mean over 21 days, `(Σy + 4·mean)/(n + 4) − mean`, from verdicts (weight 0.25: pass 1, kill or passed-over 0) and posted results (weight 1, percentile within platform). The draft's estimate is the mean worth of its known features; the signal is its percentile in the batch.
- **Novelty slot**: when two or more go out and drafts are left over, the last place goes to the most novel held draft (share of its topic/shape/source/form/kind/platform not seen in the last 7 days of releases), once a day (three times when stalled).
- The last batch of the day, or a spent cap, scraps the leftovers as "over the daily cap". **Scrapped is not a kill**: it teaches nothing, unless you heart or resurrect it, which tells the ranker it missed one.

## Learning

- **Verdicts** (pass / edit / kill, pick / none of these) feed shape weights and the entertaining signal immediately.
- **Edits.** When they change a draft before approving it, the draft and their version are kept (`state/edits.json`, one record per draft, the latest edit wins, undoing the edit removes it) with what changed: they cut the opening question, cut the last line, cut it by a fifth or more, added to it, took out exclamation marks, hashtags, emojis or "we/our", added "we/our" or a number, and which words and two- or three-word phrases they removed. Their last four edits reach every brief, fenced, as "drafts they edited before approving (their version is the voice)", and their versions count as examples the drafter mustn't copy word for word.
- **Edit patterns become proposals.** During each daily run, a pattern that shows up in at least 3 of their edits and at least half of them (with 4 or more edits in 60 days) becomes one playbook proposal, written as a description of the brand ("Open with a plain statement, not a question") with its reason ("You cut the opening question in 7 of your last 9 edits."). A word or phrase they cut at least 3 times, from at least 3 of every 4 drafts that had it, becomes a proposal to add it to "phrases we overuse". Each is proposed once; one they accepted or rejected isn't proposed again for 60 days. Nothing changes until they tap Accept.
- **Skip reasons.** After a skip (or "none of these") the board asks once, optionally: off-brand, wrong topic, too salesy, boring, factually off, other. Ignoring it is fine. The reason is stored on the draft, cleared if they bring it back, shown on the Skipped tab, given to the drafter beside the killed post ("why: too salesy"), and summed up in the triage queue.
- **Source records.** Each source's drafts approved of drafts decided over 6 weeks (a set counts once), shown on the Sources page ("4 of 5 approved"). A source with 5 or more decided and at most 1 in 5 approved, or 4 or more and none approved, is marked "Keeps losing … Pause it?" on Sources. It is never paused automatically.
- **What it drafts first.** Their topic weights move the drafting bar by one point. What it has learned moves it too, by up to 1.5 points either way, with the reasons shown on the Topics page ("What it drafts first") and on each read: per topic, the shrunk approve-vs-skip lift over 21 days (counted exactly like "learned from your verdicts") × 4, capped at ±0.75, plus 0.25 per read they hearted about it (at most 0.5), minus 0.25 per "wrong topic" skip (at most 0.5); per source, (its approval rate − their overall rate) × 2 once it has 3 decided, capped at ±0.75, plus 0.25 per hearted read from it (at most 0.5). Each kind is capped at ±1 and a story's total at ±1.5. It changes which stories are drafted and in what order, not how they're written.
- **Rank weights** move once a day at the first batch: from the last 14 days of released sets, passes vs kills (each side ≥ 4) give a gap per signal; posted results (above vs below median, each side ≥ 4) give another. `new = old + 0.5 · gap`, clipped to ±0.02 a day, ±0.1 against a week ago, and [0.05, 0.6]. If posts stall (≥ 6 measured posts in 3 days averaging under 0.5 interactions, or all identical), 0.02 moves from the heaviest weight to the lightest and the novelty budget rises.
- **Notes** queue a rewrite (at most 3 waiting at a time). The rewrite lands as a new version of the same draft; the old text is kept with the note. Posted drafts are never rewritten.
- **Redo** writes a new set for a story you passed on (at most 2 per story). The new set inherits the old set's daily slot and goes straight to Waiting.
- **Fingerprints**: pass and edit carry a hash of the text you saw. If a rewrite landed while the board was open, the action is refused and you see the new text.
- **Proposals from the numbers.** Playbook changes are proposed from the numbers alone (skip reasons, edit patterns, how each source does), never from free text, so a single grumpy note can't rewrite the rules. Every change is a proposal you accept or reject on the Playbook page.
- **The weekly coach.** The Coach page's **Write this week's report** button, and the timer on Fridays when **Run on its own** is on, run `runner.weekly`: two steps through the same engine and caps as a run, without the brand kit. The first brief is the week's numbers only and may propose playbook changes. The second adds their notes and undone skips from the week, the audience profile and the positions, and returns the report (a summary, what's working, what isn't, what to try) and any audience or position changes. Each answer is checked by `saveWeekly`: in what's working, what isn't and what to try, a line with a link, a handle or an instruction is dropped; the summary is kept as written, trimmed to 1200 characters; every change is a proposal they accept or reject on the Coach page. A first answer that fails (a refusal, running out of room) is skipped and the report still runs. The timer tries the report once per Friday per brand, and only when no report was written in the last six days. It records the try in `app/weekly.json` before the first step, so a failure isn't retried that day and a restart doesn't run it again. A failed report doesn't make the brand sit out the next daily run. The button runs it whenever they press it.
- **Taste log**: every triaged story is logged (seen, drafted, topic, source).

## Untrusted text

Everything read from outside (news, pages, subreddit posts, brand kit text) and your own notes when they're fed back to Claude arrive inside `<data-NONCE>` tags, with a fresh random nonce per brief, a guard sentence explaining that it is data and never instructions, control characters stripped, each field capped (1,200 characters by default; callers set their own, such as 2,000 for a linked page in setup and 60,000 for brand kit text), and any fence tags inside the content neutralised. The fencer is one shared, tested function (`server/lib/fence.js`). Model text stored as the brand's own view (proposals) must pass an own-words check: no instruction-shaped text, no links or handles, and no ≥ 50% echo of the source.

Your own settings are fenced too. The voice, playbook, positions and audience reach Claude inside the same tags, introduced as a description of the brand rather than instructions. Saving `voice.md`, `playbook.md`, `positions.json` or `audience.json` through `studio_config` is refused if it matches a known instruction pattern ("ignore previous…", "from now on", "always write…"); describe the brand instead. `studio_config` reads and writes only the files listed above, and the store refuses any path outside the data folder.

Pages they paste with "Draft from a link" are outside text like any feed: cleaned the same way on the way in, fenced the same way in the brief. These are mitigations, not guarantees: fencing tells the model the text is data, the pattern checks catch known instruction phrasing, and model output is validated before it is saved. What the studio never does with story text is code, not prompting: links in it are stored for them to open and never fetched, and a new source only ever arrives as a suggestion they tap. Feed titles that become source names are flattened and dropped if instruction-shaped. Persona names are flattened, capped at 60 and refused if instruction-shaped.

## The local server and Claude Code

The server listens on 127.0.0.1 only and checks the `Host` header on every request. The board needs a session cookie, and the only way to get one is the launch link: a 256-bit token that works once, within five minutes, and is swapped for an HttpOnly, SameSite=Strict cookie. The details are in the header of `server/lib/web.js`.

The command opens that link with the system's opener (`open`, `xdg-open`, or `rundll32` on Windows), so for a moment the token sits in that process's command line, where other accounts on the same computer can list it. This is an accepted risk for a single-person app: the token is single-use, expires in five minutes, and is usually spent by the browser within a second. On a shared computer, run with `--no-open` and paste the printed link yourself.

A second copy of the command doesn't trust the address in the lock file on its word. It sends a fresh nonce with an HMAC made from the control secret in the 0600 lock file, and only uses the answer if it carries a matching HMAC over the nonce and the address. The secret itself never crosses the wire, a nonce is accepted once, and a process that can't be signalled (EPERM) counts as gone, so a stale lock pointing at someone else's server starts a new studio instead.

With the Claude Code engine, each drafting step runs `claude -p` with `--setting-sources ''` (no user, project or local settings, so no `CLAUDE.md` from any parent folder) in a fresh empty folder under `app/claude-runs/`, created 0700, and removed afterwards. It doesn't run under the system's shared temporary folder, where another account could plant settings in a parent folder.

## Tools

The studio's operations are named tools (`server/lib/tools.js`). The board calls them through the server's API (`/api/call`), and the runner calls the ones a run needs. The main ones:

| Tool | Purpose |
|---|---|
| `studio_personas` | list, create, switch or rename personas |
| `studio_status` | setup state, counter, waiting, jobs; runs due releases |
| `studio_view` | board data: drafts tabs, reads, playbook, settings, sources, topics, schedule |
| `studio_act` | pass, edit, kill (optional reason), kill_reason, pick, none, redo, restore, resurrect, heart, note, draft_this, mark_posted, unpost |
| `studio_config` | get/set/patch the files in the persona's folder, with validation |
| `studio_source_add` | add a website or subreddit (test-fetched) |
| `studio_topics` | add, remove or weight a topic |
| `studio_draft_link` | fetch one article and queue it to be drafted |
| `studio_wizard` | the setup wizard's answers and steps (create, start, get, answer, draft, step, finish) |
| `studio_release` | rank and release the due batch |
| `studio_proposal_decide` | accept (as is, or their edited text) or reject a proposal, including a suggested source |
| `studio_metrics` | enter post numbers or import a CSV |

Every tool except `studio_personas` also takes `persona`. The source also holds tools for posting through Claude's browser; the web app hides them (the `noPosting` board hook) and never calls them. The weekly coach report runs in the app through the runner (below), not as a tool call.

## The board

Sections: Drafts, Sources, Topics, Brand kit, Schedule, Settings, then Reads and Playbook, with the persona switcher at the top of the sidebar. The Claude page (engine and API key) opens from Settings, and on its own until an engine is configured or Claude Code is detected. The setup wizard is a page of its own, reached from Add persona, the first-run card and Settings; a progress strip shows its steps (stacked labels on a phone). Sources carries a badge for suggested sources. Settings save on click (switch, − / + stepper, segmented choice, hour chips, preset cards); text fields appear only for text (an address, a name, an example post, a note). Lint flags are shown as plain-language chips; "Approve" and "Skip" are the pass and kill verdicts (Skip teaches, and **Bring back** undoes it with a reason).

- **Look.** All colours, radii, type sizes, spacing, shadows and layout widths are CSS custom properties in `server/ui/skins/light.css`; `board.css` only refers to them (a test fails on any literal colour there). A second skin is one more file in `skins/` scoped to `:root[data-skin="<name>"]`; every skin file is bundled. Only the light skin exists, so the board is light.
- **Layout.** Over 900 px: sidebar, page, and (over 1180 px) a right column. 641-900 px: the sidebar becomes a strip of icons with short labels. 640 px and under: a menu button opens the sidebar as a drawer.
