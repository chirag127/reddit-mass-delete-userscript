# Reddit: Mass Delete

Finds your own comments and posts inside a subreddit and date range, shows a dry-run plan, then deletes them — or overwrites the text first — through Reddit's `/api/delete`.

> Part of the [userscripts collection](https://github.com/chirag127?tab=repositories&q=userscript). One repo, one script.

## ✨ What it does

- 📚 Pages `/user/<you>/comments.json` and `/submitted.json`, filters by **subreddit** and **date range** locally.
- 🧾 Queue table with type, subreddit, date and text snippet; per-row checkboxes plus all/none.
- 🧪 **Dry run first**, then one `confirm()`.
- 🧽 **Delete** or **overwrite-then-delete** (comments get a `[removed]` placeholder first; posts only if self-post).
- 🔁 **Per-item retry** with exponential back-off and a timestamped log.
- ⚡ 3 concurrent workers, 150–400 ms jitter, pause/stop, progress bar.
- 🖤 Draggable, resizable, collapsible dashboard with persisted settings.

## 📦 Install

Read the [userscript install guide](https://github.com/chirag127/userscript-install-guide) once, then:

**[Install reddit-mass-delete-userscript.user.js](https://github.com/chirag127/reddit-mass-delete-userscript/raw/main/reddit-mass-delete-userscript.user.js)**

## 🕹️ Usage

1. Open reddit.com signed in. The panel is bottom-right; `Alt+Shift+R` toggles it.
2. Fill **Subreddit** (blank = all), **From**/**To**, **Kind**, **Mode** and **Cap**, then **Save**.
3. **Analyse** to build the queue. **Dry run** to read the plan.
4. **Run**, then confirm. Pause and Stop stay live.

## ⚠️ Limits

- Reddit listings stop at roughly **1000 items per listing**. Narrow the date range for full history; the log warns when the cap is reached.
- Overwrite only touches **comments** and **self-posts**. Link posts have no body and are deleted directly.
- Deleted items are gone from the profile but remain in Reddit's backend; the cap keeps a run reversible-ish by limiting blast radius.
- The listing is `.json` on `www.reddit.com`; `old.reddit.com` is matched too, but the modhash source differs. Reload if the log says "no modhash".
- Edited-then-deleted comments can still be recovered by third-party archives. Overwriting is best-effort, not a guarantee.

## 🚨 Risk note

Destructive: this deletes **your real content**. Always dry-run first and start with a small cap (10–25). Overwrite-then-delete doubles the request count and therefore the rate-limit pressure.

## 🧠 Docs

Endpoint notes, rules and test steps: [AGENTS.md](AGENTS.md). Knowledge bundle: [okf/index.md](okf/index.md).

## 📄 License

[MIT](LICENSE) © 2026 chirag127
