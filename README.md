# Fishbowl Studio

**A drafting studio for the person who writes a brand's LinkedIn and X posts.**

Every weekday morning, Fishbowl Studio reads the news on your brand's beat, decides what's worth talking about, and drafts a few different takes on each story in your brand's voice. Through the day it puts the best of them on a review board inside Claude. You pass the good ones, fix the nearly-good ones, kill the rest, and leave a note when something's off. It learns from every verdict. When you're happy with a post, you copy it and post it yourself.

It runs inside the Claude desktop app as a plugin. There's nothing to host and no account to create.

## Your day with it

- **7:00.** While you're making coffee, the studio reads your news feeds, drops duplicates (the same story from five outlets counts once), and gives each story an honest interest score. It writes three takes for each story worth it, each built a different way: one leads with the concrete detail, one asks the question the story raises, one says plainly what the brand thinks.
- **8:00, 12:00, 16:00, 20:00.** A few drafts appear on your board at each time, up to ten a day, best first. Stale ones are quietly cleared away so you never review yesterday's news.
- **Whenever you like.** Open the board, pick the best take from each set, tweak a word, pass it, copy it, post it. Leave a note like "too preachy" and Claude rewrites it. Say "none of these" and ask for a redo.
- **Fridays.** A short report: what worked, what didn't, and a few suggested changes to your playbook that you accept or reject with one click.

## What the board looks like

A single column of cards, light or dark to match Claude, comfortable on a narrow window.

Across the top: your brand name and a counter like **"4 of 10 today · 3 held · next batch 16:00 · 1 scrapped"**, with tabs for **Drafts**, **Reads**, **Playbook** and **Settings**.

**Drafts** has four tabs: **Waiting**, **Passed**, **Killed** and **Scrapped**, with filter chips (sets, singles, experiments, flagged, LinkedIn, X).

- A **set** card shows the story it's about, then three takes side by side, each with its own character count and a **Pick this one** button. One is marked "our pick". Below them: **None of these…**, with quick reasons ("too generic", "wrong tone") and **Redo**.
- A **single** card shows the post in large type, the story underneath, small marks (the shape it used, any warnings such as "number not in source"), and a fold-out **Thinking** with the private reasoning behind it. Buttons: **♡**, **Edit**, **Pass**, **Kill**, **Note**.
- A **passed** card has a big **Copy · LinkedIn · 612/3000** button, then **Mark posted** (paste the link if you like) and **Numbers**, where you type in likes and views later so it learns what actually lands.
- **Killed** cards can be **restored** if you change your mind, with a line on why. **Scrapped** cards (never shown, or went stale) can be **resurrected**.

**Reads** shows every story it read, with its one-line reaction and interest score, and a **Draft this** button for anything it skipped that you want. **Playbook** shows the rules it's learned, your brand's positions, who you write for, and any suggested changes waiting for a yes or no. **Settings** lets you choose platforms, release times and how many drafts a day.

If the board can't appear (some Claude windows don't show it), just say "review my drafts" and do it all in chat: *"pass 1a, kill 2, edit 3: …"*.

## Install it (4 steps)

1. In the Claude desktop app, open **Customize → Plugins**.
2. Click **Add marketplace** and enter `OWNER/fishbowl-studio`.
3. Install **Fishbowl Studio**.
4. Start a Cowork session and type **`/studio:setup`**. Claude will ask about nine short questions: your brand, your audience, your voice (paste a few posts and it learns it), what the brand believes, what to read, and how many posts you want. At the end it tells you exactly how to make it run every weekday.

It needs Claude's desktop app on your computer, with Node.js available (see [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md)). Everything it keeps lives in one folder you can open: **Documents → Fishbowl Studio**.

## Handy things to say

- "Show my studio board" · "Review my drafts" · "Do my rewrites"
- "Run the studio now" (`/studio:run`)
- "Add this feed: …" (`/studio:add-source`)
- "Learn my voice from these posts" (`/studio:voice`)
- "Write three evergreen posts" · "Weekly report"
- "Import these numbers" (attach the CSV export from LinkedIn or X analytics)

## What it will never do

- **Post for you.** There is no posting code in it at all. You copy and post.
- **Read your messages, DMs, inbox or accounts.** It only reads the public news feeds you approve.
- **Send anything anywhere.** No analytics, no tracking, no servers of ours. Its only outbound traffic is fetching the feeds you list. Your drafts, notes and numbers stay in your Documents folder.
- **Change what your brand believes.** It can suggest a change to your positions or playbook; nothing changes until you click Accept.
- **Name private people.** A draft that names someone who isn't in the story is sent back for a rewrite, and flagged on the board if the name survives.
- **Make memes or images.** Words only.

## For the curious

- [How it works](docs/HOW-IT-WORKS.md): the pipeline, the ranking formula, how it learns.
- [Assumptions](docs/ASSUMPTIONS.md): platform behaviour we couldn't verify yet.
- Developers: `npm test`, `npm run dev` (a local board at http://localhost:7611 with a fictional demo brand), `npm run pack` (a zip for Upload plugin). No dependencies.

MIT licence · © Fishbowl Studio contributors
