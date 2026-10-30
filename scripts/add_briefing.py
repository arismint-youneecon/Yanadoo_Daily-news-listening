#!/usr/bin/env python3
"""Add one briefing to the site: make the MP3, write data/<date>.json, rebuild data/index.json.

Usage:
  python3 scripts/add_briefing.py --date 2026-10-31 --level 1 --item item.json --models /path/to/kokoro [--speed 0.9] [--voice af_heart]

item.json fields:
  slot      "g1" | "g2" | "k1"   (section + order; id becomes <date>-<slot>)
  icon      Tabler icon name without "ti-" (optional)
  headline  short English headline
  ko        short Korean summary
  url       original article URL
  source    "CS Monitor (AP)" or "Korea Herald"
  title_ko  Korean topic for the MP3 title tag
  p         list of English paragraphs (the script that is read aloud)
  tr        list of Korean paragraphs (same count as p)
  g         glossary {lowercase word or phrase: Korean meaning}
  ph        list of multi-word glossary keys
  kw        list of [english, korean] key words

Audio: Kokoro TTS, 0.6 s between paragraphs, loudness -16 LUFS, 48 kbps mono MP3.
Audio files older than KEEP_DAYS are deleted; their briefings keep the script and lose the audio link.
"""
import argparse, json, os, subprocess, sys, glob, datetime

KEEP_DAYS = 60
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
AUDIO = os.path.join(ROOT, "audio")


def tts(paragraphs, models, voice, speed, lang, out_wav):
    import numpy as np, soundfile as sf
    from kokoro_onnx import Kokoro
    k = Kokoro(os.path.join(models, "kokoro-v1.0.onnx"), os.path.join(models, "voices-v1.0.bin"))
    chunks, sr = [], 24000
    for para in paragraphs:
        s, sr = k.create(para, voice=voice, speed=speed, lang=lang)
        chunks += [s, np.zeros(int(sr * 0.6), dtype=s.dtype)]
    audio = np.concatenate(chunks)
    sf.write(out_wav, audio, sr)
    return len(audio) / sr


def encode(wav, mp3, title):
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", wav,
                    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "24000", "-ac", "1",
                    "-codec:a", "libmp3lame", "-b:a", "48k", "-id3v2_version", "3",
                    "-metadata", "title=" + title, "-metadata", "artist=아침 영어 뉴스 클럽",
                    "-metadata", "album=아침 영어 뉴스 클럽", "-metadata", "genre=Speech", mp3], check=True)


def rebuild_index():
    days = []
    for path in sorted(glob.glob(os.path.join(DATA, "????-??-??.json")), reverse=True):
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        days.append({"date": d["date"], "items": [
            {k: it.get(k) for k in ("id", "section", "icon", "headline", "ko")} for it in d["items"]]})
    with open(os.path.join(DATA, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "days": days}, f, ensure_ascii=False, indent=1)
    return len(days)


def prune(today):
    cutoff = (datetime.date.fromisoformat(today) - datetime.timedelta(days=KEEP_DAYS)).isoformat()
    removed = []
    for mp3 in glob.glob(os.path.join(AUDIO, "????-??-??-*.mp3")):
        if os.path.basename(mp3)[:10] < cutoff:
            os.remove(mp3); removed.append(os.path.basename(mp3))
    if removed:
        for path in glob.glob(os.path.join(DATA, "????-??-??.json")):
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
            changed = False
            for it in d["items"]:
                if it.get("audio") and os.path.basename(it["audio"]) in removed:
                    it["audio"] = None; changed = True
            if changed:
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(d, f, ensure_ascii=False, indent=1)
    return removed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True)
    ap.add_argument("--level", type=int, default=1)
    ap.add_argument("--item", required=True)
    ap.add_argument("--models", required=True)
    ap.add_argument("--speed", type=float, default=0.9)
    ap.add_argument("--voice", default="af_heart")
    ap.add_argument("--lang", default="en-us")
    ap.add_argument("--wav", help="use this WAV instead of running TTS")
    a = ap.parse_args()

    with open(a.item, encoding="utf-8") as f:
        it = json.load(f)
    for k in ("slot", "headline", "ko", "p", "tr", "g", "kw"):
        if not it.get(k):
            sys.exit("missing field: " + k)
    if it["slot"][0] not in "gk":
        sys.exit("slot must start with g or k")
    if len(it["p"]) != len(it["tr"]):
        sys.exit("p and tr must have the same number of paragraphs")

    os.makedirs(DATA, exist_ok=True); os.makedirs(AUDIO, exist_ok=True)
    bid = a.date + "-" + it["slot"]
    mp3_rel = "audio/" + bid + ".mp3"
    wav = a.wav or os.path.join("/tmp", bid + ".wav")
    if not a.wav:
        tts(it["p"], a.models, a.voice, a.speed, a.lang, wav)
    md = a.date[5:7].lstrip("0") + "/" + a.date[8:10].lstrip("0")
    encode(wav, os.path.join(ROOT, mp3_rel), "%s %s (레벨 %d)" % (md, it.get("title_ko") or it["ko"], a.level))
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                os.path.join(ROOT, mp3_rel)], capture_output=True, text=True, check=True).stdout.strip())

    entry = {
        "id": bid, "section": it["slot"][0], "icon": it.get("icon"), "headline": it["headline"], "ko": it["ko"],
        "url": it.get("url"), "source": it.get("source"), "audio": mp3_rel, "duration": round(dur, 1),
        "speed": a.speed, "p": it["p"], "tr": it["tr"], "g": it["g"], "ph": it.get("ph", []), "kw": it["kw"],
    }
    day_path = os.path.join(DATA, a.date + ".json")
    day = {"date": a.date, "level": a.level, "items": []}
    if os.path.exists(day_path):
        with open(day_path, encoding="utf-8") as f:
            day = json.load(f)
    day["level"] = a.level
    day["items"] = [x for x in day["items"] if x["id"] != bid] + [entry]
    order = {"g1": 0, "g2": 1, "g3": 2, "k1": 3, "k2": 4, "k3": 5}
    day["items"].sort(key=lambda x: order.get(x["id"][11:], 9))
    with open(day_path, "w", encoding="utf-8") as f:
        json.dump(day, f, ensure_ascii=False, indent=1)

    removed = prune(a.date)
    n = rebuild_index()
    size = os.path.getsize(os.path.join(ROOT, mp3_rel))
    print("ok %s duration=%.1fs mp3=%dKB days=%d pruned=%d" % (bid, dur, size // 1024, n, len(removed)))


if __name__ == "__main__":
    main()
