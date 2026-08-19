/* MeteoMNE — app.js v2 (Korak 2: promjena mjesta) */
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
    return;
  }

  $("temp").textContent = fmtBroj(obs.T, 1) + "°";
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
