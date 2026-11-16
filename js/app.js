/* MeteoMNE — app.js v15 (esc + timezone fix) */
"use strict";

const $ = (id) => document.getElementById(id);

// P0 FIX: siguran HTML escape (DOM-baziran, nikad ne vraća undefined)
const esc = (s) => {
    if (s == null) return "";
    const el = document.createElement('span');
    el.textContent = String(s);
    return el.innerHTML;
};

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
    vjetar: { naslov: "Vjetar", legenda: '<span class="leg-t">— brzina vjetra (m/s)</span> <span class="leg-h">– – udar</span>' },
    pritisak: { naslov: "Pritisak", legenda: '<span class="leg-t">— pritisak (hPa)</span>' },
    insolacija: { naslov: "Insolacija", legenda: '<span class="leg-t">— insolacija (W/m²)</span>' }
};

// P0 FIX: dan/noć po stvarnom vremenu u Crnoj Gori (automatski CET/CEST)
function danJe() {
    const h = parseInt(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Podgorica',
        hour: 'numeric',
        hour12: false
    }).format(new Date()), 10);
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
const OPSEG_DANA = { "3d": 3, "7d": 7, "30d": 30 };

// keš-verzija: mijenja se na 10 min -> browser može da kešira istoriju
function verzija() { return "?v=" + Math.floor(Date.now() / 600000); }

const grafMoje = { mode: "tvaga", opseg: "3d", sifra: null, kes: {}, raw: null, els: { naslov: $("graf-naslov"), legenda: $("graf-legenda"), raspon: $("graf-raspon"), wrap: $("graf-wrap") } };
const grafDetalj = { mode: "tvaga", opseg: "3d", sifra: null, kes: {}, raw: null, els: { naslov: $("detalj-graf-naslov"), legenda: $("detalj-graf-legenda"), raspon: $("detalj-graf-raspon"), wrap: $("detalj-graf-wrap") } };

function grafTier(opseg) { return opseg === "sve" ? "d" : "r"; }

async function ucitajGraf(sifra, ctx) {
    ctx.sifra = sifra;
    const tier = grafTier(ctx.opseg);
    const url = "data/history/" + sifra + (tier === "d" ? ".d.json" : ".r.json");
    let data;
    if (Object.prototype.hasOwnProperty.call(ctx.kes, url)) {
        data = ctx.kes[url];
    } else {
        try { const r = await fetch(url + verzija()); data = r.ok ? await r.json() : null; }
        catch (e) { data = null; }
        ctx.kes[url] = data;
    }
    if (!data && tier === "d") {                      // nema dnevnog -> padni na sirovi (30 dana)
        try { const r = await fetch("data/history/" + sifra + ".r.json" + verzija()); data = r.ok ? await r.json() : null; }
        catch (e) { data = null; }
        if (data) ctx.kes[url] = data;
    }
    ctx.raw = data;
    iscrtaj(ctx);
}

function iscrtaj(ctx) {
    const dec = Graf.decode(ctx.raw);
    if (!dec || !dec.pts.length) {
        Graf.prazno(ctx.els.wrap, "Istorija za ovu stanicu trenutno nije dostupna.", ctx.els.raspon);
        return;
    }
    let pts = dec.pts;
    if (ctx.opseg !== "sve") {
        const dana = OPSEG_DANA[ctx.opseg] || 3;
        const od = pts[pts.length - 1].t - dana * 86400000;
        pts = pts.filter((p) => p.t >= od);
    }
    if (pts.length < 2) {
        Graf.prazno(ctx.els.wrap, "Nedovoljno podataka za izabrani opseg.", ctx.els.raspon);
        return;
    }
    const mi = MODE_INFO[ctx.mode];
    ctx.els.naslov.textContent = mi.naslov;
    ctx.els.legenda.innerHTML = mi.legenda + (dec.kind === "d" ? ' <span class="leg-b">pojas = min–maks</span>' : "");
    Graf.render(ctx.els.wrap, { pts: pts, mode: ctx.mode, kind: dec.kind, rasponEl: ctx.els.raspon });
}

function veziChipove(selector, ctx) {
    document.querySelectorAll(selector).forEach((c) => {
        c.addEventListener("click", () => {
            ctx.mode = c.dataset.graf;
            document.querySelectorAll(selector).forEach((x) => x.classList.toggle("aktivan", x === c));
            if (ctx.raw) iscrtaj(ctx);
        });
    });
}
veziChipove("#graf-chips .chip", grafMoje);
veziChipove("#detalj-chips .chip", grafDetalj);

function veziOpseg(selector, ctx) {
    document.querySelectorAll(selector).forEach((c) => {
        c.addEventListener("click", () => {
            if (ctx.opseg === c.dataset.opseg) return;
            ctx.opseg = c.dataset.opseg;
            document.querySelectorAll(selector).forEach((x) => x.classList.toggle("aktivan", x === c));
            if (ctx.sifra) ucitajGraf(ctx.sifra, ctx);
        });
    });
}
veziOpseg("#graf-opseg .chip", grafMoje);
veziOpseg("#detalj-graf-opseg .chip", grafDetalj);

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
function ocistiDanTekst(t) { return (t || "").replace(/^(ponedjeljak|utorak|srijeda|četvrtak|petak|subota|nedjelja),?\s+\d{1,2}\.\d{1,2}\.\d{4}\.\s*/i, ""); }
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
        '<div id="pg-racunarska" hidden></div>';

    box.querySelectorAll(".prog-tab").forEach((b) => {
        b.addEventListener("click", () => {
            box.querySelectorAll(".prog-tab").forEach((x) => x.classList.toggle("aktivan", x === b));
            $("pg-zvanicna").hidden = b.dataset.pg !== "zvanicna";
            $("pg-racunarska").hidden = b.dataset.pg !== "racunarska";
        });
    });
    renderRacProg();
}

/* ---------- računarska prognoza ---------- */
// P0 FIX: UTC -> lokalno crnogorsko vrijeme preko Intl (tačan CET/CEST, bez ručnog DST)
function utcToCet(utcSat, datumStr) {
    const match = /(\d{4}-\d{2}-\d{2})/.exec(datumStr || "");
    if (!match) return String(utcSat).padStart(2, "0");
    const utcDate = new Date(match[1] + "T" + String(utcSat).padStart(2, "0") + ":00:00Z");
    const h = parseInt(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Podgorica',
        hour: 'numeric',
        hour12: false
    }).format(utcDate), 10);
    return String(h).padStart(2, "0");
}

const RAC_SIMBOL_BASE = "https://www.meteo.co.me/Meteorologija/Pr/Gradovi/5danaE/Simbolcici/";
function racSimbolUrl(kod) { return kod ? RAC_SIMBOL_BASE + kod + ".svg" : ""; }

function racVjetarOpis(kod) {
    if (!kod) return ""; const m = /^v(\d)-(\d{3})$/.exec(kod); if (!m) return "";
    const snaga = +m[1], smjer = +m[2]; if (snaga === 0) return "bez vjetra";
    const stepeni = [[0, "S"],[22.5, "SSW"],[45, "SW"],[67.5, "WSW"],[90, "W"],[112.5, "WNW"],[135, "NW"],[157.5, "NNW"],[180, "N"],[202.5, "NNE"],[225, "NE"],[247.5, "ENE"],[270, "E"],[292.5, "ESE"],[315, "SE"],[337.5, "SSE"],[360, "S"]];
    let best = stepeni[0]; for (let i = 1; i < stepeni.length; i++) { if (Math.abs(smjer - stepeni[i][0]) < Math.abs(smjer - best[0])) best = stepeni[i]; }
    const opisi = {1: "slab", 2: "umjeren", 3: "jak", 4: "vrlo jak"}; return (opisi[snaga] || "") + " " + best[1];
}

function racVjetarSvg(kod) {
    if (!kod) return ""; const m = /^v(\d)-(\d{3})$/.exec(kod); if (!m) return "";
    const snaga = +m[1], smjer = +m[2]; if (snaga === 0) return '<span class="rac-vj-txt">—</span>';
    const debljina = snaga === 1 ? 1.5 : (snaga === 2 ? 2 : 2.5);
    return '<svg class="rac-vj-svg" viewBox="0 0 24 24" style="transform:rotate(' + smjer + 'deg)"><line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" stroke-width="' + debljina + '" stroke-linecap="round"/><polygon points="12,2 8,8 16,8" fill="currentColor"/></svg>';
}

const RAC_DANI_SR = ["Ponedjeljak", "Utorak", "Srijeda", "Četvrtak", "Petak", "Subota", "Nedjelja"];
function racDatumPrikaz(datumStr) {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(datumStr || "");
    if (!m) return esc(datumStr);
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (isNaN(+d)) return esc(datumStr);
    const danas = new Date(); danas.setHours(0, 0, 0, 0);
    const razlika = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - danas) / 864e5);
    const rel = razlika === 0 ? " · Danas" : razlika === 1 ? " · Sutra" : razlika === -1 ? " · Juče" : "";
    const naziv = RAC_DANI_SR[(d.getDay() + 6) % 7];
    return esc(naziv + ", " + d.getDate() + "." + (d.getMonth() + 1) + "." + rel);
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
        const imeLower = bezDijakritika(mojeNaziv).toLowerCase();
        const STANICA_TO_RAC_KOD = {
            "herceg novi": "HER",
            "bijelo polje": "BIJ",
            "ada bojana": "ADB"
        };
        let racKod = STANICA_TO_RAC_KOD[imeLower];
        if (!racKod) {
            const prvaRijec = imeLower.split(" ")[0];
            const nadjen = gradovi.find(g =>
                bezDijakritika(g.naziv).toLowerCase() === prvaRijec ||
                bezDijakritika(g.naziv).toLowerCase() === imeLower
            );
            if (nadjen) racKod = nadjen.kod;
        }
        racProgIzabrani = gradovi.find(g => g.kod === racKod) || gradovi.find(g => g.kod === "POD");
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
        return '<details class="rac-acc"><summary class="rac-acc-glava"><span class="rac-acc-lijevo"><span class="rac-acc-datum">' + racDatumPrikaz(dan.datum) + '</span><span class="rac-acc-tempi">' + TminTxt + ' / ' + TmaxTxt + '</span></span><span class="rac-acc-strelica"></span></summary><div class="rac-acc-tijelo"><table class="rac-tabela"><thead><tr><th>Sat</th><th>Vrijeme</th><th>Padavine</th><th>Vlažnost</th><th>Vjetar</th></tr></thead><tbody>' + redovi + '</tbody></table></div></details>';
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
        grafMoje.kes = {}; grafDetalj.kes = {};   // svjeza istorija poslije osvježavanja
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
