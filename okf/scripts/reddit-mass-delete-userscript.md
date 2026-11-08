---
type: Script
title: Reddit — Mass delete
description: Deletes your own comments and posts by subreddit and date range, with overwrite mode, dry run and retries.
repo: https://github.com/chirag127/reddit-mass-delete-userscript
install: https://github.com/chirag127/reddit-mass-delete-userscript/raw/main/reddit-mass-delete-userscript.user.js
version: "1.0.0"
tags: [userscript, reddit, delete, cleanup, api]
timestamp: 2026-11-09T00:00:00Z
---

# Reddit — Mass delete

Pages `/user/<me>/comments.json` and `/submitted.json` (100 per page, `after` fullname
cursor), filters locally by subreddit and date, then posts `/api/delete` with a JSON body.

## Method

| Step | Call |
|------|------|
| Identity | `GET /api/me.json` |
| List | `GET /user/<me>/{comments,submitted}.json` |
| Overwrite | `POST /api/editusertext` with `thing_id`, `text`, `uh` |
| Delete | `POST /api/delete` with `id`, `uh` |

`uh` is read from `window.reddit.modhash`, `window.___r.config.modhash` or
`input[name="uh"]` and travels in the body. Three workers, exponential back-off on
429/5xx, dry run then one confirm, hard cap.

## Limitations

- Listings stop at ~1000 items; narrow the dates for full coverage.
- Overwrite applies to comments and self-posts only — link posts have no body.
- Third-party archives may still hold edited-then-deleted comments.
- Old Reddit exposes a different modhash source; reload if it is missing.

## Risk

Destructive against your real content. Dry run first, start with a cap of 10–25, and
expect double the request count in overwrite mode.
