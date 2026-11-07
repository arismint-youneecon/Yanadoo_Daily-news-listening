#!/usr/bin/env python3
"""Pick today's 오늘의 뽀로로 from the official "Pororo the Little Penguin" English channel and add it to the site.

  python3 scripts/pick_video.py --date 2026-11-08            # pick and save
  python3 scripts/pick_video.py --date 2026-11-08 --dry-run  # only show the candidates

Order: a new single episode on the channel (3-15 minutes) first, then the Season 2 playlist (5-minute episodes,
from the first one), then Season 8 (12-minute episodes, #1 onward). Songs, Shorts and 1-3 hour compilations are
skipped, and so is any video already used on another day. When every episode has been used, the one used
longest ago comes back. Each pick is checked with YouTube's oEmbed, which answers only for videos that can be
played inside other sites (our app).

Exit codes: 0 ok (prints "ok video ..."), 3 YouTube could not be reached or nothing usable was found.
Only the id, title and link are stored; subtitles and dialogue are never copied.
"""
import argparse, json, os, re, subprocess, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from add_video import add, day_video, used_videos  # noqa: E402

CHANNEL_ID = "UCAmia3u27mHY-Y6c-lwakAQ"
VIDEOS_PAGE = "https://www.youtube.com/@PororoEnglish/videos"
PLAYLISTS = [  # (playlist id, series label, order)
    ("PLif0g7abcI4d-8QAnktCaVWrfhKGQ_a4l", "Season 2", "oldest-first"),
    ("PLif0g7abcI4fDljtQNqJWD6gpUYbKSEd0", "Season 8", "episode-number"),
]
MIN_S, MAX_S = 180, 900
SKIP = re.compile(r"#shorts|compilation|collection|full episodes|non-?stop|marathon|\bhours?\b|-hour|\b\d+\s*h\b|"
                  r"\b\d+\s*min\b|nursery rhymes|\bsongs?\b|opening|ending|best animation|\bmovie\b|playlist", re.I)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def fetch(url):
    r = subprocess.run(["curl", "-sS", "-L", "--max-time", "30", "-A", UA, "-H", "Accept-Language: en-US,en;q=0.8",
                        "-w", "\n%{http_code}", url], capture_output=True, text=True)
    if r.returncode != 0:
        raise OSError(r.stderr.strip() or "curl failed")
    body, _, code = r.stdout.rpartition("\n")
    return int(code), body


def initial_data(html):
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", html, re.S)
    if not m:
        raise ValueError("page has no ytInitialData (blocked or changed)")
    return json.loads(m.group(1))


def seconds(text):
    if not text or not re.fullmatch(r"\d+(:\d{2}){1,2}", text):
        return None
    s = 0
    for part in text.split(":"):
        s = s * 60 + int(part)
    return s


def lockups(data):
    """Every video tile on a channel or playlist page: [{id, raw, length, s}] in page order."""
    out = []

    def walk(o):
        if isinstance(o, dict):
            lv = o.get("lockupViewModel")
            if lv and lv.get("contentType", "LOCKUP_CONTENT_TYPE_VIDEO") == "LOCKUP_CONTENT_TYPE_VIDEO" and lv.get("contentId"):
                title = lv.get("metadata", {}).get("lockupMetadataViewModel", {}).get("title", {}).get("content", "")
                length = ""
                for ov in lv.get("contentImage", {}).get("thumbnailViewModel", {}).get("overlays", []):
                    for b in ov.get("thumbnailBottomOverlayViewModel", {}).get("badges", []):
                        length = b.get("thumbnailBadgeViewModel", {}).get("text", length)
                out.append({"id": lv["contentId"], "raw": title, "length": length, "s": seconds(length)})
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for x in o:
                walk(x)

    walk(data)
    return out


def clean(raw, series=None):
    """'I Am Not a Bed Wetter | Pororo Season2 [4K] | ...' -> ('I Am Not a Bed Wetter', 'Season 2')
    'Pororo Season 8 | #23 Loopy, Are You Okay? | ...' -> ('Loopy, Are You Okay?', 'Season 8 · #23')"""
    parts = [p.strip() for p in raw.split("|") if p.strip()]
    m = re.search(r"season\s*(\d+)", raw, re.I)
    series = series or (("Season " + m.group(1)) if m else None)
    title = parts[0] if parts else raw
    if re.fullmatch(r"pororo\s+season\s*\d+.*", title, re.I) and len(parts) > 1:
        title = parts[1]
    ep = re.match(r"#\s*(\d+)\s+(.*)", title)
    if ep:
        title = ep.group(2)
        series = (series + " · " if series else "") + "#" + ep.group(1)
    title = re.sub(r"[\U0001F000-\U0001FAFF☀-➿️]+", "", title).strip(" -·")
    return title or raw, series


def episode_no(raw):
    m = re.search(r"#\s*(\d+)", raw)
    return int(m.group(1)) if m else 999


def usable(t):
    return t["s"] is not None and MIN_S <= t["s"] <= MAX_S and not SKIP.search(t["raw"])


def candidates():
    """Candidates in pick order, plus a list of pages that failed."""
    out, failed, seen = [], [], set()

    def push(t, series=None):
        if t["id"] not in seen and usable(t):
            seen.add(t["id"])
            title, ser = clean(t["raw"], series)
            out.append(dict(t, title=title, series=ser))

    try:
        code, html = fetch(VIDEOS_PAGE)
        if code != 200:
            raise OSError("HTTP %d" % code)
        for t in lockups(initial_data(html)):  # newest first
            if re.search(r"episode|season", t["raw"], re.I):
                push(t)
    except Exception as e:  # noqa: BLE001
        failed.append("videos page: %s" % e)
    for pid, label, order in PLAYLISTS:
        try:
            code, html = fetch("https://www.youtube.com/playlist?list=" + pid)
            if code != 200:
                raise OSError("HTTP %d" % code)
            tiles = lockups(initial_data(html))
            if order == "oldest-first":
                tiles = list(reversed(tiles))
            else:
                tiles = sorted(tiles, key=lambda t: episode_no(t["raw"]))
            for t in tiles:
                push(t, label)
        except Exception as e:  # noqa: BLE001
            failed.append("%s playlist: %s" % (label, e))
    return out, failed


def embeddable(vid):
    url = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote("https://www.youtube.com/watch?v=" + vid, safe="")
    try:
        code, body = fetch(url)
        return code == 200 and json.loads(body).get("author_url", "").lower().endswith("/@pororoenglish")
    except Exception:  # noqa: BLE001
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--replace", action="store_true", help="pick again even if this date already has a video")
    a = ap.parse_args()

    have = day_video(a.date)
    if have and not a.replace and not a.dry_run:
        print("ok video %s %s (already set, kept)" % (a.date, have["id"]))
        return

    cands, failed = candidates()
    for f in failed:
        print("warn:", f, file=sys.stderr)
    used = used_videos()
    if have:
        used.pop(have["id"], None)
    if a.dry_run:
        for c in cands:
            print("%s %-6s %-16s %s%s" % (c["id"], c["length"], c["series"] or "", c["title"],
                                          ("  (used " + used[c["id"]] + ")") if c["id"] in used else ""))
        print("candidates=%d unused=%d" % (len(cands), sum(c["id"] not in used for c in cands)))
        return
    if not cands:
        sys.exit(print("error: no candidates; YouTube could not be reached or its pages changed: " + "; ".join(failed), file=sys.stderr) or 3)

    fresh = [c for c in cands if c["id"] not in used]
    repeat = sorted((c for c in cands if c["id"] in used), key=lambda c: used[c["id"]])  # used longest ago first
    for c, again in [(c, False) for c in fresh] + [(c, True) for c in repeat]:
        if embeddable(c["id"]):
            add(a.date, c["id"], c["title"], c["series"], c["length"], None, allow_repeat=again)
            return
        print("warn: %s cannot be played inside other sites, skipped" % c["id"], file=sys.stderr)
    sys.exit(print("error: none of %d candidates can be embedded" % len(cands), file=sys.stderr) or 3)


if __name__ == "__main__":
    main()
