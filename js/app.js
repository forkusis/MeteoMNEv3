/* MeteoMNE — app.js v1 (skelet) */
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

const MESECI = ["januar","februar","mart","april","maj","jun","jul","avgust","septembar","oktobar","novembar","decembar"];
const RUZA = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const DEFAULT_SIFRA = "02PLJV10"; // Pljevlja

let registry = {};
let mojaSifra = localStorage.getItem("moje_mjesto") || DEFAULT_SIFRA;

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

function renderMjesto(st) {
  const meta = registry[st.sifra] || {};
  $("mjesto-ime").innerHTML = esc((st.stanica || "—").toUpperCase()) +
    (meta.elevacija != null ? '<span class="elev">· ' + Math.round(meta.elevacija) + ' m</span>' : "");

  $("temp").textContent = fmtBroj(st.T, 1) + "°";
  $("mjerenje").textContent = fmtVrijeme(st.datum_vrijeme);

  let vjetar = "—";
  if (st.vjetar !== "" && st.vjetar != null) {
    vjetar = fmtBroj(st.vjetar, 1) + " m/s";
    const sm = smjerTekst(st.smjer_kod);
    if (sm) vjetar += " " + strelica(sm.deg);
  }

  $("parametri").innerHTML =
    red("Vlažnost",   (st.vlaga !== "" && st.vlaga != null) ? fmtBroj(st.vlaga, 0) + "%" : "—") +
    red("Vjetar",     vjetar) +
    red("Pritisak",   (st.pritisak !== "" && st.pritisak != null) ? fmtBroj(st.pritisak, 1) + " hPa" : "—") +
    red("Padavine",   (st.RR !== "" && st.RR != null) ? fmtBroj(st.RR, 1) + " mm" : "—") +
    red("Udar vjetra",(st.udar !== "" && st.udar != null) ? fmtBroj(st.udar, 1) + " m/s" : "—") +
    red("Insolacija", (st.insolacija !== "" && st.insolacija != null) ? fmtBroj(st.insolacija, 1) + " W/m²" : "—");
}

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

    const stanice = dL.stations || [];
    const moja = stanice.find((s) => s.sifra === mojaSifra) ||
                 stanice.find((s) => s.sifra === DEFAULT_SIFRA) ||
                 stanice[0];
    if (!moja) throw new Error("nema stanica");
    renderMjesto(moja);
  } catch (e) {
    $("mjesto-ime").textContent = "—";
    $("temp").textContent = "—";
    $("mjerenje").textContent = "Zvanični podaci trenutno nijesu dostupni. Aplikacija ne izmišlja vrijednosti.";
    $("parametri").innerHTML = "";
  }
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("aktivan", b === btn));
    document.querySelectorAll(".ekran").forEach((s) => s.classList.toggle("aktivan", s.id === "ekran-" + btn.dataset.ekran));
  });
});

ucitaj();
setInterval(ucitaj, 5 * 60 * 1000);
