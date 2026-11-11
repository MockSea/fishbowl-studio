---
description: Start Fishbowl Studio and open it in the browser
allowed-tools: Bash(npx --yes github:MockSea/fishbowl-studio:*)
---

# Start Fishbowl Studio

Fishbowl Studio is a local web app. This command starts it the same way a terminal would.

1. Run this with the Bash tool, **in the background** (it keeps running while the studio is open):

   ```
   npx --yes github:MockSea/fishbowl-studio
   ```

2. Wait a few seconds, then read its output. It prints the studio folder and a line starting
   `Open it here (the link works once):`. It also opens that link in the browser.
   If it says the studio is already running, it has opened a fresh link to that one and exited.

3. Tell the person, in one or two plain sentences: the studio is open in their browser, and if the
   tab didn't appear, to open the link it printed. Mention that it keeps running until they stop
   it here or close Claude Code.

If the output says Node.js is too old or missing, pass on its one-sentence fix and stop.
If it says it can't write to the studio folder, pass on that message as written.

Don't call the studio's API, don't read or change files in the studio folder, and don't open the
link yourself: the link works once and is meant for the person's browser.
