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
| `sources.json` | news feeds and the reading list, each can be paused | you (board Sources, or `/studio:add-source`) |
| `positions.json` | what the brand believes, strength 1-5 | you; Claude only proposes |
| `audience.json` | who you write for and their "buttons" | you; Claude only proposes |
| `playbook.md` | the learned rules injected into every draft | you; Claude only proposes |
| `shapes.json` | shapes learned from posts you admire | you accept them on the board |
| `reports/weekly-*.md` | weekly reports | written by the weekly skill |
| `state/*.json` | bookkeeping: items, drafts, verdicts, notes, hearts, jobs, proposals, weights | the server |

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
2. `studio_fetch`: every feed in `sources.json` that isn't paused. It first checks her **news frequency** (below) and skips the fetch, saying why, if it is too soon. The feed parser is hand-written and tolerant (RSS 2.0, RSS 1.0, Atom), refuses DTDs and entities, strips HTML, keeps HTTPS links only, takes 12 items per feed and at most 3 MB per fetch (it parses the first 1 MB and 200 items, in one linear pass). Redirects are followed by hand, at most 5, and every hop must be a public HTTPS host name; hosts that resolve to private, loopback or link-local addresses are refused. Titles, summaries and authors are flattened to one line with control, format and Unicode tag characters removed. A dead feed is reported and the rest carry on.
   - **Dedupe**: exact URL (normalised: tracking parameters, `www.`, fragments and trailing slashes removed) and **story level**: titles are normalised (outlet suffix and punctuation dropped, light stemming) and compared by Jaccard similarity (≥ 0.5) or containment (≥ 0.8 for 4+ words) within 72 hours. The first outlet's item represents the story; the others are recorded as "also covered by" and feed the trending signal.
   - **Ageing**: items older than 30 days with no drafts are pruned. Only items from the last 48 hours are drafted.
3. `studio_wander` / `studio_record_wander` (up to twice): slow curiosity reading over the reading list. The source is chosen by topic interest (7-day mean triage interest, default 4, plus up to 3 for curiosity keywords seen recently), neglect (every third trip takes the least recently visited source), and caps (12 visits a day, same host at most every 2 h, same source every 24 h). Instruction-shaped entries are dropped. Findings never become drafts directly; they feed evergreen posts.
4. `studio_triage_queue` / `studio_record_triage`: the newest 40 untriaged stories, one per story cluster. Claude writes a one-line private reaction, a 0-10 interest score and a topic. These show on the Reads tab and feed the taste log.
5. `studio_drafting_brief` / `studio_save_takes`, in a loop. The work queue is: queued rewrites, redos and "draft this" requests, then stories with interest ≥ 6 (up to `drafts_per_run`, 12 by default), then evergreen posts (2 a day by default).
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

- **Sources** (`studio_sources`): `add` takes an address and test-fetches it through the same safe path as the feeds (below). A feed is used as is; a web page is searched for its `<link rel="alternate" type="application/rss+xml|atom+xml">` and that feed is fetched instead, if it too is a public HTTPS address. The name is hers if given, else the feed's title (flattened to one line, capped at 80, and replaced by the host name if it reads like an instruction), else the host. `pause`, `resume`, `remove` and `topic` (re-file under one of her topics) find the source by normalised address. Every write goes through the `sources.json` validator.
- **Topics** (`studio_topics`): `add` turns "Cargo bikes" into the slug `cargo-bikes`, `remove` drops it (and re-files its sources under "other"), `weight` sets 1 (less), 2 (normal) or 3 (more). Weights move the drafting bar by one point: a story's interest counts one higher on a "more" topic and one lower on a "less" one, for both the threshold (6) and the order. They also tilt wandering the same way, and the triage queue tells Claude plainly which topics she wants more or less of. Every write goes through the `beat.json` validator.
- **Draft from a link** (`studio_draft_link`): one article address, checked like a source address and fetched through the same path (HTTPS, public hosts only, redirects followed by hand and checked at every hop, private addresses refused, 3 MB cap). The page is parsed in linear passes: title (Open Graph title or `<title>`), description, and the paragraphs of its `<article>` or `<main>`, with scripts, styles and tags removed, entities decoded, flattened to one line, control and invisible characters stripped, fence tags neutralised, capped at 3,000 characters. A feed pasted here is refused with "add it under Sources". It is stored as a story marked `from_link`, skips triage (she chose it), and is queued as a "draft this" job; the brief fences the page exactly like a feed item and adds one line, outside the fence, that she sent the link herself. Pasting the same article again while it waits queues it once; an article already read from a feed is reused rather than fetched again.

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
- **Rank weights** move once a day at the first batch: from the last 14 days of released sets, passes vs kills (each side ≥ 4) give a gap per signal; posted results (above vs below median, each side ≥ 4) give another. `new = old + 0.5 · gap`, clipped to ±0.02 a day, ±0.1 against a week ago, and [0.05, 0.6]. If posts stall (≥ 6 measured posts in 3 days averaging under 0.5 interactions, or all identical), 0.02 moves from the heaviest weight to the lightest and the novelty budget rises.
- **Notes** queue a rewrite (at most 3 waiting at a time). The rewrite lands as a new version of the same draft; the old text is kept with the note. Posted drafts are never rewritten.
- **Redo** writes a new set for a story you passed on (at most 2 per story). The new set inherits the old set's daily slot and goes straight to Waiting.
- **Fingerprints**: pass and edit carry a hash of the text you saw. If a rewrite landed while the board was open, the action is refused and you see the new text.
- **Weekly**: the report is written in two parts. Playbook changes are proposed from the numbers alone, before Claude sees your notes, so a single grumpy note can't rewrite the rules. Audience and position suggestions come after. Every change is a proposal you accept or reject.
- **Taste log**: every triaged story is logged (seen, drafted, topic, source); the weekly report shows drafted-of-seen by topic and source over four weeks.

## Untrusted text

Everything read from outside (news, pages, pasted posts) and your own notes when they're fed back to Claude arrive inside `<data-NONCE>` tags, with a fresh random nonce per brief, a guard sentence explaining that it is data and never instructions, control characters stripped, each field capped at 1200 characters, and any fence tags inside the content neutralised. The fencer is one shared, tested function (`server/lib/fence.js`). Model text stored as the brand's own view (proposals, wander findings) must pass an own-words check: no instruction-shaped text, no links or handles, and no ≥ 50% echo of the source.

Your own settings are fenced too. The voice, playbook, positions and audience reach Claude inside the same tags, introduced as a description of the brand rather than instructions, so one bad write can't become a standing order in every brief. Saving `voice.md`, `playbook.md`, `positions.json` or `audience.json` through `studio_config` is refused if it contains instruction-shaped text ("ignore previous…", "from now on", "always write…"); describe the brand instead. `studio_config` reads and writes only the files listed above, and the store refuses any path outside the data folder.

In the chat review list, story headlines never share a line with a `[draft · hash]` marker: they come last, fenced, keyed by list number.

Pages she pastes with "Draft from a link" are outside text like any feed: cleaned the same way on the way in, fenced the same way in the brief. Feed titles that become source names are flattened and dropped if instruction-shaped. Persona names are flattened, capped at 60 and refused if instruction-shaped.

## Tools

| Tool | Purpose |
|---|---|
| `studio_personas` | list, create, switch or rename personas |
| `studio_status` | setup state, counter, waiting, jobs; runs due releases |
| `studio_board` | opens the board (MCP App) and returns a text fallback |
| `studio_view` | board data and text: drafts tabs, reads, playbook, settings, sources, topics, schedule |
| `studio_act` | pass, edit, kill, pick, none, redo, restore, resurrect, heart, note, draft_this, mark_posted, unpost |
| `studio_config` | get/set/patch the files in the persona's folder, with validation |
| `studio_sources` | add (test-fetched), pause, resume, re-file or remove a source |
| `studio_topics` | add, remove or weight a topic |
| `studio_draft_link` | fetch one article and queue it to be drafted |
| `studio_fetch` | fetch, dedupe and store news (respects the news frequency unless `force`) |
| `studio_wander`, `studio_record_wander` | curiosity reading |
| `studio_triage_queue`, `studio_record_triage` | triage |
| `studio_drafting_brief`, `studio_save_takes` | the drafting loop |
| `studio_release` | rank and release the due batch |
| `studio_weekly_brief`, `studio_save_weekly` | the weekly report |
| `studio_proposals` | list or propose changes (Claude) |
| `studio_proposal_decide` | accept or reject a proposal; board only, hidden from Claude |
| `studio_metrics` | enter post numbers or import a CSV |

Every tool except `studio_personas` also takes `persona`.

## The board

Sections: Drafts, Sources, Topics, Schedule, Settings, then Reads and Playbook, with the persona switcher at the top of the sidebar. Every setting is a control that saves on click (switch, − / + stepper, segmented choice, hour chips, preset cards); text fields appear only for text (an address, a name, an example post, a note). Lint flags are shown as plain-language chips; "Approve" and "Skip" are the pass and kill verdicts (Skip teaches, like kill always did, and **Bring back** undoes it with a reason).

- **Look.** All colours, radii, type sizes, spacing, shadows and layout widths are CSS custom properties in `server/ui/skins/light.css`; `board.css` only refers to them (a test fails on any literal colour there). A second skin is one more file in `skins/` scoped to `:root[data-skin="<name>"]`; every skin file is bundled, and a skin named after the host theme (e.g. `dark.css`) is used when the host reports that theme. Without one the board stays light. The host's font is used when it provides one.
- **Layout.** Over 900 px: sidebar, page, and (over 1180 px) a right column. 641-900 px (a chat-width window): the sidebar becomes a strip of icons with short labels. 640 px and under: a menu button opens the sidebar as a drawer. The board sits in an auto-height iframe, so nothing is fixed to the viewport or sized in `vh` (a bottom tab bar would sit at the end of the page, not the bottom of the screen).

## What changed from the original agent

- No world simulation, personas, posting, scraping or memes.
- Takes in a set each get their own shape (the original shared one shape per set).
- The playbook, positions and audience change only by proposals she accepts on the board (Claude can propose, never accept), or when she edits them with Claude in setup.
- Autopass became "our pick": the best-ranked take is highlighted, never approved.
- "Post this" from a triage note was folded into "Draft this", which writes proper takes.
- Added: story-level dedupe, a real named-person check, per-platform settings, manual metrics and CSV import.
