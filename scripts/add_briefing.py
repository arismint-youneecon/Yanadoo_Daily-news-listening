#!/usr/bin/env python3
"""Add one level version of one story to the site: make the MP3, update data/<date>.json, rebuild data/index.json.

Every story is written at 5 levels (1 = TOEIC ~300 ... 5 = TOEIC ~990). Run this once per level:
  python3 scripts/add_briefing.py --date 2026-10-31 --level 3 --item k1_L3.json --models /path/to/kokoro
(voice and speed come from the level: 1-3 af_heart, 4 am_michael, 5 bf_emma)

item.json fields:
  slot      "g1" | "g2" | "k1"   (section + order; the story id becomes <date>-<slot>)
  icon      Tabler icon name without "ti-" (optional; shared by all levels)
  ko        short Korean summary (shared by all levels)
  url       original article URL (shared)
  source    "CS Monitor (AP)" or "Korea Herald" (shared)
  title_ko  Korean topic for the MP3 title tag (optional)
  headline  English headline written at this level
  p         list of English paragraphs at this level (the script that is read aloud)
  tr        list of Korean paragraphs (same count as p)
  g         glossary {lowercase word or phrase as it appears in p: Korean meaning}
  ph        list of multi-word glossary keys
  kw        list of [english, korean] key words

Audio: Kokoro TTS with the level's voice, speed and pauses (0.6 s between paragraphs), loudness -16 LUFS, 48 kbps mono MP3,
saved as audio/<date>-<slot>-L<level>.mp3. Audio older than KEEP_DAYS is deleted; the script and translation stay.
"""
import argparse, json, os, subprocess, sys, glob, datetime

KEEP_DAYS = 30
LEVELS = (1, 2, 3, 4, 5)
# Pace rises with the level. Voices differ in natural pace, so speed is set per voice, and levels 1-2 also get
# a short pause after every sentence so beginners have time to follow. Measured on real scripts (words per minute
# including pauses): level 1 ~110, 2 ~125, 3 ~145, 4 ~145 (male voice), 5 ~165 (British voice).
VOICE = {1: "af_heart", 2: "af_heart", 3: "af_heart", 4: "am_michael", 5: "bf_emma"}
SPEED = {1: 0.75, 2: 0.8, 3: 0.9, 4: 1.1, 5: 1.05}
SENTENCE_GAP = {1: 0.5, 2: 0.3, 3: 0.0, 4: 0.0, 5: 0.0}
SHARED = ("icon", "ko", "url", "source")
PER_LEVEL = ("headline", "p", "tr", "g", "ph", "kw")
WORDS = {1: (100, 140), 2: (170, 210), 3: (250, 300), 4: (300, 350), 5: (350, 420)}
ORDER = {"g1": 0, "g2": 1, "g3": 2, "k1": 3, "k2": 4, "k3": 5}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
AUDIO = os.path.join(ROOT, "audio")


def tts(paragraphs, models, voice, speed, lang, out_wav, sentence_gap=0.0):
    import re, numpy as np, soundfile as sf
    from kokoro_onnx import Kokoro
    k = Kokoro(os.path.join(models, "kokoro-v1.0.onnx"), os.path.join(models, "voices-v1.0.bin"))
    chunks, sr = [], 24000
    for para in paragraphs:
        parts = re.split(r"(?<=[.?!])\s+", para.strip()) if sentence_gap else [para]
        for i, part in enumerate(parts):
            s, sr = k.create(part, voice=voice, speed=speed, lang=lang)
            chunks.append(s)
            if i < len(parts) - 1:
                chunks.append(np.zeros(int(sr * sentence_gap), dtype=s.dtype))
        chunks.append(np.zeros(int(sr * 0.6), dtype=chunks[-1].dtype))
    audio = np.concatenate(chunks)
    sf.write(out_wav, audio, sr)
    return len(audio) / sr


def encode(wav, mp3, title):
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", wav,
                    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "24000", "-ac", "1",
                    "-codec:a", "libmp3lame", "-b:a", "48k", "-id3v2_version", "3",
                    "-metadata", "title=" + title, "-metadata", "artist=아침 영어 뉴스 클럽",
                    "-metadata", "album=아침 영어 뉴스 클럽", "-metadata", "genre=Speech", mp3], check=True)


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def rebuild_index():
    days = []
    for path in sorted(glob.glob(os.path.join(DATA, "????-??-??.json")), reverse=True):
        d = read_json(path)
        days.append({"date": d["date"], "items": [
            {"id": it["id"], "section": it["section"], "icon": it.get("icon"), "ko": it.get("ko"),
             "h": {lv: v.get("headline") for lv, v in sorted(it.get("levels", {}).items())}}
            for it in d["items"]]})
    write_json(os.path.join(DATA, "index.json"),
               {"updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "days": days})
    return len(days)


def prune(today):
    cutoff = (datetime.date.fromisoformat(today) - datetime.timedelta(days=KEEP_DAYS)).isoformat()
    removed = set()
    for mp3 in glob.glob(os.path.join(AUDIO, "????-??-??-*.mp3")):
        if os.path.basename(mp3)[:10] < cutoff:
            os.remove(mp3); removed.add(os.path.basename(mp3))
    if removed:
        for path in glob.glob(os.path.join(DATA, "????-??-??.json")):
            d, changed = read_json(path), False
            for it in d["items"]:
                for v in it.get("levels", {}).values():
                    if v.get("audio") and os.path.basename(v["audio"]) in removed:
                        v["audio"] = None; changed = True
            if changed:
                write_json(path, d)
    return removed


def check_item(it, level):
    """Stop on problems that break the study screen; print warnings for the rest."""
    import re
    for k in ("slot", "headline", "ko", "p", "tr", "g", "kw"):
        if not it.get(k):
            sys.exit("missing field: " + k)
    if it["slot"] not in ORDER:
        sys.exit("slot must be one of " + ", ".join(ORDER))
    if len(it["p"]) != len(it["tr"]):
        sys.exit("p and tr must have the same number of paragraphs")
    text = " ".join(it["p"])
    low = text.lower()
    g, ph = it["g"], it.get("ph", [])
    bad = [k for k in g if k != k.lower()]
    if bad:
        sys.exit("glossary keys must be lowercase: %s" % bad)
    bad = [k for k in g if " " in k and k not in ph]
    if bad:
        sys.exit("multi-word glossary keys missing from ph: %s" % bad)
    bad = [k for k in ph if k not in g or k not in low]
    if bad:
        sys.exit("ph keys must be in g and appear in the script exactly: %s" % bad)
    miss = [k for k in g if " " not in k and not re.search(r"(?<![a-z])" + re.escape(k) + r"(s|es|d|ed)?(?![a-z])", low)]
    if miss:
        print("warning: glossary words not found in the script: %s" % miss)
    if level <= 2 and re.search(r"\b(?:[A-Z]\.){2,}|\b(?:Mr|Mrs|Ms|Dr|St|No)\.", text):
        print("warning: abbreviations with periods add pauses at levels 1-2; write the words out")
    n = len(text.split()); lo, hi = WORDS[level]
    if not lo * 0.85 <= n <= hi * 1.15:
        print("warning: level %d script has %d words (target %d-%d)" % (level, n, lo, hi))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True)
    ap.add_argument("--level", type=int, required=True, choices=LEVELS)
    ap.add_argument("--item", required=True)
    ap.add_argument("--models", default="")
    ap.add_argument("--speed", type=float, help="default: the level's speed %s" % SPEED)
    ap.add_argument("--voice", help="default: the level's voice %s" % VOICE)
    ap.add_argument("--lang", default=None, help="default: en-gb for bf_/bm_ voices, otherwise en-us")
    ap.add_argument("--wav", help="use this WAV instead of running TTS")
    ap.add_argument("--check-only", action="store_true", help="only check the item file, make nothing")
    a = ap.parse_args()
    voice = a.voice or VOICE[a.level]
    speed = a.speed or SPEED[a.level]
    lang = a.lang or ("en-gb" if voice[:1] == "b" else "en-us")

    it = read_json(a.item)
    check_item(it, a.level)
    if a.check_only:
        print("check ok"); return

    os.makedirs(DATA, exist_ok=True); os.makedirs(AUDIO, exist_ok=True)
    sid = a.date + "-" + it["slot"]
    mp3_rel = "audio/%s-L%d.mp3" % (sid, a.level)
    wav = a.wav or os.path.join("/tmp", "%s-L%d.wav" % (sid, a.level))
    if not a.wav:
        tts(it["p"], a.models, voice, speed, lang, wav, SENTENCE_GAP[a.level])
    md = a.date[5:7].lstrip("0") + "/" + a.date[8:10].lstrip("0")
    encode(wav, os.path.join(ROOT, mp3_rel), "%s %s (%d단계)" % (md, it.get("title_ko") or it["ko"], a.level))
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                os.path.join(ROOT, mp3_rel)], capture_output=True, text=True, check=True).stdout.strip())

    day_path = os.path.join(DATA, a.date + ".json")
    day = read_json(day_path) if os.path.exists(day_path) else {"date": a.date, "items": []}
    story = next((x for x in day["items"] if x["id"] == sid), None)
    if story is None:
        story = {"id": sid, "section": it["slot"][0], "levels": {}}
        day["items"].append(story)
    for k in SHARED:
        if it.get(k):
            story[k] = it[k]
    version = {k: it.get(k, [] if k == "ph" else None) for k in PER_LEVEL}
    version.update({"audio": mp3_rel, "duration": round(dur, 1), "speed": speed, "voice": voice,
                    "words": len(" ".join(it["p"]).split())})
    story.setdefault("levels", {})[str(a.level)] = version
    story["levels"] = dict(sorted(story["levels"].items()))
    day["items"].sort(key=lambda x: ORDER.get(x["id"][11:], 9))
    write_json(day_path, day)

    removed = prune(a.date)
    n = rebuild_index()
    size = os.path.getsize(os.path.join(ROOT, mp3_rel))
    have = ",".join(story["levels"].keys())
    print("ok %s L%d words=%d duration=%.1fs speed=%.2f mp3=%dKB levels=[%s] days=%d pruned=%d" % (
        sid, a.level, version["words"], dur, speed, size // 1024, have, n, len(removed)))


if __name__ == "__main__":
    main()
