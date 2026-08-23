/* MeteoMNE — app.js v13 (Fixes & Modern RacProg) */
"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&","<":"<",">":">"," ":" ","'":"'"}[c]));
const MESECI = ["januar", "februar", "mart", "april", "maj", "jun", "jul", "avgust", "septembar", "oktobar", "novembar", "decembar"];
const RUZA = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const DEFAULT_SIFRA = "02PLJV10";

let registry = {};
let staniceTrenutne = [];
let mojaSifra = localStorage.getItem("moje_mjesto") || DEFAULT_SIFRA;
let detaljSifra = null;
let morePodaci = null;
let snijegPodaci = null;
let prognozaPodaci = null;
let racProgPodaci = null;
let racProgIzabrani = null;
let racProgModel = "model2"; // Default ECMWF

const MODE_INFO = {
    tvaga: { naslov: "Temperatura i vlažnost", legenda: '<span class="leg-t">— temperatura (°C)</span> <span class="leg-h">– – vlažnost (%)</span>' },
    rr: { naslov: "Padavine", legenda: '<span class="leg-t">▮ padavine (mm)</span>' },
    vjetar: { naslov: "Vjetar", legenda: '<span class="leg-t">— brzina vjetra (m/s)</span>' },
    pritisak: { naslov: "Pritisak", legenda: '<span class="leg-t">— pritisak (hPa)</span>' },
    insolacija: { naslov: "Insolacija", legenda: '<span class="leg-t">— insolacija (W/m²)</span>' }
};
const KEY1 = { tvaga: "T", rr: "RR", vjetar: "V", pritisak: "P", insolacija: "S" };

function danJe() {
    const h = (new Date().getUTCHours() + 2) % 24;
    return h >= 6 && h < 20;
}

function ikonaFajl(opis, obs) {
    const rr = obs && obs.RR !== "" && obs.RR != null ? parseFloat(obs.RR) : 0;
    const t = obs && obs.T !== "" && obs.T != null ? parseFloat(obs.T) : null;
    if (rr > 0) return (t != null && t < 2) ? "snowy-2.svg" : "rainy-2.svg";
    const dan = danJe();
    const o = (opis || "").toLowerCase();
    if (o === "vedro") return dan ? "day.svg" : "night.svg";
    if (o === "pretežno vedro") return dan ? "cloudy-day-1.svg" : "cloudy-night-1.svg";
    if (o === "malo oblačno") return dan ? "cloudy-day-2.svg" : "cloudy-night-2.svg";
    if (o === "umjereno oblačno") return dan ? "cloudy-day-3.svg" : "cloudy-night-3.svg";
    if (o === "pretežno oblačno") return dan ? "cloudy-day-3.svg" : "cloudy-night-3.svg";
    if (o === "oblačno") return "cloudy.svg";
    return dan ? "cloudy-day-1.svg" : "cloudy-night-1.svg";
}

function prikaziOpis(ids, obs) {
    const desno = $(ids.desno), ik = $(ids.ikona), tx = $(ids.tekst);
    if (!desno || !ik || !tx) return;
    if (obs && obs.opis) {
        ik.src = ikonaFajl(obs.opis, obs);
        tx.textContent = obs.opis;
        desno.hidden = false;
    } else {
        desno.hidden = true;
    }
}

function fmtBroj(v, dec) {
    const n = (typeof v === "number") ? v : parseFloat(v);
    if (!isFinite(n)) return "—";
    return n.toFixed(dec).replace(".", ",");
}

function fmtVrijeme(dt) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}:\d{2})/.exec(dt || "");
    if (!m) return "—";
    return "Izmjereno " + m[4] + " · " + parseInt(m[1], 10) + ". " + MESECI[parseInt(m[2], 10) - 1];
}

function fmtSati(dt) {
    const m = /(\d{2}:\d{2})/.exec(dt || "");
    return m ? m[1] : "";
}

function fmtKratko(dt) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}:\d{2})/.exec(dt || "");
    if (!m) return "";
    const sada = new Date();
    const istiDan = (parseInt(m[1], 10) === sada.getDate()) && (parseInt(m[2], 10) === sada.getMonth() + 1);
    return istiDan ? m[4] : (parseInt(m[1], 10) + ". " + parseInt(m[2], 10) + ". " + m[4]);
}

function smjerTekst(kod) {
    if (kod === "" || kod == null) return null;
    const k = parseFloat(kod);
    if (!isFinite(k)) return null;
    const deg = k * 11.25;
    return { deg: deg, naziv: RUZA[Math.round(deg / 22.5) % 16] };
}

function strelica(deg) {
    return '<svg class="str" viewBox="0 0 12 12" style="transform:rotate(' + ((deg + 180) % 360) + 'deg)" aria-hidden="true"><path d="M6 1 L9 8 L6 6.6 L3 8 Z" fill="currentColor"/></svg>';
}

function red(labela, vrijednost) {
    return '<li><span class="p-labela">' + labela + '</span> <span class="p-vrijednost">' + vrijednost + '</span></li>';
}

function bezDijakritika(s) {
    return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseDT(dt) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/.exec(dt || "");
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
}

function parametriHTML(obs) {
    let vjetar = "—";
    if (obs.vjetar !== "" && obs.vjetar != null) {
        vjetar = fmtBroj(obs.vjetar, 1) + " m/s";
        const sm = smjerTekst(obs.smjer_kod);
        if (sm) vjetar += " " + strelica(sm.deg);
    }
    return red("Vlažnost", (obs.vlaga !== "" && obs.vlaga != null) ? fmtBroj(obs.vlaga, 0) + "%" : "—") +
           red("Vjetar", vjetar) +
           red("Pritisak", (obs.pritisak !== "" && obs.pritisak != null) ? fmtBroj(obs.pritisak, 1) + " hPa" : "—") +
           red("Padavine", (obs.RR !== "" && obs.RR != null) ? fmtBroj(obs.RR, 1) + " mm" : "—") +
           red("Udar vjetra", (obs.udar !== "" && obs.udar != null) ? fmtBroj(obs.udar, 1) + " m/s" : "—") +
           red("Insolacija", (obs.insolacija !== "" && obs.insolacija != null) ? fmtBroj(obs.insolacija, 1) + " W/m²" : "—");
}

/* ---------- grafovi ---------- */
function crtajGraf(pts, mode, els) {
    els.naslov.textContent = MODE_INFO[mode].naslov;
    els.legenda.innerHTML = MODE_INFO[mode].legenda;
    const data = (pts || []).map((p) => ({ t: parseDT(p.dt), T: p.T, H: p.vlaga, RR: p.RR, V: p.vjetar, P: p.pritisak, S: p.insolacija })).filter((p) => p.t);
    const ser = (key) => { const out = []; data.forEach((p, i) => { if (p[key] != null) out.push({ t: p.t, v: p[key], i: i }); }); return out; };
    let s1 = [], s2 = null;
    if (mode === "tvaga") { s1 = ser("T"); s2 = ser("H"); }
    else if (mode === "rr") s1 = ser("RR");
    else if (mode === "vjetar") s1 = ser("V");
    else if (mode === "pritisak") s1 = ser("P");
    else s1 = ser("S");

    if (data.length < 2 || s1.length < 1) {
        els.wrap.innerHTML = '<p class="graf-prazno">' + (data.length < 2 ? "Nedovoljno podataka za grafikon." : "Za ovaj parametar nema izmjerenih podataka.") + '</p>';
        els.raspon.textContent = "—";
        return;
    }
    const W = 340, H = 170, mL = 36, mR = (mode === "tvaga") ? 32 : 10, mT = 8, mB = 22;
    const iw = W - mL - mR, ih = H - mT - mB;
    const t0 = data[0].t, t1 = data[data.length - 1].t;
    const span = Math.max(+t1 - +t0, 1);
    const X = (d) => mL + ((+d - +t0) / span) * iw;
    const vals = s1.map((p) => p.v).concat(s2 ? s2.map((p) => p.v) : []);
    let yMin, yMax;
    if (mode === "tvaga" || mode === "pritisak") {
        const only = (mode === "tvaga") ? s1.map((p) => p.v) : vals;
        yMin = Math.min.apply(null, only); yMax = Math.max.apply(null, only);
        if (yMax - yMin < 2) { yMax += 1; yMin -= 1; }
        const pad = (yMax - yMin) * 0.15; yMin -= pad; yMax += pad;
    } else {
        yMin = 0; yMax = Math.max.apply(null, vals) * 1.15;
        if (yMax < 1) yMax = 1;
    }
    const Y = (v) => mT + (1 - (v - yMin) / (yMax - yMin)) * ih;
    const YH = (v) => mT + (1 - v / 100) * ih;
    const ticks = niceTicks(yMin, yMax);
    const korak = (ticks.length > 1) ? (ticks[1] - ticks[0]) : 1;
    const fmtTick = (v) => (korak >= 1 ? String(Math.round(v)) : v.toFixed(1).replace(".", ","));
    let grid = "", labL = "";
    ticks.forEach((tv) => {
        const y = Y(tv);
        grid += '<line x1="' + mL + '" y1="' + y.toFixed(1) + '" x2="' + (W - mR) + '" y2="' + y.toFixed(1) + '" class="g-mreza"/>';
        labL += '<text x="' + (mL - 5) + '" y="' + (y + 3).toFixed(1) + '" class="g-lab g-lab-l" text-anchor="end">' + fmtTick(tv) + '</text>';
    });
    let labR = "";
    if (mode === "tvaga") {
        [100, 50, 0].forEach((v, i) => { labR += '<text x="' + (W - mR + 5) + '" y="' + (mT + i * 0.5 * ih + 3) + '" class="g-lab g-lab-r">' + v + '</text>'; });
    }
    const fmtX = (d) => d.getDate() + ". " + (d.getMonth() + 1) + ". " + String(d.getHours()).padStart(2, "0") + "h";
    const fmtDT = (d) => d.getDate() + ". " + (d.getMonth() + 1) + ". · " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    const xMid = new Date((+t0 + +t1) / 2);
    const labX =
        '<text x="' + mL + '" y="' + (H - 6) + '" class="g-lab">' + fmtX(t0) + '</text>' +
        '<text x="' + (mL + iw / 2) + '" y="' + (H - 6) + '" class="g-lab" text-anchor="middle">' + fmtX(xMid) + '</text>' +
        '<text x="' + (W - mR) + '" y="' + (H - 6) + '" class="g-lab" text-anchor="end">' + fmtX(t1) + '</text>';

    function linija(s, cls, yFn) {
        let d = "";
        for (let k = 0; k < s.length; k++) {
            const gap = (k > 0) && ((s[k].i - s[k - 1].i) > 1);
            d += ((k > 0 && !gap) ? "L" : "M") + X(s[k].t).toFixed(1) + " " + yFn(s[k].v).toFixed(1);
        }
        return d ? '<path d="' + d + '" class="' + cls + '" fill="none"/>' : "";
    }
    function stubovi(s) {
        const bw = Math.max(2, (iw / Math.max(data.length, 1)) * 0.6);
        let out = "";
        s.forEach((p) => {
            const y = Y(p.v); const h = (mT + ih) - y;
            if (h > 0) out += '<rect x="' + (X(p.t) - bw / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" class="g-stub"/>';
        });
        return out;
    }
    let serSvg = "";
    if (mode === "tvaga") serSvg = linija(s2, "g-linija-h", YH) + linija(s1, "g-linija-t", Y);
    else if (mode === "rr") serSvg = stubovi(s1);
    else serSvg = linija(s1, "g-linija-t", Y);

    els.raspon.textContent = fmtX(t0) + " – " + fmtX(t1) + " · " + data.length + " mjerenja";
    els.wrap.innerHTML =
        '<svg viewBox="0 0 ' + W + ' ' + H + '" class="g-svg">' + grid + labL + labR + labX + serSvg +
        '<line class="g-vodilica" id="g-vodilica" x1="-10" x2="-10" y1="' + mT + '" y2="' + (mT + ih) + '"/>' +
        '<circle class="g-tacka-t" id="g-tacka-t" cx="-10" cy="-10" r="3"/>' +
        '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="transparent" id="g-dodir"/>' +
        '</svg>' + '<div class="g-tooltip" id="g-tooltip" hidden></div>';

    const svgEl = els.wrap.querySelector(".g-svg");
    const dodir = els.wrap.querySelector("#g-dodir");
    const tooltip = els.wrap.querySelector("#g-tooltip");
    const vod = els.wrap.querySelector("#g-vodilica");
    const tacka = els.wrap.querySelector("#g-tacka-t");

    function ttSadrzaj(p) {
        const f = (v, u, d) => (v == null ? "—" : fmtBroj(v, d) + u);
        if (mode === "tvaga") return '<span>T <b>' + f(p.T, "°C", 1) + '</b></span> <span class="tt-h">Vlažnost <b>' + f(p.H, "%", 0) + '</b></span>';
        if (mode === "rr") return '<span>Padavine <b>' + f(p.RR, " mm", 1) + '</b></span>';
        if (mode === "vjetar") return '<span>Vjetar <b>' + f(p.V, " m/s", 1) + '</b></span>';
        if (mode === "pritisak") return '<span>Pritisak <b>' + f(p.P, " hPa", 1) + '</b></span>';
        return '<span>Insolacija <b>' + f(p.S, " W/m²", 1) + '</b></span>';
    }

    function naDodir(ev) {
        const rect = svgEl.getBoundingClientRect();
        const px = ((ev.clientX - rect.left) / rect.width) * W;
        let best = null, bd = Infinity;
        data.forEach((p) => { const d = Math.abs(X(p.t) - px); if (d < bd) { bd = d; best = p; } });
        if (!best) return;
        const x = X(best.t);
        vod.setAttribute("x1", x); vod.setAttribute("x2", x);
        const v1 = best[KEY1[mode]];
        if (mode !== "rr" && v1 != null) { tacka.setAttribute("cx", x); tacka.setAttribute("cy", Y(v1)); }
        else { tacka.setAttribute("cx", -10); }
        tooltip.hidden = false;
        tooltip.innerHTML = '<span class="tt-vrijeme">' + fmtDT(best.t) + '</span>' + ttSadrzaj(best);
        tooltip.style.left = Math.min(82, Math.max(18, (x / W) * 100)) + "%";
    }
    dodir.addEventListener("pointerdown", naDodir);
    dodir.addEventListener("pointermove", naDodir);
    dodir.addEventListener("pointerleave", () => {
        tooltip.hidden = true;
        vod.setAttribute("x1", -10); vod.setAttribute("x2", -10);
        tacka.setAttribute("cx", -10); tacka.setAttribute("cy", -10);
    });
}

function niceTicks(lo, hi) {
    const range = Math.max(hi - lo, 1e-9);
    const divs = [3, 4, 5];
    for (let d = 0; d < divs.length; d++) {
        const step = niceStep(range / divs[d]);
        const first = Math.ceil((lo - 1e-9) / step) * step;
        const ticks = [];
        for (let v = first; v <= hi + 1e-9; v += step) ticks.push(v);
        if (ticks.length >= 3 && ticks.length <= 5) return ticks;
    }
    return [lo, (lo + hi) / 2, hi];
}

function niceStep(raw) {
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const frac = raw / pow;
    let nice;
    if (frac <= 1) nice = 1; else if (frac <= 2) nice = 2; else if (frac <= 2.5) nice = 2.5; else if (frac <= 5) nice = 5; else nice = 10;
    return nice * pow;
}

async function ucitajGraf(sifra, ctx) {
    try {
        const r = await fetch("data/history/" + sifra + ".json?_=" + Date.now());
        if (!r.ok) throw new Error("HTTP " + r.status);
        ctx.pts = await r.json();
        crtajGraf(ctx.pts, ctx.mode, ctx.els);
    } catch (e) {
        ctx.pts = null;
        ctx.els.wrap.innerHTML = '<p class="graf-prazno">Istorija za ovu stanicu trenutno nije dostupna.</p>';
        ctx.els.raspon.textContent = "—";
    }
}

const grafMoje = { mode: "tvaga", pts: null, els: { naslov: $("graf-naslov"), legenda: $("graf-legenda"), raspon: $("graf-raspon"), wrap: $("graf-wrap") } };
const grafDetalj = { mode: "tvaga", pts: null, els: { naslov: $("detalj-graf-naslov"), legenda: $("detalj-graf-legenda"), raspon: $("detalj-graf-raspon"), wrap: $("detalj-graf-wrap") } };

function veziChipove(selector, ctx) {
    document.querySelectorAll(selector).forEach((c) => {
        c.addEventListener("click", () => {
            ctx.mode = c.dataset.graf;
            document.querySelectorAll(selector).forEach((x) => x.classList.toggle("aktivan", x === c));
            if (ctx.pts) crtajGraf(ctx.pts, ctx.mode, ctx.els);
        });
    });
}
veziChipove("#graf-chips .chip", grafMoje);
veziChipove("#detalj-chips .chip", grafDetalj);

/* ---------- Moje mjesto ---------- */
function prikaziMjesto() {
    const meta = registry[mojaSifra] || {};
    const obs = staniceTrenutne.find((s) => s.sifra === mojaSifra);
    const naziv = (obs && obs.stanica) || meta.naziv || "—";
    $("mjesto-ime").innerHTML = esc(String(naziv).toUpperCase()) + (meta.elevacija != null ? '<span class="elev">· ' + Math.round(meta.elevacija) + ' m</span>' : "");
    if (!obs) {
        $("temp").textContent = "—"; $("mjerenje").textContent = "Stanica trenutno ne šalje mjerenja."; $("parametri").innerHTML = "";
        prikaziOpis({desno: "hero-desno", ikona: "opis-ikona", tekst: "opis-tekst"}, null);
    } else {
        $("temp").innerHTML = '<span class="temp-broj">' + fmtBroj(obs.T, 1) + '</span> <span class="temp-jedinica">°C</span>';
        $("mjerenje").textContent = fmtVrijeme(obs.datum_vrijeme); $("parametri").innerHTML = parametriHTML(obs);
        prikaziOpis({desno: "hero-desno", ikona: "opis-ikona", tekst: "opis-tekst"}, obs);
    }
    ucitajGraf(mojaSifra, grafMoje);
}

/* ---------- detalj stanice ---------- */
function renderDetalj() {
    const meta = registry[detaljSifra] || {};
    const obs = staniceTrenutne.find((s) => s.sifra === detaljSifra);
    $("detalj-ime").innerHTML = esc(String(meta.naziv || (obs && obs.stanica) || "—").toUpperCase()) + (meta.elevacija != null ? '<span class="elev">· ' + Math.round(meta.elevacija) + ' m</span>' : "");
    if (!obs) {
        $("detalj-temp").textContent = "—"; $("detalj-mjerenje").textContent = "Stanica trenutno ne šalje mjerenja."; $("detalj-parametri").innerHTML = "";
        prikaziOpis({desno: "detalj-hero-desno", ikona: "detalj-opis-ikona", tekst: "detalj-opis-tekst"}, null);
    } else {
        $("detalj-temp").innerHTML = '<span class="temp-broj">' + fmtBroj(obs.T, 1) + '</span> <span class="temp-jedinica">°C</span>';
        $("detalj-mjerenje").textContent = fmtVrijeme(obs.datum_vrijeme); $("detalj-parametri").innerHTML = parametriHTML(obs);
        prikaziOpis({desno: "detalj-hero-desno", ikona: "detalj-opis-ikona", tekst: "detalj-opis-tekst"}, obs);
    }
    ucitajGraf(detaljSifra, grafDetalj);
}

/* ---------- ekrani / istorija / nazad ---------- */
function prikaziEkran(id) { document.querySelectorAll(".ekran").forEach((s) => s.classList.toggle("aktivan", s.id === id)); }
function hashStanica() { const m = /^#stanica\/([A-Za-z0-9_-]+)/.exec(location.hash); return m ? m[1] : null; }
function syncIzHasa() {
    if (location.hash === "#mapa") { prikaziEkran("ekran-mapa"); pokreniMapu(); return; }
    if (location.hash === "#more") { prikaziEkran("ekran-more"); renderMoreEkran(); return; }
    if (location.hash === "#snijeg") { prikaziEkran("ekran-snijeg"); renderSnijegEkran(); return; }
    const s = hashStanica();
    if (s && registry[s]) { detaljSifra = s; prikaziEkran("ekran-detalj"); renderDetalj(); }
    else if (s) { history.replaceState(null, "", location.pathname + location.search); }
    else if (["ekran-detalj", "ekran-mapa", "ekran-more", "ekran-snijeg"].some((id) => $(id).classList.contains("aktivan"))) { prikaziEkran("ekran-stanice"); }
}
function otvoriDetalj(sifra) {
    if (hashStanica() === sifra) { detaljSifra = sifra; prikaziEkran("ekran-detalj"); renderDetalj(); return; }
    location.hash = "stanica/" + sifra;
}
window.addEventListener("hashchange", syncIzHasa);
document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("aktivan", b === btn));
        const id = "ekran-" + btn.dataset.ekran;
        prikaziEkran(id);
        if (id !== "ekran-detalj" && (hashStanica() || ["#mapa", "#more", "#snijeg"].includes(location.hash))) { history.replaceState(null, "", location.pathname + location.search); }
    });
});
$("detalj-nazad").addEventListener("click", () => { if (hashStanica()) history.back(); else prikaziEkran("ekran-stanice"); });

/* ---------- mapa ---------- */
let mapaObj = null, mapaMarkeri = [];
function tempBoja(t) {
    if (t == null || t === "" || !isFinite(t)) return "#8a97a3";
    const x = Math.max(-5, Math.min(35, t)); const hue = 210 - ((x + 5) / 40) * 200;
    return "hsl(" + Math.round(hue) + ", 62%, 45%)";
}
function pokreniMapu() {
    if (!window.L) { $("mapa").innerHTML = '<p class="graf-prazno">Mapa nije dostupna bez internet konekcije.</p>'; return; }
    if (!mapaObj) {
        mapaObj = L.map("mapa", { zoomControl: true });
        L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { attribution: '© OpenStreetMap © CARTO', maxZoom: 16 }).addTo(mapaObj);
        mapaObj.fitBounds([[41.85, 18.35], [43.55, 20.45]], { padding: [8, 8] });
    }
    mapaMarkeri.forEach((m) => mapaObj.removeLayer(m)); mapaMarkeri = [];
    Object.values(registry).forEach((s) => {
        if (s.lat == null || s.lng == null) return;
        const obs = staniceTrenutne.find((o) => o.sifra === s.sifra); const t = obs ? parseFloat(obs.T) : NaN;
        const label = (obs && isFinite(t)) ? Math.round(t) + "°" : "—";
        const icon = L.divIcon({ className: "mapa-ikon", html: '<span class="mapa-bedz" style="background:' + tempBoja(t) + '">' + label + "</span>", iconSize: [44, 26], iconAnchor: [22, 13] });
        const mk = L.marker([s.lat, s.lng], { icon: icon }).addTo(mapaObj); mk.on("click", () => otvoriDetalj(s.sifra)); mapaMarkeri.push(mk);
    });
    setTimeout(() => mapaObj.invalidateSize(), 80);
}
$("stanice-mapa-dugme").addEventListener("click", () => { if (location.hash === "#mapa") { prikaziEkran("ekran-mapa"); pokreniMapu(); } else location.hash = "mapa"; });
$("mapa-nazad").addEventListener("click", () => { if (location.hash === "#mapa") history.back(); else prikaziEkran("ekran-stanice"); });

/* ---------- more / snijeg ---------- */
function renderMoreEkran() {
    if (!morePodaci || !morePodaci.stations || !morePodaci.stations.length) { $("more-labela").textContent = "—"; $("more-lista").innerHTML = '<li class="lista-prazno">ZHMS trenutno ne objavljuje mjerenja temperature mora.</li>'; return; }
    $("more-labela").textContent = "Mjereno: " + (morePodaci.mjerenje_labela || "—");
    $("more-lista").innerHTML = morePodaci.stations.slice().sort((a, b) => b.vrijednost - a.vrijednost).map((s) => red(esc(s.naziv), fmtBroj(s.vrijednost, 1) + "°C")).join("");
}
function renderSnijegEkran() {
    if (!snijegPodaci || !snijegPodaci.stations || !snijegPodaci.stations.length) { $("snijeg-labela").textContent = "—"; $("snijeg-lista").innerHTML = '<li class="lista-prazno">Trenutno nema mjerenja snijega.</li>'; return; }
    $("snijeg-labela").textContent = "Mjereno: " + (snijegPodaci.mjerenje_labela || "—");
    $("snijeg-lista").innerHTML = snijegPodaci.stations.slice().sort((a, b) => b.vrijednost - a.vrijednost).map((s) => red(esc(s.naziv), fmtBroj(s.vrijednost, 0) + " cm")).join("");
}
$("kartica-more").addEventListener("click", () => { location.hash = "more"; });
$("kartica-snijeg").addEventListener("click", () => { location.hash = "snijeg"; });
$("more-nazad").addEventListener("click", () => { if (location.hash === "#more") history.back(); else prikaziEkran("ekran-stanice"); });
$("snijeg-nazad").addEventListener("click", () => { if (location.hash === "#snijeg") history.back(); else prikaziEkran("ekran-stanice"); });

/* ---------- prognoza ---------- */
function ocistiDanTekst(t) { return (t || "").replace(/^(ponedjeljak|utorak|srijeda|četvrtak|petak|subota|nedjelja),?\s+\d{1,2}\.\d{1,2}\.\d{4}\.\s/i, ""); }
const PROG_MAPE = ["https://www.meteo.co.me/Meteorologija/Pr/cgprognoza-A.svg", "https://www.meteo.co.me/Meteorologija/Pr/cgprognoza-B.svg"];

function renderPrognoza() {
    const box = $("prog-sadrzaj");
    if (!box) return;
    if (!prognozaPodaci || !prognozaPodaci.dani || !prognozaPodaci.dani.length) { box.innerHTML = '<p class="graf-prazno">Zvanična prognoza trenutno nije dostupna.</p>'; return; }
    const d = prognozaPodaci.dani;
    function acc(naslov, azur, bodyHtml) {
        return '<details class="prog-acc"><summary class="prog-acc-glava"><span class="prog-acc-lijevo"><span class="prog-acc-naslov">' + esc(naslov) + '</span>' + (azur ? '<span class="prog-acc-azur">ažurirano: ' + esc(azur) + '</span>' : '') + '</span> <span class="prog-acc-strelica"></span></summary><div class="prog-acc-tijelo">' + bodyHtml + '</div></details>';
    }
    let zv = "";
    d.forEach((dan, i) => {
        let body = "";
        if (dan.tekst) body += '<p class="prog-tekst">' + esc(ocistiDanTekst(dan.tekst)) + '</p>';
        if (dan.podgorica && dan.podgorica.length > 10) body += '<p class="prog-podgorica">' + esc(dan.podgorica) + '</p>';
        if (PROG_MAPE[i]) body += '<img class="prog-mapa" src="' + PROG_MAPE[i] + '" alt="" onerror="this.style.display=\'none\'">';
        zv += acc(dan.naslov || ("Dan " + (i + 1)), dan.azurirano, body);
    });
    if (prognozaPodaci.pomorci) {
        let body = "";
        if (prognozaPodaci.pomorci.tekst) body += '<p class="prog-tekst">' + esc(prognozaPodaci.pomorci.tekst) + '</p>';
        body += '<img class="prog-mapa" src="https://www.meteo.co.me/Meteorologija/Pr/jjadran.svg" alt="" onerror="this.style.display=\'none\'">';
        zv += acc("Za pomorce", prognozaPodaci.pomorci.azurirano, body);
    }
    box.innerHTML =
        '<div class="prog-tabovi">' +
        '<button class="prog-tab aktivan" data-pg="zvanicna">Zvanična</button>' +
        '<button class="prog-tab" data-pg="racunarska">Računarska</button>' +
        '</div>' +
        '<div id="pg-zvanicna">' + zv + '</div>' +
        '<div id="pg-racunarska" hidden></div>'; /* DODAT 'hidden' OVDE */
        
    box.querySelectorAll(".prog-tab").forEach((b) => {
        b.addEventListener("click", () => {
            box.querySelectorAll(".prog-tab").forEach((x) => x.classList.toggle("aktivan", x === b));
            $("pg-zvanicna").hidden = b.dataset.pg !== "zvanicna";
            $("pg-racunarska").hidden = b.dataset.pg !== "racunarska";
        });
    });
    renderRacProg();
}

/* ---------- računarska prognoza (Moderno) ---------- */
function cetOffset(datumStr) {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(datumStr || ""); if (!m) return 2;
    const y = +m[1], mo = +m[2], d = +m[3];
    const mar31 = new Date(y, 2, 31); const nedMar = 31 - ((mar31.getDay() + 1) % 7);
    const okt31 = new Date(y, 9, 31); const nedOkt = 31 - ((okt31.getDay() + 1) % 7);
    const dt = new Date(y, mo - 1, d);
    const ljetnjeStart = new Date(y, 2, nedMar); const ljetnjeEnd = new Date(y, 9, nedOkt);
    return (dt >= ljetnjeStart && dt < ljetnjeEnd) ? 2 : 1;
}
function utcToCet(utcSat, datumStr) { return String((parseInt(utcSat, 10) + cetOffset(datumStr)) % 24).padStart(2, "0"); }
const RAC_SIMBOL_BASE = "https://www.meteo.co.me/Meteorologija/Pr/Gradovi/5danaE/Simbolcici/";
function racSimbolUrl(kod) { return kod ? RAC_SIMBOL_BASE + kod + ".svg" : ""; }
function racVjetarOpis(kod) {
    if (!kod) return ""; const m = /^v(\d)-(\d{3})$/.exec(kod); if (!m) return "";
    const snaga = +m[1], smjer = +m[2]; if (snaga === 0) return "bez vjetra";
    const stepeni = [[0,"S"],[22.5,"SSW"],[45,"SW"],[67.5,"WSW"],[90,"W"],[112.5,"WNW"],[135,"NW"],[157.5,"NNW"],[180,"N"],[202.5,"NNE"],[225,"NE"],[247.5,"ENE"],[270,"E"],[292.5,"ESE"],[315,"SE"],[337.5,"SSE"],[360,"S"]];
    let best = stepeni[0]; for (let i = 1; i < stepeni.length; i++) { if (Math.abs(smjer - stepeni[i][0]) < Math.abs(smjer - best[0])) best = stepeni[i]; }
    const opisi = {1:"slab", 2:"umjeren", 3:"jak", 4:"vrlo jak"}; return (opisi[snaga] || "") + " " + best[1];
}
function racVjetarSvg(kod) {
    if (!kod) return ""; const m = /^v(\d)-(\d{3})$/.exec(kod); if (!m) return "";
    const snaga = +m[1], smjer = +m[2]; if (snaga === 0) return '<span class="rac-vj-txt">—</span>';
    const debljina = snaga === 1 ? 1.5 : (snaga === 2 ? 2 : 2.5);
    return '<svg class="rac-vj-svg" viewBox="0 0 24 24" style="transform:rotate(' + smjer + 'deg)"><line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" stroke-width="' + debljina + '" stroke-linecap="round"/><polygon points="12,2 8,8 16,8" fill="currentColor"/></svg>';
}

function renderRacProg() {
    const box = $("pg-racunarska");
    if (!box) return;
    if (!racProgPodaci || !racProgPodaci[racProgModel] || !racProgPodaci[racProgModel].gradovi.length) {
        box.innerHTML = '<p class="graf-prazno">Računarska prognoza trenutno nije dostupna.</p>'; return;
    }
    const gradovi = racProgPodaci[racProgModel].gradovi;
    if (!racProgIzabrani || !gradovi.find(g => g.kod === racProgIzabrani.kod)) {
        const mojeNaziv = (registry[mojaSifra] && registry[mojaSifra].naziv) || "";
        const mojeBazno = bezDijakritika(mojeNaziv.split(" ")[0] || "").toLowerCase();
        racProgIzabrani = gradovi.find(g => bezDijakritika(g.naziv).toLowerCase() === mojeBazno) || gradovi.find(g => g.kod === "POD");
    }
    const gradoviHtml = gradovi.map(g => '<button class="rac-grad' + (g.kod === racProgIzabrani.kod ? ' aktivan' : '') + '" data-kod="' + esc(g.kod) + '">' + esc(g.naziv) + '</button>').join("");
    const dani = racProgIzabrani.dani.map(dan => {
        const TminTxt = dan.Tmin != null ? fmtBroj(dan.Tmin, 1) + "°C" : "—";
        const TmaxTxt = dan.Tmax != null ? fmtBroj(dan.Tmax, 1) + "°C" : "—";
        const redovi = dan.sati.map(s => {
            const cetSat = utcToCet(s.sat, dan.datum) + ":00";
            const rr = s.RR != null ? fmtBroj(s.RR, 1) + " mm" : "—";
            const rh = s.RH != null ? fmtBroj(s.RH, 0) + "%" : "—";
            const simbUrl = racSimbolUrl(s.simbol);
            const simbHtml = simbUrl ? '<img class="rac-simb" src="' + esc(simbUrl) + '" alt="" onerror="this.style.visibility=\'hidden\'">' : '<span class="rac-simb-prazno">—</span>';
            const vjSvg = racVjetarSvg(s.vjetar);
            const vjOpis = racVjetarOpis(s.vjetar);
            const vjHtml = vjOpis ? '<span class="rac-vj-wrap">' + vjSvg + '<span class="rac-vj-txt">' + esc(vjOpis) + '</span></span>' : '<span class="rac-vj-txt">—</span>';
            return '<tr><td class="rac-sat">' + cetSat + '</td><td class="rac-simb-td">' + simbHtml + '</td><td class="rac-rr">' + rr + '</td><td class="rac-rh">' + rh + '</td><td class="rac-vj">' + vjHtml + '</td></tr>';
        }).join("");
        return '<details class="rac-acc"><summary class="rac-acc-glava"><span class="rac-acc-lijevo"><span class="rac-acc-datum">' + esc(dan.datum) + '</span><span class="rac-acc-tempi">' + TminTxt + ' / ' + TmaxTxt + '</span></span><span class="rac-acc-strelica"></span></summary><div class="rac-acc-tijelo"><table class="rac-tabela"><thead><tr><th>Sat</th><th>Vrijeme</th><th>Padavine</th><th>Vlažnost</th><th>Vjetar</th></tr></thead><tbody>' + redovi + '</tbody></table></div></details>';
    }).join("");

    box.innerHTML =
        '<div class="rac-header"><span class="rac-header-naslov">Računarska prognoza</span><button class="rac-info-btn" id="rac-info-btn" aria-label="Informacije">ℹ</button></div>' +
        '<div class="rac-info-popover" id="rac-info-popover" hidden><p>Računarska prognoza je direktni rezultat numeričkog modeliranja i prognostičari nisu ni na koji način uticali na nju. <br><b>Model 1:</b> WRF NMM (NCEP/USA) <br><b>Model 2:</b> WRF NMM (ECMWF)</p></div>' +
        '<div class="rac-model-switcher"><button class="rac-model-btn' + (racProgModel === 'model1' ? ' aktivan' : '') + '" data-model="model1">Model 1 (NCEP)</button><button class="rac-model-btn' + (racProgModel === 'model2' ? ' aktivan' : '') + '" data-model="model2">Model 2 (ECMWF)</button></div>' +
        '<div class="rac-birac-wrap"><button class="rac-birac-btn" id="rac-birac-btn" aria-expanded="false"><span class="rac-birac-naziv">' + esc(racProgIzabrani.naziv) + '</span><span class="rac-birac-strelica"></span></button><div class="rac-dropdown" id="rac-dropdown" hidden>' + gradoviHtml + '</div></div>' +
        '<div class="rac-dani">' + dani + '</div>';

    const infoBtn = $("rac-info-btn"), infoPop = $("rac-info-popover");
    if (infoBtn && infoPop) { infoBtn.addEventListener("click", e => { e.stopPropagation(); infoPop.hidden = !infoPop.hidden; }); infoPop.addEventListener("click", e => e.stopPropagation()); }
    const biracBtn = $("rac-birac-btn"), dropdown = $("rac-dropdown");
    if (biracBtn && dropdown) {
        biracBtn.addEventListener("click", e => { e.stopPropagation(); const isH = dropdown.hidden; dropdown.hidden = !isH; biracBtn.setAttribute("aria-expanded", isH ? "true" : "false"); });
        dropdown.addEventListener("click", e => {
            e.stopPropagation(); const btn = e.target.closest(".rac-grad");
            if (btn) { racProgIzabrani = gradovi.find(g => g.kod === btn.dataset.kod); renderRacProg(); }
        });
    }
    box.querySelectorAll(".rac-model-btn").forEach(btn => { btn.addEventListener("click", () => { racProgModel = btn.dataset.model; racProgIzabrani = null; renderRacProg(); }); });

    if (!window._racDropdownListenerAttached) {
        document.addEventListener("click", (e) => {
            const dr = document.getElementById("rac-dropdown"), bb = document.getElementById("rac-birac-btn"), ip = document.getElementById("rac-info-popover"), ib = document.getElementById("rac-info-btn");
            if (dr && bb && !dr.hidden && !dr.contains(e.target) && !bb.contains(e.target)) { dr.hidden = true; bb.setAttribute("aria-expanded", "false"); }
            if (ip && ib && !ip.hidden && !ip.contains(e.target) && !ib.contains(e.target)) { ip.hidden = true; }
        });
        window._racDropdownListenerAttached = true;
    }
}

/* ---------- tab Stanice ---------- */
function mrezaRed(labela, stanica, vrijednost) { return '<li><span class="p-labela">' + labela + '</span> <span class="m-vrijednost"><span class="m-stanica">' + esc(stanica) + '</span> <b>' + vrijednost + '</b></span></li>'; }
function renderMreza() {
    const saT = staniceTrenutne.filter((s) => s.T !== "" && s.T != null); const saV = staniceTrenutne.filter((s) => s.vjetar !== "" && s.vjetar != null);
    if (!saT.length) { $("mreza").innerHTML = ""; return; }
    const top = saT.reduce((a, b) => (parseFloat(b.T) > parseFloat(a.T) ? b : a)); const min = saT.reduce((a, b) => (parseFloat(b.T) < parseFloat(a.T) ? b : a));
    let redovi = mrezaRed("Najtoplije", top.stanica, fmtBroj(top.T, 1) + "°C") + mrezaRed("Najhladnije", min.stanica, fmtBroj(min.T, 1) + "°C");
    if (saV.length) { const vjet = saV.reduce((a, b) => (parseFloat(b.vjetar) > parseFloat(a.vjetar) ? b : a)); redovi += mrezaRed("Najjači vjetar", vjet.stanica, fmtBroj(vjet.vjetar, 1) + " m/s"); }
    $("mreza").innerHTML = redovi;
}
function renderListaStanica() {
    const q = bezDijakritika($("pretraga-stanice").value.trim()); const svi = Object.values(registry).sort((a, b) => (a.naziv || "").localeCompare(b.naziv || ""));
    const filtrirane = q ? svi.filter((s) => bezDijakritika(s.naziv || "").includes(q)) : svi;
    if (!filtrirane.length) { $("lista-stanica").innerHTML = '<li class="lista-prazno">Nema rezultata.</li>'; return; }
    $("lista-stanica").innerHTML = filtrirane.map((s) => {
        const obs = staniceTrenutne.find((o) => o.sifra === s.sifra);
        if (!obs) return '<li><button class="st-red" data-sifra="' + esc(s.sifra) + '"><span class="st-lijevo"><span class="st-naziv">' + esc(s.naziv) + '</span><span class="st-meta">nema mjerenja</span></span><span class="st-temp">—</span></button></li>';
        const meta = [fmtKratko(obs.datum_vrijeme)];
        if (obs.vlaga !== "" && obs.vlaga != null) meta.push(fmtBroj(obs.vlaga, 0) + "%");
        if (obs.vjetar !== "" && obs.vjetar != null) meta.push(fmtBroj(obs.vjetar, 1) + " m/s");
        return '<li><button class="st-red" data-sifra="' + esc(s.sifra) + '"><span class="st-lijevo"><span class="st-naziv">' + esc(obs.stanica || s.naziv) + '</span><span class="st-meta">' + meta.join(" · ") + '</span></span><span class="st-temp">' + fmtBroj(obs.T, 1) + '°C</span></button></li>';
    }).join("");
}
$("pretraga-stanice").addEventListener("input", renderListaStanica);
$("ekstremi-glava").addEventListener("click", () => { const t = $("ekstremi-tijelo"), o = t.hidden; t.hidden = !o; $("ekstremi-glava").setAttribute("aria-expanded", o ? "true" : "false"); });
$("param-glava").addEventListener("click", () => { const t = $("param-tijelo"), o = t.hidden; t.hidden = !o; $("param-glava").setAttribute("aria-expanded", o ? "true" : "false"); $("param-naslov").textContent = o ? "Ostale info." : "Vidi ostale parametre"; });
$("detalj-param-glava").addEventListener("click", () => { const t = $("detalj-param-tijelo"), o = t.hidden; t.hidden = !o; $("detalj-param-glava").setAttribute("aria-expanded", o ? "true" : "false"); $("detalj-param-naslov").textContent = o ? "Ostale info." : "Vidi ostale parametre"; });
$("lista-stanica").addEventListener("click", (e) => { const btn = e.target.closest(".st-red"); if (btn) otvoriDetalj(btn.dataset.sifra); });

/* ---------- birač mjesta ---------- */
function renderLista() {
    const q = bezDijakritika($("pretraga").value.trim()); const svi = Object.values(registry).sort((a, b) => (a.naziv || "").localeCompare(b.naziv || ""));
    const filtrirani = q ? svi.filter((s) => bezDijakritika(s.naziv || "").includes(q)) : svi;
    if (!filtrirani.length) { $("lista-mjesta").innerHTML = '<li class="lista-prazno">Nema rezultata.</li>'; return; }
    $("lista-mjesta").innerHTML = filtrirani.map((s) => {
        const obs = staniceTrenutne.find((o) => o.sifra === s.sifra); const desno = obs ? '<span class="rm-temp">' + fmtBroj(obs.T, 1) + '°C</span>' + fmtSati(obs.datum_vrijeme) : 'nema mjerenja';
        return '<li><button class="red-mjesta' + (s.sifra === mojaSifra ? ' izabrano' : '') + '" data-sifra="' + esc(s.sifra) + '"><span class="rm-naziv">' + esc(s.naziv) + '</span><span class="rm-desno">' + desno + '</span></button></li>';
    }).join("");
}
function otvoriOverlay() { $("overlay").hidden = false; $("pretraga").value = ""; renderLista(); }
function zatvoriOverlay() { $("overlay").hidden = true; }
$("mjesto-ime").addEventListener("click", otvoriOverlay); $("overlay-zatvori").addEventListener("click", zatvoriOverlay); $("pretraga").addEventListener("input", renderLista);
$("lista-mjesta").addEventListener("click", (e) => { const btn = e.target.closest(".red-mjesta"); if (!btn) return; mojaSifra = btn.dataset.sifra; localStorage.setItem("moje_mjesto", mojaSifra); zatvoriOverlay(); prikaziMjesto(); });

function mnozina(n, oblici) { const d = n % 10, dd = n % 100; if (d === 1 && dd !== 11) return oblici[0]; if (d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14)) return oblici[1]; return oblici[2]; }
function renderTematskeKartice() {
    if (morePodaci && morePodaci.stations && morePodaci.stations.length) { const top = morePodaci.stations.reduce((a, b) => (b.vrijednost > a.vrijednost ? b : a)); $("more-vrijednost").textContent = fmtBroj(top.vrijednost, 0) + "°C"; $("more-meta").textContent = top.naziv + " · " + morePodaci.stations.length + " " + mnozina(morePodaci.stations.length, ["lokacija", "lokacije", "lokacija"]); }
    else { $("more-vrijednost").textContent = "—"; $("more-meta").textContent = "Nema objavljenih mjerenja"; }
    if (snijegPodaci && snijegPodaci.stations && snijegPodaci.stations.length) { const top = snijegPodaci.stations.reduce((a, b) => (b.vrijednost > a.vrijednost ? b : a)); $("snijeg-vrijednost").textContent = fmtBroj(top.vrijednost, 0) + " cm"; $("snijeg-meta").textContent = top.naziv + " · " + snijegPodaci.stations.length + " " + mnozina(snijegPodaci.stations.length, ["stanica", "stanice", "stanica"]); }
    else { $("snijeg-vrijednost").textContent = "—"; $("snijeg-meta").textContent = "Trenutno nema snijega"; }
}

/* ---------- učitavanje ---------- */
async function ucitaj() {
    try {
        const [rL, rS] = await Promise.all([fetch("data/latest.json?_=" + Date.now()), fetch("data/stations.json?_=" + Date.now())]);
        if (!rL.ok || !rS.ok) throw new Error("HTTP " + rL.status + "/" + rS.status);
        const dL = await rL.json(), dS = await rS.json();
        registry = {}; (dS.stations || []).forEach((s) => { registry[s.sifra] = s; });
        staniceTrenutne = dL.stations || []; if (!registry[mojaSifra]) mojaSifra = DEFAULT_SIFRA;
        const [more, snijeg, prog, rac] = await Promise.all([
            fetch("data/sea.json?_=" + Date.now()).then((r) => (r.ok ? r.json() : null)).catch(() => null),
            fetch("data/snow.json?_=" + Date.now()).then((r) => (r.ok ? r.json() : null)).catch(() => null),
            fetch("data/prognoza.json?_=" + Date.now()).then((r) => (r.ok ? r.json() : null)).catch(() => null),
            fetch("data/racprog.json?_=" + Date.now()).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        ]);
        morePodaci = more; snijegPodaci = snijeg; prognozaPodaci = prog; racProgPodaci = rac;
        renderTematskeKartice(); renderPrognoza(); prikaziMjesto(); renderMreza(); renderListaStanica(); syncIzHasa();
        if (detaljSifra && $("ekran-detalj").classList.contains("aktivan")) renderDetalj();
        if ($("ekran-more").classList.contains("aktivan")) renderMoreEkran();
        if ($("ekran-snijeg").classList.contains("aktivan")) renderSnijegEkran();
    } catch (e) {
        $("mjesto-ime").textContent = "—"; $("temp").textContent = "—"; $("mjerenje").textContent = "Zvanični podaci trenutno nijesu dostupni."; $("parametri").innerHTML = ""; $("graf-wrap").innerHTML = ""; $("graf-raspon").textContent = "—";
    }
}
ucitaj();
setInterval(ucitaj, 5 * 60 * 1000);
