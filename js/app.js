/* MeteoMNE — app.js v3 (Korak 3: grafikon temperature i vlažnosti) */
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

const MESECI = ["januar","februar","mart","april","maj","jun","jul","avgust","septembar","oktobar","novembar","decembar"];
const RUZA = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const DEFAULT_SIFRA = "02PLJV10"; // Pljevlja

let registry = {};
let staniceTrenutne = [];
let mojaSifra = localStorage.getItem("moje_mjesto") || DEFAULT_SIFRA;

/* ---------- format ---------- */
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
  return '<li><span class="p-labela">' + labela + '</span><span class="p-vrijednost">' + vrijednost + '</span></li>';
}
function bezDijakritika(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function parseDT(dt) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/.exec(dt || "");
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
}

/* ---------- Moje mjesto ---------- */
function prikaziMjesto() {
  const meta = registry[mojaSifra] || {};
  const obs = staniceTrenutne.find((s) => s.sifra === mojaSifra);
  const naziv = (obs && obs.stanica) || meta.naziv || "—";

  $("mjesto-ime").innerHTML = esc(String(naziv).toUpperCase()) +
    (meta.elevacija != null ? '<span class="elev">· ' + Math.round(meta.elevacija) + ' m</span>' : "");

  if (!obs) {
    $("temp").textContent = "—";
    $("mjerenje").textContent = "Stanica trenutno ne šalje mjerenja.";
    $("parametri").innerHTML = "";
    ucitajGraf(mojaSifra);
    return;
  }

  $("temp").innerHTML = '<span class="temp-broj">' + fmtBroj(obs.T, 1) + '</span><span class="temp-jedinica">°C</span>';
  $("mjerenje").textContent = fmtVrijeme(obs.datum_vrijeme);

  let vjetar = "—";
  if (obs.vjetar !== "" && obs.vjetar != null) {
    vjetar = fmtBroj(obs.vjetar, 1) + " m/s";
    const sm = smjerTekst(obs.smjer_kod);
    if (sm) vjetar += " " + strelica(sm.deg);
  }

  $("parametri").innerHTML =
    red("Vlažnost",    (obs.vlaga !== "" && obs.vlaga != null) ? fmtBroj(obs.vlaga, 0) + "%" : "—") +
    red("Vjetar",      vjetar) +
    red("Pritisak",    (obs.pritisak !== "" && obs.pritisak != null) ? fmtBroj(obs.pritisak, 1) + " hPa" : "—") +
    red("Padavine",    (obs.RR !== "" && obs.RR != null) ? fmtBroj(obs.RR, 1) + " mm" : "—") +
    red("Udar vjetra", (obs.udar !== "" && obs.udar != null) ? fmtBroj(obs.udar, 1) + " m/s" : "—") +
    red("Insolacija",  (obs.insolacija !== "" && obs.insolacija != null) ? fmtBroj(obs.insolacija, 1) + " W/m²" : "—");

  ucitajGraf(mojaSifra);
}

/* ---------- grafikon (ručni SVG, bez biblioteka) ---------- */
async function ucitajGraf(sifra) {
  const wrap = $("graf-wrap");
  try {
    const r = await fetch("data/history/" + sifra + ".json?_=" + Date.now());
    if (!r.ok) throw new Error("HTTP " + r.status);
    const pts = await r.json();
    crtajGraf(pts);
  } catch (e) {
    wrap.innerHTML = '<p class="graf-prazno">Istorija za ovu stanicu trenutno nije dostupna.</p>';
    $("graf-raspon").textContent = "—";
  }
}

function crtajGraf(pts) {
  const wrap = $("graf-wrap");
  const data = (pts || [])
    .map((p) => ({ t: parseDT(p.dt), T: (p.T == null ? null : p.T), H: (p.vlaga == null ? null : p.vlaga) }))
    .filter((p) => p.t);

  const Ts = data.filter((p) => p.T != null).map((p) => p.T);
  if (data.length < 2 || Ts.length < 2) {
    wrap.innerHTML = '<p class="graf-prazno">Nedovoljno podataka za grafikon.</p>';
    $("graf-raspon").textContent = "—";
    return;
  }

  const W = 340, H = 170, mL = 30, mR = 32, mT = 8, mB = 22;
  const iw = W - mL - mR, ih = H - mT - mB;
  const t0 = data[0].t, t1 = data[data.length - 1].t;
  const span = Math.max(+t1 - +t0, 1);
  const X = (d) => mL + ((+d - +t0) / span) * iw;

  let tMin = Math.min.apply(null, Ts), tMax = Math.max.apply(null, Ts);
  if (tMax - tMin < 2) { tMax += 1; tMin -= 1; }
  const pad = (tMax - tMin) * 0.15;
  tMin -= pad; tMax += pad;
  const YT = (v) => mT + (1 - (v - tMin) / (tMax - tMin)) * ih;
  const YH = (v) => mT + (1 - v / 100) * ih;

  const fmtX = (d) => d.getDate() + "." + (d.getMonth() + 1) + ". " + String(d.getHours()).padStart(2, "0") + "h";
  const fmtDT = (d) => d.getDate() + "." + (d.getMonth() + 1) + ". · " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");

  let grid = "", labL = "", labR = "";
  [0, 0.5, 1].forEach((f) => {
    const y = mT + f * ih;
    grid += '<line x1="' + mL + '" y1="' + y + '" x2="' + (W - mR) + '" y2="' + y + '" class="g-mreza"/>';
    labL += '<text x="' + (mL - 5) + '" y="' + (y + 3) + '" class="g-lab g-lab-l" text-anchor="end">' + Math.round(tMax - f * (tMax - tMin)) + '°</text>';
  });
  [100, 50, 0].forEach((v, i) => {
    labR += '<text x="' + (W - mR + 5) + '" y="' + (mT + i * 0.5 * ih + 3) + '" class="g-lab g-lab-r">' + v + '</text>';
  });
  const xMid = new Date((+t0 + +t1) / 2);
  const labX =
    '<text x="' + mL + '" y="' + (H - 6) + '" class="g-lab">' + fmtX(t0) + '</text>' +
    '<text x="' + (mL + iw / 2) + '" y="' + (H - 6) + '" class="g-lab" text-anchor="middle">' + fmtX(xMid) + '</text>' +
    '<text x="' + (W - mR) + '" y="' + (H - 6) + '" class="g-lab" text-anchor="end">' + fmtX(t1) + '</text>';

  let pT = "";
  data.forEach((p) => {
    if (p.T != null) pT += (pT ? "L" : "M") + X(p.t).toFixed(1) + " " + YT(p.T).toFixed(1);
  });
  let pH = "", prevH = false;
  data.forEach((p) => {
    if (p.H != null) {
      pH += (prevH ? "L" : "M") + X(p.t).toFixed(1) + " " + YH(p.H).toFixed(1);
      prevH = true;
    } else {
      prevH = false;
    }
  });

  $("graf-raspon").textContent = fmtX(t0) + " – " + fmtX(t1) + " · " + data.length + " mjerenja";

  wrap.innerHTML =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" class="g-svg">' +
    grid + labL + labR + labX +
    (pH ? '<path d="' + pH + '" class="g-linija-h" fill="none"/>' : '') +
    '<path d="' + pT + '" class="g-linija-t" fill="none"/>' +
    '<line class="g-vodilica" id="g-vodilica" x1="-10" x2="-10" y1="' + mT + '" y2="' + (mT + ih) + '"/>' +
    '<circle class="g-tacka-t" id="g-tacka-t" cx="-10" cy="-10" r="3"/>' +
    '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="transparent" id="g-dodir"/>' +
    '</svg>' +
    '<div class="g-tooltip" id="g-tooltip" hidden></div>';

  const svgEl = wrap.querySelector(".g-svg");
  const dodir = wrap.querySelector("#g-dodir");
  const tooltip = wrap.querySelector("#g-tooltip");
  const vod = wrap.querySelector("#g-vodilica");
  const tacka = wrap.querySelector("#g-tacka-t");

  function naDodir(ev) {
    const rect = svgEl.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    let best = null, bd = Infinity;
    data.forEach((p) => {
      const d = Math.abs(X(p.t) - px);
      if (d < bd) { bd = d; best = p; }
    });
    if (!best) return;
    const x = X(best.t);
    vod.setAttribute("x1", x); vod.setAttribute("x2", x);
    if (best.T != null) { tacka.setAttribute("cx", x); tacka.setAttribute("cy", YT(best.T)); }
    tooltip.hidden = false;
    tooltip.innerHTML =
      '<span class="tt-vrijeme">' + fmtDT(best.t) + '</span>' +
      '<span>T <b>' + (best.T != null ? fmtBroj(best.T, 1) + "°C" : "—") + '</b></span>' +
      '<span class="tt-h">Vlažnost <b>' + (best.H != null ? fmtBroj(best.H, 0) + "%" : "—") + '</b></span>';
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

/* ---------- birač mjesta ---------- */
function renderLista() {
  const q = bezDijakritika($("pretraga").value.trim());
  const svi = Object.values(registry).sort((a, b) => (a.naziv || "").localeCompare(b.naziv || ""));
  const filtrirani = q ? svi.filter((s) => bezDijakritika(s.naziv || "").includes(q)) : svi;

  if (!filtrirani.length) {
    $("lista-mjesta").innerHTML = '<li class="lista-prazno">Nema rezultata za „' + esc($("pretraga").value.trim()) + '".</li>';
    return;
  }

  $("lista-mjesta").innerHTML = filtrirani.map((s) => {
    const obs = staniceTrenutne.find((o) => o.sifra === s.sifra);
    const desno = obs
      ? '<span class="rm-temp">' + fmtBroj(obs.T, 1) + '°</span>' + fmtSati(obs.datum_vrijeme)
      : 'nema mjerenja';
    return '<li><button class="red-mjesta' + (s.sifra === mojaSifra ? ' izabrano' : '') + '" data-sifra="' + esc(s.sifra) + '">' +
      '<span class="rm-naziv">' + esc(s.naziv) + '</span>' +
      '<span class="rm-desno">' + desno + '</span>' +
      '</button></li>';
  }).join("");
}

function otvoriOverlay() {
  $("overlay").hidden = false;
  $("pretraga").value = "";
  renderLista();
}
function zatvoriOverlay() {
  $("overlay").hidden = true;
}

$("mjesto-ime").addEventListener("click", otvoriOverlay);
$("overlay-zatvori").addEventListener("click", zatvoriOverlay);
$("pretraga").addEventListener("input", renderLista);
$("lista-mjesta").addEventListener("click", (e) => {
  const btn = e.target.closest(".red-mjesta");
  if (!btn) return;
  mojaSifra = btn.dataset.sifra;
  localStorage.setItem("moje_mjesto", mojaSifra);
  zatvoriOverlay();
  prikaziMjesto();
});

/* ---------- učitavanje ---------- */
async function ucitaj() {
  try {
    const [rL, rS] = await Promise.all([
      fetch("data/latest.json?_=" + Date.now()),
      fetch("data/stations.json?_=" + Date.now())
    ]);
    if (!rL.ok || !rS.ok) throw new Error("HTTP " + rL.status + "/" + rS.status);
    const dL = await rL.json();
    const dS = await rS.json();

    registry = {};
    (dS.stations || []).forEach((s) => { registry[s.sifra] = s; });
    staniceTrenutne = dL.stations || [];

    if (!registry[mojaSifra]) {
      mojaSifra = DEFAULT_SIFRA;
    }
    prikaziMjesto();
  } catch (e) {
    $("mjesto-ime").textContent = "—";
    $("temp").textContent = "—";
    $("mjerenje").textContent = "Zvanični podaci trenutno nijesu dostupni. Aplikacija ne izmišlja vrijednosti.";
    $("parametri").innerHTML = "";
    $("graf-wrap").innerHTML = "";
    $("graf-raspon").textContent = "—";
  }
}

/* ---------- tabovi ---------- */
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("aktivan", b === btn));
    document.querySelectorAll(".ekran").forEach((s) => s.classList.toggle("aktivan", s.id === "ekran-" + btn.dataset.ekran));
  });
});

ucitaj();
setInterval(ucitaj, 5 * 60 * 1000);
