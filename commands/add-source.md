---
description: Add or remove a Fishbowl Studio news feed or reading-list source
---

Change Fishbowl Studio's sources. Her request: $ARGUMENTS

1. Call `studio_config` with `{action: "get", file: "sources.json"}` and `{action: "get", file: "beat.json"}` to see the current feeds, reading list and topic slugs.
2. Work out what she wants: add a feed (daily news), add to the reading list (slow curiosity reading), or remove one. If she gave a website rather than a feed address, suggest the site's likely RSS/Atom feed URL and say you'll test it. Ask which topic slug it belongs to if it isn't obvious. If she didn't say what to change, ask one short question.
3. Call `studio_config` with `{action: "set", file: "sources.json", content: <the whole updated object>}`. Keep every existing entry you aren't changing. Addresses must be `https://`.
4. If you added a feed, call `studio_fetch` and tell her whether it worked (and how many stories it brought in). If it's dead, say so and offer an alternative.
5. Confirm in one line what changed.
