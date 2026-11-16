/* MeteoMNE — graf.js v1
   Canvas grafikon: brz na mobilnom, interaktivan (dodir = očitanje),
   podržava sirove (10-min) i dnevne (min/prosjek/maks) serije. */
(function () {
    "use strict";

    var TZ = "Europe/Podgorica";

    var MODE = {
        tvaga: { glavni: "T", sporedni: "H", jed: "°C", jed2: "%" },
        rr: { glavni: "RR", stubovi: true, jed: " mm" },
        vjetar: { glavni: "V", udar: "G", jed: " m/s" },
        pritisak: { glavni: "P", jed: " hPa" },
        insolacija: { glavni: "S", jed: " W/m²" }
    };

    var DAN_FMT = fmtOpcije({ day: "numeric", month: "numeric" });
    var SAT_FMT = fmtOpcije({ hour: "2-digit", minute: "2-digit", hour12: false });
    var PUN_FMT = fmtOpcije({ day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

    function fmtOpcije(o) {
        o.timeZone = TZ;
        try { return new Intl.DateTimeFormat("sr-Latn-ME", o); }
        catch (e) { try { return new Intl.DateTimeFormat(undefined, o); } catch (e2) { return null; } }
    }
    function fmt(f, ms) {
        if (!f) { return new Date(ms).toLocaleString(); }
        try { return f.format(new Date(ms)); } catch (e) { return ""; }
    }

    function boje() {
        var s = getComputedStyle(document.documentElement);
        var g = function (n, f) { var v = (s.getPropertyValue(n) || "").trim(); return v || f; };
        return {
            ink: g("--ink", "#12212e"),
            akcenat: g("--akcenat", "#2f7dbd"),
            mreza: g("--linija", "#e2e8ec"),
            mutno: g("--mutno", "#6b7c8a")
        };
    }

    function nn(a, i) {
        if (!a || i >= a.length) { return null; }
        var v = a[i];
        return (typeof v === "number" && isFinite(v)) ? v : null;
    }

    /* ---------- dekodiranje ---------- */
    function decode(j) {
        if (!j) { return null; }
        var pts = [], i;
        if (Array.isArray(j)) {                       // stari format (lista objekata)
            for (i = 0; i < j.length; i++) {
                var t = stariDT(j[i].dt);
                if (t == null) { continue; }
                pts.push({ t: t, T: br(j[i].T), H: br(j[i].vlaga), RR: br(j[i].RR), V: br(j[i].vjetar), P: br(j[i].pritisak), S: br(j[i].insolacija) });
            }
            return { kind: "r", pts: pts };
        }
        if (j.k === "r") {                            // sirovo: minute od t0
            var t0 = j.t0 * 1000;
            for (i = 0; i < j.m.length; i++) {
                pts.push({
                    t: t0 + j.m[i] * 60000,
                    T: nn(j.T, i), H: nn(j.H, i), RR: nn(j.RR, i), V: nn(j.V, i),
                    G: nn(j.G, i), P: nn(j.P, i), S: nn(j.S, i)
                });
            }
            return { kind: "r", pts: pts };
        }
        if (j.k === "d") {                            // dnevno: apsolutne sekunde
            for (i = 0; i < j.ts.length; i++) {
                pts.push({
                    t: j.ts[i] * 1000,
                    T: nn(j.T, i), Tn: nn(j.Tn, i), Tx: nn(j.Tx, i), H: nn(j.H, i),
                    RR: nn(j.RR, i), V: nn(j.V, i), G: nn(j.G, i), P: nn(j.P, i)
                });
            }
            return { kind: "d", pts: pts };
        }
        return null;
    }

    function br(v) {
        if (v === "" || v == null) { return null; }
        var n = parseFloat(v);
        return isFinite(n) ? n : null;
    }
    function stariDT(s) {
        var m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/.exec(s || "");
        if (!m) { return null; }
        return +new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
    }

    /* ---------- LTTB (downsampling zadržava oblik krive) ---------- */
    function lttb(pts, prag) {
        var n = pts.length;
        if (prag >= n || prag < 3) { return pts; }
        var out = [pts[0]], svaki = (n - 2) / (prag - 2), a = 0, i, j;
        for (i = 0; i < prag - 2; i++) {
            var ax = 0, ay = 0, k = 0;
            var s0 = Math.floor((i + 1) * svaki) + 1, s1 = Math.min(Math.floor((i + 2) * svaki) + 1, n);
            for (j = s0; j < s1; j++) { ax += pts[j].t; ay += pts[j].v; k++; }
            if (k) { ax /= k; ay /= k; } else { ax = pts[Math.min(s0, n - 1)].t; ay = pts[Math.min(s0, n - 1)].v; }
            var f0 = Math.floor(i * svaki) + 1, f1 = Math.floor((i + 1) * svaki) + 1;
            var maks = -1, naj = f0;
            for (j = f0; j < f1; j++) {
                var p = pts[j];
                var pov = Math.abs((pts[a].t - ax) * (p.v - pts[a].v) - (pts[a].t - p.t) * (ay - pts[a].v));
                if (pov > maks) { maks = pov; naj = j; }
            }
            out.push(pts[naj]);
            a = naj;
        }
        out.push(pts[n - 1]);
        return out;
    }

    /* ---------- skale ---------- */
    function niceStep(raw) {
        var pw = Math.pow(10, Math.floor(Math.log10(raw))), fr = raw / pw, n;
        if (fr <= 1) { n = 1; } else if (fr <= 2) { n = 2; } else if (fr <= 2.5) { n = 2.5; } else if (fr <= 5) { n = 5; } else { n = 10; }
        return n * pw;
    }
    function ticks(lo, hi) {
        var raspon = Math.max(hi - lo, 1e-9), d, i;
        var podele = [3, 4, 5];
        for (d = 0; d < podele.length; d++) {
            var korak = niceStep(raspon / podele[d]);
            var prvi = Math.ceil((lo - 1e-9) / korak) * korak, out = [];
            for (var v = prvi; v <= hi + 1e-9; v += korak) { out.push(v); }
            if (out.length >= 3 && out.length <= 6) { return out; }
        }
        return [lo, (lo + hi) / 2, hi];
    }

    function baza(wrap) {
        if (wrap.__g) { return wrap.__g; }
        var plot = document.createElement("div");
        plot.className = "g-plot";
        var cv = document.createElement("canvas");
        cv.className = "g-canvas";
        var ov = document.createElement("canvas");
        ov.className = "g-overlay";
        var tt = document.createElement("div");
        tt.className = "g-tooltip";
        tt.hidden = true;
        plot.appendChild(cv); plot.appendChild(ov); plot.appendChild(tt);
        wrap.innerHTML = "";
        wrap.appendChild(plot);
        var g = { plot: plot, cv: cv, ov: ov, tt: tt, st: null, w: 0 };
        wrap.__g = g;
        veziDodir(g);
        if (window.ResizeObserver && !wrap.__ro) {
            wrap.__ro = new window.ResizeObserver(function () { crtaj(wrap); });
            wrap.__ro.observe(wrap);
        }
        return g;
    }

    function pripremi(g, W, H) {
        var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        [g.cv, g.ov].forEach(function (c) {
            c.width = Math.round(W * dpr);
            c.height = Math.round(H * dpr);
            c.style.width = W + "px";
            c.style.height = H + "px";
            var x = c.getContext("2d");
            x.setTransform(dpr, 0, 0, dpr, 0, 0);
            x.clearRect(0, 0, W, H);
        });
        return { dpr: dpr };
    }

    function serija(pts, kljuc) {
        var out = [], i;
        for (i = 0; i < pts.length; i++) {
            if (pts[i][kljuc] != null) { out.push({ t: pts[i].t, v: pts[i][kljuc], i: i }); }
        }
        return out;
    }

    function medianKorak(s) {
        var d = [], i;
        for (i = 1; i < s.length; i++) { d.push(s[i].t - s[i - 1].t); }
        if (!d.length) { return 0; }
        d.sort(function (a, b) { return a - b; });
        return d[Math.floor(d.length / 2)];
    }

    /* ---------- crtanje ---------- */
    function crtaj(wrap) {
        var g = wrap.__g;
        if (!g || !g.st) { return; }
        var st = g.st, pts = st.pts, mode = st.mode, kind = st.kind;
        var W = Math.max(wrap.clientWidth || 0, 260);
        var H = 196;
        pripremi(g, W, H);

        var c = g.cv.getContext("2d");
        var b = boje();
        var m = MODE[mode] || MODE.tvaga;
        var sporedni = m.sporedni && mode === "tvaga";
        var mL = 34, mR = sporedni ? 30 : 8, mT = 12, mB = 22;
        var iw = W - mL - mR, ih = H - mT - mB;

        var s1 = serija(pts, m.glavni);
        if (s1.length < 1) {
            wrap.innerHTML = '<p class="graf-prazno">Za ovaj parametar nema izmjerenih podataka.</p>';
            wrap.__g = null;
            return;
        }

        var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
        var raspon = Math.max(t1 - t0, 1);
        var X = function (t) { return mL + ((t - t0) / raspon) * iw; };

        // y-os: primarna
        var vrednosti = [], i;
        for (i = 0; i < s1.length; i++) { vrednosti.push(s1[i].v); }
        if (mode === "vjetar" && s1.length) {
            var sg = serija(pts, "G");
            for (i = 0; i < sg.length; i++) { vrednosti.push(sg[i].v); }
        }
        var bend = (kind === "d" && mode === "tvaga");
        if (bend) {
            for (i = 0; i < pts.length; i++) {
                if (pts[i].Tn != null) { vrednosti.push(pts[i].Tn); }
                if (pts[i].Tx != null) { vrednosti.push(pts[i].Tx); }
            }
        }
        var yMin, yMax;
        if (m.stubovi) {
            yMin = 0;
            yMax = Math.max.apply(null, vrednosti) * 1.15;
            if (!(yMax > 0)) { yMax = 1; }
        } else {
            yMin = Math.min.apply(null, vrednosti);
            yMax = Math.max.apply(null, vrednosti);
            if (yMax - yMin < 2) { var sr = (yMax + yMin) / 2; yMin = sr - 1; yMax = sr + 1; }
            var pad = (yMax - yMin) * 0.12;
            yMin -= pad; yMax += pad;
        }
        var Y = function (v) { return mT + (1 - (v - yMin) / (yMax - yMin)) * ih; };
        var YH = function (v) { return mT + (1 - v / 100) * ih; };

        // mreža
        var tk = ticks(yMin, yMax);
        var korak = tk.length > 1 ? tk[1] - tk[0] : 1;
        c.lineWidth = 1;
        c.strokeStyle = b.mreza;
        c.fillStyle = b.mutno;
        c.font = "9px " + (getComputedStyle(wrap).fontFamily || "sans-serif");
        c.textAlign = "right";
        c.textBaseline = "middle";
        tk.forEach(function (tv) {
            var y = Math.round(Y(tv)) + 0.5;
            c.beginPath(); c.moveTo(mL, y); c.lineTo(W - mR, y); c.stroke();
            c.fillText(korak >= 1 ? String(Math.round(tv)) : tv.toFixed(1).replace(".", ","), mL - 5, y);
        });
        // desna osa (vlažnost)
        if (sporedni) {
            c.fillStyle = b.akcenat;
            c.textAlign = "left";
            [0, 50, 100].forEach(function (v) { c.fillText(String(v), W - mR + 5, YH(v)); });
        }

        // x-oznake
        var dugi = raspon > 3 * 86400000;
        var f = dugi ? DAN_FMT : SAT_FMT;
        c.fillStyle = b.mutno;
        c.textBaseline = "alphabetic";
        c.textAlign = "left";
        c.fillText(fmt(f, t0), mL, H - 6);
        c.textAlign = "center";
        c.fillText(fmt(f, (t0 + t1) / 2), mL + iw / 2, H - 6);
        c.textAlign = "right";
        c.fillText(fmt(f, t1), W - mR, H - 6);

        var sirina = iw;

        // pojas min–maks (dnevni prikaz)
        if (bend) {
            var gore = [], dole = [], ima = false;
            for (i = 0; i < pts.length; i++) {
                if (pts[i].Tx != null && pts[i].Tn != null) {
                    gore.push([X(pts[i].t), Y(pts[i].Tx)]);
                    dole.push([X(pts[i].t), Y(pts[i].Tn)]);
                    ima = true;
                }
            }
            if (ima) {
                c.beginPath();
                gore.forEach(function (p, k) { k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); });
                for (i = dole.length - 1; i >= 0; i--) { c.lineTo(dole[i][0], dole[i][1]); }
                c.closePath();
                c.fillStyle = "rgba(47,125,189,0.13)";
                c.fill();
            }
        }

        // stubovi (padavine)
        if (m.stubovi) {
            var bw = Math.max(1.5, Math.min(9, (sirina / Math.max(s1.length, 1)) * 0.7));
            c.fillStyle = b.ink;
            for (i = 0; i < s1.length; i++) {
                var yb = Y(s1[i].v), hb = (mT + ih) - yb;
                if (hb > 0.4) { c.fillRect(X(s1[i].t) - bw / 2, yb, bw, hb); }
            }
        } else {
            // linija (LTTB skraćuje samo prikaz, ne mijenja podatke)
            var prag = Math.max(2, Math.floor(sirina * 2));
            var kr = lttb(s1, prag);
            var korakS = medianKorak(s1);
            c.strokeStyle = b.ink;
            c.lineWidth = 2;
            c.lineJoin = "round";
            c.lineCap = "round";
            c.beginPath();
            for (i = 0; i < kr.length; i++) {
                var x = X(kr[i].t), y = Y(kr[i].v);
                var puk = i > 0 && korakS > 0 && (kr[i].t - kr[i - 1].t) > korakS * 2.5;
                if (i === 0 || puk) { c.moveTo(x, y); } else { c.lineTo(x, y); }
            }
            c.stroke();

            // udar vjetra (isprekidano)
            if (mode === "vjetar") {
                var sg2 = lttb(serija(pts, "G"), prag);
                if (sg2.length > 1) {
                    c.save();
                    c.setLineDash([3, 3]);
                    c.strokeStyle = b.akcenat;
                    c.lineWidth = 1.4;
                    c.beginPath();
                    for (i = 0; i < sg2.length; i++) {
                        var xx = X(sg2[i].t), yy = Y(sg2[i].v);
                        if (i === 0) { c.moveTo(xx, yy); } else { c.lineTo(xx, yy); }
                    }
                    c.stroke();
                    c.restore();
                }
            }
            // vlažnost (desna osa, isprekidano)
            if (sporedni) {
                var s2 = lttb(serija(pts, m.sporedni), prag);
                if (s2.length > 1) {
                    c.save();
                    c.setLineDash([4, 3]);
                    c.strokeStyle = b.akcenat;
                    c.lineWidth = 1.5;
                    c.beginPath();
                    for (i = 0; i < s2.length; i++) {
                        var x2 = X(s2[i].t), y2 = YH(s2[i].v);
                        if (i === 0) { c.moveTo(x2, y2); } else { c.lineTo(x2, y2); }
                    }
                    c.stroke();
                    c.restore();
                }
            }
        }

        // spremi geometriju za dodir
        g.geo = { mL: mL, iw: iw, mT: mT, ih: ih, t0: t0, raspon: raspon, W: W, H: H, Y: Y, YH: YH, b: b, m: m, sporedni: sporedni };
        g.pts = pts;
        g.kind = kind;
    }

    /* ---------- dodir / miš ---------- */
    function veziDodir(g) {
        var ov = g.ov;
        function naDodir(ev) {
            ev.preventDefault();
            var geo = g.geo;
            if (!geo || !g.pts || !g.pts.length) { return; }
            var r = ov.getBoundingClientRect();
            var px = Math.min(Math.max(ev.clientX - r.left, geo.mL), geo.mL + geo.iw);
            var tz = geo.t0 + ((px - geo.mL) / geo.iw) * geo.raspon;
            var naj = null, bd = Infinity, i;
            for (i = 0; i < g.pts.length; i++) {
                var d = Math.abs(g.pts[i].t - tz);
                if (d < bd) { bd = d; naj = g.pts[i]; }
            }
            if (!naj) { return; }
            var x = geo.mL + ((naj.t - geo.t0) / geo.raspon) * geo.iw;

            var c = ov.getContext("2d");
            c.clearRect(0, 0, geo.W, geo.H);
            c.strokeStyle = geo.b.mutno;
            c.lineWidth = 1;
            c.setLineDash([2, 3]);
            c.beginPath();
            c.moveTo(Math.round(x) + 0.5, geo.mT);
            c.lineTo(Math.round(x) + 0.5, geo.mT + geo.ih);
            c.stroke();
            c.setLineDash([]);

            var v = naj[geo.m.glavni];
            if (v != null && !geo.m.stubovi) {
                c.fillStyle = geo.b.ink;
                c.beginPath();
                c.arc(x, geo.Y(v), 3.2, 0, Math.PI * 2);
                c.fill();
            }

            g.tt.hidden = false;
            g.tt.innerHTML = sadrzaj(naj, geo.m, geo.kind);
            var levo = Math.min(Math.max(x, 70), geo.W - 70);
            g.tt.style.left = levo + "px";
        }
        function skloni() {
            g.tt.hidden = true;
            if (g.geo) { g.ov.getContext("2d").clearRect(0, 0, g.geo.W, g.geo.H); }
        }
        var pritisnut = false;
        ov.addEventListener("pointerdown", function (ev) { pritisnut = true; naDodir(ev); });
        ov.addEventListener("pointermove", function (ev) { if (pritisnut || ev.pointerType === "mouse") { naDodir(ev); } });
        ov.addEventListener("pointerup", function (ev) { pritisnut = false; if (ev.pointerType === "touch") { naDodir(ev); } });
        ov.addEventListener("pointerleave", skloni);
        ov.addEventListener("pointercancel", function () { pritisnut = false; skloni(); });
    }

    function sadrzaj(p, m, kind) {
        var f = function (v, u, d) {
            if (v == null) { return "—"; }
            return v.toFixed(d).replace(".", ",") + u;
        };
        var html = '<span class="tt-vrijeme">' + fmt(PUN_FMT, p.t) + (kind === "d" ? " · dnevni prosjek" : "") + "</span>";
        html += "<span>" + naziv(m.glavni) + " <b>" + f(p[m.glavni], m.jed || "", m.glavni === "S" || m.glavni === "H" ? 0 : 1) + "</b></span>";
        if (kind === "d" && p.Tn != null && p.Tx != null) {
            html += '<span>min–maks <b>' + f(p.Tn, "°C", 1) + " – " + f(p.Tx, "°C", 1) + "</b></span>";
        }
        if (m.sporedni && p[m.sporedni] != null) {
            html += '<span class="tt-h">Vlažnost <b>' + f(p[m.sporedni], "%", 0) + "</b></span>";
        }
        if (p.RR != null && m.glavni !== "RR") {
            html += "<span>Padavine <b>" + f(p.RR, " mm", 1) + "</b></span>";
        }
        if (p.G != null && m.glavni === "V") {
            html += "<span>Udar <b>" + f(p.G, " m/s", 1) + "</b></span>";
        }
        return html;
    }
    function naziv(k) {
        return { T: "Temperatura", H: "Vlažnost", RR: "Padavine", V: "Vjetar", P: "Pritisak", S: "Insolacija" }[k] || k;
    }

    /* ---------- javni API ---------- */
    function render(wrap, opts) {
        var g = baza(wrap);
        g.st = { pts: opts.pts || [], mode: opts.mode || "tvaga", kind: opts.kind || "r" };
        g.geo = null;
        g.tt.hidden = true;
        crtaj(wrap);
        if (opts.rasponEl) {
            var p = g.st.pts;
            if (p.length) {
                var dana = Math.max(1, Math.round((p[p.length - 1].t - p[0].t) / 86400000));
                opts.rasponEl.textContent = dana + (dana === 1 ? " dan" : " dana") + " · " + p.length + " tačaka";
            } else {
                opts.rasponEl.textContent = "—";
            }
        }
    }

    function prazno(wrap, tekst, rasponEl) {
        wrap.__g = null;
        wrap.innerHTML = '<p class="graf-prazno">' + tekst + "</p>";
        if (rasponEl) { rasponEl.textContent = "—"; }
    }

    window.Graf = { render: render, prazno: prazno, decode: decode, lttb: lttb };
})();
