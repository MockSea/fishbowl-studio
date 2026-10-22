---
description: Add or remove a Fishbowl Studio news feed or reading-list source
---

Change Fishbowl Studio's sources. Her request: $ARGUMENTS

She can also do this herself on the board's **Sources** page (paste an address, pause, remove). In chat:

1. Call `studio_view` with `{view: "sources"}` to see the current feeds, reading list and topics. If she has more than one brand, make sure you're on the right one (`studio_personas` `{action: "list"}`; pass `persona` if it isn't the active one).
2. Work out what she wants: add a feed (daily news), add to the reading list (slow curiosity reading), pause, resume, re-file under a topic, or remove one. If she didn't say, ask one short question.
3. To add: call `studio_sources` with `{action: "add", url, list: "feeds" | "reading", topic?}`. She can give a website rather than a feed address: the studio test-fetches it, finds the site's feed if the page links to one, and names it from the feed's title. Addresses must be `https://` public sites. If it says it couldn't add it, tell her why in one line and, if you know the site's real feed address, offer it.
4. To change one: `studio_sources` with `{action: "pause" | "resume" | "remove" | "topic", url, list, topic?}`.
5. If you added a feed, call `studio_fetch` with `force: true` and tell her how many stories it brought in.
6. Confirm in one line what changed.
