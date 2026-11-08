// ==UserScript==
// @name         Reddit: Mass Delete
// @namespace    https://github.com/chirag127
// @version      1.0.0
// @description  Finds your own comments and posts by subreddit and date range, shows a dry-run plan, then deletes them through Reddit's /api/delete with optional overwrite first, 3 paced workers and a per-item retry log.
// @author       chirag127
// @license      MIT
// @match        https://www.reddit.com/*
// @match        https://old.reddit.com/*
// @icon         https://www.reddit.com/favicon.ico
// @homepageURL  https://github.com/chirag127/reddit-mass-delete-userscript
// @supportURL   https://github.com/chirag127/reddit-mass-delete-userscript/issues
// @downloadURL  https://github.com/chirag127/reddit-mass-delete-userscript/raw/main/reddit-mass-delete-userscript.user.js
// @updateURL    https://github.com/chirag127/reddit-mass-delete-userscript/raw/main/reddit-mass-delete-userscript.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const PAGE = 100;
  const CONCURRENCY = 3;
  const MAX_PAGES = 12;              // Reddit listings stop at ~1000 items
  const S = {
    sub: GM_getValue("rdmd.sub", ""),
    from: GM_getValue("rdmd.from", ""),
    to: GM_getValue("rdmd.to", ""),
    kind: GM_getValue("rdmd.kind", "both"),
    mode: GM_getValue("rdmd.mode", "delete"),
    text: GM_getValue("rdmd.text", "[removed]"),
    cap: Number(GM_getValue("rdmd.cap", 100)) || 100
  };
  const state = {
    me: "", uh: "", rows: [], running: false, paused: false, stop: false,
    done: 0, total: 0, route: "", listed: 0
  };

  /* ---------- utils ---------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = () => 150 + Math.random() * 250;

  function isTyping() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = (el.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") n.className = v;
      else if (k === "style") Object.assign(n.style, v);
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }

  function modhash() {
    if (state.uh) return state.uh;
    try {
      if (window.reddit && window.reddit.modhash) return window.reddit.modhash;
      if (window.___r && window.___r.config && window.___r.config.modhash) return window.___r.config.modhash;
    } catch { /* cross-realm shim */ }
    const input = document.querySelector('input[name="uh"]');
    return input ? input.value : "";
  }

  async function api(path, opts = {}) {
    const headers = { "x-requested-with": "XMLHttpRequest" };
    if (opts.body) headers["content-type"] = "application/json";
    const res = await fetch(path, {
      credentials: "include", method: opts.method || "GET",
      headers, body: opts.body
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    return { ok: res.ok, status: res.status, data };
  }

  async function apiRetry(path, opts, tries = 3) {
    for (let i = 0; i < tries; i++) {
      const res = await api(path, opts);
      if (res.status !== 429 && res.status < 500) return res;
      const back = 3000 * Math.pow(2, i) + Math.random() * 1500;
      log(`retry ${i + 1}/${tries} after ${Math.round(back)} ms (${res.status})`, "warn");
      await sleep(back);
    }
    return { ok: false, status: 429, data: null };
  }

  function log(msg, kind = "info") {
    const box = document.querySelector("#rdmd-log");
    if (!box) return;
    box.prepend(h("div", { class: "rdmd-" + kind }, `${new Date().toLocaleTimeString()}  ${msg}`));
    while (box.childElementCount > 150) box.lastChild.remove();
  }

  function setStat() {
    const a = document.querySelector("#rdmd-found");
    const b = document.querySelector("#rdmd-picked");
    if (a) a.textContent = String(state.rows.length);
    if (b) b.textContent = String(state.rows.filter((r) => r.checked).length);
  }

  function progress(done, total) {
    const bar = document.querySelector("#rdmd-bar");
    if (bar) bar.style.width = total ? `${Math.round((done / total) * 100)}%` : "0%";
  }

  /* ---------- data ---------- */

  async function me() {
    if (state.me) return state.me;
    const res = await api("/api/me.json");
    const name = res.data && res.data.data && res.data.data.name;
    if (name) {
      state.me = name;
      if (res.data.data.modhash) state.uh = res.data.data.modhash;
      return name;
    }
    // New Reddit keeps the name on the page shell for logged-in sessions.
    const shell = document.querySelector('a[href^="/user/"]');
    if (shell) {
      const m = shell.getAttribute("href").match(/^\/user\/([^/]+)/);
      if (m && m[1] !== "me") return (state.me = m[1]);
    }
    return "";
  }

  function inRange(utc) {
    const from = S.from ? Date.parse(S.from + "T00:00:00") / 1000 : 0;
    const to = S.to ? Date.parse(S.to + "T23:59:59") / 1000 : Infinity;
    return utc >= from && utc <= to;
  }

  async function listing(user, kind) {
    const out = [];
    let after = "";
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = `/user/${encodeURIComponent(user)}/${kind}.json?limit=${PAGE}&sort=new${after ? `&after=${encodeURIComponent(after)}` : ""}`;
      const res = await apiRetry(q);
      if (!res.ok || !res.data) { log(`${kind}: page ${page + 1} failed (${res.status})`, "bad"); break; }
      const children = (res.data.data && res.data.data.children) || [];
      for (const c of children) {
        const d = c.data || {};
        if (!d.id || !d.created_utc) continue;
        const sub = d.subreddit || "";
        if (S.sub && sub.toLowerCase() !== S.sub.replace(/^r\//, "").toLowerCase()) continue;
        if (!inRange(d.created_utc)) continue;
        out.push({
          id: `${kind === "comments" ? "t1" : "t3"}_${d.id}`,
          type: kind === "comments" ? "comment" : "post",
          sub, created: d.created_utc,
          title: d.link_title || d.title || "",
          body: (d.body || d.selftext || "").slice(0, 160),
          author: d.author || "",
          self: d.is_self !== false,
          checked: true, gone: false
        });
      }
      after = (res.data.data && res.data.data.after) || "";
      state.listed = out.length;
      setStat();
      if (!after) break;
      await sleep(jitter());
    }
    return out;
  }

  async function analyse() {
    if (state.running) return;
    const user = await me();
    if (!user) { log("not signed in — open reddit.com and log in", "bad"); return; }
    const kinds = S.kind === "both" ? ["comments", "submitted"] : [S.kind === "posts" ? "submitted" : "comments"];
    log(`reading u/${user} (${kinds.join(" + ")})…`);
    state.rows = [];
    const all = [];
    for (const kind of kinds) all.push(...(await listing(user, kind)));
    all.sort((a, b) => b.created - a.created);
    state.rows = all;
    paint();
    log(`found ${all.length} item(s) in range${S.sub ? ` on r/${S.sub}` : ""}`, all.length ? "good" : "warn");
    if (all.length >= 1000) log("listing cap reached (~1000) — narrow the date range for full coverage", "warn");
  }

  /* ---------- table ---------- */

  function paint() {
    const body = document.querySelector("#rdmd-rows");
    body.textContent = "";
    for (const row of state.rows) {
      const cb = h("input", { type: "checkbox" });
      cb.checked = row.checked;
      cb.addEventListener("change", () => { row.checked = cb.checked; setStat(); });
      body.append(h("tr", {},
        h("td", {}, cb),
        h("td", { class: "rdmd-type " + row.type }, row.type === "comment" ? "c" : "p"),
        h("td", {}, `r/${row.sub}`),
        h("td", { class: "rdmd-when" }, new Date(row.created * 1000).toLocaleDateString()),
        h("td", { class: "rdmd-body", title: row.body }, row.body || row.title || "(no text)")
      ));
    }
    setStat();
  }

  function pickAll(on) {
    for (const r of state.rows) r.checked = on;
    paint();
  }

  /* ---------- actions ---------- */

  function dryRun() {
    const picked = state.rows.filter((r) => r.checked).slice(0, S.cap);
    if (!picked.length) { log("nothing selected — Analyse first", "warn"); return; }
    log(`DRY RUN — ${picked.length} of ${state.rows.filter((r) => r.checked).length} selected, cap ${S.cap}, mode ${S.mode}`, "warn");
    for (const r of picked.slice(0, 25)) log(`  · ${r.type} r/${r.sub} ${new Date(r.created * 1000).toLocaleDateString()} — ${(r.body || r.title).slice(0, 60)}`);
    if (picked.length > 25) log(`  … and ${picked.length - 25} more`);
    progress(picked.length, picked.length);
  }

  async function start() {
    if (state.running) return;
    const uh = modhash();
    if (!uh) { log("no modhash — reload the page while logged in", "bad"); return; }
    const picked = state.rows.filter((r) => r.checked).slice(0, S.cap);
    if (!picked.length) { log("nothing selected", "warn"); return; }
    const verb = S.mode === "overwrite" ? "overwrite (comments only) then delete" : "delete";
    if (!confirm(`${verb} ${picked.length} item(s)?\n\nDry run first if you have not checked the list.`)) return;

    state.running = true; state.stop = false; state.paused = false;
    state.done = 0; state.total = picked.length;
    log(`START — ${picked.length} item(s), ${CONCURRENCY} workers, mode ${S.mode}`);

    let i = 0;
    const worker = async () => {
      while (i < picked.length && !state.stop) {
        while (state.paused && !state.stop) await sleep(200);
        if (state.stop) return;
        const row = picked[i++];

        if (S.mode === "overwrite" && row.type === "comment" && row.self) {
          const edit = await apiRetry("/api/editusertext", {
            method: "POST", body: JSON.stringify({ thing_id: row.id, text: S.text, uh })
          });
          if (!edit.ok) log(`edit failed ${row.id} (${edit.status}) — deleting anyway`, "warn");
        }
        const del = await apiRetry("/api/delete", { method: "POST", body: JSON.stringify({ id: row.id, uh }) });
        if (del.ok) { state.done++; row.gone = true; log(`deleted ${row.id} r/${row.sub}`, "good"); }
        else log(`delete failed ${row.id} (${del.status})`, "bad");
        progress(state.done, state.total);
        await sleep(jitter());
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    state.running = false;
    state.rows = state.rows.filter((r) => !r.gone);
    paint();
    log(state.stop ? `STOPPED after ${state.done}/${state.total}` : `FINISHED — ${state.done}/${state.total} removed`, state.stop ? "warn" : "good");
  }

  function togglePause() {
    state.paused = !state.paused;
    log(state.paused ? "paused" : "resumed", "warn");
  }

  function stop() { state.stop = true; log("stopping after current requests…", "warn"); }

  function saveSettings() {
    S.sub = document.querySelector("#rdmd-sub").value.trim().replace(/^r\//, "");
    S.from = document.querySelector("#rdmd-from").value;
    S.to = document.querySelector("#rdmd-to").value;
    S.kind = document.querySelector("#rdmd-kind").value;
    S.mode = document.querySelector("#rdmd-mode").value;
    S.text = document.querySelector("#rdmd-text").value;
    S.cap = Math.max(1, Number(document.querySelector("#rdmd-cap").value) || 100);
    for (const [k, v] of Object.entries({ "rdmd.sub": S.sub, "rdmd.from": S.from, "rdmd.to": S.to, "rdmd.kind": S.kind, "rdmd.mode": S.mode, "rdmd.text": S.text, "rdmd.cap": S.cap })) GM_setValue(k, v);
    log("settings saved", "good");
  }

  /* ---------- panel ---------- */

  let panel, chip;

  function build() {
    if (document.getElementById("rdmd-panel")) return;
    panel = h("div", { id: "rdmd-panel" },
      h("div", { class: "rdmd-hdr" },
        h("span", { class: "rdmd-dot" }),
        h("strong", {}, "Reddit mass delete"),
        h("span", { class: "rdmd-spacer" }),
        h("button", { class: "rdmd-min", title: "Collapse", onclick: collapse }, "–"),
        h("button", { class: "rdmd-x", title: "Hide", onclick: () => { panel.style.display = "none"; chip.style.display = "block"; } }, "×")
      ),
      h("div", { class: "rdmd-body" },
        h("div", { class: "rdmd-grid" },
          h("label", {}, "Subreddit", h("input", { id: "rdmd-sub", type: "text", placeholder: "all", value: S.sub })),
          h("label", {}, "Kind", h("select", { id: "rdmd-kind" },
            h("option", { value: "both" }, "comments + posts"),
            h("option", { value: "comments" }, "comments only"),
            h("option", { value: "posts" }, "posts only")
          )),
          h("label", {}, "From", h("input", { id: "rdmd-from", type: "date", value: S.from })),
          h("label", {}, "To", h("input", { id: "rdmd-to", type: "date", value: S.to })),
          h("label", {}, "Mode", h("select", { id: "rdmd-mode" },
            h("option", { value: "delete" }, "delete"),
            h("option", { value: "overwrite" }, "overwrite then delete")
          )),
          h("label", {}, "Cap", h("input", { id: "rdmd-cap", type: "number", min: "1", max: "1000", value: S.cap }))
        ),
        h("label", { class: "rdmd-wide" }, "Overwrite text (comments)", h("input", { id: "rdmd-text", type: "text", value: S.text })),
        h("div", { class: "rdmd-row" },
          h("button", { class: "rdmd-btn", onclick: saveSettings }, "Save"),
          h("button", { class: "rdmd-btn", onclick: analyse }, "1 · Analyse"),
          h("button", { class: "rdmd-btn rdmd-ghost", onclick: dryRun }, "2 · Dry run"),
          h("button", { class: "rdmd-btn rdmd-go", onclick: start }, "3 · Run"),
          h("button", { class: "rdmd-btn rdmd-ghost", onclick: togglePause }, "Pause"),
          h("button", { class: "rdmd-btn rdmd-ghost", onclick: stop }, "Stop")
        ),
        h("div", { class: "rdmd-stats" },
          h("span", {}, "Found: "), h("b", { id: "rdmd-found" }, "0"),
          h("span", {}, " · Selected: "), h("b", { id: "rdmd-picked" }, "0"),
          h("span", { class: "rdmd-spacer" }),
          h("button", { class: "rdmd-link", onclick: () => pickAll(true) }, "all"),
          h("button", { class: "rdmd-link", onclick: () => pickAll(false) }, "none")
        ),
        h("div", { class: "rdmd-track" }, h("div", { class: "rdmd-bar", id: "rdmd-bar" })),
        h("div", { class: "rdmd-scroll" },
          h("table", { class: "rdmd-table" },
            h("thead", {}, h("tr", {}, h("th", {}), h("th", {}, "T"), h("th", {}, "Sub"), h("th", {}, "Date"), h("th", {}, "Text"))),
            h("tbody", { id: "rdmd-rows" })
          )
        ),
        h("div", { class: "rdmd-log", id: "rdmd-log" })
      )
    );
    Object.assign(panel.style, { position: "fixed", right: "18px", bottom: "18px", width: "470px", height: "540px" });
    chip = h("button", { id: "rdmd-chip", onclick: () => { chip.style.display = "none"; panel.style.display = "flex"; } }, "reddit · delete");
    document.body.append(panel, chip);
    chip.style.display = "none";
    panel.querySelector("#rdmd-kind").value = S.kind;
    panel.querySelector("#rdmd-mode").value = S.mode;
    drag(panel.querySelector(".rdmd-hdr"), panel);
  }

  function collapse() {
    panel.classList.toggle("rdmd-collapsed");
    panel.querySelector(".rdmd-min").textContent = panel.classList.contains("rdmd-collapsed") ? "+" : "–";
  }

  function drag(handle, box) {
    let on = false, sx = 0, sy = 0, ox = 0, oy = 0;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      on = true; sx = e.clientX; sy = e.clientY;
      const r = box.getBoundingClientRect(); ox = r.left; oy = r.top;
      box.style.right = "auto"; box.style.bottom = "auto";
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!on) return;
      box.style.left = Math.max(0, Math.min(innerWidth - 60, ox + e.clientX - sx)) + "px";
      box.style.top = Math.max(0, Math.min(innerHeight - 40, oy + e.clientY - sy)) + "px";
    });
    handle.addEventListener("pointerup", () => (on = false));
  }

  /* ---------- route ---------- */

  function routeTick() {
    if (location.href === state.route) return;
    state.route = location.href;
    if (!document.getElementById("rdmd-panel")) build();
    else if (!document.body.contains(panel)) document.body.append(panel, chip);
  }

  function boot() {
    if (document.documentElement.dataset.rdmdBooted) return;
    document.documentElement.dataset.rdmdBooted = "1";
    document.head.append(h("style", {}, `
      #rdmd-panel,#rdmd-chip{font:12px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#e8e8e8;background:#181818;border:1px solid #2c2c2c;border-radius:10px;box-shadow:0 12px 40px #000a;z-index:2147483000}
      #rdmd-panel{display:flex;flex-direction:column;overflow:hidden;resize:both;min-width:340px;min-height:320px}
      #rdmd-panel.rdmd-collapsed{height:auto!important;resize:none}
      #rdmd-panel.rdmd-collapsed .rdmd-body{display:none}
      .rdmd-hdr{display:flex;align-items:center;gap:8px;padding:9px 10px;background:#111;border-bottom:1px solid #2c2c2c;cursor:grab;user-select:none}
      .rdmd-dot{width:8px;height:8px;border-radius:50%;background:#065fd4;box-shadow:0 0 0 3px #065fd433}
      .rdmd-spacer{flex:1}
      .rdmd-hdr button{background:none;border:0;color:#aaa;font-size:15px;cursor:pointer}
      .rdmd-body{display:flex;flex-direction:column;gap:7px;padding:10px;overflow:hidden;flex:1;min-height:0}
      .rdmd-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
      .rdmd-grid label,.rdmd-wide{display:flex;flex-direction:column;gap:2px;color:#9a9a9a;font-size:10px}
      .rdmd-body input,.rdmd-body select{background:#111;border:1px solid #333;color:#eee;border-radius:5px;padding:4px 6px;font-size:11px;outline:none;min-width:0}
      .rdmd-body input:focus,.rdmd-body select:focus{border-color:#065fd4}
      .rdmd-row{display:flex;gap:5px;flex-wrap:wrap}
      .rdmd-btn{flex:1;min-width:62px;background:#065fd4;border:1px solid #065fd4;color:#fff;border-radius:6px;padding:6px 7px;font-size:11px;cursor:pointer}
      .rdmd-ghost{background:#222;border-color:#333;color:#ddd}
      .rdmd-stats{display:flex;align-items:center;gap:4px;color:#9a9a9a;font-size:11px}
      .rdmd-stats b{color:#e8e8e8}
      .rdmd-link{background:none;border:0;color:#6ab0ff;font-size:11px;cursor:pointer;padding:0 3px}
      .rdmd-track{height:5px;background:#242424;border-radius:3px;overflow:hidden}
      .rdmd-bar{height:100%;width:0;background:#065fd4;transition:width .2s}
      .rdmd-scroll{flex:1;min-height:90px;overflow:auto;border:1px solid #262626;border-radius:6px}
      .rdmd-table{width:100%;border-collapse:collapse;table-layout:fixed}
      .rdmd-table th{position:sticky;top:0;background:#1f1f1f;color:#8f8f8f;font-size:10px;text-align:left;padding:5px;font-weight:600}
      .rdmd-table td{padding:4px 5px;border-top:1px solid #232323;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .rdmd-type{width:18px;text-align:center;font-weight:700}
      .rdmd-type.c{color:#6ab0ff}.rdmd-type.p{color:#c792ea}
      .rdmd-when{width:66px;color:#9a9a9a}
      .rdmd-body{color:#c9c9c9}
      .rdmd-log{height:96px;overflow:auto;background:#101010;border:1px solid #262626;border-radius:6px;padding:5px;font:10px/1.5 ui-monospace,Consolas,monospace}
      .rdmd-good{color:#5fd68a}.rdmd-bad{color:#ff7b72}.rdmd-warn{color:#f0b429}
      #rdmd-chip{position:fixed;right:18px;bottom:18px;display:none;background:#181818;color:#fff;border:1px solid #065fd4;border-radius:999px;padding:7px 12px;font-size:11px;cursor:pointer}
    `));
    build();
    routeTick();
    new MutationObserver(() => {
      if (panel && !document.body.contains(panel) && document.body) document.body.append(panel);
    }).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(routeTick, 800);

    document.addEventListener("keydown", (e) => {
      if (isTyping()) return;
      if (e.key === "Escape") { panel.style.display = "none"; chip.style.display = "block"; }
      if (e.altKey && e.key.toLowerCase() === "r") {
        panel.style.display = panel.style.display === "none" ? "flex" : "none";
        chip.style.display = panel.style.display === "none" ? "block" : "none";
      }
    }, true);
  }

  boot();
})();
