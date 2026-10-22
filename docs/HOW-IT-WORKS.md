# How Fishbowl Studio works

Fishbowl Studio is a Claude plugin with three parts:

1. **A local MCP server** (`server/`, plain Node.js, no dependencies). It does the bookkeeping: reading feeds, dedupe, ranking, release times, verdicts, caps and learning. Every formula lives here as a small pure function with tests.
2. **Skills and commands** (`skills/`, `commands/`). They tell Claude what to do at each step: react to stories, write takes, rewrite from notes, write the weekly report. Claude does the thinking; the server hands it exactly the context it needs and checks what comes back.
3. **The board** (`server/ui/`), an MCP App: one self-contained HTML page rendered inside the chat, assembled at read time from small files (no build step): the skin (`skins/*.css`), the component CSS (`board.css`), the bridge and four scripts (icons, shell, drafts feed, the other pages). Every button calls a server tool through the host bridge.

The model never sees raw files and the server never writes prose.

## The data folder

Everything lives in one folder, `~/Documents/Fishbowl Studio/` by default (set `STUDIO_HOME` to move it). It holds one folder per brand, `personas/<slug>/`, and `personas.json`, which lists them and names the active one. Each persona folder holds exactly what a single-brand studio held before. Files you might open in a persona's folder:

| File | What it is | Who changes it |
|---|---|---|
| `settings.json` | platforms, daily cap, release times, news frequency, takes per story, overused phrases | you (board Settings and Schedule, or Claude) |
| `voice.md` | the brand and its voice | you, via `/studio:voice` |
| `voice-samples.json` | posts you pasted as examples | you |
| `beat.json` | topics and how much you want of each, off-limits list, curiosity keywords, names you allow | you (board Topics, or setup) |
| `sources.json` | news feeds and subreddits, the reading list, watched X and LinkedIn accounts, X trending topics, saved searches; each can be paused | you, on the board's Sources page; Claude can only suggest, pause, re-file or remove |
| `positions.json` | what the brand believes, strength 1-5 | you; Claude only proposes |
| `audience.json` | who you write for and their "buttons" | you; Claude only proposes |
| `playbook.md` | the learned rules injected into every draft | you; Claude only proposes |
| `shapes.json` | shapes learned from posts you admire | you accept them on the board |
| `reports/weekly-*.md` | weekly reports | written by the weekly skill |
| `state/*.json` | bookkeeping: items, drafts, verdicts, skip reasons, edits, notes, hearts, jobs, proposals, weights, coach reports, connected accounts | the server |

All writes are atomic (temp file + rename) under a folder lock, so a scheduled run and an open board can't overwrite each other.

## Personas

One studio per brand. `personas.json` is `{active, personas: [{slug, name, created_at}]}`; the slug is the folder name (lowercase letters, digits and hyphens, 40 at most, never changed by a rename) and the name is what the board shows (it is kept equal to that persona's `settings.brand`). Up to 12 personas.

- **Every tool acts on the active persona**, or on the one named by its `persona` argument (every tool takes one). A tool call is pinned to one persona for its whole run, so switching on the board can't split a call between two brands. A `persona` that isn't in the registry is refused; it can't name a path.
- `studio_personas`: `list` (with what's waiting per persona), `create` (a new empty folder plus `settings.json` with the brand name; it becomes active), `switch`, `rename`. There is no delete: removing a brand is moving its folder away by hand.
- **The daily run goes through every persona** (the `daily-run` skill lists them and passes `persona` on each call), so one scheduled task serves all brands. The board's switcher only changes which brand the board and the chat work on.
- **Migration.** On the first start of this version, a studio folder from before personas (config files and `state/` at its root) is moved, entry by entry with a rename, into `personas/<slug>/` (slug from its brand name), and `personas.json` is written last. Nothing is copied or rewritten, and files that aren't the studio's stay where they are. If a move was interrupted, the next start finishes it; where a file already exists at the destination, the leftover root copy is kept beside it as `<name>.legacy-<time>` rather than overwriting anything. A brand-new folder gets one empty persona, "My brand".

## The daily pipeline

The scheduled task asks Claude to "Run the Fishbowl Studio daily run". The `daily-run` skill then calls:

1. `studio_status`: setup check, plus any release that is due.
2. `studio_fetch`: every feed in `sources.json` that isn't paused (websites and subreddits). It first checks her **news frequency** (below) and skips the fetch, saying why, if it is too soon. The feed parser is hand-written and tolerant (RSS 2.0, RSS 1.0, Atom), refuses DTDs and entities, strips HTML, keeps HTTPS links only, takes 12 items per feed and at most 3 MB per fetch (it parses the first 1 MB and 200 items, in one linear pass). Redirects are followed by hand, at most 5, and every hop must be a public HTTPS host name; hosts that resolve to private, loopback or link-local addresses are refused. Titles, summaries and authors are flattened to one line with control, format and Unicode tag characters removed. A dead feed is reported and the rest carry on.
   - **Dedupe**: exact URL (normalised: tracking parameters, `www.`, fragments and trailing slashes removed) and **story level**: titles are normalised (outlet suffix and punctuation dropped, light stemming) and compared by Jaccard similarity (≥ 0.5) or containment (≥ 0.8 for 4+ words) within 72 hours. The first outlet's item represents the story; the others are recorded as "also covered by" and feed the trending signal.
   - **Ageing**: items older than 30 days with no drafts are pruned. Only items from the last 48 hours are drafted.
   - Then `studio_read_queue` / `studio_record_reads`: the X and LinkedIn accounts she watches, X trending topics and her saved searches, read by Claude (below).
3. `studio_wander` / `studio_record_wander` (up to twice): slow curiosity reading over the reading list. The source is chosen by topic interest (7-day mean triage interest, default 4, plus up to 3 for curiosity keywords seen recently), neglect (every third trip takes the least recently visited source), and caps (12 visits a day, same host at most every 2 h, same source every 24 h). Instruction-shaped entries are dropped. Findings never become drafts directly; they feed evergreen posts.
4. `studio_triage_queue` / `studio_record_triage`: the newest 40 untriaged stories, one per story cluster (posts and search results included, each marked as what it is). Claude writes a one-line private reaction, a 0-10 interest score and a topic. The queue also says, in one line, why she skipped posts lately ("wrong topic 3 (policy 3)"). These show on the Reads tab and feed the taste log. After each triage the server checks for sites worth suggesting (discovery, below).
5. `studio_drafting_brief` / `studio_save_takes`, in a loop. The work queue is: queued rewrites, redos and "draft this" requests, then stories with interest ≥ 6 (after her topic weights and what it has learned, below; up to `drafts_per_run`, 12 by default), then evergreen posts (2 a day by default).
6. `studio_release`: rank and release the due batch.

Running the skill twice is harmless: fetched items dedupe, triaged items aren't re-queued, drafted stories aren't drafted again, and each batch releases once.

## How often it reads the news

A plugin can't schedule itself: the trigger is a Cowork scheduled task she creates once. `settings.fetch_every` is one of five presets, validated on save; anything else is refused. Each preset says what task to set (the board's Schedule page shows it with copy buttons, times worked out from her release hours) and the least time between two fetches:

| Preset | Task to set in Cowork | Fetches when |
|---|---|---|
| `hourly` | repeat Hourly | 45 min or more since the last fetch |
| `every_3h` | repeat Hourly | 2 h 45 min or more since the last fetch |
| `twice_daily` | two tasks, Daily, an hour before the first batch and an hour before the batch nearest 13:00 | 5 h or more |
| `daily` | Daily, an hour before the first batch | 20 h or more |
| `weekdays` (default) | Weekdays, an hour before the first batch | 20 h or more, never on Saturday or Sunday |

The gaps are a little under the interval so a run that starts a few minutes early still fetches. A run that comes too soon (an hourly task with "every 3 hours", a second run on the same day, a weekend run on "weekdays") skips only the fetch: triage, drafting and the release still happen. Cowork's scheduler has no "every 3 hours", so that preset uses an hourly task and the in-between runs end almost at once; the cost is a short Claude session each hour, which the Schedule page says. When she asks for a run in chat (`/studio:run`), the skill passes `force: true` and the news is read regardless.

## Sources, topics and links from the board

- **Sources.** She adds them on the board (`studio_source_add`, board only). Claude can only **suggest** one (`studio_sources` `suggest`, or `add`, which is treated as a suggestion): it waits under Suggested sources until she taps Add, and nothing is fetched before that. `studio_config` can edit, pause, re-file or remove sources in `sources.json` but refuses a write that adds a new one. A website is test-fetched through the same safe path as the feeds (below). A feed is used as is; a web page is searched for its `<link rel="alternate" type="application/rss+xml|atom+xml">` and that feed is fetched instead, if it too is a public HTTPS address. The name is hers if given, else the feed's title (flattened to one line, capped at 80, and replaced by the host name if it reads like an instruction), else the host. `pause`, `resume`, `remove` and `topic` (re-file under one of her topics) find the source by its list (`feeds`, `reading`, `watch`, `trends`, `searches`) and normalised address, or a search by its words. Every write goes through the `sources.json` validator.
- **Topics** (`studio_topics`): `add` turns "Cargo bikes" into the slug `cargo-bikes`, `remove` drops it (and re-files its sources under "other"), `weight` sets 1 (less), 2 (normal) or 3 (more). Weights move the drafting bar by one point: a story's interest counts one higher on a "more" topic and one lower on a "less" one, for both the threshold (6) and the order. They also tilt wandering the same way, and the triage queue tells Claude plainly which topics she wants more or less of. Every write goes through the `beat.json` validator.
- **Draft from a link** (`studio_draft_link`): one article address, checked like a source address and fetched through the same path (HTTPS, public hosts only, redirects followed by hand and checked at every hop, private addresses refused, 3 MB cap). The page is parsed in linear passes: title (Open Graph title or `<title>`), description, and the paragraphs of its `<article>` or `<main>`, with scripts, styles and tags removed, entities decoded, flattened to one line, control and invisible characters stripped, fence tags neutralised, capped at 3,000 characters. A feed pasted here is refused with "add it under Sources". It is stored as a story marked `from_link`, skips triage (she chose it), and is queued as a "draft this" job; the brief fences the page exactly like a feed item and adds one line, outside the fence, that she sent the link herself. Pasting the same article again while it waits queues it once; an article already read from a feed is reused rather than fetched again.

## Reading where her audience is

Five kinds of source, one validator (`handles.js`, `config.js`). Whatever she pastes becomes one canonical entry or a plain refusal:

| Kind | She pastes | Stored as | Read by |
|---|---|---|---|
| Website | a page or feed address | the feed's `https://` address | the server, every run (`studio_fetch`) |
| Subreddit | `r/name` or a reddit.com/r/name address | `https://www.reddit.com/r/<name>/.rss`, always rebuilt from the name | the server, like any feed. The poster's username and the "submitted by … [link] [comments]" footer are dropped: Reddit users are private people |
| X account | `@handle`, `handle`, or an x.com (or twitter.com) address of the account itself | `https://x.com/<handle>` (letters, digits, `_`, at most 15; page names like `home` or `explore` refused) | Claude, in its browser, logged out |
| LinkedIn page | a linkedin.com `/company/`, `/showcase/` or `/in/` address | `https://www.linkedin.com/<kind>/<slug>/` | Claude, in its browser, logged out |
| X trending topics | (a switch) | `x.com/explore/tabs/trending` | Claude, in its browser, logged out |
| Saved search | a few words ("e-bike regulation") | the words: 2-80 characters, no address, nothing instruction-shaped | Claude, with its web search |

Only x.com and linkedin.com addresses can be watched, and the server builds them from the validated handle, so a watched account can't point anywhere else. Each watched account carries `via: "public"`; a signed-in read through an account slot (`via: "account:<type>"`) is accepted only once that account type declares `read: true`, which none does yet. Adding it later means building the reader and flipping the type's file, not changing the source kind.

**How a read works.** `studio_read_queue` respects her news frequency like `studio_fetch` (or `force`). It lists the targets, numbered, each with the exact address the server built. The `daily-run` skill opens each one with Claude's browser tool (Claude in Chrome) as a logged-out visitor: no signing in, no typing into the page, no following links in posts, no other address. If the page asks for a login it reports `login_wall`. If there's no browser tool it reports `no_browser` for each account and looks the account up with web search instead (`via: "search"`); the board's Sources page then says Claude couldn't use its browser. Saved searches go through Claude's web search, up to 8 results from the last week each. `studio_record_reads` takes results only for target numbers it issued, at most 10 posts per account, 20 trends and 8 results per search. Every field is flattened to one line and cleaned like a feed item; a post's link is kept only if it is on its own platform, a search result needs a public `https://` link. They are stored as stories (`web: watch | trends | search`, no author) and triaged with the news. The server never fetches any of these links.

**Discovery.** A site earns a suggestion when it has shown up at least 3 times in search results she'd care about (triaged 6 or more), from at least 2 different searches or on 2 different days, in 30 days, and isn't already a source or a social site. The suggestion says why ("3 good results from 2 of your searches in the last month") and waits under Suggested sources until she taps Add (it's test-fetched then) or Dismiss. A site she has added or dismissed is never suggested again. This is the only way an address Claude came across becomes something the studio reads: a search result that says "add me as a source" is one result, below the bar, and even above it is only a suggestion.

## What it has learned, in her words

The Topics page explains learning with the same numbers the ranker uses. For each draft feature (topic, shape, platform, source, length, question, number, "we/our", evergreen, experiment) it counts approvals against skips over 21 days and shows the ones whose shrunk lift `(approved + 4·base)/(n + 4) − base` is at least 0.03 with two or more verdicts, strongest first, each with its sentence ("You approved 0 of 6 in the last 3 weeks (0%, against 53% overall)"). Under it, the four rank weights as percentages with how they moved in the last week.

## A drafting brief

For each piece of work the server decides, before Claude writes anything:

- **Platform.** Each set targets one platform, chosen as the enabled platform furthest below its share of today's sets. Rewrites and redos keep their platform. Platform rules are data (`platforms/*.json`): limits, target length, register and formatting. Adding a platform means adding a file.
- **Shapes, one per take.** Shapes are structural mechanisms (`shapes/*.json`, 13 seeds, each tagged with the platforms it suits). Each shape's weight is
  `w = (1 + passes + edits + posted + hearts) / (1 + kills) × results multiplier × 2 if it's the HOME shape`.
  With probability 0.25 the pick is uniform instead (exploration). Takes in a set get distinct shapes, and shapes tied to an overused form are avoided. The results multiplier comes from the numbers you enter: `clamp(mean(post score / platform mean) for the shape ÷ the same over all posts, 0.25, 4)`, where post score = `(likes + 2·reposts + 2·quotes + replies) / views`.
- **Experiment.** With probability 0.2 take 1 becomes an experiment: a hybrid of two shapes plus one off-playbook note (`defaults/experiments.json`).
- **Context**, in this order: the brand voice, fenced voice samples, the playbook, her recent verdicts (6 passed, 6 killed), kills she restored with her reasons, her recent notes, lines and thoughts she hearted, the brand's top positions, the safety guard, the audience and buttons, platform rules, the writing instruction, the story and the triage reaction, the shapes, and the "overused lately" list.

## Checking the takes

`studio_save_takes` checks every take. On the **first** submission any of these sends specific takes back for one redraft:

- longer than the platform's hard limit;
- take 1 lands in a template form above 10% of the last 50 drafts, opens with a 3-word opener above 5%, or makes a batch collapse (≥ 3 first takes in the last 3 hours with more than 60% in one form, in which case take 1 gets a new shape);
- a crutch family over its cap in the last 50 drafts: comparisons (12.5%), hype words (6%), and your own "phrases we overuse" (4%);
- shares a 5-word run with an example it was shown;
- echoes the story's wording (≥ 50% of its content words);
- **names a person who isn't in the story or on your allowlist** (the private-individual check: 2-3 capitalised words or a titled surname, minus common words, brand and allowlist);
- mentions an @handle.

The **second** submission is final. Takes still over the length limit, or still stuck on a "drop if stuck" crutch (hype), are dropped. Everything else is saved with **lint flags**, which show on the card and cost ×0.85 each in rank: hashtag, link, long for the platform, ties back to an earlier post, reads like a news report, @handle, number not in the source, quote not in the source, names someone not in the source, and for uncited evergreen posts: a statistic, quotation or name with nothing cited.

## The day's ten

Drafts land **held**. At each release hour (8, 12, 16, 20 by default) the held pool is ranked and a share is released to **Waiting**. The release runs whenever any studio tool is called after the hour (the board, the status check or the scheduled run), so batches appear on time as long as something touches the studio; missed batches run as one.

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
- **Edits.** When she changes a draft before approving it, the draft and her version are kept (`state/edits.json`, one record per draft, the latest edit wins, undoing the edit removes it) with what changed: she cut the opening question, cut the last line, cut it by a fifth or more, added to it, took out exclamation marks, hashtags, emojis or "we/our", added "we/our" or a number, and which words and two- or three-word phrases she removed. Her last four edits reach every brief, fenced, as "drafts she edited before approving (her version is the voice)", and her versions count as examples the drafter mustn't copy word for word.
- **Edit patterns become proposals.** In the weekly pass, a pattern that shows up in at least 3 of her edits and at least half of them (with 4 or more edits in 60 days) becomes one playbook proposal, written as a description of the brand ("Open with a plain statement, not a question") with its reason ("You cut the opening question in 7 of your last 9 edits."). A word or phrase she cut at least 3 times, from at least 3 of every 4 drafts that had it, becomes a proposal to add it to "phrases we overuse". Each is proposed once; one she accepted or rejected isn't proposed again for 60 days. Nothing changes until she taps Accept.
- **Skip reasons.** After a skip (or "none of these") the board asks once, optionally: off-brand, wrong topic, too salesy, boring, factually off, other. Ignoring it is fine. The reason is stored on the draft, cleared if she brings it back, shown on the Skipped tab, given to the drafter beside the killed post ("why: too salesy"), summed up in the triage queue, and counted in the weekly report.
- **Source records.** Each source's drafts approved of drafts decided over 6 weeks (a set counts once), shown on the Sources page ("4 of 5 approved"). A source with 5 or more decided and at most 1 in 5 approved, or 4 or more and none approved, is marked "Keeps losing … Pause it?" on Sources and Coach. It is never paused automatically.
- **What it drafts first.** Her topic weights move the drafting bar by one point. What it has learned moves it too, by up to 1.5 points either way, with the reasons shown on the Topics page ("What it drafts first") and on each read: per topic, the shrunk approve-vs-skip lift over 21 days (counted exactly like "learned from your verdicts") × 4, capped at ±0.75, plus 0.25 per read she hearted about it (at most 0.5), minus 0.25 per "wrong topic" skip (at most 0.5); per source, (its approval rate − her overall rate) × 2 once it has 3 decided, capped at ±0.75, plus 0.25 per hearted read from it (at most 0.5). Each kind is capped at ±1 and a story's total at ±1.5. It changes which stories are drafted and in what order, not how they're written.
- **Rank weights** move once a day at the first batch: from the last 14 days of released sets, passes vs kills (each side ≥ 4) give a gap per signal; posted results (above vs below median, each side ≥ 4) give another. `new = old + 0.5 · gap`, clipped to ±0.02 a day, ±0.1 against a week ago, and [0.05, 0.6]. If posts stall (≥ 6 measured posts in 3 days averaging under 0.5 interactions, or all identical), 0.02 moves from the heaviest weight to the lightest and the novelty budget rises.
- **Notes** queue a rewrite (at most 3 waiting at a time). The rewrite lands as a new version of the same draft; the old text is kept with the note. Posted drafts are never rewritten.
- **Redo** writes a new set for a story you passed on (at most 2 per story). The new set inherits the old set's daily slot and goes straight to Waiting.
- **Fingerprints**: pass and edit carry a hash of the text you saw. If a rewrite landed while the board was open, the action is refused and you see the new text.
- **Weekly coach**: the report is written in two parts. Playbook changes are proposed from the numbers alone (including skip reasons, edit patterns and how each source does), before Claude sees your notes, so a single grumpy note can't rewrite the rules. Then the coach report: what's working (2-3 lines), what isn't (1-3), two or three things to try, and a short summary, each line naming its evidence. It is stored per persona (`state/coach.json`, one per week) and shown on the board's Coach page with everything waiting for her yes; lines with a link, a handle or anything instruction-shaped are dropped, and coach text is never fed back into a brief. Audience and position suggestions come after. Every change is a proposal you accept or reject.
- **Taste log**: every triaged story is logged (seen, drafted, topic, source); the weekly report shows drafted-of-seen by topic and source over four weeks.

## Untrusted text

Everything read from outside (news, pages, subreddit posts, X and LinkedIn posts, trending topics, search results, pasted posts) and your own notes when they're fed back to Claude arrive inside `<data-NONCE>` tags, with a fresh random nonce per brief, a guard sentence explaining that it is data and never instructions, control characters stripped, each field capped at 1200 characters, and any fence tags inside the content neutralised. The fencer is one shared, tested function (`server/lib/fence.js`). Model text stored as the brand's own view (proposals, wander findings) must pass an own-words check: no instruction-shaped text, no links or handles, and no ≥ 50% echo of the source.

Your own settings are fenced too. The voice, playbook, positions and audience reach Claude inside the same tags, introduced as a description of the brand rather than instructions, so one bad write can't become a standing order in every brief. Saving `voice.md`, `playbook.md`, `positions.json` or `audience.json` through `studio_config` is refused if it contains instruction-shaped text ("ignore previous…", "from now on", "always write…"); describe the brand instead. `studio_config` reads and writes only the files listed above, and the store refuses any path outside the data folder.

In the chat review list, story headlines never share a line with a `[draft · hash]` marker: they come last, fenced, keyed by list number.

Pages she pastes with "Draft from a link", and everything Claude reads on a social site or in a search, are outside text like any feed: cleaned the same way on the way in, fenced the same way in the brief. A post's text never becomes an instruction, a setting or something to fetch: links in posts are stored for her to open and never fetched, and a new source only ever arrives as a suggestion she taps (see Discovery). Feed titles that become source names are flattened and dropped if instruction-shaped. Persona names are flattened, capped at 60 and refused if instruction-shaped.

## Tools

| Tool | Purpose |
|---|---|
| `studio_personas` | list, create, switch or rename personas |
| `studio_status` | setup state, counter, waiting, jobs; runs due releases |
| `studio_board` | opens the board (MCP App) and returns a text fallback |
| `studio_view` | board data and text: drafts tabs, reads, coach, playbook, settings, sources, topics, schedule |
| `studio_act` | pass, edit, kill (optional reason), kill_reason, pick, none, redo, restore, resurrect, heart, note, draft_this, mark_posted, unpost |
| `studio_config` | get/set/patch the files in the persona's folder, with validation |
| `studio_sources` | suggest a source (it waits for her tap), or pause, resume, re-file or remove one |
| `studio_source_add` | add a source (website or subreddit test-fetched; account, trends, search); board only, hidden from Claude |
| `studio_read_queue`, `studio_record_reads` | the accounts, trends and searches Claude reads, and what it read |
| `studio_accounts` | list account slots and which are connected |
| `studio_account_set` | connect (by prompt) or remove an account; board only, hidden from Claude |
| `studio_topics` | add, remove or weight a topic |
| `studio_draft_link` | fetch one article and queue it to be drafted |
| `studio_fetch` | fetch, dedupe and store news (respects the news frequency unless `force`) |
| `studio_wander`, `studio_record_wander` | curiosity reading |
| `studio_triage_queue`, `studio_record_triage` | triage |
| `studio_drafting_brief`, `studio_save_takes` | the drafting loop |
| `studio_release` | rank and release the due batch |
| `studio_weekly_brief`, `studio_save_weekly` | the weekly coach report (and edit-pattern proposals) |
| `studio_proposals` | list or propose changes (Claude): playbook, position, audience, shape, phrase |
| `studio_proposal_decide` | accept or reject a proposal, including a suggested source; board only, hidden from Claude |

**Which new tools change what's read or what the voice says, and how they're held back.** Adding a source of any kind: board only (`studio_source_add`), because a source is a standing fetch or read target. Claude suggesting one: proposal (`studio_sources` suggest), because Claude may have been told about it by something it read. Edit patterns and overused phrases: proposals, because they change every future brief. Discovery: proposal, for the same reason as suggestions. Connecting an account: board only. Recording what Claude read (`studio_record_reads`): neither, because it only adds fenced stories, never targets. Skip reasons and learned boosts: neither; like verdicts, they move ranking, not the voice or the sources.

## Account slots

`accounts/` holds one small file per account type (`x.json`, `linkedin.json`, `reddit.json`, `bluesky.json`): its label, icon, what it would enable, a `connect` prompt, and `capabilities` `{read, post}`, each `false` (not built), `"prompt"` (only when she asks Claude in chat) or `true`. All are `false` today. Adding a type is adding a file.

Settings › Accounts lists them. **Add account** records the account as `connected_by_prompt` (type and time, nothing else: no password, token or cookie is ever stored) and sends the type's prompt to Claude, which walks her through signing in herself, in her own browser. That is all it does today. Two hooks wait for later: a watched account's `via` can name an account slot once that type can read (above), and `handOff()` in `accounts.js` is where an approved draft would be handed to an account's `post` capability, through an official API or a scheduler service, never browser automation. It refuses today: posting stays copy and paste.
| `studio_metrics` | enter post numbers or import a CSV |

Every tool except `studio_personas` also takes `persona`.

## The board

Sections: Drafts, Sources, Topics, Schedule, Settings, then Reads, Coach and Playbook, with the persona switcher at the top of the sidebar. Coach carries a badge for proposals waiting for her yes, Sources one for suggested sources. Every setting is a control that saves on click (switch, − / + stepper, segmented choice, hour chips, preset cards); text fields appear only for text (an address, a name, an example post, a note). Lint flags are shown as plain-language chips; "Approve" and "Skip" are the pass and kill verdicts (Skip teaches, like kill always did, and **Bring back** undoes it with a reason).

- **Look.** All colours, radii, type sizes, spacing, shadows and layout widths are CSS custom properties in `server/ui/skins/light.css`; `board.css` only refers to them (a test fails on any literal colour there). A second skin is one more file in `skins/` scoped to `:root[data-skin="<name>"]`; every skin file is bundled, and a skin named after the host theme (e.g. `dark.css`) is used when the host reports that theme. Without one the board stays light. The host's font is used when it provides one.
- **Layout.** Over 900 px: sidebar, page, and (over 1180 px) a right column. 641-900 px (a chat-width window): the sidebar becomes a strip of icons with short labels. 640 px and under: a menu button opens the sidebar as a drawer. The board sits in an auto-height iframe, so nothing is fixed to the viewport or sized in `vh` (a bottom tab bar would sit at the end of the page, not the bottom of the screen).

## What changed from the original agent

- No world simulation, personas (the original's simulated people), posting or memes. What it reads: RSS and Atom feeds and public subreddit feeds (fetched by the server), pages she pastes, and the public, logged-out pages of the X and LinkedIn accounts she chose plus X trending topics and her saved web searches, which Claude reads with its own browser and web search tools during a run and hands back as fenced text. No logins, no cookies, no credentials, no crawling beyond the addresses she approved, and no automated clicking or typing on any site.
- Takes in a set each get their own shape (the original shared one shape per set).
- The playbook, positions and audience change only by proposals she accepts on the board (Claude can propose, never accept), or when she edits them with Claude in setup.
- Autopass became "our pick": the best-ranked take is highlighted, never approved.
- "Post this" from a triage note was folded into "Draft this", which writes proper takes.
- Added: story-level dedupe, a real named-person check, per-platform settings, manual metrics and CSV import.
