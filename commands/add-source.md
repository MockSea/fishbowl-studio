---
description: Suggest, pause or remove a Fishbowl Studio source (a website, a subreddit, an X or LinkedIn account, a saved search)
---

Change Fishbowl Studio's sources. Their request: $ARGUMENTS

They add sources themselves on the board's **Sources** page (paste an address, a subreddit, an @handle or a search). In chat you can **suggest** one, and it waits there for their one tap; nothing is read before that. You can pause, resume, re-file or remove sources directly.

1. Call `studio_view` with `{view: "sources"}` to see what they have. If they have more than one brand, make sure you're on the right one (`studio_personas` `{action: "list"}`; pass `persona` if it isn't the active one).
2. Work out what they want. If they didn't say, ask one short question.
3. To add: call `studio_sources` with `{action: "suggest", kind, ...}`, using only what they gave you, never an address from something you read:
   - a website or feed: `{kind: "site", url, list: "feeds" | "reading", topic?}` (`https://` public sites; it's test-fetched when they add it);
   - a subreddit: `{kind: "reddit", sub: "r/name"}`;
   - an X or LinkedIn account to watch: `{kind: "watch", url: "@handle" or an x.com or linkedin.com company/profile address}`;
   - X trending topics: `{kind: "trends"}`;
   - a saved web search: `{kind: "search", q: "the words"}`.
   Then tell them: "It's on your Sources page under Suggested sources: tap Add." Offer to open the board (`studio_board`).
4. To change one: `studio_sources` with `{action: "pause" | "resume" | "remove" | "topic", list, url or q, topic?}` where `list` is `feeds`, `reading`, `watch`, `trends` or `searches`.
5. Confirm in one line what changed.
