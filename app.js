"use strict";
/* DAX-Anlagespiel – Dashboard (statisch, lädt data.json) */
(function () {
  const TABS = [
    ["uebersicht", "Übersicht"], ["wert", "Wertentwicklung"], ["kml", "KML (μ-σ)"], ["wml", "WML (μ-β)"],
    ["detail", "Portfolio-Detail"], ["gv", "Gewinne & Verluste"], ["methodik", "Methodik"],
  ];
  const PALETTE = ["#1f77b4", "#d95f02", "#7570b3", "#1b9e77", "#e7298a", "#66a61e", "#a6761d", "#e6ab02", "#666666", "#17becf"];
  const SYMBOLS = ["circle", "square", "diamond", "triangle-up", "cross", "x", "triangle-down", "star"];
  const state = { data: null, tab: "uebersicht", day: 0, own: "", sort: { key: "rendite_kum", dir: -1 },
    log: false, kmlMode: "ann", wmlBeta: "post", detail: "", gvPf: "", allPos: false, timer: null, firstDay: 0 };

  const $ = (s, r) => (r || document).querySelector(s);
  const nf = (d) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
  const f0 = nf(0), f1 = nf(1), f2 = nf(2), f3 = nf(3);
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const z = (v) => (Math.abs(v) < 0.005 ? 0 : v);
  const eur = (v) => (isNum(v) ? f2.format(z(v)) + " €" : "–");
  const eurS = (v) => (isNum(v) ? (z(v) > 0 ? "+" : "") + f2.format(z(v)) + " €" : "–");
  const pct = (v, d) => (isNum(v) ? (v > 0 && d === "s" ? "+" : "") + f2.format(v * 100) + " %" : "–");
  const pctS = (v) => (isNum(v) ? (v > 0 ? "+" : "") + f2.format(v * 100) + " %" : "–");
  const num = (v, d) => (isNum(v) ? nf(d == null ? 2 : d).format(v) : "–");
  const dt = (iso) => iso.split("-").reverse().join(".");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  // ------------------------------------------------------------------ Start
  fetch("data.json?v=" + Date.now()).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init).catch((e) => { $("#stand").textContent = "Daten konnten nicht geladen werden (" + e.message + ")."; });

  function init(d) {
    state.data = d;
    document.title = d.meta.spiel;
    $("#titel").textContent = d.meta.spiel;
    $("#stand").textContent = "Datenstand: Schlusskurse vom " + dt(d.meta.datenstand);
    const alt = d.meta.datenalter_handelstage;
    if (alt > d.meta.max_datenalter_handelstage) {
      const b = $("#banner"); b.hidden = false;
      b.textContent = "Achtung: Die Kursdaten sind " + alt + " Handelstage alt. Die Aktualisierung hat möglicherweise nicht funktioniert.";
    }
    $("#fuss").textContent = "Stand erzeugt " + d.meta.erzeugt_utc.replace("T", " ").replace("Z", " UTC") + " · Version " + d.meta.commit + " · " + d.portfolios.length + " Portfolios";
    state.pfs = d.portfolios.slice().sort((a, b) => a.id.localeCompare(b.id));
    state.color = {}; state.symbol = {};
    state.pfs.forEach((p, i) => { state.color[p.id] = PALETTE[i % PALETTE.length]; state.symbol[p.id] = SYMBOLS[Math.floor(i / PALETTE.length) % SYMBOLS.length]; });
    state.T = d.datum.length;
    state.day = state.T - 1;
    let fd = state.T - 1;
    state.pfs.forEach((p) => { const i = p.serie.mu.findIndex(isNum); if (i >= 0) fd = Math.min(fd, i); });
    state.firstDay = fd;
    state.detail = state.gvPf = (state.pfs[0] || {}).id || "";
    const sel = $("#own");
    state.pfs.forEach((p) => sel.add(new Option(p.id, p.id)));
    const saved = store("own");
    if (saved && state.pfs.some((p) => p.id === saved)) { state.own = saved; sel.value = saved; }
    sel.onchange = () => { state.own = sel.value; store("own", sel.value); render(); };
    const nav = $("#tabs");
    TABS.forEach(([id, label]) => {
      const b = document.createElement("button");
      b.type = "button"; b.role = "tab"; b.textContent = label; b.dataset.id = id;
      b.onclick = () => { stop(); state.tab = id; render(); };
      nav.appendChild(b);
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => render());
    window.addEventListener("resize", () => document.querySelectorAll(".chart").forEach((c) => c.data && Plotly.Plots.resize(c)));
    render();
  }

  function stop() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }

  function render() {
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.id === state.tab));
    const m = $("#main");
    m.innerHTML = "";
    if (!state.pfs.length) { m.innerHTML = "<p>Das Journal enthält noch keine Buchungen.</p>"; return; }
    ({ uebersicht: vUebersicht, wert: vWert, kml: vKml, wml: vWml, detail: vDetail, gv: vGv, methodik: vMethodik })[state.tab](m);
  }

  // ------------------------------------------------------------------ Hilfen
  function el(html) {
    const t = document.createElement("div"); t.innerHTML = html.trim();
    if (t.children.length === 1 && t.childNodes.length === 1) return t.firstChild;
    const f = document.createDocumentFragment(); while (t.firstChild) f.appendChild(t.firstChild); return f;
  }

  function layout(extra) {
    const fg = css("--fg"), line = css("--line");
    return Object.assign({
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: { color: fg, size: 12 },
      margin: { l: 60, r: 20, t: 20, b: 50 }, legend: { orientation: "h", y: -0.2 },
      xaxis: { gridcolor: line, zerolinecolor: line, automargin: true, tickformat: "%d.%m.", hoverformat: "%d.%m.%Y" },
      yaxis: { gridcolor: line, zerolinecolor: line, automargin: true }, hovermode: "closest",
    }, extra);
  }
  const CONF = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d"] };

  function plot(node, traces, lay) { Plotly.react(node, traces, layout(lay), CONF); }

  function sortableTable(cols, rows, opt) {
    opt = opt || {};
    const wrap = el('<div class="tablewrap"><table><thead></thead><tbody></tbody></table></div>');
    const sk = opt.sort || { key: cols[0].key, dir: 1 };
    const body = () => {
      const c = cols.find((x) => x.key === sk.key) || cols[0];
      const val = (r) => (c.sortVal ? c.sortVal(r) : r[c.key]);
      const s = rows.slice().sort((a, b) => {
        const x = val(a), y = val(b);
        if (!isNum(x) && !isNum(y)) return String(x == null ? "" : x).localeCompare(String(y == null ? "" : y)) * sk.dir;
        if (!isNum(x)) return 1; if (!isNum(y)) return -1;
        return (x - y) * sk.dir;
      });
      $("tbody", wrap).innerHTML = s.map((r) => "<tr" + (opt.hl && opt.hl(r) ? ' class="own"' : "") + ">" + cols.map((c2) => {
        const v = c2.render ? c2.render(r) : esc(r[c2.key] == null ? "" : r[c2.key]);
        const cls = (c2.cls ? c2.cls(r) : "") + (c2.left ? " l" : "");
        return "<td" + (cls.trim() ? ' class="' + cls.trim() + '"' : "") + ">" + v + "</td>";
      }).join("") + "</tr>").join("");
      $("thead", wrap).innerHTML = "<tr>" + cols.map((c2) => '<th scope="col" class="' + (c2.left ? "l" : "") + '"' +
        (c2.key === sk.key ? ' aria-sort="' + (sk.dir > 0 ? "ascending" : "descending") + '"' : "") + '><button type="button" data-k="' + c2.key + '" title="' + esc(c2.title || c2.label) + '">' + esc(c2.label) + "</button></th>").join("") + "</tr>";
      wrap.querySelectorAll("th button").forEach((b) => b.onclick = () => {
        if (sk.key === b.dataset.k) sk.dir = -sk.dir; else { sk.key = b.dataset.k; sk.dir = 1; }
        if (opt.onsort) opt.onsort(sk); body();
      });
    };
    body();
    return wrap;
  }
  const signCls = (v) => (isNum(v) ? (v > 0.005 ? "pos" : v < -0.005 ? "neg" : "") : "");
  const arrow = (v) => (isNum(v) ? (v > 0.005 ? "▲ " : v < -0.005 ? "▼ " : "") : "");

  // ------------------------------------------------------------------ Übersicht
  function vUebersicht(m) {
    const rows = state.pfs.map((p) => Object.assign({ id: p.id, status: p.status }, p.aktuell));
    const cols = [
      { key: "rang", label: "Rang", title: "Rang nach kumulierter Rendite", render: (r) => r.rang, sortVal: (r) => r.rang },
      { key: "id", label: "Portfolio", left: true },
      { key: "rendite_kum", label: "Rendite", render: (r) => arrow(r.rendite_kum) + pctS(r.rendite_kum), cls: (r) => signCls(r.rendite_kum) },
      { key: "nav", label: "NAV", render: (r) => eur(r.nav) },
      { key: "gv_gesamt", label: "G/V", title: "Gewinn/Verlust in Euro seit Wertungsbeginn", render: (r) => arrow(r.gv_gesamt) + eurS(r.gv_gesamt), cls: (r) => signCls(r.gv_gesamt) },
      { key: "beta_post", label: "β post", title: "Beta ex post (Regression)", render: (r) => num(r.beta_post) },
      { key: "beta_ante", label: "β ante", title: "Beta ex ante (gewichtete Titelbetas)", render: (r) => num(r.beta_ante) },
      { key: "alpha", label: "α (Jensen)", title: "Jensens Alpha p. a.; ● = signifikant (|t| > 1,96)", render: (r) => pctS(r.alpha) + (r.alpha_signifikant ? " ●" : "") + (isNum(r.alpha_t) ? ' <span class="note">t=' + num(r.alpha_t, 1) + "</span>" : "") },
      { key: "sharpe", label: "Sharpe", render: (r) => num(r.sharpe) },
      { key: "treynor", label: "Treynor", title: "n. a. bei |β| < " + state.data.meta.parameter.kennzahlen.treynor_min_abs_beta, render: (r) => (isNum(r.treynor) ? pctS(r.treynor) : "n. a.") },
      { key: "max_drawdown", label: "Max. DD", render: (r) => pct(r.max_drawdown) },
      { key: "brutto_hebel", label: "Hebel", title: "Brutto-Hebel (Long + |Short|) / NAV", render: (r) => num(r.brutto_hebel) + "×" },
      { key: "status", label: "Status", left: true, render: (r) => (r.status === "aktiv" ? "aktiv" : "ausgeschieden") },
    ];
    rows.slice().sort((a, b) => b.rendite_kum - a.rendite_kum).forEach((r, i) => { r.rang = i + 1; });
    m.appendChild(el('<p class="note">Spalten anklicken zum Sortieren. α ist annualisiert, ● kennzeichnet Signifikanz zum 5-%-Niveau. Ex-post-Kennzahlen erst ab ' + state.data.meta.parameter.kennzahlen.min_beobachtungen_ex_post + " Handelstagen.</p>"));
    m.appendChild(sortableTable(cols, rows, { sort: state.sort, hl: (r) => r.id === state.own, onsort: (s) => (state.sort = s) }));
    const warn = state.data.meta.warnungen || [];
    const assumed = state.pfs.reduce((a, p) => a + (p.preise_angenommen || 0), 0);
    if (assumed) m.appendChild(el('<p class="note">' + assumed + " Buchung(en) ohne eingetragenen Preis: Schlusskurs des Buchungstags angenommen.</p>"));
    if (warn.length) m.appendChild(el('<p class="note">' + warn.length + " Hinweis(e) zur Datenqualität, siehe Methodik.</p>"));
  }

  // ------------------------------------------------------------------ Wertentwicklung
  function vWert(m) {
    m.appendChild(el('<div class="controls"><label><input type="checkbox" id="log"> logarithmische Achse</label><span class="note">NAV normiert auf 100 (Wertungsbeginn), zum Vergleich der DAX.</span></div>'));
    $("#log").checked = state.log;
    $("#log").onchange = (e) => { state.log = e.target.checked; draw(); };
    const c = el('<div class="chart" role="img" aria-label="Wertentwicklung der Portfolios und des DAX"></div>');
    m.appendChild(c);
    function draw() {
      const d = state.data, x = d.datum;
      const traces = state.pfs.map((p) => {
        const own = p.id === state.own;
        return { x, y: p.nav.map((v) => (v / p.nav[0]) * 100), name: p.id, type: "scatter", mode: "lines",
          line: { color: own || !state.own ? state.color[p.id] : css("--line"), width: own ? 3.5 : 1.6 },
          opacity: state.own && !own ? 0.6 : 1, hovertemplate: "%{y:.1f}<extra>" + p.id + "</extra>" };
      });
      traces.push({ x, y: d.markt.index, name: "DAX", type: "scatter", mode: "lines", line: { color: css("--fg"), width: 3, dash: "dot" }, hovertemplate: "%{y:.1f}<extra>DAX</extra>" });
      plot(c, traces, { yaxis: { type: state.log ? "log" : "linear", title: "Index (Wertungsbeginn = 100)", gridcolor: css("--line") }, hovermode: "x unified" });
    }
    draw();
  }

  // ------------------------------------------------------------------ Zeitregler
  function slider(m, onchange) {
    const d = state.data, lo = state.firstDay, hi = state.T - 1;
    const box = el('<div class="controls"><button type="button" class="btn" id="play" aria-label="Abspielen">▶ Abspielen</button>' +
      '<input type="range" id="sl" min="' + lo + '" max="' + hi + '" value="' + Math.max(lo, state.day) + '" aria-label="Handelstag"><strong id="sd"></strong></div>');
    m.appendChild(box);
    const sl = $("#sl", box), sd = $("#sd", box), pb = $("#play", box);
    const upd = () => { state.day = +sl.value; sd.textContent = dt(d.datum[state.day]); onchange(); };
    sl.oninput = () => { stop(); pb.textContent = "▶ Abspielen"; upd(); };
    pb.onclick = () => {
      if (state.timer) { stop(); pb.textContent = "▶ Abspielen"; return; }
      if (+sl.value >= hi) sl.value = lo;
      pb.textContent = "❚❚ Pause";
      state.timer = setInterval(() => { if (+sl.value >= hi) { stop(); pb.textContent = "▶ Abspielen"; return; } sl.value = +sl.value + 1; upd(); }, 250);
    };
    if (state.day < lo) state.day = hi;
    sl.value = state.day; sd.textContent = dt(d.datum[state.day]);
    return box;
  }

  function ptsAt(i, xf, yf) {
    return state.pfs.map((p) => ({ p, x: xf(p, i), y: yf(p, i) })).filter((q) => isNum(q.x) && isNum(q.y));
  }
  function scatterTrace(pts, text) {
    return {
      x: pts.map((q) => q.x), y: pts.map((q) => q.y), type: "scatter", mode: "markers+text", name: "Portfolios",
      text: pts.map((q) => q.p.id), textposition: "top center", textfont: { size: 10, color: css("--muted") },
      marker: { size: pts.map((q) => (q.p.id === state.own ? 15 : 10)), color: pts.map((q) => (q.p.status !== "aktiv" ? css("--muted") : state.color[q.p.id])),
        symbol: pts.map((q) => (q.p.status !== "aktiv" ? "x" : state.symbol[q.p.id])), line: { width: pts.map((q) => (q.p.id === state.own ? 3 : 1)), color: css("--fg") } },
      customdata: pts.map((q) => text(q.p, q)), hovertemplate: "%{customdata}<extra></extra>",
    };
  }
  function range(vals, pad, clampLo, clampHi) {
    const v = vals.filter(isNum); if (!v.length) return undefined;
    let lo = Math.min(...v), hi = Math.max(...v); const w = (hi - lo) || 0.1;
    lo = Math.max(clampLo, lo - w * pad); hi = Math.min(clampHi, hi + w * pad); return [lo, hi];
  }

  // ------------------------------------------------------------------ KML
  function vKml(m) {
    const d = state.data;
    m.appendChild(el('<div class="controls"><label>Darstellung <select id="mode"><option value="ann">annualisiert</option><option value="per">Periode (kumuliert)</option></select></label>' +
      '<span class="note">Kapitalmarktlinie: μ = μ<sub>f</sub> + (μ<sub>m</sub> − μ<sub>f</sub>)/σ<sub>m</sub> · σ</span></div>'));
    $("#mode").value = state.kmlMode; $("#mode").onchange = (e) => { state.kmlMode = e.target.value; draw(); };
    const c = el('<div class="chart" role="img" aria-label="Portfolios im Rendite-Risiko-Diagramm mit Kapitalmarktlinie"></div>');
    slider(m, draw); m.appendChild(c);
    m.appendChild(el('<div class="hint">Ex post über wenige Monate gemessen sind KML und WML stark vom Zufall geprägt. Bei negativer Marktüberrendite fallen beide Linien.</div>'));
    const ann = () => state.kmlMode === "ann";
    function draw() {
      const i = state.day, A = d.meta.parameter.kennzahlen.annualisierung;
      const mk = d.markt;
      let xf, yf, mx, my, fy, xl, yl;
      if (ann()) {
        xf = (p, k) => p.serie.sigma[k]; yf = (p, k) => p.serie.mu[k];
        mx = mk.sigma[i]; my = mk.mu[i]; fy = mk.mu_f[i]; xl = "Volatilität σ (p. a.)"; yl = "Rendite μ (p. a.)";
      } else {
        xf = (p, k) => (isNum(p.serie.sigma[k]) ? p.serie.sigma[k] * Math.sqrt(k / A) : null); yf = (p, k) => p.serie.rendite_kum[k];
        mx = isNum(mk.sigma[i]) ? mk.sigma[i] * Math.sqrt(i / A) : null; my = mk.index[i] / 100 - 1; fy = mk.rf_kum[i];
        xl = "Volatilität über die Periode (σ·√(n/252))"; yl = "Kumulierte Rendite";
      }
      const pts = ptsAt(i, xf, yf);
      // feste Achsen über alle Tage, damit der Zeitregler ruhig bleibt
      const allX = [], allY = [];
      for (let k = state.firstDay; k < state.T; k++) {
        state.pfs.forEach((p) => { allX.push(xf(p, k)); allY.push(yf(p, k)); });
      }
      const xr = range(allX.concat([0, mx]), 0.08, 0, 2.5), yr = range(allY.concat([my, fy]), 0.1, -1.5, 3);
      const xmax = xr ? xr[1] : 0.5;
      const slope = isNum(mx) && mx > 0 ? (my - fy) / mx : 0;
      const tr = [
        { x: [0, xmax], y: [fy, fy + slope * xmax], mode: "lines", type: "scatter", name: "Kapitalmarktlinie", line: { color: css("--accent"), width: 2 }, hoverinfo: "skip" },
        scatterTrace(pts, (p, q) => "<b>" + p.id + "</b><br>" + (ann() ? "μ " + pct(p.serie.mu[i]) + " · σ " + pct(p.serie.sigma[i]) : "Rendite " + pctS(q.y) + " · σ " + pct(q.x)) +
          "<br>β post " + num(p.serie.beta_post[i]) + " · α " + pctS(p.serie.alpha[i]) + "<br>Sharpe " + num(p.serie.sharpe[i])),
        { x: [mx], y: [my], mode: "markers+text", type: "scatter", name: "DAX", text: ["DAX"], textposition: "bottom center", marker: { size: 14, symbol: "diamond", color: css("--fg") }, hovertemplate: "DAX: " + pct(my) + "<extra></extra>" },
        { x: [0], y: [fy], mode: "markers+text", type: "scatter", name: "risikolos", text: ["r<sub>f</sub>"], textposition: "top right", marker: { size: 11, symbol: "square", color: css("--muted") }, hovertemplate: "risikolos: " + pct(fy) + "<extra></extra>" },
      ];
      plot(c, tr, { xaxis: { title: xl, range: xr, tickformat: ".0%", gridcolor: css("--line") }, yaxis: { title: yl, range: yr, tickformat: ".0%", gridcolor: css("--line"), zerolinecolor: css("--muted") }, showlegend: true });
    }
    draw();
  }

  // ------------------------------------------------------------------ WML
  function vWml(m) {
    const d = state.data;
    m.appendChild(el('<div class="controls"><label>Beta <select id="bt"><option value="post">ex post (Regression)</option><option value="ante">ex ante (Titelbetas)</option></select></label>' +
      '<span class="note">Wertpapiermarktlinie: μ = μ<sub>f</sub> + β (μ<sub>m</sub> − μ<sub>f</sub>); der senkrechte Abstand ist Jensens Alpha.</span></div>'));
    $("#bt").value = state.wmlBeta; $("#bt").onchange = (e) => { state.wmlBeta = e.target.value; draw(); };
    const c = el('<div class="chart" role="img" aria-label="Portfolios im Rendite-Beta-Diagramm mit Wertpapiermarktlinie"></div>');
    slider(m, draw); m.appendChild(c);
    m.appendChild(el('<div class="hint">Short-Positionen führen zu niedrigem oder negativem Beta. Ein Portfolio mit Beta nahe 0 kann eine hohe Volatilität haben und trotzdem auf der WML nahe μ<sub>f</sub> liegen: der Unterschied zwischen systematischem und Gesamtrisiko.</div>'));
    function draw() {
      const i = state.day, mk = d.markt, mu_f = mk.mu_f[i], mu_m = mk.mu[i];
      const bk = state.wmlBeta === "post" ? "beta_post" : "beta_ante";
      const pts = ptsAt(i, (p, k) => p.serie[bk][k], (p, k) => p.serie.mu[k]);
      const allX = [], allY = [];
      for (let k = state.firstDay; k < state.T; k++) state.pfs.forEach((p) => { allX.push(p.serie[bk][k]); allY.push(p.serie.mu[k]); });
      const xr = range(allX.concat([0, 1]), 0.1, -3, 4), yr = range(allY.concat([mu_m, mu_f]), 0.1, -1.5, 3);
      const x0 = xr ? xr[0] : -1, x1 = xr ? xr[1] : 2;
      const wml = (b) => mu_f + b * (mu_m - mu_f);
      const ax = [], ay = [];
      pts.forEach((q) => { ax.push(q.x, q.x, null); ay.push(q.y, wml(q.x), null); });
      const tr = [
        { x: [x0, x1], y: [wml(x0), wml(x1)], mode: "lines", type: "scatter", name: "Wertpapiermarktlinie", line: { color: css("--accent"), width: 2 }, hoverinfo: "skip" },
        { x: ax, y: ay, mode: "lines", type: "scatter", name: "α (Abstand zur WML)", line: { color: css("--muted"), width: 1, dash: "dot" }, hoverinfo: "skip" },
        scatterTrace(pts, (p) => "<b>" + p.id + "</b><br>μ " + pct(p.serie.mu[i]) + " · β " + num(p.serie[bk][i]) + "<br>α " + pctS(p.serie.alpha[i]) + " (t=" + num(p.serie.alpha_t[i], 1) + ")<br>β post " + num(p.serie.beta_post[i]) + " · β ante " + num(p.serie.beta_ante[i])),
        { x: [1], y: [mu_m], mode: "markers+text", type: "scatter", name: "DAX", text: ["DAX"], textposition: "bottom center", marker: { size: 14, symbol: "diamond", color: css("--fg") }, hovertemplate: "DAX: " + pct(mu_m) + "<extra></extra>" },
        { x: [0], y: [mu_f], mode: "markers+text", type: "scatter", name: "risikolos", text: ["r<sub>f</sub>"], textposition: "top right", marker: { size: 11, symbol: "square", color: css("--muted") }, hovertemplate: "risikolos: " + pct(mu_f) + "<extra></extra>" },
      ];
      plot(c, tr, { xaxis: { title: "Beta (" + (state.wmlBeta === "post" ? "ex post" : "ex ante") + ")", range: xr, gridcolor: css("--line"), zerolinecolor: css("--muted") }, yaxis: { title: "Rendite μ (p. a.)", range: yr, tickformat: ".0%", gridcolor: css("--line"), zerolinecolor: css("--muted") } });
    }
    draw();
  }

  // ------------------------------------------------------------------ Detail
  function pfSelect(id, key, onchange) {
    const box = el('<div class="controls"><label>Portfolio <select id="' + id + '"></select></label></div>');
    const s = $("select", box);
    state.pfs.forEach((p) => s.add(new Option(p.id, p.id)));
    s.value = state[key];
    s.onchange = () => { state[key] = s.value; onchange(); };
    return box;
  }
  const getPf = (id) => state.pfs.find((p) => p.id === id);

  function vDetail(m) {
    m.appendChild(pfSelect("pf", "detail", render));
    const p = getPf(state.detail), a = p.aktuell, d = state.data;
    m.appendChild(el('<div class="cards">' +
      [["NAV", eur(a.nav)], ["Rendite", pctS(a.rendite_kum)], ["β post / ante", num(a.beta_post) + " / " + num(a.beta_ante)],
        ["α (p. a.)", pctS(a.alpha) + (a.alpha_signifikant ? " ●" : "")], ["R²", num(a.r2)], ["Sharpe", num(a.sharpe)],
        ["Brutto-Hebel", num(a.brutto_hebel) + "×"], ["Netto-Exposure", pctS(a.netto_exposure)], ["Cash", eur(a.cash)]]
        .map((x) => "<div class='card'><span>" + x[0] + "</span><b>" + x[1] + "</b></div>").join("") + "</div>"));
    if (p.status !== "aktiv") m.appendChild(el('<div class="banner">Ausgeschieden am ' + dt(p.ausgeschieden_am) + ": NAV ≤ Grenze, Portfolio eingefroren.</div>"));
    m.appendChild(el("<h2>Positionen</h2>"));
    const open = p.positionen.filter((x) => x.richtung !== "geschlossen");
    m.appendChild(sortableTable([
      { key: "name", label: "Titel", left: true }, { key: "richtung", label: "Richtung", left: true, render: (r) => (r.richtung === "long" ? "▲ Long" : "▼ Short"), cls: (r) => (r.richtung === "long" ? "pos" : "neg") },
      { key: "stueck", label: "Stück", render: (r) => num(r.stueck, 2) }, { key: "wert", label: "Marktwert", render: (r) => eur(r.wert) },
      { key: "gewicht", label: "Gewicht", render: (r) => pctS(r.gewicht) }, { key: "beta", label: "β ante", render: (r) => num(r.beta) },
    ], open, { sort: { key: "gewicht", dir: -1 } }));
    if (!open.length) m.appendChild(el('<p class="note">Keine offenen Positionen (100 % Cash).</p>'));

    const g = el('<div class="grid2"><div><h2>Regression der Überrenditen</h2><div class="chart small" id="reg" role="img" aria-label="Regression der Portfolio-Überrendite auf die Marktüberrendite"></div></div>' +
      '<div><h2>Risikozerlegung</h2><div class="chart small" id="risk" role="img" aria-label="Risikozerlegung in systematisch und unsystematisch"></div></div></div>');
    m.appendChild(g);
    m.appendChild(el('<h2>Exposure im Zeitverlauf</h2><div class="chart small" id="exp" role="img" aria-label="Netto-Exposure und Brutto-Hebel über die Zeit"></div>'));
    // Regression
    const rf = d.markt.rf_kum, idx = d.markt.index, xs = [], ys = [], tx = [];
    for (let i = 1; i < state.T; i++) {
      if (p.status !== "aktiv" && i > d.datum.indexOf(p.ausgeschieden_am)) break;
      const r = (p.nav[i] / p.nav[i - 1] - 1) - ((1 + rf[i]) / (1 + rf[i - 1]) - 1);
      const mm = (idx[i] / idx[i - 1] - 1) - ((1 + rf[i]) / (1 + rf[i - 1]) - 1);
      xs.push(mm); ys.push(r); tx.push(d.datum[i]);
    }
    const tr = [{ x: xs, y: ys, text: tx, mode: "markers", type: "scatter", name: "Handelstage", marker: { size: 6, color: state.color[p.id], opacity: 0.8 }, hovertemplate: "%{text}<br>x<sub>m</sub> %{x:.2%} · x<sub>p</sub> %{y:.2%}<extra></extra>" }];
    if (isNum(a.beta_post)) {
      const xmin = Math.min(...xs), xmax = Math.max(...xs), A = d.meta.parameter.kennzahlen.annualisierung, ad = (a.alpha || 0) / A;
      tr.push({ x: [xmin, xmax], y: [ad + a.beta_post * xmin, ad + a.beta_post * xmax], mode: "lines", type: "scatter", name: "β = " + num(a.beta_post), line: { color: css("--fg"), width: 2 } });
    }
    plot($("#reg"), tr, { xaxis: { title: "Marktüberrendite x_m (täglich)", tickformat: ".1%", gridcolor: css("--line") }, yaxis: { title: "Portfolio-Überrendite x_p", tickformat: ".1%", gridcolor: css("--line") } });
    // Risiko
    const sys_ = a.sigma_systematisch, uns = a.sigma_unsystematisch;
    plot($("#risk"), [{ x: ["σ gesamt", "systematisch", "unsystematisch"], y: [a.sigma, sys_, uns], type: "bar", marker: { color: [css("--muted"), css("--accent"), "#d95f02"] }, text: [a.sigma, sys_, uns].map((v) => pct(v)), textposition: "outside", hoverinfo: "skip" }],
      { yaxis: { tickformat: ".0%", title: "Volatilität p. a.", gridcolor: css("--line") }, showlegend: false, annotations: [{ xref: "paper", yref: "paper", x: 0.5, y: 1.08, showarrow: false, text: "Anteil systematisch (R²): " + pct(a.r2) }] });
    plot($("#exp"), [
      { x: d.datum, y: p.serie.netto_exposure, name: "Netto-Exposure", mode: "lines", type: "scatter", line: { color: css("--accent"), width: 2 } },
      { x: d.datum, y: p.serie.brutto_hebel, name: "Brutto-Hebel (rechts)", mode: "lines", type: "scatter", yaxis: "y2", line: { color: "#d95f02", width: 2, dash: "dash" } }],
      { yaxis: { tickformat: ".0%", title: "Netto-Exposure", gridcolor: css("--line") }, yaxis2: { overlaying: "y", side: "right", title: "Brutto-Hebel (×)", showgrid: false } });
  }

  // ------------------------------------------------------------------ G/V
  function vGv(m) {
    m.appendChild(pfSelect("pf", "gvPf", render));
    const p = getPf(state.gvPf), d = state.data, gv = p.gv;
    m.appendChild(el('<div class="cards">' + [["G/V gesamt", eurS(gv.gesamt)], ["realisiert", eurS(gv.realisiert)], ["unrealisiert", eurS(gv.unrealisiert)],
      ["Dividenden", eurS(gv.dividenden)], ["Kosten", eurS(-gv.kosten - gv.leihgebuehren)], ["Zinsen", eurS(gv.zinsen)]]
      .map((x) => "<div class='card'><span>" + x[0] + "</span><b>" + x[1] + "</b></div>").join("") + "</div>"));
    m.appendChild(el('<h2>Positionen</h2><div class="controls"><label><input type="checkbox" id="allp"> auch geschlossene Positionen</label></div>'));
    $("#allp").checked = state.allPos; $("#allp").onchange = (e) => { state.allPos = e.target.checked; render(); };
    const rows = p.positionen.filter((x) => state.allPos || x.richtung !== "geschlossen");
    const money = (k) => ({ key: k, render: (r) => eurS(r[k]), cls: (r) => signCls(r[k]) });
    m.appendChild(sortableTable([
      { key: "name", label: "Titel", left: true },
      { key: "richtung", label: "Richtung", left: true, render: (r) => ({ long: "▲ Long", short: "▼ Short", geschlossen: "geschlossen" })[r.richtung] },
      { key: "stueck", label: "Stück", render: (r) => num(r.stueck, 2) },
      { key: "einstandskurs", label: "Einstandskurs", render: (r) => (isNum(r.einstandskurs) ? eur(r.einstandskurs) : "–") },
      { key: "kurs", label: "Kurs", render: (r) => eur(r.kurs) }, { key: "wert", label: "Marktwert", render: (r) => eur(r.wert) },
      Object.assign(money("gv_unrealisiert"), { label: "unrealisiert" }),
      { key: "gv_unrealisiert_pct", label: "unreal. %", render: (r) => pctS(r.gv_unrealisiert_pct), cls: (r) => signCls(r.gv_unrealisiert_pct) },
      Object.assign(money("gv_realisiert"), { label: "realisiert" }), Object.assign(money("dividenden"), { label: "Dividenden" }),
      { key: "kosten", label: "Kosten", render: (r) => eur(-(r.kosten + (r.leihgebuehren || 0))) },
      Object.assign(money("gv_gesamt"), { label: "gesamt" }),
    ], rows, { sort: { key: "gv_gesamt", dir: -1 } }));

    m.appendChild(el('<h2>Wasserfall: vom Startkapital zum NAV</h2><div class="chart" id="wf" role="img" aria-label="Wasserfalldiagramm der Gewinn- und Verlustbeiträge je Titel"></div>'));
    m.appendChild(el('<h2>Verlauf: realisierter und unrealisierter G/V</h2><div class="chart small" id="gvl" role="img" aria-label="Verlauf des Gewinns und Verlusts"></div>'));
    m.appendChild(el("<h2>Transaktionen</h2>"));
    m.appendChild(sortableTable([
      { key: "buchung_id", label: "Nr.", render: (r) => r.buchung_id }, { key: "datum", label: "Datum", left: true, render: (r) => dt(r.datum) },
      { key: "name", label: "Titel", left: true },
      { key: "stueck", label: "Stück", render: (r) => (r.stueck > 0 ? "+" : "") + num(r.stueck, 2) },
      { key: "preis", label: "Preis", render: (r) => eur(r.preis) + (r.preis_angenommen ? ' <abbr title="Preis angenommen: Schlusskurs des Buchungstags">*</abbr>' : "") },
      { key: "volumen", label: "Volumen", render: (r) => eur(r.volumen) },
      { key: "einstandskurs_vorher", label: "Einstandskurs vorher", render: (r) => (isNum(r.einstandskurs_vorher) ? eur(r.einstandskurs_vorher) : "–") },
      { key: "gv_realisiert", label: "realisiert", render: (r) => eurS(r.gv_realisiert), cls: (r) => signCls(r.gv_realisiert) },
      { key: "kosten", label: "Kosten", render: (r) => eur(r.kosten) },
    ], p.transaktionen, { sort: { key: "datum", dir: -1 } }));
    m.appendChild(el('<p class="note">* Preis angenommen: kein Ausführungspreis im Journal, Xetra-Schlusskurs des Buchungstags verwendet.</p>'));

    // Wasserfall (Basic-Bundle kennt keinen Waterfall-Typ: gestapelte Balken mit unsichtbarer Basis)
    const steps = p.positionen.filter((x) => Math.abs(x.gv_gesamt) > 0.005).sort((a, b) => b.gv_gesamt - a.gv_gesamt).map((x) => [x.name, x.gv_gesamt]);
    if (Math.abs(gv.zinsen) > 0.005) steps.push(["Zinsen", gv.zinsen]);
    const start = d.meta.parameter.spiel.startbudget_eur, labels = ["Start"], base = [0], up = [0], down = [0], tot = [start];
    let run = start;
    steps.forEach(([n, v]) => { labels.push(n); base.push(Math.min(run, run + v)); up.push(v > 0 ? v : 0); down.push(v < 0 ? -v : 0); tot.push(0); run += v; });
    labels.push("NAV"); base.push(0); up.push(0); down.push(0); tot.push(run);
    const all = [start, run].concat(steps.map((s, i) => base[i + 1] + Math.abs(s[1])), base.slice(1, -1));
    const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.15 || 50;
    const txt = (arr, sign) => arr.map((v) => (v ? (sign ? sign : "") + f0.format(v) : ""));
    plot($("#wf"), [
      { x: labels, y: base, type: "bar", marker: { color: "rgba(0,0,0,0)" }, hoverinfo: "skip", showlegend: false },
      { x: labels, y: tot, type: "bar", name: "Stand", marker: { color: css("--muted") }, text: txt(tot), textposition: "inside", hovertemplate: "%{x}: %{y:,.2f} €<extra></extra>" },
      { x: labels, y: up, type: "bar", name: "Gewinn ▲", marker: { color: css("--pos") }, text: txt(up, "+"), textposition: "outside", hovertemplate: "%{x}: +%{y:,.2f} €<extra></extra>" },
      { x: labels, y: down, type: "bar", name: "Verlust ▼", marker: { color: css("--neg") }, text: txt(down, "−"), textposition: "outside", hovertemplate: "%{x}: −%{y:,.2f} €<extra></extra>" },
    ], { barmode: "stack", yaxis: { range: [lo - pad, hi + pad], title: "EUR", gridcolor: css("--line") }, xaxis: { tickangle: -35 } });
    plot($("#gvl"), [
      { x: d.datum, y: gv.serie.realisiert, name: "realisiert", mode: "lines", type: "scatter", stackgroup: "a", line: { color: css("--accent"), width: 1.5 } },
      { x: d.datum, y: gv.serie.unrealisiert, name: "unrealisiert", mode: "lines", type: "scatter", stackgroup: "a", line: { color: "#d95f02", width: 1.5 } },
      { x: d.datum, y: gv.serie.sonstige, name: "Dividenden, Zinsen, Kosten", mode: "lines", type: "scatter", stackgroup: "a", line: { color: css("--muted"), width: 1 } },
      { x: d.datum, y: gv.serie.gesamt, name: "gesamt", mode: "lines", type: "scatter", line: { color: css("--fg"), width: 2.5 } }],
      { yaxis: { title: "EUR", gridcolor: css("--line"), zerolinecolor: css("--muted") }, hovermode: "x unified" });
  }

  // ------------------------------------------------------------------ Methodik
  function vMethodik(m) {
    const d = state.data, par = d.meta.parameter;
    m.appendChild(el(`<div>
<h2>Bewertung</h2>
<p>Alle Portfolios starten mit ${f0.format(par.spiel.startbudget_eur)} € und werden börsentäglich zum Xetra-Schlusskurs bewertet. Buchungen werden zum eingetragenen Ausführungspreis verrechnet.</p>
<p><span class="fm">NAV<sub>t</sub> = C<sub>t</sub> + Σ q<sub>i,t</sub> · P<sub>i,t</sub></span> (Short: q &lt; 0). Dividenden werden am Ex-Tag gebucht (Long erhält, Short zahlt), Kurse sind nicht dividendenbereinigt.</p>
<p><span class="fm">r<sub>p,t</sub> = NAV<sub>t</sub> / NAV<sub>t−1</sub> − 1</span>, Überrenditen <span class="fm">x = r − r<sub>f</sub></span>, <span class="fm">r<sub>f,t</sub> = €STR<sub>t−1</sub> · Δd / 360</span>. Marktportfolio ist der DAX (Performanceindex).</p>
<h2>Gewinn und Verlust</h2>
<p>Einstandskurs nach Methode „${esc(par.handel.gv_methode)}“. Realisiert: <span class="fm">−c · (p − p̄)</span> beim Schließen (c = schließende Stückzahl). Unrealisiert: <span class="fm">q · (P − p̄)</span>. Abstimmung: <span class="fm">NAV − Startkapital = realisiert + unrealisiert + Dividenden − Kosten − Leihgebühren + Zinsen</span>, bei jedem Lauf geprüft.</p>
<h2>Kennzahlen</h2>
<ul>
<li><b>β post</b>: OLS von x<sub>p</sub> auf x<sub>m</sub> (Newey-West-Standardfehler, ${par.kennzahlen.newey_west_lags} Lags); <b>α</b> = Achsenabschnitt · ${par.kennzahlen.annualisierung}, t-Wert, ● bei |t| &gt; 1,96.</li>
<li><b>β ante</b>: Σ w<sub>i</sub> β<sub>i</sub> mit Titelbetas aus den ${par.marktdaten.vorperiode_handelstage} Handelstagen vor Spielstart (Short = negatives Gewicht).</li>
<li><b>Sharpe</b> = (μ − μ<sub>f</sub>)/σ; <b>Treynor</b> = (μ − μ<sub>f</sub>)/β (n. a. bei |β| &lt; ${par.kennzahlen.treynor_min_abs_beta}); Tracking Error, Information Ratio und Max. Drawdown in der Detailansicht bzw. Übersicht.</li>
<li>Alle Kennzahlen werden auf dem wachsenden Fenster ab dem ersten Handelstag nach Spielstart berechnet (annualisiert mit ${par.kennzahlen.annualisierung} Tagen), erst ab ${par.kennzahlen.min_beobachtungen_ex_post} Beobachtungen.</li>
<li><b>KML</b>: μ = μ<sub>f</sub> + (μ<sub>m</sub> − μ<sub>f</sub>)/σ<sub>m</sub> · σ. <b>WML</b>: μ = μ<sub>f</sub> + β (μ<sub>m</sub> − μ<sub>f</sub>); α ist der senkrechte Abstand.</li>
</ul>
<div class="hint">Bei etwa 70 bis 80 Beobachtungen ist fast kein Alpha signifikant von null verschieden: Glück oder Können? Die t-Werte zeigen es.</div>
<h2>Regeln dieses Spiels</h2>
<ul>
<li>Leerverkäufe: ${par.short.erlaubt ? "erlaubt" : "nicht erlaubt"}, Leihgebühr ${pct(par.short.leihgebuehr_pa)} p. a., Dividenden ${par.short.dividende_belasten ? "werden belastet" : "werden nicht belastet"}.</li>
<li>Transaktionskosten: ${pct(par.handel.kosten_prozent)} vom Volumen + ${eur(par.handel.kosten_fix_eur)} je Buchung. Cash-Zins: Haben ${esc(par.cash.habenzins == null ? "0 %" : par.cash.habenzins)}, Soll ${esc(par.cash.sollzins == null ? "0 %" : par.cash.sollzins)}.</li>
<li>Grenzen (nur Prüfung): Brutto-Hebel ≤ ${par.limits.max_brutto_hebel == null ? "–" : par.limits.max_brutto_hebel}; Ausscheiden bei NAV ≤ ${f0.format(par.limits.min_nav_eur)} €.</li>
</ul>
<h2>Datenquellen</h2>
<p>Kurse, Dividenden, Splits: Yahoo Finance (inoffizielle Schnittstelle, ohne Gewähr), €STR: EZB Data Portal. Nur abgeleitete Kennzahlen, nur für die Lehre. Stand: ${dt(d.meta.datenstand)}, Version ${esc(d.meta.commit)}.</p>
<h2>Hinweise zur Datenqualität (${(d.meta.warnungen || []).length})</h2>
${(d.meta.warnungen || []).length ? "<ul>" + d.meta.warnungen.slice(0, 200).map((w) => "<li>" + esc(w) + "</li>").join("") + "</ul>" : "<p>Keine.</p>"}
</div>`));
  }
})();
