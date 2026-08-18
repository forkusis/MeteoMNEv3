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
DATA_DIR = "data"
HISTORY_CSV = os.path.join(DATA_DIR, "history.csv")
LATEST_JSON = os.path.join(DATA_DIR, "latest.json")
STATION_HISTORY_DIR = os.path.join(DATA_DIR, "history")
MAX_POINTS_PER_STATION = 96

FIELDNAMES = ["sifra", "tip", "stanica", "datum_vrijeme", "T", "vlaga", "RR", "vjetar", "smjer_kod", "udar", "insolacija", "pritisak"]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "sr-Latn-ME,sr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Connection": "keep-alive"
}

def fetch_raw(session):
    r = session.get(BASE_URL, timeout=30, headers=HEADERS, verify=False)
    r.raise_for_status()
    return r.text

def extract_posljednje(html):
    m = re.search(r"var\s+posljednje\s*=\s*(\{.*?\});", html, re.S)
    if not m:
        raise ValueError("Nisam pronašao 'posljednje' varijablu na stranici.")
    raw = m.group(1)
    raw = re.sub(r",\s*\]", "]", raw)
    raw = re.sub(r",\s*\}", "}", raw)
    return json.loads(raw)

def flatten(data):
    rows = []
    for tip, arr in data.items():
        for item in arr:
            padded = (list(item) + [""] * 9)[:9]
            code, tip2, naziv, dt_str, T, RR, wind, wind_dir, gust = padded
            rows.append({
                "sifra": code,
                "tip": tip2,
                "stanica": naziv,
                "datum_vrijeme": dt_str,
                "T": T,
                "vlaga": "",
                "RR": RR,
                "vjetar": wind,
                "smjer_kod": wind_dir,
                "udar": gust,
                "insolacija": "",
                "pritisak": "",
            })
    return rows

def migrate_history_csv():
    """Jednokratna migracija: ako history.csv ima stari raspored (11 kolona bez 'vlaga'),
    prepisuje ga u novi raspored i ispravlja redove od 12 vrijednosti koji su
    upisani po starom zaglavlju (pomjerene kolone)."""
    if not os.path.exists(HISTORY_CSV):
        return
    with open(HISTORY_CSV, newline="", encoding="utf-8") as f:
        all_rows = [r for r in csv.reader(f) if r]
    if not all_rows:
        return
    header = all_rows[0]
    if header == FIELDNAMES:
        return  # vec migrirano, nema sta da se radi
    fixed = []
    for r in all_rows[1:]:
        if len(r) == 11:
            fixed.append(r[:5] + [""] + r[5:])   # stari red: dodaj praznu vlagu
        else:
            fixed.append(r)                      # red od 12 vrijednosti: vec je u novom rasporedu
    with open(HISTORY_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(FIELDNAMES)
        writer.writerows(fixed)
    print(f"Migracija history.csv zavrsena: {len(fixed)} redova prebaceno u novi raspored.")

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

def js_object_to_json(js_str):
    s = re.sub(r'([{,]\s*)(\w+)(\s*:)', r'\1"\2"\3', js_str)
    s = re.sub(r",\s*\]", "]", s)
    s = re.sub(r",\s*\}", "}", s)
    return s

def fetch_graph_extra(session, sifra, tip, naziv):
    try:
        time.sleep(random.uniform(1.5, 3.5))
        url = f"{GRAPH_URL}?v={tip}&s={sifra}&name={quote(naziv)}&p=&d="
        r = session.get(url, timeout=30, headers=HEADERS, verify=False)
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
            reader = csv.DictReader(f)
            for row in reader:
                keys.add((row["sifra"], row["datum_vrijeme"]))
    return keys

def append_new(rows, existing_keys):
    os.makedirs(DATA_DIR, exist_ok=True)
    is_new_file = not os.path.exists(HISTORY_CSV)
    new_rows = [r for r in rows if (r["sifra"], r["datum_vrijeme"]) not in existing_keys]
    if new_rows:
        with open(HISTORY_CSV, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
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
        reader = csv.DictReader(f)
        for row in reader:
            by_station.setdefault(row["sifra"], []).append(row)

    os.makedirs(STATION_HISTORY_DIR, exist_ok=True)
    for sifra, rows in by_station.items():
        trimmed = rows[-MAX_POINTS_PER_STATION:]
        points = []
        for r in trimmed:
            points.append({
                "dt": r["datum_vrijeme"],
                "T": _to_float(r.get("T")),
                "vlaga": _to_float(r.get("vlaga")),
                "RR": _to_float(r.get("RR")),
                "vjetar": _to_float(r.get("vjetar")),
                "insolacija": _to_float(r.get("insolacija")),
                "pritisak": _to_float(r.get("pritisak")),
            })
        safe_name = re.sub(r"[^A-Za-z0-9_-]", "_", sifra)
        with open(os.path.join(STATION_HISTORY_DIR, f"{safe_name}.json"), "w", encoding="utf-8") as out:
            json.dump(points, out, ensure_ascii=False)

def main():
    session = requests.Session()

    print("Provjeravam da li history.csv treba migraciju...")
    migrate_history_csv()

    print("Povlačim glavnu listu stanica...")
    html = fetch_raw(session)
    data = extract_posljednje(html)
    rows = flatten(data)

    print(f"Pronađeno {len(rows)} stanica. Krećem u dohvatanje detalja (vlažnost, pritisak)...")
    print("Ovo će trajati oko 2 minuta zbog bezbjednosnih pauza.")
    rows = enrich_with_graph_data(session, rows)

    existing = load_existing_keys()
    new_rows = append_new(rows, existing)
    export_station_history()

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(LATEST_JSON, "w", encoding="utf-8") as f:
        json.dump({
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "stations": rows,
        }, f, ensure_ascii=False, indent=2)

    print(f"Uspješno završeno! Ukupno stanica: {len(rows)}, novih zapisa: {len(new_rows)}")

if __name__ == "__main__":
    main()
