# How Fishbowl Studio works

Fishbowl Studio is a Claude plugin with three parts:

1. **A local MCP server** (`server/`, plain Node.js, no dependencies). It does the bookkeeping: reading feeds, dedupe, ranking, release times, verdicts, caps and learning. Every formula lives here as a small pure function with tests.
2. **Skills and commands** (`skills/`, `commands/`). They tell Claude what to do at each step: react to stories, write takes, rewrite from notes, write the weekly report. Claude does the thinking; the server hands it exactly the context it needs and checks what comes back.
3. **The board** (`server/ui/`), an MCP App: one self-contained HTML page rendered inside the chat. Every button calls a server tool through the host bridge.

The model never sees raw files and the server never writes prose.

## The data folder

Everything lives in one folder, `~/Documents/Fishbowl Studio/` by default (set `STUDIO_HOME` to move it). Files you might open:

| File | What it is | Who changes it |
|---|---|---|
| `settings.json` | platforms, daily cap, release times, takes per story, overused phrases | you (board Settings or Claude) |
| `voice.md` | the brand and its voice | you, via `/studio:voice` |
| `voice-samples.json` | posts you pasted as examples | you |
| `beat.json` | topics, off-limits list, curiosity keywords, names you allow | you, via setup |
| `sources.json` | news feeds and the reading list | you, via `/studio:add-source` |
| `positions.json` | what the brand believes, strength 1-5 | you; Claude only proposes |
| `audience.json` | who you write for and their "buttons" | you; Claude only proposes |
| `playbook.md` | the learned rules injected into every draft | you; Claude only proposes |
| `shapes.json` | shapes learned from posts you admire | you accept them on the board |
| `reports/weekly-*.md` | weekly reports | written by the weekly skill |
| `state/*.json` | bookkeeping: items, drafts, verdicts, notes, hearts, jobs, proposals, weights | the server |

All writes are atomic (temp file + rename) under a folder lock, so a scheduled run and an open board can't overwrite each other.

## The daily pipeline

The scheduled task asks Claude to "Run the Fishbowl Studio daily run". The `daily-run` skill then calls:

1. `studio_status`: setup check, plus any release that is due.
2. `studio_fetch`: every feed in `sources.json`. The feed parser is hand-written and tolerant (RSS 2.0, RSS 1.0, Atom), refuses DTDs and entities, strips HTML, keeps HTTPS links only, takes 12 items per feed and at most 3 MB per fetch. A dead feed is reported and the rest carry on.
   - **Dedupe**: exact URL (normalised: tracking parameters, `www.`, fragments and trailing slashes removed) and **story level**: titles are normalised (outlet suffix and punctuation dropped, light stemming) and compared by Jaccard similarity (≥ 0.5) or containment (≥ 0.8 for 4+ words) within 72 hours. The first outlet's item represents the story; the others are recorded as "also covered by" and feed the trending signal.
   - **Ageing**: items older than 30 days with no drafts are pruned. Only items from the last 48 hours are drafted.
3. `studio_wander` / `studio_record_wander` (up to twice): slow curiosity reading over the reading list. The source is chosen by topic interest (7-day mean triage interest, default 4, plus up to 3 for curiosity keywords seen recently), neglect (every third trip takes the least recently visited source), and caps (12 visits a day, same host at most every 2 h, same source every 24 h). Instruction-shaped entries are dropped. Findings never become drafts directly; they feed evergreen posts.
4. `studio_triage_queue` / `studio_record_triage`: the newest 40 untriaged stories, one per story cluster. Claude writes a one-line private reaction, a 0-10 interest score and a topic. These show on the Reads tab and feed the taste log.
5. `studio_drafting_brief` / `studio_save_takes`, in a loop. The work queue is: queued rewrites, redos and "draft this" requests, then stories with interest ≥ 6 (up to `drafts_per_run`, 12 by default), then evergreen posts (2 a day by default).
6. `studio_release`: rank and release the due batch.

Running the skill twice is harmless: fetched items dedupe, triaged items aren't re-queued, drafted stories aren't drafted again, and each batch releases once.

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

## Tools

| Tool | Purpose |
|---|---|
| `studio_status` | setup state, counter, waiting, jobs; runs due releases |
| `studio_board` | opens the board (MCP App) and returns a text fallback |
| `studio_view` | board data and text: drafts tabs, reads, playbook, settings |
| `studio_act` | pass, edit, kill, pick, none, redo, restore, resurrect, heart, note, draft_this, mark_posted, unpost |
| `studio_config` | get/set/patch the files in the data folder, with validation |
| `studio_fetch` | fetch, dedupe and store news |
| `studio_wander`, `studio_record_wander` | curiosity reading |
| `studio_triage_queue`, `studio_record_triage` | triage |
| `studio_drafting_brief`, `studio_save_takes` | the drafting loop |
| `studio_release` | rank and release the due batch |
| `studio_weekly_brief`, `studio_save_weekly` | the weekly report |
| `studio_proposals` | list, accept, reject or propose changes |
| `studio_metrics` | enter post numbers or import a CSV |

## What changed from the original agent

- No world simulation, personas, posting, scraping or memes.
- Takes in a set each get their own shape (the original shared one shape per set).
- The playbook, positions and audience change only by proposals she accepts.
- Autopass became "our pick": the best-ranked take is highlighted, never approved.
- "Post this" from a triage note was folded into "Draft this", which writes proper takes.
- Added: story-level dedupe, a real named-person check, per-platform settings, manual metrics and CSV import.
