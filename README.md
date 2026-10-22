# Fishbowl Studio

**A drafting studio for the person who writes a brand's LinkedIn, X, Threads and Bluesky posts.**

> **You need:** the Claude desktop app and a paid Claude plan that includes **Cowork**, plus Node.js on your computer (see [Install it](#install-it-4-steps)). It doesn't work on the free plan or in the browser.

Every weekday morning, Fishbowl Studio reads the news on your brand's beat, and the places your audience actually talks (subreddits, the X and LinkedIn accounts you watch, your saved searches), decides what's worth talking about, and drafts a few different takes on each story in your brand's voice. Through the day it puts the best of them on a review board inside Claude. You pass the good ones, fix the nearly-good ones, kill the rest, and leave a note when something's off. It learns from every verdict, every edit you make and every reason you give for a skip, so it writes more like you the more you use it. When you're happy with a post, you copy it and post it yourself, or, if you've turned **Post for me** on for that account, Claude posts it for you at the next release time.

It runs inside the Claude desktop app as a plugin. There's nothing to host and no account to create.

## Your day with it

- **7:00.** While you're making coffee, the studio reads your news feeds and subreddits, Claude looks at the public pages of the accounts you watch and runs your saved searches, duplicates are dropped (the same story from five outlets counts once), and each story gets an honest interest score. Stories like the ones you approve and heart move up the queue. It writes three takes for each story worth it, each built a different way: one leads with the concrete detail, one asks the question the story raises, one says plainly what the brand thinks.
- **8:00, 12:00, 16:00, 20:00.** A few drafts appear on your board at each time, up to ten a day, best first. Stale ones are quietly cleared away so you never review yesterday's news.
- **Whenever you like.** Open the board, pick the best take from each set, tweak a word, pass it, copy it, post it. Leave a note like "too preachy" and Claude rewrites it. Say "none of these" and ask for a redo.
- **If you turned on Post for me.** A few minutes after each release time, Claude posts what you approved, in your own signed-in browser. If your laptop was asleep, the board says the slot was missed and why; it never posts late or retries by itself.
- **Fridays.** Your coach: a short report per brand on the board (what's working, what isn't, two or three things to try) and the changes it suggests, each with its reason ("you cut the opening question 7 of 9 times"). You accept or reject each with one tap; nothing about your voice changes without it.

## What the board looks like

A light, roomy dashboard inside Claude: a sidebar on the left, today's counter across the top (**"4 of 10 today · 3 held · next batch 16:00"**), and a **Full screen** button when the chat feels cramped. In a chat-width window the sidebar shrinks to a strip of icons; on a phone it becomes a menu.

At the top of the sidebar is the **brand switcher**: one studio per brand you write for (we call them personas), each with its own drafts, sources, topics and voice. **Add persona** opens the **setup wizard**, the same one `/studio:setup` and a new brand's first-run card open:

1. **The brand**: its name, and if you like its website or LinkedIn page.
2. **A few questions**: who the posts are for, how it should sound, what it should talk about, what's off limits. Each has an example; skip any of them.
3. **Claude's drafts**: Claude writes a first voice, playbook, topics, off-limits list, audience and starter sources. Each line is a suggestion: change it and **Keep** it, or **Drop** it. Nothing is used, and no source is read, until you keep or add it. The site you linked is read as outside text: it can't change your settings or add itself as a source.
4. **Posting**: **Post for me**, per connected account, off unless you turn it on.

Then **Set it up for me** asks Claude to make the scheduled task (you approve it once). Close the wizard any time; your answers are kept and it picks up where you left off.

- **Drafts** reads like a feed. Each draft is a post with your brand's name and handle, the text, a character-count ring and an action row: **Approve**, **Edit** (right in the card, with the ring counting as you type), **Skip**, ♡, and **Rewrite** (leave a note; Claude rewrites it). Anything worth a second look shows as a friendly chip under the post ("Check the number: 7 isn't in the story"). The story it's about sits under the post like a quoted link, and **Why it wrote this** folds out the reasoning. When it wrote several takes on one story you see them together and pick one (**Best bet** marks its favourite), or say **None of these…** with a quick reason and **try again**. After **Skip** it asks, once and optionally, why: **Off-brand**, **Wrong topic**, **Too salesy**, **Boring**, **Factually off** or **Other**. Tabs: **To review**, **Approved** (with **Copy · LinkedIn · 612/3000**, **Mark as posted**, **Add numbers**), **Skipped** and **Expired**, each with a **Bring back**. Filter by platform or by "Pick one", "Needs a look" and so on. On a wide screen, a side column shows today's numbers and all your brands with what's waiting.
- **Sources**: everything it reads, each with an on/off switch, a topic picker, a status ("Active", "Paused", "Not responding", "Asks to log in") and its record ("4 of 5 approved"; one that keeps losing says "Pause it?", but only you pause it). Add a **website** (it finds the feed and checks it works), a **subreddit** (`r/name`), an **X or LinkedIn account** to watch (`@handle` or the page's address), **X trending topics**, or a **saved search** ("bike commuting"). **Suggested sources** at the top are sites that kept showing up in good search results, or that Claude suggested in chat: nothing there is read until you tap **Add**. **Draft from a link**: paste one article and it becomes a draft with the next run, or ask Claude to draft it now.
- **Topics**: what it pays attention to, each set to **Less**, **Normal** or **More**; **Learned from your verdicts**: what it has noticed you approve or skip, and why ("Posts about policy: you approved 0 of 6 in the last 3 weeks"); **What it drafts first**: the stories it moves up or down because of that ("Because: you hearted 2 reads about cargo"); and **From your edits**: what you keep changing.
- **Schedule**: how often to read the news (every hour, every 3 hours, twice a day, once a day, or weekdays), which hours drafts arrive (tap to toggle), and the scheduled tasks it needs: **Set it up for me** asks Claude to create them (you approve each once), or set them up by hand with copy buttons.
- **Settings**: platforms (LinkedIn, X, Threads, Bluesky: switches), drafts a day and evergreen posts a day (− / + steppers), takes per story (1, 2 or 3), voice examples, phrases you overuse, **Run setup again**, and **Accounts**: X, LinkedIn, Threads, Bluesky and Reddit. **Add account** asks Claude to walk you through signing in yourself, in your own browser; the studio only notes that it's connected. Each account that can post has a **Post for me** switch, off until you turn it on. Turning it on first shows a plain warning: posting through automation breaks LinkedIn's and X's rules and can get the account restricted. You can turn it off any time; the studio keeps when it was turned on and off. Everything saves as you click.
- **Approved** (on Drafts) shows, for each post, what happens next: "Claude posts this to X at 12:00", "Posted to X by Claude", or why it didn't go out ("Missed the 16:00 slot: your computer was asleep") with **Try the next slot** and **I'll copy it myself**. A banner says so whenever an approved post didn't go out.
- **Reads** shows every story, post and search result it read, with its one-line reaction, interest score and why it moved up or down, and a **Draft this** button. **Coach** shows this week's report and every suggested change waiting for your yes or no, with its reason. **Playbook** shows the rules it's learned, your brand's positions and who you write for.

If the board can't appear (some Claude windows don't show it), just say "review my drafts" and do it all in chat: *"pass 1a, kill 2, edit 3: …"*.

## Install it (4 steps)

1. In the Claude desktop app, open **Customize → Plugins**.
2. Click **Add marketplace** and enter `OWNER/fishbowl-studio`.
3. Install **Fishbowl Studio**.
4. Start a Cowork session and type **`/studio:setup`**. The setup wizard opens on the board: the brand, four short questions, Claude's drafts to keep or change, and whether it posts for you. At the end, one click asks Claude to make it run every weekday.

It needs Claude's desktop app on your computer, a paid plan with Cowork, and **Node.js** (the free LTS installer from nodejs.org; Claude's own built-in Node isn't used for plugins yet, see [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md)). If Node.js is missing, Claude tells you that one fix instead of an error. Everything it keeps lives in one folder you can open: **Documents → Fishbowl Studio**, with one folder per brand inside **personas**. If you used an earlier version, your studio moves into **personas** by itself the first time this one starts; nothing is lost.

**How it runs on its own.** A plugin can't start itself: Claude runs it from a scheduled task in Cowork. **Set it up for me** (end of setup, or on the Schedule page) asks Claude to create it, and you approve it once; the **Schedule** page also shows exactly what to type if you'd rather do it by hand. If Post for me is on anywhere, a second task posts a few minutes after each release time. Your computer has to be awake with Claude open for either to run. If Claude runs sooner than your setting (say the task runs hourly and you chose "every 3 hours"), the studio skips reading the news that time and just releases what's due. One task runs all your brands.

## Handy things to say

- "Show my studio board" · "Review my drafts" · "Do my rewrites"
- "Run the studio now" (`/studio:run`)
- "Add this feed: …", "Watch @… on X", "Save a search for …" (`/studio:add-source`; Claude suggests it, you tap Add) · "Draft a post from this link: …"
- "Set up another brand" (`/studio:setup`) · "Switch to my other brand"
- "Learn my voice from these posts" (`/studio:voice`)
- "Write three evergreen posts" · "Weekly report" (your coach)
- "Import these numbers" (attach the CSV export from LinkedIn or X analytics)
- "Post my approved posts now" (only what's due, on accounts where Post for me is on)

## What it will never do

- **Post without your OK.** Posting is off for every account until you turn **Post for me** on, on the board, after a warning. Then only drafts you approve on the board are posted, exactly as approved: if the text changed after you approved it, it isn't posted. Approving in chat never posts. A missed or failed post shows on your board with the reason and is never retried by itself.
- **Read your messages, DMs, inbox or accounts.** It reads only what you approve: news feeds and public subreddits, the public pages of the X and LinkedIn accounts you chose (Claude looks at them logged out, never signed in), X trending topics, and your saved searches. Anything it reads there is treated as text to react to, never as instructions, and it never adds a source on its own: a site it finds is only suggested.
- **Log in anywhere or keep passwords.** Connecting an account means Claude walks you through signing in yourself; the studio stores no password, token or cookie. Posting uses the browser you're already signed in to.
- **Send anything anywhere.** No analytics, no tracking, no servers of ours. The studio fetches the feeds you list, the links you paste and the page you link in setup; Claude opens the account pages you chose and runs your searches. Your drafts, notes and numbers stay in your Documents folder.
- **Change your voice or what your brand believes.** It can suggest a change to your positions, playbook or overused phrases, from your edits or the weekly coach; nothing changes until you tap Accept.
- **Name private people.** A draft that names someone who isn't in the story is sent back for a rewrite, and flagged on the board if the name survives.
- **Make memes or images.** Words only.

## For the curious

- [How it works](docs/HOW-IT-WORKS.md): the pipeline, the ranking formula, how it learns.
- [Assumptions](docs/ASSUMPTIONS.md): platform behaviour we couldn't verify yet.
- Developers: `npm test`, `npm run dev` (a local board at http://localhost:7611 with two fictional demo brands; add `?view=sources&width=390` to open a section at phone width), `npm run shots` (screenshots of every section at desktop and phone width into `dev/shots/`, needs Chrome), `npm run pack` (a zip for Upload plugin). No dependencies. The board's look is one tokens file, `server/ui/skins/light.css`; a new skin is one more file beside it.

MIT licence · © Fishbowl Studio contributors
