import re
import json
import csv
import os
import time
import random
from datetime import datetime, timezone
from urllib.parse import quote
import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_URL = "https://www.meteo.co.me/Meteorologija/aws_m.php"
GRAPH_URL = "https://www.meteo.co.me/Meteorologija/aws-graph.php"
PROGNOZA_URL = "https://www.meteo.co.me/page.php?id=31"
SEA_SNOW_URLS = [
    "https://www.meteo.co.me/Meteorologija/TTRR/sneg-talasi.php",
    "https://www.meteo.co.me/synopT.php",
]

DATA_DIR = "data"
HISTORY_CSV = os.path.join(DATA_DIR, "history.csv")
LATEST_JSON = os.path.join(DATA_DIR, "latest.json")
STATIONS_JSON = os.path.join(DATA_DIR, "stations.json")
SEA_JSON = os.path.join(DATA_DIR, "sea.json")
SNOW_JSON = os.path.join(DATA_DIR, "snow.json")
PROGNOZA_JSON = os.path.join(DATA_DIR, "prognoza.json")
RACPROG_JSON = os.path.join(DATA_DIR, "racprog.json")
STATION_HISTORY_DIR = os.path.join(DATA_DIR, "history")

MAX_POINTS_PER_STATION = 96
FIELDNAMES = ["sifra", "tip", "stanica", "datum_vrijeme", "T", "vlaga", "RR", "vjetar", "smjer_kod", "udar", "insolacija", "pritisak"]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "sr-Latn-ME,sr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Connection": "keep-alive"
}

NEBO = ["Vedro", "Pretežno vedro", "Malo oblačno", "Umjereno oblačno", "Pretežno oblačno", "Oblačno"]
RACPROG_GRADOVI = [
    ("POD", "Podgorica"), ("TUZ", "Tuzi"), ("ULC", "Ulcinj"), ("BAR", "Bar"),
    ("BUD", "Budva"), ("KOT", "Kotor"), ("TIV", "Tivat"), ("HER", "Herceg Novi"),
    ("CET", "Cetinje"), ("DAN", "Danilovgrad"), ("NIK", "Nikšić"), ("SAV", "Šavnik"),
    ("KOL", "Kolašin"), ("PLU", "Plužine"), ("PLA", "Plav"), ("AND", "Andrijevica"),
    ("GUS", "Gusinje"), ("MOJ", "Mojkovac"), ("PET", "Petnjica"), ("BER", "Berane"),
    ("ROZ", "Rožaje"), ("BIJ", "Bijelo Polje"), ("ZAB", "Žabljak"), ("PLJ", "Pljevlja"),
    ("ADB", "Ada Bojana")
]
RAC_SATI = ["00", "03", "06", "09", "12", "15", "18", "21"]
RACPROG_MODELS = {
    "model1": "https://www.meteo.co.me/Meteorologija/Pr/Gradovi/5danaA/",
    "model2": "https://www.meteo.co.me/Meteorologija/Pr/Gradovi/5danaE/"
}

def opis_vremena(obl, vbn=None):
    val = obl if obl not in (None, "") else vbn
    if val in (None, ""): return None
    try: o = int(val)
    except (ValueError, TypeError): return None
    if o < 2: return NEBO[0]
    if o < 3: return NEBO[1]
    if o < 5: return NEBO[2]
    if o < 7: return NEBO[3]
    if o < 8: return NEBO[4]
    return NEBO[5]

def fetch_raw(session):
    r = session.get(BASE_URL, timeout=30, headers=HEADERS, verify=False)
    r.raise_for_status()
    return r.text

def extract_posljednje(html):
    m = re.search(r"var\s+posljednje\s*=\s*({.*?});", html, re.S)
    if not m: raise ValueError("Nisam pronašao 'posljednje' varijablu na stranici.")
    raw = m.group(1)
    raw = re.sub(r",\s*]", "]", raw)
    raw = re.sub(r",\s*}", "}", raw)
    return json.loads(raw)

def extract_stanice(html):
    marker = re.search(r"var\s+stanice\s*=", html)
    if not marker: return []
    bracket_start = html.find("[", marker.end())
    if bracket_start == -1: return []
    depth = 0
    raw = None
    i = bracket_start
    while i < len(html):
        if html[i] == "[": depth += 1
        elif html[i] == "]":
            depth -= 1
            if depth == 0:
                raw = html[bracket_start:i + 1]
                break
        i += 1
    if raw is None: return []
    raw = re.sub(r",\s*]", "]", raw)
    try: return json.loads(raw)
    except json.JSONDecodeError: return []

def build_station_registry(stanice_raw):
    registry = []
    for item in stanice_raw:
        padded = (list(item) + [" "] * 8)[:8]
        sifra, wmo, lat, lng, elev, naziv, tip, status = padded
        registry.append({
            "sifra": sifra, "wmo": wmo if str(wmo) not in (" ", "-") else None,
            "lat": _to_float(lat), "lng": _to_float(lng), "elevacija": _to_float(elev),
            "naziv": naziv, "tip": tip, "aktivna": str(status) != "0",
        })
    registry.sort(key=lambda s: (s["naziv"] or " ").lower())
    return registry

def flatten(data):
    rows = []
    for tip, arr in data.items():
        for item in arr:
            padded = (list(item) + [" "] * 9)[:9]
            code, tip2, naziv, dt_str, T, RR, wind, wind_dir, gust = padded
            rows.append({
                "sifra": code, "tip": tip2, "stanica": naziv, "datum_vrijeme": dt_str,
                "T": T, "vlaga": "", "RR": RR, "vjetar": wind, "smjer_kod": wind_dir,
                "udar": gust, "insolacija": "", "pritisak": "",
            })
    return rows

def migrate_history_csv():
    if not os.path.exists(HISTORY_CSV): return
    with open(HISTORY_CSV, newline="", encoding="utf-8") as f:
        all_rows = [r for r in csv.reader(f) if r]
    if not all_rows or all_rows[0] == FIELDNAMES: return
    fixed = [r[:5] + [""] + r[5:] if len(r) == 11 else r for r in all_rows[1:]]
    with open(HISTORY_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(FIELDNAMES)
        writer.writerows(fixed)

def extract_balanced_object(html, var_name):
    marker = re.search(r"var\s+" + re.escape(var_name) + r"\s*=", html)
    if not marker: return None
    brace_start = html.find("{", marker.end())
    if brace_start == -1: return None
    depth = 0
    i = brace_start
    while i < len(html):
        if html[i] == "{": depth += 1
        elif html[i] == "}":
            depth -= 1
            if depth == 0: return html[brace_start:i + 1]
        i += 1
    return None

def extract_balanced_array(html, var_name):
    marker = re.search(r"var\s+" + re.escape(var_name) + r"\s*=\s*\[", html)
    if not marker: return None
    start = html.find("[", marker.start())
    if start == -1: return None
    depth = 0
    i = start
    while i < len(html):
        if html[i] == "[": depth += 1
        elif html[i] == "]":
            depth -= 1
            if depth == 0: return html[start:i + 1]
        i += 1
    return None

def extract_sinop(html):
    raw = extract_balanced_array(html, "sinop")
    if not raw: return []
    blocks = re.split(r"}\s*,\s*{", raw.strip("[]"))
    out = []
    for b in blocks:
        sifra = re.search(r"sifra:\s*'([^']*)'", b)
        naziv = re.search(r"naziv:\s*'([^']*)'", b)
        obl = re.search(r"\bobl:\s*'([^']*)'", b)
        vbn = re.search(r"VBNobl:\s*'([^']*)'", b)
        out.append({
            "wmo": sifra.group(1) if sifra else None,
            "naziv": naziv.group(1) if naziv else None,
            "obl": obl.group(1) if obl else None,
            "vbn": vbn.group(1) if vbn else None,
        })
    return out

def js_object_to_json(js_str):
    s = re.sub(r'([{,]\s*)(\w+)(\s*:)', r'\1"\2"\3', js_str)
    s = re.sub(r",\s*]", "]", s)
    s = re.sub(r",\s*}", "}", s)
    return s

def fetch_graph_extra(session, sifra, tip, naziv):
    try:
        time.sleep(random.uniform(1.5, 3.5))
        url = f"{GRAPH_URL}?v={tip}&s={sifra}&name={quote(naziv)}&p=&d="
        r = session.get(url, timeout=30, headers=HEADERS, verify=False)
        r.raise_for_status()
        obj_str = extract_balanced_object(r.text, "DataAll")
        if not obj_str: return "", "", ""
        data = json.loads(js_object_to_json(obj_str))
        g3 = data.get("G3", {})
        gr = g3.get("GR", [])
        insolacija = gr[-1][1] if gr else ""
        p = g3.get("P", [])
        pritisak = p[-1][1] if p else ""
        g1 = data.get("G1", {})
        h = g1.get("H", [])
        vlaga = h[-1][1] if h else ""
        return insolacija, pritisak, vlaga
    except Exception as e:
        print(f"  ! Greška pri dohvatanju grafika za {naziv} ({sifra}): {e}")
        return "", "", ""

def enrich_with_graph_data(session, rows):
    for row in rows:
        print(f"  Dohvatam grafikone za: {row['stanica']} ({row['tip']})...")
        insolacija, pritisak, vlaga = fetch_graph_extra(session, row["sifra"], row["tip"], row["stanica"])
        row["insolacija"] = insolacija
        row["pritisak"] = pritisak
        row["vlaga"] = vlaga
    return rows

def load_existing_keys():
    keys = set()
    if os.path.exists(HISTORY_CSV):
        with open(HISTORY_CSV, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f): keys.add((row["sifra"], row["datum_vrijeme"]))
    return keys

def append_new(rows, existing_keys):
    os.makedirs(DATA_DIR, exist_ok=True)
    is_new_file = not os.path.exists(HISTORY_CSV)
    new_rows = [r for r in rows if (r["sifra"], r["datum_vrijeme"]) not in existing_keys]
    if new_rows:
        with open(HISTORY_CSV, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction="ignore")
            if is_new_file: writer.writeheader()
            writer.writerows(new_rows)
    return new_rows

def _to_float(value):
    try:
        if value in (None, ""): return None
        return float(value)
    except (ValueError, TypeError): return None

def export_station_history():
    if not os.path.exists(HISTORY_CSV): return
    by_station = {}
    with open(HISTORY_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f): by_station.setdefault(row["sifra"], []).append(row)
    os.makedirs(STATION_HISTORY_DIR, exist_ok=True)
    for sifra, rows in by_station.items():
        trimmed = rows[-MAX_POINTS_PER_STATION:]
        points = []
        for r in trimmed:
            points.append({
                "dt": r["datum_vrijeme"], "T": _to_float(r.get("T")), "vlaga": _to_float(r.get("vlaga")),
                "RR": _to_float(r.get("RR")), "vjetar": _to_float(r.get("vjetar")),
                "insolacija": _to_float(r.get("insolacija")), "pritisak": _to_float(r.get("pritisak")),
            })
        safe_name = re.sub(r"[^A-Za-z0-9_-]", "_", sifra)
        with open(os.path.join(STATION_HISTORY_DIR, f"{safe_name}.json"), "w", encoding="utf-8") as out:
            json.dump(points, out, ensure_ascii=False)

def fetch_sea_snow(session):
    htmls = []
    for url in SEA_SNOW_URLS:
        try:
            r = session.get(url, timeout=30, headers=HEADERS, verify=False)
            r.raise_for_status()
            htmls.append(r.text)
        except Exception as e: print(f"  ! Greška pri dohvatanju {url}: {e}")
    return htmls

def _najduzi(rezultati):
    best = ""
    for s in rezultati:
        if len(s) > len(best): best = s
    return best

def _js_string(html, var):
    m = re.search(r"var\s+" + var + r"\d*\s*=\s*\"((?:[^\"\\]|\\.)*)\"", html)
    if not m: return ""
    return m.group(1).replace('\\"', '"').replace("\\'", "'")

def parse_labela(html, pref): return _najduzi([_js_string(html, pref + "H")]).strip()
def parse_tabela_tekst(html, pref): return _najduzi([_js_string(html, pref + "T")]).strip()

def _ocisti(s): return (s or "").replace("Â", "").replace("°", "°").replace("*", "")

def parse_redovi_jedinica(s, jedinice):
    if not s: return []
    s = _ocisti(s)
    for jed in jedinice:
        if jed not in s: continue
        out = []
        for part in s.split(jed):
            m = re.search(r"(\d+)\s*([A-Za-zČĆŠŽčćšžĐđ ]+?)\s*(-?\d+(?:[.,]\d+)?)\s*$", part.strip())
            if m:
                naziv = m.group(2).strip()
                if naziv: out.append({"naziv": naziv, "vrijednost": float(m.group(3).replace(",", "."))})
        if out: return out
    return []

def parse_redovi_broj(s):
    s = _ocisti(s)
    out = []
    if not s: return out
    for m in re.finditer(r"(\d+)\s*([A-Za-zČĆŠŽčćšžĐđ ]+?)\s*(-?\d+(?:[.,]\d+)?)\s*(?=\d+[A-Za-zČĆŠŽčćšžĐđ]|$)", s):
        naziv = m.group(2).strip()
        if naziv: out.append({"naziv": naziv, "vrijednost": float(m.group(3).replace(",", "."))})
    return out

def build_more(htmls):
    for html in htmls:
        redovi = parse_redovi_jedinica(parse_tabela_tekst(html, "sea"), ["°C", "°C"])
        if redovi: return {"updated_at": datetime.now(timezone.utc).isoformat(), "mjerenje_labela": parse_labela(html, "sea"), "stations": redovi}
    return {"updated_at": datetime.now(timezone.utc).isoformat(), "mjerenje_labela": "", "stations": []}

def build_snijeg(htmls):
    for html in htmls:
        tekst = parse_tabela_tekst(html, "snow")
        redovi = parse_redovi_jedinica(tekst, ["cm"])
        if not redovi: redovi = parse_redovi_broj(tekst)
        if redovi: return {"updated_at": datetime.now(timezone.utc).isoformat(), "mjerenje_labela": parse_labela(html, "snow"), "stations": redovi}
    return {"updated_at": datetime.now(timezone.utc).isoformat(), "mjerenje_labela": "", "stations": []}

def fetch_prognoza(session):
    try:
        r = session.get(PROGNOZA_URL, timeout=30, headers=HEADERS, verify=False)
        r.raise_for_status()
        return r.text
    except Exception as e:
        print(f"  ! Greška pri dohvatanju prognoze: {e}")
        return None

def _detag(html):
    t = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
    t = re.sub(r"<[^>]+>", "\n", t)
    t = t.replace("Â", "").replace("&", "&").replace("<", "<").replace(">", ">")
    lines = [re.sub(r"\s+", " ", l).strip() for l in t.split("\n")]
    return [l for l in lines if l]

def build_prognoza(html):
    week_re = re.compile(r"^(ponedjeljak|utorak|srijeda|četvrtak|petak|subota|nedjelja)\b", re.I)
    dat_re = re.compile(r"^\d{1,2}\.\d{1,2}\.\d{4}\.?$")
    lines = _detag(html)
    blocks = []
    cur = []
    for l in lines:
        m = re.match(r"prognoza ažurirana:\s*(.+)", l, re.I)
        if m:
            blocks.append({"stamp": m.group(1).strip(), "lines": cur})
            cur = []
        else: cur.append(l)
    dani = []
    pomorci = None
    for i, b in enumerate(blocks[:3]):
        body = []
        podgorica = ""
        naslov = ""
        started = False
        in_pod = False
        for x in b["lines"]:
            low = x.lower()
            if low.startswith("prognoza za pomorce"):
                started = True
                if not naslov: naslov = "Za pomorce"
                continue
            if week_re.match(low):
                started = True
                if not naslov or re.search(r"\d{1,2}\.\d{1,2}\.\d{4}", x): naslov = x
                continue
            if dat_re.match(x): continue
            if low in ("za pomorce",): continue
            if not started: continue
            if low.startswith("podgorica:"):
                in_pod = True
                podgorica = x
                continue
            if in_pod:
                podgorica += " " + x
                continue
            body.append(x)
        entry = {"naslov": naslov, "azurirano": b["stamp"], "tekst": " ".join(body).strip(), "podgorica": podgorica.strip()}
        if i < 2: dani.append(entry)
        else: pomorci = entry
    return {"updated_at": datetime.now(timezone.utc).isoformat(), "dani": dani, "pomorci": pomorci}

def _rac_broj(s):
    if s is None: return None
    s = s.strip().rstrip(".")
    try: return float(s) + 0.0
    except (ValueError, TypeError): return None

def parse_racprog_dan(html):
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S)
    datum = None
    tmin = None
    tmax = None
    sati = []
    for row in rows:
        raw_cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        if not raw_cells: continue
        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in raw_cells]
        
        if datum is None:
            dm = re.search(r"(ponedjeljak|utorak|srijeda|četvrtak|petak|subota|nedjelja),\s*\d{4}-\d{2}-\d{2}", " ".join(cells), re.I)
            if dm:
                datum = dm.group(0)
                continue
                
        if len(cells) >= 2 and cells[0].lower() == "tmin":
            tmin = _rac_broj(cells[1])
            continue
        if len(cells) >= 2 and cells[0].lower() == "tmax":
            tmax = _rac_broj(cells[1])
            continue
            
        if len(cells) >= 5 and cells[0].strip() in RAC_SATI:
            sat = cells[0].strip()
            sim_m = re.search(r'Simbolcici/([^"]+\.svg)', raw_cells[1])
            simbol = sim_m.group(1).replace(".svg", "") if sim_m else None
            rr = _rac_broj(cells[2])
            if rr is not None and rr == -0.0: rr = 0.0
            rh = _rac_broj(cells[3])
            vj_m = re.search(r'Simbolcici/V/([^"]+\.svg)', raw_cells[4])
            vjetar = vj_m.group(1).replace(".svg", "") if vj_m else None
            sati.append({"sat": sat, "simbol": simbol, "RR": rr, "RH": rh, "vjetar": vjetar})
    return datum, tmin, tmax, sati

def fetch_racprog(session):
    print(f"Dohvatam računarsku prognozu za {len(RACPROG_GRADOVI)} gradova (oba modela)...")
    rezultat = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "model1": {"gradovi": []},
        "model2": {"gradovi": []}
    }
    for model_key, base_url in RACPROG_MODELS.items():
        print(f"  Dohvatam {model_key}...")
        suffix = "A" if model_key == "model1" else "E"
        for kod, naziv in RACPROG_GRADOVI:
            grad_data = {"kod": kod, "naziv": naziv, "dani": []}
            for dan in range(1, 6):
                url = f"{base_url}{kod}-{suffix}{dan}.html"
                try:
                    r = session.get(url, timeout=30, headers=HEADERS, verify=False)
                    if r.status_code == 404: continue
                    r.raise_for_status()
                    html_text = r.content.decode('utf-8', errors='ignore') # OVO REŠAVA PROBLEM SA "ČETVRTAK"
                    datum, tmin, tmax, sati = parse_racprog_dan(html_text)
                    grad_data["dani"].append({"datum": datum or f"Dan {dan}", "Tmin": tmin, "Tmax": tmax, "sati": sati})
                    time.sleep(0.15)
                except Exception as e:
                    print(f"  ! Greška za {naziv} dan {dan} ({model_key}): {e}")
                    continue
            if grad_data["dani"]: rezultat[model_key]["gradovi"].append(grad_data)
    return rezultat

def main():
    session = requests.Session()
    print("Provjeravam da li history.csv treba migraciju...")
    migrate_history_csv()
    print("Povlačim glavnu listu stanica...")
    html = fetch_raw(session)
    data = extract_posljednje(html)
    rows = flatten(data)
    stanice_raw = extract_stanice(html)
    registry = build_station_registry(stanice_raw)
    if registry:
        with open(STATIONS_JSON, "w", encoding="utf-8") as f:
            json.dump({"updated_at": datetime.now(timezone.utc).isoformat(), "count": len(registry), "stations": registry}, f, ensure_ascii=False, indent=2)
    print(f"Pronađeno {len(rows)} stanica. Krećem u dohvatanje detalja...")
    rows = enrich_with_graph_data(session, rows)
    existing = load_existing_keys()
    new_rows = append_new(rows, existing)
    export_station_history()
    
    print("Dohvatam more, snijeg i sinop...")
    ss_htmls = fetch_sea_snow(session)
    more = build_more(ss_htmls)
    snijeg = build_snijeg(ss_htmls)
    with open(SEA_JSON, "w", encoding="utf-8") as f: json.dump(more, f, ensure_ascii=False, indent=2)
    with open(SNOW_JSON, "w", encoding="utf-8") as f: json.dump(snijeg, f, ensure_ascii=False, indent=2)
    
    sinop_html = next((h for h in ss_htmls if h and "var sinop" in h), None)
    sinop = extract_sinop(sinop_html) if sinop_html else []
    wmo_opis = {str(s["wmo"]): opis_vremena(s.get("obl"), s.get("vbn")) for s in sinop if s.get("wmo")}
    reg_by_sifra = {r["sifra"]: r for r in registry}
    for row in rows:
        reg = reg_by_sifra.get(row["sifra"])
        wmo = str(reg["wmo"]) if reg and reg.get("wmo") is not None else None
        row["opis"] = wmo_opis.get(wmo) if wmo else None
        
    print("Dohvatam zvaničnu prognozu...")
    prog_html = fetch_prognoza(session)
    if prog_html is not None:
        prognoza = build_prognoza(prog_html)
        with open(PROGNOZA_JSON, "w", encoding="utf-8") as f: json.dump(prognoza, f, ensure_ascii=False, indent=2)
        
    print("Dohvatam računarsku prognozu (oba modela)...")
    racprog = fetch_racprog(session)
    with open(RACPROG_JSON, "w", encoding="utf-8") as f: json.dump(racprog, f, ensure_ascii=False, indent=2)
    
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(LATEST_JSON, "w", encoding="utf-8") as f:
        json.dump({"updated_at": datetime.now(timezone.utc).isoformat(), "stations": rows}, f, ensure_ascii=False, indent=2)
    print(f"Uspješno završeno! Ukupno stanica: {len(rows)}, novih zapisa: {len(new_rows)}")

if __name__ == "__main__":
    main()
