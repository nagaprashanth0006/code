// Shortlist UI. Plain JS, no dependencies. One request scores everything; dropdowns only change the view.
(() => {
  const $ = s => document.querySelector(s);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const pct = v => Math.round(v * 100);
  const st = { file: null, tab: "file", data: null, meta: null, role: "all", level: null, country: "all", years: null,
               busy: false, focus: null, ready: false };
  let timer = null;

  // ---------------------------------------------------------------- theme
  const root = document.documentElement;
  try { const t = localStorage.getItem("shortlist-theme"); if (t) root.dataset.theme = t; } catch {}
  $("#theme").onclick = () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("shortlist-theme", root.dataset.theme); } catch {}
    if (st.data) render();
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => st.data && render());

  // ---------------------------------------------------------------- dropdowns
  const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem("shortlist-" + k); localStorage.setItem("shortlist-" + k, v); } catch {} };
  const opt = (value, label) => { const o = el("option", null, label); o.value = value; return o; };
  fetch("/api/meta").then(r => r.json()).then(m => {
    st.meta = m;
    const fams = Object.keys(m.families);
    const role = $("#rf-role");
    role.replaceChildren(opt("all", "All roles"));
    fams.forEach(f => {
      const g = el("optgroup"); g.label = f;
      if (fams.length > 1) g.append(opt("family:" + f, `All in ${f}`));
      m.roles.filter(r => r.family === f).forEach(r => g.append(opt(r.id, r.label)));
      role.append(g);
    });
    role.value = "all";
    $("#rf-level").replaceChildren(...m.levels.map(l => opt(l.id, l.label)));
    const savedLevel = pref("level");
    $("#rf-level").value = savedLevel && m.levels.some(l => l.id === savedLevel) ? savedLevel : "senior";
    st.level = $("#rf-level").value;
    $("#rf-country").replaceChildren(opt("all", "All countries / regions"), ...m.countries.map(c => opt(c.id, c.label)));
    $("#rf-country").value = "all";
    role.onchange = () => { st.role = role.value; st.focus = null; render(); };
    $("#rf-level").onchange = () => { st.level = $("#rf-level").value; pref("level", st.level); render(); };
    $("#rf-country").onchange = () => { st.country = $("#rf-country").value; render(); };
    setModel(m.ready);
    if (!m.ready) pollReady();
  }).catch(() => setModel(null));

  // ---------------------------------------------------------------- model status (first ~10 s after server start)
  $("#rf-focus-only").onclick = () => { if (st.shown) { st.focus = null; select("role", st.shown); } };

  function setModel(ready) {
    st.ready = !!ready;
    const pill = $("#rf-model");
    pill.innerHTML = `<span class="dot ${ready ? "ok" : ready === false ? "busy" : ""}"></span>`;
    pill.append(ready ? "Ready · runs locally, nothing is stored" : ready === false ? "Warming up the scoring model…" : "Server offline");
  }
  function pollReady() {
    setTimeout(() => fetch("/api/meta").then(r => r.json()).then(m => { setModel(m.ready); if (!m.ready) pollReady(); })
      .catch(() => { setModel(null); pollReady(); }), 1000);
  }
  function select(kind, value) {
    st[kind] = value;
    $({ role: "#rf-role", level: "#rf-level", country: "#rf-country" }[kind]).value = value;
    if (kind === "level") pref("level", value);
    render();
  }

  // ---------------------------------------------------------------- input
  const go = $("#rf-go"), textEl = $("#rf-text");
  function setTab(t) {
    st.tab = t;
    document.querySelectorAll("[data-rtab]").forEach(b => b.setAttribute("aria-selected", b.dataset.rtab === t));
    document.querySelectorAll("[data-rpane]").forEach(p => p.hidden = p.dataset.rpane !== t);
    if (t === "paste") textEl.focus();
    refresh();
  }
  document.querySelectorAll("[data-rtab]").forEach(b => b.onclick = () => setTab(b.dataset.rtab));
  function refresh() {
    const n = (textEl.value.match(/\S+/g) || []).length;
    if (st.tab === "paste") { $("#rf-count").textContent = `${n} words`; go.disabled = st.busy || n < 30; }
    else { $("#rf-count").textContent = st.file ? "" : "No file selected"; go.disabled = st.busy || !st.file; }
    $("#rf-count").style.display = st.tab === "file" && st.file ? "none" : "";
    $("#rf-chip").classList.toggle("show", st.tab === "file" && !!st.file);
  }
  textEl.addEventListener("input", refresh);
  function setFile(f) {
    if (!f) return;
    st.file = f; st.years = null;
    $("#rf-chip-name").textContent = `${f.name} · ${(f.size / 1024).toFixed(f.size > 1e6 ? 0 : 1)} KB`;
    setTab("file");
  }
  $("#rf-file").onchange = e => setFile(e.target.files[0]);
  $("#rf-chip-x").onclick = e => { e.preventDefault(); st.file = null; $("#rf-file").value = ""; refresh(); };
  $("#rf-clear").onclick = () => {
    // Also drop the parsed resume from the server's in-memory cache.
    if (st.data?.doc_key) fetch("/api/forget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: st.data.doc_key }) }).catch(() => {});
    st.file = null; st.data = null; st.years = null; st.focus = null; $("#rf-file").value = ""; textEl.value = ""; $("#rf-jd").value = "";
    $("#rf-results").classList.remove("show"); showError(""); syncExp(); refresh();
  };
  let depth = 0;
  addEventListener("dragenter", e => { e.preventDefault(); if (++depth === 1) { setTab("file"); $("#rf-input").classList.add("over"); } });
  addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; $("#rf-input").classList.remove("over"); } });
  addEventListener("dragover", e => e.preventDefault());
  addEventListener("drop", e => {
    e.preventDefault(); depth = 0; $("#rf-input").classList.remove("over");
    const f = e.dataTransfer.files[0];
    if (f) setFile(f); else { const t = e.dataTransfer.getData("text"); if (t) { textEl.value = t; setTab("paste"); } }
  });
  addEventListener("paste", e => { const f = e.clipboardData?.files?.[0]; if (f) { e.preventDefault(); setFile(f); } });
  addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !go.disabled) score(); });
  go.onclick = () => score();
  function showError(m) { $("#rf-error").textContent = m; $("#rf-error").classList.toggle("show", !!m); }

  // ---------------------------------------------------------------- experience slider
  const slider = $("#rf-exp");
  function syncExp() {
    const p = st.data?.profile;
    const used = st.years ?? p?.years_derived ?? null;
    slider.value = used == null ? 5 : Math.min(30, Math.max(5, Math.round(used)));
    $("#rf-exp-val").textContent = used == null ? "from resume" : `${(+used).toFixed(used % 1 ? 1 : 0)} yrs`;
    $("#rf-exp-auto").hidden = st.years == null;
    const note = $("#rf-exp-note");
    note.className = "";
    if (!p) note.textContent = "5–30 years · set from the resume";
    else if (st.years != null) note.textContent = `Override · resume says ${p.years_derived} yrs`;
    else if (p.years_derived < p.min_years) { note.textContent = `Resume shows ${p.years_derived} yrs (< ${p.min_years})`; note.className = "short"; }
    else note.textContent = p.years_source === "stated" ? "Stated in the resume" : `From job dates, as of ${p.as_of}`;
  }
  slider.oninput = () => { st.years = +slider.value; syncExp(); clearTimeout(timer); timer = setTimeout(() => st.data && score(true), 350); };
  $("#rf-exp-auto").onclick = () => { st.years = null; syncExp(); if (st.data) score(true); };

  // ---------------------------------------------------------------- request
  // XHR rather than fetch: it reports upload progress. The browser stays responsive throughout; the
  // status line shows which stage is running (uploading → reading & scoring → done) and for how long.
  let req = null;
  function status(text, progress) {
    const box = $("#rf-status"), bar = $("#rf-pbar");
    box.hidden = text == null;
    if (text == null) return;
    $("#rf-status-text").textContent = text;
    bar.parentElement.classList.toggle("indeterminate", progress == null);
    bar.style.width = progress == null ? "" : `${Math.round(progress * 100)}%`;
  }
  function score(quiet) {
    showError("");
    if (req) req.abort();
    const fd = new FormData();
    const upload = st.tab === "file" && st.file;
    if (upload) { fd.append("file", st.file); fd.append("file_modified", String(st.file.lastModified || "")); }
    else fd.append("text", textEl.value);
    if (st.years != null) fd.append("years", st.years);
    if ($("#rf-jd").value.trim()) fd.append("jd", $("#rf-jd").value);
    st.busy = true; refresh();
    $("#rf-input").classList.add("working");
    if (!quiet) { go.classList.add("busy"); $("#rf-go-label").textContent = "Scoring"; }
    $("#rf-results").classList.add("rf-loading");
    const t0 = performance.now();
    let stage = upload ? "Uploading" : "Sending";
    const warm = () => st.ready ? "" : " (warming up the scoring model — first run only)";
    const tick = setInterval(() => {
      if (stage === "Processing") status(`Reading & scoring… ${((performance.now() - t0) / 1000).toFixed(0)}s${warm()}`, null);
    }, 500);
    status(`${stage}…`, upload ? 0 : null);
    const x = req = new XMLHttpRequest();
    x.open("POST", "/api/analyze");
    x.responseType = "json";
    x.upload.onprogress = e => { if (e.lengthComputable && upload) status(`Uploading ${Math.round(100 * e.loaded / e.total)}%`, e.loaded / e.total); };
    x.upload.onload = () => { stage = "Processing"; status(`Reading & scoring…${warm()}`, null); };
    const done = () => {
      clearInterval(tick); req = null;
      st.busy = false; go.classList.remove("busy"); $("#rf-go-label").textContent = "Score resume";
      $("#rf-input").classList.remove("working");
      $("#rf-results").classList.remove("rf-loading"); refresh();
    };
    x.onload = () => {
      done();
      const data = x.response || { error: `Server error (${x.status}).` };
      if (x.status >= 400 || data.error) { status(null); showError(data.error || `Server error (${x.status}).`); return; }
      st.data = data;
      if (!st.ready) setModel(true);
      const t = data.timing_ms || {};
      status(`Done in ${((performance.now() - t0) / 1000).toFixed(1)}s · read ${t.read ?? "–"} ms, scored ${t.score ?? "–"} ms`, 1);
      setTimeout(() => { if (!st.busy) status(null); }, 4000);
      syncExp();
      render(!quiet);
    };
    x.onerror = () => { done(); status(null); showError("Can't reach the Shortlist server. Is app.py running?"); };
    x.onabort = () => { clearInterval(tick); };
    x.send(fd);
  }

  // ---------------------------------------------------------------- colours
  // 0 → mild red, 50 → orange, 100 → green; pastel in light mode, deep and muted in dark mode
  const hue = v => v < 0.5 ? 35 * (v / 0.5) : 35 + 95 * ((v - 0.5) / 0.5);
  const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const tint = v => { const h = hue(v).toFixed(0), d = Math.abs(v - 0.5) * 2;
    return isDark() ? `hsl(${h} ${v > 0.6 ? 45 : 55}% ${22 + 8 * d}%)` : `hsl(${h} ${v > 0.6 ? 55 : 85}% ${88 - 10 * d}%)`; };
  const solid = v => `hsl(${hue(v).toFixed(0)} 70% 46%)`;

  function bars(target, rows) {
    target.replaceChildren(...rows.map(([label, v, title]) => {
      const li = el("li");
      li.append(el("span", "lbl", label));
      const tr = el("span", "track"), i = el("i");
      i.style.width = "0%"; i.style.background = solid(v ?? 0);
      tr.append(i); li.append(tr, el("span", "v", v == null ? "—" : pct(v) + "%"));
      if (title) li.title = title;
      requestAnimationFrame(() => requestAnimationFrame(() => i.style.width = pct(v ?? 0) + "%"));
      return li;
    }));
  }
  function countUp(node, to) {
    const t0 = performance.now();
    const step = now => { const k = Math.min(1, (now - t0) / 700), e = 1 - (1 - k) ** 3; node.innerHTML = `${Math.round(to * e)}<small>%</small>`; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function chips(items, cls, detail) {
    const wrap = el("div", "chips");
    if (!items.length) { wrap.append(el("span", "sub", "None")); return wrap; }
    items.forEach(it => {
      const c = el("span", `chip ${cls}${it.credit != null && it.credit < 0.8 ? " weak" : ""}`, it.skill);
      if (it.weight) c.append(el("span", "w", it.weight === 3 ? "core" : it.weight === 1 ? "nice" : ""));
      if (detail && it.where) c.title = `Evidence: ${it.where} (credit ${pct(it.credit)}%)`;
      wrap.append(c);
    });
    return wrap;
  }

  // ---------------------------------------------------------------- render
  function render(scroll) {
    const d = st.data;
    if (!d || !st.meta || !st.level) return;
    $("#rf-results").classList.add("show");
    const roles = Object.fromEntries(st.meta.roles.map(r => [r.id, r.label]));
    const levels = Object.fromEntries(st.meta.levels.map(l => [l.id, l.label]));
    const roleMode = st.role === "all" ? "all" : st.role.startsWith("family:") ? "family" : "one";
    const oneCountry = st.country !== "all";
    const scope = roleMode === "one" ? [st.role] : roleMode === "family" ? d.families[st.role.slice(7)] : d.role_order;

    // The role-fit panel always shows one role: the selected one, or with "All roles" the heatmap cell the
    // user clicked, defaulting to the best fit at the selected position.
    const best = scope.reduce((a, r) => d.matrix[r][st.level].score > d.matrix[a][st.level].score ? r : a, scope[0]);
    const focus = roleMode === "one" ? st.role : (st.focus && scope.includes(st.focus) ? st.focus : best);
    st.shown = focus;

    // layout: role fit (+ country panel) → how to improve + what's missing → heatmap or position strip → countries
    $("#rf-mx-card").hidden = roleMode === "one";
    $("#rf-strip-card").hidden = roleMode !== "one";
    $("#rf-country-card").hidden = !oneCountry;
    $("#rf-top").classList.toggle("single", !oneCountry);
    $("#rf-top").classList.remove("matrix-left");
    $("#rf-cty-card").hidden = oneCountry;
    $("#rf-fit-actions").hidden = roleMode === "one";

    renderRole(d, roles, levels, focus, roleMode === "one" ? null : (focus === best && !st.focus ? "best" : "picked"));
    if (roleMode !== "one") renderMatrix(d, roles, levels, scope, roleMode, focus);
    if (oneCountry) renderCountry(d); else renderCountries(d);
    renderJd(d);
    renderSeniority(d, levels);
    renderProfile(d);
    renderAts(d);
    const sugg = [...d.suggestions];
    if (d.profile.years_note) sugg.unshift(d.profile.years_note);
    $("#rf-sugg-card").hidden = !sugg.length;
    $("#rf-sugg").replaceChildren(...sugg.map(s => el("li", null, s)));
    if (scroll) $("#rf-results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderRole(d, roles, levels, rid, why) {
    const cell = d.matrix[rid][st.level], role = d.roles[rid], lv = d.levels[st.level];
    const C = 2 * Math.PI * 76, arc = $("#rf-arc");
    arc.style.stroke = solid(cell.score);
    arc.style.strokeDashoffset = C;
    requestAnimationFrame(() => requestAnimationFrame(() => arc.style.strokeDashoffset = C * (1 - cell.score)));
    countUp($("#rf-pct"), pct(cell.score));
    const prefix = why === "best" ? "Best fit · " : why === "picked" ? "Selected · " : "";
    $("#rf-fit-title").textContent = `${prefix}${levels[st.level]} · ${roles[rid]}`;
    $("#rf-fit-sub").textContent = `Role fit ${pct(cell.role_fit)}% × seniority ${pct(cell.gate)}%` + (d.profile.exp_factor < 1 ? ` × experience ${d.profile.exp_factor}` : "")
      + (why ? " · click any cell in the heatmap below to inspect it" : "");
    bars($("#rf-bars"), [
      ["Skills", role.skills, `${pct(role.coverage)}% of the weighted template covered`],
      ["Similarity", role.semantic, "Meaning-based similarity to the role profile"],
      ["Job titles", role.title, role.title_evidence ? `Matched: ${role.title_evidence}` : "No matching title"],
      ["ATS readability", d.ats.score],
      ["Seniority", lv.score, `Years ${pct(lv.years)}% · scope signals ${pct(lv.signals)}% · title level ${pct(lv.title)}%`],
    ]);
    const warn = $("#rf-exp-warn");
    warn.hidden = d.profile.exp_factor >= 1;
    warn.textContent = `Resume shows ${d.profile.years_used} years; under ${d.profile.min_years} years every score is reduced (×${d.profile.exp_factor}).`;

    // how to improve
    const im = cell.improve, cur = $("#rf-imp-cur"), pot = $("#rf-imp-pot"), top = Math.max(im.potential, cell.score);
    $("#rf-imp-title").textContent = `How to improve: ${levels[st.level]} · ${roles[rid]}`;
    $("#rf-imp-now").textContent = `Now ${pct(cell.score)}%`;
    $("#rf-imp-pot-v").textContent = `Up to ~${pct(top)}%`;
    cur.style.background = solid(cell.score); pot.style.background = solid(top);
    cur.style.width = pct(cell.score) + "%"; pot.style.width = pct(top) + "%";
    const icons = { skill: "+", evidence: "↑", title: "T", ats: "A", scope: "★" };
    const kinds = { skill: "Missing skill", evidence: "Stronger evidence", title: "Headline", ats: "ATS fix", scope: "Seniority scope" };
    $("#rf-imp-list").replaceChildren(...(im.actions.length ? im.actions.map(a => {
      const li = el("li"), k = el("span", "k", icons[a.kind] || "•");
      k.title = kinds[a.kind] || a.kind;
      li.append(el("span", "gain", `+${(a.gain * 100).toFixed(a.gain < 0.1 ? 1 : 0)} pts`), k, el("span", "t", a.text));
      return li;
    }) : [el("li", "imp-empty", "No meaningful edits left for this target — it's already a strong match.")]));
    $("#rf-imp-notes").replaceChildren(...im.notes.map(n => el("div", "rf-note", n)));

    // this role at every position
    $("#rf-strip-title").textContent = `${roles[rid]} at every position`;
    $("#rf-strip").replaceChildren(...d.level_order.map(l => {
      const v = d.matrix[rid][l].score, b = el("button", l === st.level ? "sel" : "");
      b.append(el("span", null, levels[l]), document.createTextNode(pct(v) + "%"));
      b.style.background = tint(v);
      b.title = `Typical: ${d.levels[l].band[0]}–${d.levels[l].band[1]} yrs`;
      b.onclick = () => select("level", l);
      return b;
    }));

    // skills
    $("#rf-skills-title").textContent = `Skills for ${roles[rid]} · ${pct(role.coverage)}% of template`;
    const sk = $("#rf-skills"); sk.replaceChildren();
    sk.append(el("div", "subhead", `Matched (${role.matched.length})`), chips(role.matched, "ok", true));
    sk.append(el("div", "subhead", `Missing (${role.missing.length}) — add only what you've really used`), chips(role.missing, "miss"));
  }

  function renderMatrix(d, roles, levels, scope, roleMode, focus) {
    const cells = [];
    scope.forEach(r => d.level_order.forEach(l => cells.push([d.matrix[r][l].score, r, l])));
    cells.sort((a, b) => b[0] - a[0]);
    const rank = new Map(cells.slice(0, 3).map(([, r, l], i) => [`${r}|${l}`, i + 1]));
    const fam = roleMode === "family" ? st.role.slice(7) : null;
    $("#rf-mx-title").textContent = fam ? `${fam}: roles × positions` : "All roles × positions";
    $("#rf-mx-sub").textContent = `Experience: ${d.profile.years_used} yrs ${st.years != null ? "(override)" : "(from resume)"} · click a cell for its breakdown`;
    const cg = el("colgroup"); cg.append(el("col", "rc")); d.level_order.forEach(() => cg.append(el("col")));
    const head = el("tr"); head.append(el("th", "role", ""));
    d.level_order.forEach(l => { const th = el("th", l === st.level ? "sel" : "", levels[l]); th.title = `Typical: ${d.levels[l].band[0]}–${d.levels[l].band[1]} yrs`; head.append(th); });
    const thead = el("thead"); thead.append(head);
    const tbody = el("tbody");
    const groups = Object.entries(d.families).map(([f, ids]) => [f, ids.filter(i => scope.includes(i))]).filter(([, ids]) => ids.length);
    groups.forEach(([f, ids]) => {
      if (groups.length > 1) { const tr = el("tr"), th = el("th", "fam", f); th.colSpan = d.level_order.length + 1; tr.append(th); tbody.append(tr); }
      ids.forEach(r => {
        const tr = el("tr"); tr.append(el("th", "role", roles[r]));
        d.level_order.forEach(l => {
          const v = d.matrix[r][l].score, b = el("button", null, pct(v));
          const td = el("td", (l === st.level ? "col" : "") + (r === focus && l === st.level ? " focus" : ""));
          b.style.background = tint(v);
          b.title = `${levels[l]} · ${roles[r]}: ${pct(v)}% — click for details`;
          b.setAttribute("aria-label", b.title);
          // Inspect the cell in the role-fit panel above while keeping the "All roles" heatmap
          b.onclick = () => {
            st.focus = r; st.level = l; $("#rf-level").value = l; pref("level", l); render();
            $("#rf-fit").scrollIntoView({ behavior: "smooth", block: "nearest" });
          };
          td.append(b);
          if (rank.has(`${r}|${l}`)) td.append(el("span", "rank", "#" + rank.get(`${r}|${l}`)));
          tr.append(td);
        });
        tbody.append(tr);
      });
    });
    $("#rf-mx").replaceChildren(cg, thead, tbody);
  }

  function renderCountry(d) {
    const c = d.countries.find(x => x.id === st.country);
    $("#rf-c-title").textContent = c.label;
    $("#rf-c-pct").textContent = pct(c.score) + "%";
    $("#rf-c-pct").style.color = solid(c.score);
    bars($("#rf-c-bars"), [["Work rights", c.parts.eligibility], ["Location", c.parts.location], ["Language", c.parts.language], ["CV norms", c.parts.conventions]]);
    $("#rf-c-notes").replaceChildren(...c.notes.map(n => el("li", null, n)));
    $("#rf-c-guide").replaceChildren(...c.guidance.map(n => el("li", null, n)));
  }

  function renderCountries(d) {
    $("#rf-cty").replaceChildren(...[...d.countries].sort((a, b) => b.score - a.score).map(x => {
      const b = el("button");
      b.style.background = tint(x.score);
      b.append(el("span", null, x.label), el("b", null, pct(x.score) + "%"));
      b.title = `${x.label}: ${pct(x.score)}% — click for details`;
      b.onclick = () => select("country", x.id);
      return b;
    }));
  }

  function renderJd(d) {
    const jd = d.jd;
    $("#rf-jd-card").hidden = !jd;
    if (!jd) return;
    $("#rf-jd-pct").textContent = `· ${pct(jd.score)}%`;
    const body = $("#rf-jd-body"); body.replaceChildren();
    if (jd.years_required) body.append(el("p", "sub", `Posting asks for ${jd.years_required}+ years; resume shows ${d.profile.years_derived}.`));
    body.append(el("div", "subhead", `In the posting and on your resume (${jd.matched.length})`), chips(jd.matched, "ok"));
    body.append(el("div", "subhead", `In the posting, missing from your resume (${jd.missing.length})`), chips(jd.missing, "miss"));
  }

  function renderSeniority(d, levels) {
    const lv = d.levels[st.level];
    $("#rf-sen-title").textContent = `Seniority evidence · ${levels[st.level]}`;
    const sen = $("#rf-sen"); sen.replaceChildren();
    const kv = el("dl", "kv");
    const add = (k, v) => kv.append(el("dt", null, k), el("dd", null, v));
    add("Experience", `${d.profile.years_used} yrs · typical for ${levels[st.level]}: ${lv.band[0]}–${lv.band[1]}`);
    add("Title level", d.profile.title_level ? `${d.profile.title_level} (from recent titles)` : "Not detected");
    add("Scope signals", lv.found.length ? `${pct(lv.signals)}% of what this level usually shows` : "None found");
    sen.append(kv);
    if (lv.found.length) { sen.append(el("div", "subhead", "Signals found")); sen.append(chips(lv.found.map(s => ({ skill: s })), "ok")); }
  }

  function renderProfile(d) {
    const p = d.profile, pr = $("#rf-profile"); pr.replaceChildren();
    const kv = el("dl", "kv");
    const add = (k, v, small) => { if (!v) return; const dd = el("dd", null, v); if (small) dd.append(" ", el("small", null, small)); kv.append(el("dt", null, k), dd); };
    add("Headline", p.headline);
    const src = p.years_source === "stated" ? "stated in the resume" : `from ${p.jobs.length} dated role${p.jobs.length === 1 ? "" : "s"}`;
    const detail = p.years_stated != null && p.years_source !== "stated" ? `· resume states ${p.years_stated}+` :
      p.years_source === "stated" && p.jobs.length ? `· job dates add up to ${p.years_dates}` : "";
    add("Experience", `${p.years_derived} years, ${src}`, `${detail} · “Present” = ${p.as_of} (${p.as_of_source})`);
    add("Location", p.location || "Not found");
    const level = v => v >= 1 ? "native" : v >= 0.9 ? "fluent" : v >= 0.7 ? "professional" : v >= 0.6 && v < 0.7 ? "level not stated" : v >= 0.5 ? "intermediate" : "basic";
    const langs = Object.entries(p.languages).map(([k, v]) => `${k} (${level(v)})`);
    if (p.languages_inferred_english) langs.push("English (resume language, level not stated)");
    add("Languages", langs.join(", "));
    add("Work rights", Object.entries(p.auth).map(([k, v]) => `${k}: ${v.join(", ")}`).join("; ") || (p.generic_auth.length ? p.generic_auth.join(", ") : "Not stated"));
    add("Contact", [p.emails[0], p.phones[0], p.linkedin, p.github].filter(Boolean).join(" · ") || "Not found");
    add("Sections", p.section_info.map(s => s.heading ? `${s.type} (“${s.heading}”${s.source === "content" ? ", by content" : ""})` : `${s.type} (by content)`).join(", "));
    add("Read with", d.extractor);
    pr.append(kv);
    if (p.education.length) {
      pr.append(el("div", "subhead", "Education"));
      const ul = el("ul", "jobs");
      p.education.forEach(e => { const li = el("li"); li.append(el("span", "t", e.degree), el("span", "d", e.year || ""), el("span", "c", e.institution || "")); ul.append(li); });
      pr.append(ul);
    }
    if (p.jobs.length) {
      pr.append(el("div", "subhead", "Roles parsed"));
      const ul = el("ul", "jobs");
      p.jobs.forEach(j => { const li = el("li"); li.append(el("span", "t", j.title || "(title not found)"), el("span", "d", `${j.start} – ${j.end}`), el("span", "c", j.company || "")); ul.append(li); });
      pr.append(ul);
    }
  }

  function renderAts(d) {
    $("#rf-ats-pct").textContent = `· ${pct(d.ats.score)}%`;
    $("#rf-ats").replaceChildren(...d.ats.checks.map(ch => {
      const li = el("li", ch.status);
      li.append(el("span", "ic", ch.status === "pass" ? "✓" : ch.status === "warn" ? "!" : "×"), el("span", null, ch.label), el("span", "d", ch.detail));
      return li;
    }));
  }

  refresh();
})();
