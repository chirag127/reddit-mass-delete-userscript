# AGENTS.md — reddit-mass-delete

Guidance for AI coding agents (and humans) working on this repository.

## 🎯 What this repo is

One userscript, `reddit-mass-delete-userscript.user.js`, at the repo root. It lists your own comments/posts by subreddit and date range and deletes them through Reddit's JSON API.

## 🔌 Endpoint notes (API-first)

| Step | Request |
|------|---------|
| Who am I | `GET /api/me.json` → `data.name` (fallback: first `/user/<name>/` shell link) |
| Comments | `GET /user/<name>/comments.json?limit=100&sort=new&after=<fullname>` |
| Posts | `GET /user/<name>/submitted.json?limit=100&sort=new&after=<fullname>` |
| Delete | `POST /api/delete`, JSON body `{"id":"t1_…","uh":"<modhash>"}` |
| Overwrite | `POST /api/editusertext`, JSON body `{"thing_id":"t1_…","text":"…","uh":"<modhash>"}` |

Modhash sources, in order: `data.modhash` from `/api/me.json`, `window.reddit.modhash`,
`window.___r.config.modhash`, `input[name="uh"]`. The `uh` value goes **in the JSON body** —
no custom header is needed.

- Thing prefixes matter: comments are `t1_`, posts are `t3_`.
- `after` is a fullname cursor, not an offset.
- `429` and `5xx` retry three times with 3 s / 6 s / 12 s back-off plus jitter.
- DOM clicking is not used at all.

## 🧭 Golden rules

1. One file, zero dependencies. GM storage only for settings (`sub`, dates, kind, mode, text, cap).
2. **Dry run before the confirm** — the button order is Analyse → Dry run → Run on purpose.
3. **Hard cap slice** on every run; never "all by default".
4. **Never fire while typing.** `isTyping()` guards the global keys.
5. Overwrite is **comments and self-posts only** — link posts have no body.
6. Bump `@version` on functional changes; update URLs point at raw `main`.

## 🧪 Test with sctl

```bash
sctl install ./reddit-mass-delete-userscript.user.js
sctl page goto "https://www.reddit.com/"
sctl page eval "document.querySelector('#rdmd-panel') !== null"
sctl page eval "document.querySelector('#rdmd-cap').value = '3'"
sctl page click "#rdmd-panel .rdmd-btn"          # Save
sctl page click "#rdmd-panel .rdmd-btn:nth-of-type(2)"  # Analyse
sctl debug console --level error
```

Confirm the table fills, the Dry run log lists at most the cap, and a 3-item real run leaves `FINISHED — 3/3 removed`.

## 🗂️ Layout

| File | Purpose |
|------|---------|
| `reddit-mass-delete-userscript.user.js` | The script. Edit this. |
| `README.md` | User-facing docs. |
| `okf/` | Generated scoped bundle. |

## 📌 Known fragility

- The 1000-item listing ceiling is Reddit's, not ours; `MAX_PAGES = 12` matches it. Tell the user to narrow dates instead of raising the constant blindly.
- New Reddit's `window.___r` shape changes; the three-source `modhash()` ladder must stay.
- `editusertext` refuses archived posts and link posts; treat a failed edit as non-fatal and continue to delete.

<!-- okf-requirement -->
## 📚 Documentation lives in ONE place (mandatory)

All documentation for every repository in this workspace is **single-sourced** in the
umbrella repository:

```
c:\ws\docs\okf├── bundle.md            collection overview
├── index.md             catalogue of every concept and script note
├── concepts/            shared knowledge (architecture, testing, metadata, …)
└── scripts/             one note per userscript repository
```

### Rules

1. **Never create an `okf/` folder in this repository.** It is not duplicated here, by
   design. There was once a copy in every repo: 278 files describing 42 unique documents,
   with `concepts/architecture.md` physically present 32 times. Every edit had to be
   propagated to 30 repositories and drift was unavoidable.
2. **Never hand-edit a copy.** There are no copies. Edit the canonical file under
   `c:\ws\docs\okf\`.
3. **This repository's note is** `c:\ws\docs\okf\scripts\<repo-name>.md`. If it does not
   exist, add it before adding the script.
4. **Link, do not paste.** In `README.md`, link to the canonical note with a relative path
   from the workspace, e.g. `[documentation](../../../../../docs/okf/scripts/<repo-name>.md)`.
5. **Verify** with `node c:\ws\scripts\check-okf.mjs` — it exits `0` only when nothing is
   duplicated and every repository is linked and documented.
6. When adding a new script: create the repo, add `docs/okf/scripts/<repo-name>.md`, add it
   to the tables in `docs/okf/bundle.md` and `docs/okf/index.md`, then run the checker.

Full detail: `c:\ws\docs\okf\concepts\okf-requirement.md`.
