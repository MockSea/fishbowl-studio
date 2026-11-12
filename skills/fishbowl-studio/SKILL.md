---
name: fishbowl-studio
description: Install and start Fishbowl Studio, a local web app that drafts LinkedIn, X, Threads and Bluesky posts in a brand's voice from the news it follows, and give the person the link to its review board. Use when someone asks to open, start, set up or install Fishbowl Studio, or asks for a tool that drafts their brand's social posts for them to approve.
---

# Fishbowl Studio

Fishbowl Studio is a finished web app. It runs on this computer, listens only on 127.0.0.1, and the person uses it in their browser. Your job is to install it, start it, and hand them the link. Don't build a dashboard, page or server of your own for it, and don't change its code: everything they need is in the app.

## 1. Check Node.js

Run `node --version`. Version 20 or later: go to step 2.

Missing or older: install the standalone build instead, which has Node inside. On macOS or Linux (x64, or Apple silicon):

```sh
curl -fsSL https://raw.githubusercontent.com/MockSea/fishbowl-studio/main/scripts/install.sh | FISHBOWL_NO_START=1 sh
```

It checks the download against the release's `SHA256SUMS` and installs `~/.local/bin/fishbowl-studio`. In step 3, run `~/.local/bin/fishbowl-studio` with the same options in place of the `npx` command. If it says there's no build for this computer, tell the person it needs Node.js 20 or later (nodejs.org) and stop.

## 2. Choose the studio folder

The studio keeps each brand's voice, sources, drafts and brand kit in one folder, and needs the same folder every time to find them again.

- If the person has given you a folder to work in, use a `Fishbowl Studio` folder inside it: `--home "<their folder>/Fishbowl Studio"`. Files you keep anywhere else may be gone next session.
- Otherwise leave `--home` off. The studio uses `Documents/Fishbowl Studio` in the home folder.

Use the same choice every time you start it for this person.

## 3. Start it

Run this in the background (it keeps running while the studio is open), writing its output to a log file:

```sh
npx --yes github:MockSea/fishbowl-studio#v0.1.0 --no-open --home "<studio folder>" > "<log file>" 2>&1
```

Leave out `--home` if step 2 said to. Keep `--no-open`: you give the person the link instead (step 4).

The first start downloads the app, which can take a minute. Read the log every few seconds until it has a line starting `Open it here (the link works once):` followed by an `http://127.0.0.1:<port>/?t=...` link. Stop waiting after two minutes and go to "When something goes wrong".

If the log says `Fishbowl Studio is already running. Opening it: <link>`, the studio was already running for this folder; the command printed a fresh link to it and exited. Use that link.

## 4. Give the person the link

Tell them, in one or two plain sentences: the studio is running, open this link in your browser, and it keeps running until you stop it. Give them the link exactly as printed.

- The link works once, within five minutes. Don't open it, fetch it or test it yourself: that uses it up, and their browser shows "Open the studio from its link". If that happens, or the link is older than five minutes, run the command in step 3 again; with the studio already running it prints a fresh link.
- On its first page the studio asks how to reach Claude: Claude Code if it's installed and signed in on this computer, or an Anthropic API key they paste in. That choice and the key are theirs. Don't ask for the key and don't type it for them.
- From there the app walks them through setting up a brand. You're done.

## 5. Stopping it

When they ask to stop it, stop the background command you started. Their brands stay in the studio folder; starting it again (step 3, same folder) picks up where they left off.

## When something goes wrong

Pass on the studio's own message; it is written for the person. In particular:

- **Node.js too old or missing**: it prints one sentence with the fix. Pass it on, or use the standalone build (step 1).
- **Can't write to the studio folder**: pass the message on as written, and offer to use another folder with `--home`.
- **The link doesn't open in their browser** (the page can't be reached): the studio may be running somewhere their browser can't reach, such as a sandbox. Tell them so plainly, and give them the command to run in their own terminal instead: `npx github:MockSea/fishbowl-studio#v0.1.0`. That starts it and opens the browser by itself.

## What not to do

- Don't call the studio's API or read or change files in the studio folder. The person does everything through the board.
- Don't open the one-time link.
- Don't write a new interface, server or script for the studio. If something the person wants isn't in the app, say so.
