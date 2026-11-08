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
## 🧠 OKF documentation requirement (mandatory)

**Every repository in this collection MUST ship an Open Knowledge Format (OKF) bundle in `okf/`.**

A repository without `okf/` is **incomplete**, even if the script works.

### What must exist

```
okf/
├── bundle.md      overview of the collection
├── index.md       catalogue of concepts
├── concepts/      all shared concept notes
└── scripts/       THIS repository's own script note
```

### Rules

1. **Never hand-edit** a repository's `okf/` copy. The canonical bundle is
   `repos/own/public/userscripts/okf/` in the `c:\ws` monorepo.
2. After changing the canonical bundle, regenerate every copy:
   `node okf/sync-okf.mjs`
3. Verify nothing has drifted: `node okf/sync-okf.mjs --check` — must exit `0`.
4. `README.md` must link to `okf/`. `AGENTS.md` (this file) must restate this requirement.
5. When adding a new script, add its note at `okf/scripts/<repo-name>.md` in the canonical
   bundle first, then sync.

Full detail: [`okf/concepts/okf-requirement.md`](okf/concepts/okf-requirement.md)
