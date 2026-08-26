import re
import json
import csv
import os
import time
import random
from datetime import datetime, timezone
from urllib.parse import quote
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_URL = "https://www.meteo.co.me/Meteorologija/aws_m.php"
HOME_URL = "https://www.meteo.co.me/"
GRAPH_URL = "https://www.meteo.co.me/Meteorologija/aws-graph.php"
PROGNOZA_URL = "https://www.meteo.co.me/page.php?id=31"
RAC_PAGE = "https://www.meteo.co.me/page.php?id=34"
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
STATUS_JSON = os.path.join(DATA_DIR, "status.json")
STATION_HISTORY_DIR = os.path.join(DATA_DIR, "history")
MAX_POINTS_PER_STATION = 96

FIELDNAMES = ["sifra", "tip", "stanica", "datum_vrijeme", "T", "vlaga", "RR", "vjetar", "smjer_kod", "udar", "insolacija", "pritisak"]

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
]

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
    "model2": "https://www.meteo.co.me/Meteorologija/Pr/Gradovi/5danaE/",
}

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def hours_since(iso):
    try:
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).total_seconds() / 3600.0
    except Exception:
        return None

def human_delay(a, b):
    d = random.uniform(a, b)
    if random.random() < 0.15:
        d += random.uniform(0.5, 1.5)
    time.sleep(d)

def make_session():
    s = requests.Session()
    s.verify = False
    s.headers.update({
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "sr-Latn-ME,sr;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0",
    })
    return s

def get_page(session, url, referer=None, extra=None):
    h = {
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin" if referer else "none",
        "Sec-Fetch-User": "?1",
    }
    if referer:
        h["Referer"] = referer
    if extra:
        h.update(extra)
    return session.get(url, timeout=30, headers=h)

def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def write_json(path, payload):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

def update_status(results):
    old = read_json(STATUS_JSON) or {}
    ds = old.get("datasets", {})
    for name, st in results.items():
        e = ds.get(name, {})
        if st == "ok":
            e["status"] = "ok"
            e["last_ok_at"] = now_iso()
        else:
            e["status"] = "stale"
        ds[name] = e
    write_json(STATUS_JSON, {"updated_at": now_iso(), "datasets": ds})

def opis_vremena(obl, vbn=None):
    val = obl if obl not in (None, "") else vbn
    if val in (None, ""):
        return None
    try:
        o = int(val)
    except (ValueError, TypeError):
        return None
    if o < 2: return NEBO[0]
    if o < 3: return NEBO[1]
    if o < 5: return NEBO[2]
    if o < 7: return NEBO[3]
    if o < 8: return NEBO[4]
    return NEBO[5]

def extract_posljednje(html):
    m = re.search(r"var\s+posljednje\s*=\s*({.*?});", html, re.S)
    if not m:
        raise ValueError("Nisam pronašao 'posljednje' varijablu na stranici.")
    raw = m.group(1)
    raw = re.sub(r",\s*\]", "]", raw)
    raw = re.sub(r",\s*\}", "}", raw)
    return json.loads(raw)

def extract_stanice(html):
    marker = re.search(r"var\s+stanice\s*=", html)
    if not marker:
        return []
    bracket_start = html.find("[", marker.end())
    if bracket_start == -1:
        return []
    depth = 0
    raw = None
    i = bracket_start
    while i < len(html):
        if html[i] == "[":
            depth += 1
        elif html[i] == "]":
            depth -= 1
            if depth == 0:
                raw = html[bracket_start:i + 1]
                break
        i += 1
    if raw is None:
        return []
    raw = re.sub(r",\s*\]", "]", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return []

def build_station_registry(stanice_raw):
    registry = []
    for item in stanice_raw:
        padded = (list(item) + [""] * 8)[:8]
        sifra, wmo, lat, lng, elev, naziv, tip, status = padded
        registry.append({
            "sifra": sifra,
            "wmo": wmo if str(wmo) not in ("", "-") else None,
            "lat": _to_float(lat),
            "lng": _to_float(lng),
            "elevacija": _to_float(elev),
            "naziv": naziv,
            "tip": tip,
            "aktivna": str(status) != "0",
        })
    registry.sort(key=lambda s: (s["naziv"] or "").lower())
    return registry

def flatten(data):
    rows = []
    for tip, arr in data.items():
        for item in arr:
            padded = (list(item) + [""] * 9)[:9]
            code, tip2, naziv, dt_str, T, RR, wind, wind_dir, gust = padded
            rows.append({
                "sifra": code, "tip": tip2, "stanica": naziv, "datum_vrijeme": dt_str,
                "T": T, "vlaga": "", "RR": RR, "vjetar": wind, "smjer_kod": wind_dir,
                "udar": gust, "insolacija": "", "pritisak": "",
            })
    return rows

def migrate_history_csv():
    if not os.path.exists(HISTORY_CSV):
        return
    with open(HISTORY_CSV, newline="", encoding="utf-8") as f:
        all_rows = [r for r in csv.reader(f) if r]
    if not all_rows or all_rows[0] == FIELDNAMES:
        return
    fixed = [r[:5] + [""] + r[5:] if len(r) == 11 else r for r in all_rows[1:]]
    with open(HISTORY_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(FIELDNAMES)
        writer.writerows(fixed)

def extract_balanced_object(html, var_name):
    marker = re.search(r"var\s+" + re.escape(var_name) + r"\s*=", html)
    if not marker:
        return None
    brace_start = html.find("{", marker.end())
    if brace_start == -1:
        return None
    depth = 0
    i = brace_start
    while i < len(html):
        if html[i] == "{":
            depth += 1
        elif html[i] == "}":
            depth -= 1
            if depth == 0:
                return html[brace_start:i + 1]
        i += 1
    return None

def extract_balanced_array(html, var_name):
    marker = re.search(r"var\s+" + re.escape(var_name) + r"\s*=\s*\[", html)
    if not marker:
        return None
    start = html.find("[", marker.start())
    if start == -1:
        return None
    depth = 0
    i = start
    while i < len(html):
        if html[i] == "[":
            depth += 1
        elif html[i] == "]":
            depth -= 1
            if depth == 0:
                return html[start:i + 1]
        i += 1
    return None

def extract_sinop(html):
    raw = extract_balanced_array(html, "sinop")
    if not raw:
        return []
    blocks = re.split(r"\}\s*,\s*\{", raw.strip("[]"))
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
    s = re.sub(r",\s*\]", "]", s)
    s = re.sub(r",\s*\}", "}", s)
    return s

def fetch_graph_extra(session, sifra, tip, naziv):
    try:
        human_delay(0.6, 1.8)
        url = f"{GRAPH_URL}?v={tip}&s={sifra}&name={quote(naziv)}&p=&d="
        r = get_page(session, url, referer=BASE_URL)
        r.raise_for_status()
        obj_str = extract_balanced_object(r.text, "DataAll")
        if not obj_str:
            return "", "", ""
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
    rows = list(rows)
    random.shuffle(rows)
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = {ex.submit(fetch_graph_extra, session, r["sifra"], r["tip"], r["stanica"]): r for r in rows}
        for fut in as_completed(futs):
            r = futs[fut]
            insolacija, pritisak, vlaga = fut.result()
            r["insolacija"] = insolacija
            r["pritisak"] = pritisak
            r["vlaga"] = vlaga
    return rows

def load_existing_keys():
    keys = set()
    if os.path.exists(HISTORY_CSV):
        with open(HISTORY_CSV, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                keys.add((row["sifra"], row["datum_vrijeme"]))
    return keys

def append_new(rows, existing_keys):
    os.makedirs(DATA_DIR, exist_ok=True)
    is_new_file = not os.path.exists(HISTORY_CSV)
    new_rows = [r for r in rows if (r["sifra"], r["datum_vrijeme"]) not in existing_keys]
    if new_rows:
        with open(HISTORY_CSV, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction="ignore")
            if is_new_file:
                writer.writeheader()
            writer.writerows(new_rows)
    return new_rows

def _to_float(value):
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (ValueError, TypeError):
        return None

def export_station_history():
    if not os.path.exists(HISTORY_CSV):
        return
    by_station = {}
    with open(HISTORY_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            by_station.setdefault(row["sifra"], []).append(row)
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

# ---------- more i snijeg ----------

def fetch_sea_snow(session):
    htmls = []
    for url in SEA_SNOW_URLS:
        try:
            human_delay(0.5, 1.5)
            r = get_page(session, url, referer=HOME_URL)
            r.raise_for_status()
            htmls.append(r.text)
        except Exception as e:
            print(f"  ! Greška pri dohvatanju {url}: {e}")
    return htmls

def _najduzi(rezultati):
    best = ""
    for s in rezultati:
        if len(s) > len(best):
            best = s
    return best

def _js_string(html, var):
    m = re.search(r"var\s+" + var + r"\d*\s*=\s*[\"']((?:[^\"\\]|\\.)*)[\"']", html)
    if not m:
        return ""
    return m.group(1).replace('\\"', '"').replace("\\'", "'")

def parse_labela(html, pref):
    return _najduzi([_js_string(html, pref + "H")]).strip()

def parse_tabela_tekst(html, pref):
    return _najduzi([_js_string(html, pref + "T")]).strip()

def _ocisti(s):
    return (s or "").replace("Â", "").replace("°", "°").replace("*", "")

def parse_html_tabela(s):
    s = _ocisti(s)
    if not s or "<td" not in s:
        return []
    out = []
    for m in re.finditer(r"<td[^>]*>\s*([^<]+?)\s*</td>\s*<td[^>]*>\s*(-?\d+(?:[.,]\d+)?)\s*(?:°C|cm)", s, re.I):
        naziv = m.group(1).strip()
        if naziv and len(naziv) > 1:
            out.append({"naziv": naziv, "vrijednost": float(m.group(2).replace(",", "."))})
    return out

def parse_redovi_jedinica(s, jedinice):
    if not s:
        return []
    s = _ocisti(s)
    html_redovi = parse_html_tabela(s)
    if html_redovi:
        return html_redovi
    for jed in jedinice:
        if jed not in s:
            continue
        out = []
        for part in s.split(jed):
            m = re.search(r"(\d+)\s*([A-Za-zČĆŠŽčćšžĐđ ]+?)\s*(-?\d+(?:[.,]\d+)?)\s*$", part.strip())
            if m:
                naziv = m.group(2).strip()
                if naziv:
                    out.append({"naziv": naziv, "vrijednost": float(m.group(3).replace(",", "."))})
        if out:
            return out
    return []

def parse_redovi_broj(s):
    s = _ocisti(s)
    out = []
    if not s:
        return out
    for m in re.finditer(r"(\d+)\s*([A-Za-zČĆŠŽčćšžĐđ ]+?)\s*(-?\d+(?:[.,]\d+)?)\s*(?=\d+[A-Za-zČĆŠŽčćšžĐđ]|$)", s):
        naziv = m.group(2).strip()
        if naziv:
            out.append({"naziv": naziv, "vrijednost": float(m.group(3).replace(",", "."))})
    return out

def build_more(htmls):
    for html in htmls:
        redovi = parse_redovi_jedinica(parse_tabela_tekst(html, "sea"), ["°C", "°C"])
        if redovi:
            return {"updated_at": now_iso(), "mjerenje_labela": parse_labela(html, "sea"), "stations": redovi}
    return {"updated_at": now_iso(), "mjerenje_labela": "", "stations": []}

def build_snijeg(htmls):
    for html in htmls:
        tekst = parse_tabela_tekst(html, "snow")
        redovi = parse_redovi_jedinica(tekst, ["cm"])
        if not redovi:
            redovi = parse_redovi_broj(tekst)
        if redovi:
            return {"updated_at": now_iso(), "mjerenje_labela": parse_labela(html, "snow"), "stations": redovi}
    return {"updated_at": now_iso(), "mjerenje_labela": "", "stations": []}

# ---------- zvanična prognoza ----------

def fetch_prognoza(session):
    try:
        human_delay(0.5, 1.5)
        r = get_page(session, PROGNOZA_URL, referer=HOME_URL)
        r.raise_for_status()
        return r.text
    except Exception as e:
        print(f"  ! Greška pri dohvatanju prognoze: {e}")
        return None

def _detag(html):
    t = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
    t = re.sub(r"<[^>]+>", "\n", t)
    t = t.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
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
        else:
            cur.append(l)
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
                if not naslov:
                    naslov = "Za pomorce"
                continue
            if week_re.match(low):
                started = True
                if not naslov or re.search(r"\d{1,2}\.\d{1,2}\.\d{4}", x):
                    naslov = x
                continue
            if dat_re.match(x):
                continue
            if low in ("za pomorce",):
                continue
            if not started:
                continue
            if low.startswith("podgorica:"):
                in_pod = True
                podgorica = x
                continue
            if in_pod:
                podgorica += " " + x
                continue
            body.append(x)
        entry = {"naslov": naslov, "azurirano": b["stamp"], "tekst": " ".join(body).strip(), "podgorica": podgorica.strip()}
        if i < 2:
            dani.append(entry)
        else:
            pomorci = entry
    print(f"  prognoza dijagnostika: blokova {len(blocks)}, dana {len(dani)}, pomorci {bool(pomorci)}")
    return {"updated_at": now_iso(), "dani": dani, "pomorci": pomorci}

# ---------- računarska prognoza ----------

def _rac_broj(s):
    if s is None:
        return None
    s = s.strip().rstrip(".")
    try:
        return float(s) + 0.0
    except (ValueError, TypeError):
        return None

def parse_racprog_dan(html):
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S)
    datum = None
    tmin = None
    tmax = None
    sati = []
    for row in rows:
        raw_cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        if not raw_cells:
            continue
        cells = [re.sub(r"<[^>]+>", " ", c).strip() for c in raw_cells]
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
            if rr is not None and rr == -0.0:
                rr = 0.0
            rh = _rac_broj(cells[3])
            vj_m = re.search(r'Simbolcici/V/([^"]+\.svg)', raw_cells[4])
            vjetar = vj_m.group(1).replace(".svg", "") if vj_m else None
            sati.append({"sat": sat, "simbol": simbol, "RR": rr, "RH": rh, "vjetar": vjetar})
    return datum, tmin, tmax, sati

def _fetch_rac_day(session, base_url, suffix, kod, naziv, dan_i, prev_day):
    human_delay(0.2, 0.9)
    url = f"{base_url}{kod}-{suffix}{dan_i}.html"
    lm = (prev_day or {}).get("lm")
    try:
        h = {"Sec-Fetch-Dest": "iframe", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "same-origin", "Referer": RAC_PAGE}
        if lm:
            h["If-Modified-Since"] = lm
        r = session.get(url, timeout=30, headers=h)
        if r.status_code == 304:
            return (kod, naziv, dan_i, prev_day)
        r.raise_for_status()
        text = r.text
        new_lm = r.headers.get("Last-Modified")
    except Exception as e:
        print(f"  ! Greška {kod} dan {dan_i}: {e}")
        return (kod, naziv, dan_i, prev_day)
    datum, tmin, tmax, sati = parse_racprog_dan(text)
    if datum is None and prev_day:
        return (kod, naziv, dan_i, prev_day)
    return (kod, naziv, dan_i, {"datum": datum or f"Dan {dan_i}", "Tmin": tmin, "Tmax": tmax, "sati": sati, "lm": new_lm})

def fetch_racprog(session, previous):
    prev = previous or {}
    rezultat = {"updated_at": now_iso()}
    for model_key, base_url in RACPROG_MODELS.items():
        suffix = "A" if model_key == "model1" else "E"
        prev_model = prev.get(model_key) or {}
        if model_key == "model1" and prev_model:
            age = hours_since(prev_model.get("updated_at"))
            if age is not None and age < 12:
                rezultat[model_key] = prev_model
                print(f"  {model_key}: zadržavam postojeće (staro {age:.1f}h)")
                continue
        prev_idx = {}
        for g in prev_model.get("gradovi", []):
            for i, d in enumerate(g.get("dani", [])):
                prev_idx[(g["kod"], i)] = d
        results = []
        with ThreadPoolExecutor(max_workers=3) as ex:
            futs = [ex.submit(_fetch_rac_day, session, base_url, suffix, kod, naziv, di, prev_idx.get((kod, di)))
                    for kod, naziv in RACPROG_GRADOVI for di in range(1, 6)]
            for fut in as_completed(futs):
                results.append(fut.result())
        by_kod = {}
        for kod, naziv, dan_i, day in results:
            if day is None:
                continue
            by_kod.setdefault(kod, {"kod": kod, "naziv": naziv, "dani": {}})
            by_kod[kod]["dani"][dan_i] = day
        gradovi = []
        for kod, obj in by_kod.items():
            dani = [obj["dani"][i] for i in sorted(obj["dani"].keys())]
            if dani:
                gradovi.append({"kod": kod, "naziv": obj["naziv"], "dani": dani})
        rezultat[model_key] = {"updated_at": now_iso(), "gradovi": gradovi}
        print(f"  {model_key}: gradova {len(gradovi)}")
    return rezultat

# ---------- main ----------

def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    session = make_session()
    print("Warm-up: početna stranica...")
    try:
        get_page(session, HOME_URL)
        human_delay(0.8, 2.0)
    except Exception as e:
        print(f"  ! warm-up greška: {e}")

    results = {}

    print("Provjeravam history.csv migraciju...")
    migrate_history_csv()

    print("Povlačim glavnu listu stanica...")
    rows, registry = [], []
    try:
        r = get_page(session, BASE_URL, referer=HOME_URL)
        r.raise_for_status()
        html = r.text
        rows = flatten(extract_posljednje(html))
        registry = build_station_registry(extract_stanice(html))
    except Exception as e:
        print(f"  ! Greška glavni feed: {e}")

    latest_valid = len(rows) >= 20 and sum(1 for x in rows if x["T"] not in ("", None)) >= 15
    if registry:
        write_json(STATIONS_JSON, {"updated_at": now_iso(), "count": len(registry), "stations": registry})

    if latest_valid:
        reg_by = {x["sifra"]: x for x in registry}
        print("Obogaćujem grafikone (paralelno, 3 worker-a)...")
        rows = enrich_with_graph_data(session, rows)
        new_rows = append_new(rows, load_existing_keys())
        export_station_history()

        print("Dohvatam more, snijeg i sinop...")
        ss_htmls = fetch_sea_snow(session)
        if ss_htmls:
            sinop_html = next((h for h in ss_htmls if h and "var sinop" in h), None)
            if sinop_html:
                wmo_opis = {str(s["wmo"]): opis_vremena(s.get("obl"), s.get("vbn")) for s in extract_sinop(sinop_html) if s.get("wmo")}
                for row in rows:
                    reg = reg_by.get(row["sifra"])
                    wmo = str(reg["wmo"]) if reg and reg.get("wmo") is not None else None
                    row["opis"] = wmo_opis.get(wmo) if wmo else None
            more = build_more(ss_htmls)
            snijeg = build_snijeg(ss_htmls)
            if more["stations"]:
                write_json(SEA_JSON, more)
                results["sea"] = "ok"
            else:
                results["sea"] = "stale"
                print("  ! more: nema podataka, čuvam postojeći sea.json")
            write_json(SNOW_JSON, snijeg)
            results["snow"] = "ok"
            print(f"  more: {len(more['stations'])} lokacija; snijeg: {len(snijeg['stations'])} lokacija")
        else:
            results["sea"] = "stale"
            results["snow"] = "stale"
            print("  ! more/snijeg: fetch failed, čuvam stare fajlove")

        write_json(LATEST_JSON, {"updated_at": now_iso(), "stations": rows})
        results["latest"] = "ok"
        print(f"  latest: OK ({len(rows)} stanica, novih {len(new_rows)})")
    else:
        results["latest"] = "stale"
        print("  ! latest: NEVALIDNO -> zadržavam stari latest.json")

    print("Dohvatam zvaničnu prognozu...")
    prog_html = fetch_prognoza(session)
    prognoza = build_prognoza(prog_html) if prog_html else None
    if prognoza and len(prognoza["dani"]) >= 1 and any(d["tekst"] for d in prognoza["dani"]):
        write_json(PROGNOZA_JSON, prognoza)
        results["prognoza"] = "ok"
    else:
        results["prognoza"] = "stale"
        print("  ! prognoza: NEVALIDNO -> zadržavam staru")

    print("Dohvatam računarsku prognozu...")
    rac = fetch_racprog(session, read_json(RACPROG_JSON))
    m2 = rac.get("model2", {})
    if m2.get("gradovi") and len(m2["gradovi"]) >= 10:
        write_json(RACPROG_JSON, rac)
        results["racprog"] = "ok"
    else:
        results["racprog"] = "stale"
        print("  ! racprog: NEVALIDNO -> zadržavam stari")

    update_status(results)
    print(f"Uspješno završeno. status: {results}")

if __name__ == "__main__":
    main()
