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

A light, roomy dashboard inside Claude: a sidebar on the left, today's counter across the top (**"4 of 10 today · 3 held · next batch 16:00"**), and a **Full screen** button when the chat feels cramped. In a chat-width window the sidebar shrinks to a strip of icons; on a phone it becomes a menu.

At the top of the sidebar is the **brand switcher**: one studio per brand you write for (we call them personas), each with its own drafts, sources, topics and voice. **Add persona** starts a fresh one with a three-step "here's how this works" card.

- **Drafts** reads like a feed. Each draft is a post with your brand's name and handle, the text, a character-count ring and an action row: **Approve**, **Edit** (right in the card, with the ring counting as you type), **Skip**, ♡, and **Rewrite** (leave a note; Claude rewrites it). Anything worth a second look shows as a friendly chip under the post ("Check the number: 7 isn't in the story"). The story it's about sits under the post like a quoted link, and **Why it wrote this** folds out the reasoning. When it wrote several takes on one story you see them together and pick one (**Best bet** marks its favourite), or say **None of these…** with a quick reason and **try again**. Tabs: **To review**, **Approved** (with **Copy · LinkedIn · 612/3000**, **Mark as posted**, **Add numbers**), **Skipped** and **Expired**, each with a **Bring back**. Filter by platform or by "Pick one", "Needs a look" and so on. On a wide screen, a side column shows today's numbers and all your brands with what's waiting.
- **Sources**: the sites it reads, each with an on/off switch, a topic picker and a status ("Active", "Paused", "Not responding"). Paste a website to add it (it finds the feed and checks it works). **Draft from a link**: paste one article and it becomes a draft with the next run, or ask Claude to draft it now.
- **Topics**: what it pays attention to, each set to **Less**, **Normal** or **More**, and **Learned from your verdicts**: what it has noticed you approve or skip, and why ("Posts about policy: you approved 0 of 6 in the last 3 weeks").
- **Schedule**: how often to read the news (every hour, every 3 hours, twice a day, once a day, or weekdays), which hours drafts arrive (tap to toggle), and the exact scheduled task to set up in Claude, with copy buttons.
- **Settings**: platforms (switches), drafts a day and evergreen posts a day (− / + steppers), takes per story (1, 2 or 3), voice examples and phrases you overuse. Everything saves as you click.
- **Reads** shows every story it read, with its one-line reaction and interest score, and a **Draft this** button. **Playbook** shows the rules it's learned, your brand's positions, who you write for, and suggested changes waiting for your yes or no.

If the board can't appear (some Claude windows don't show it), just say "review my drafts" and do it all in chat: *"pass 1a, kill 2, edit 3: …"*.

## Install it (4 steps)

1. In the Claude desktop app, open **Customize → Plugins**.
2. Click **Add marketplace** and enter `OWNER/fishbowl-studio`.
3. Install **Fishbowl Studio**.
4. Start a Cowork session and type **`/studio:setup`**. Claude will ask about nine short questions: your brand, your audience, your voice (paste a few posts and it learns it), what the brand believes, what to read, and how many posts you want. At the end it tells you exactly how to make it run every weekday.

It needs Claude's desktop app on your computer, with Node.js available (see [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md)). Everything it keeps lives in one folder you can open: **Documents → Fishbowl Studio**, with one folder per brand inside **personas**. If you used an earlier version, your studio moves into **personas** by itself the first time this one starts; nothing is lost.

**How it runs on its own.** A plugin can't start itself: Claude runs it from a scheduled task in Cowork that you set once. The board's **Schedule** page shows exactly what to type for the news setting you choose. If Claude runs sooner than your setting (say the task runs hourly and you chose "every 3 hours"), the studio skips reading the news that time and just releases what's due. One task runs all your brands.

## Handy things to say

- "Show my studio board" · "Review my drafts" · "Do my rewrites"
- "Run the studio now" (`/studio:run`)
- "Add this feed: …" (`/studio:add-source`) · "Draft a post from this link: …"
- "Set up another brand" · "Switch to my other brand"
- "Learn my voice from these posts" (`/studio:voice`)
- "Write three evergreen posts" · "Weekly report"
- "Import these numbers" (attach the CSV export from LinkedIn or X analytics)

## What it will never do

- **Post for you.** There is no posting code in it at all. You copy and post.
- **Read your messages, DMs, inbox or accounts.** It only reads the public news feeds you approve.
- **Send anything anywhere.** No analytics, no tracking, no servers of ours. Its only outbound traffic is fetching the feeds you list and the links you paste. Your drafts, notes and numbers stay in your Documents folder.
- **Change what your brand believes.** It can suggest a change to your positions or playbook; nothing changes until you click Accept.
- **Name private people.** A draft that names someone who isn't in the story is sent back for a rewrite, and flagged on the board if the name survives.
- **Make memes or images.** Words only.

## For the curious

- [How it works](docs/HOW-IT-WORKS.md): the pipeline, the ranking formula, how it learns.
- [Assumptions](docs/ASSUMPTIONS.md): platform behaviour we couldn't verify yet.
- Developers: `npm test`, `npm run dev` (a local board at http://localhost:7611 with two fictional demo brands; add `?view=sources&width=390` to open a section at phone width), `npm run shots` (screenshots of every section at desktop and phone width into `dev/shots/`, needs Chrome), `npm run pack` (a zip for Upload plugin). No dependencies. The board's look is one tokens file, `server/ui/skins/light.css`; a new skin is one more file beside it.

MIT licence · © Fishbowl Studio contributors
