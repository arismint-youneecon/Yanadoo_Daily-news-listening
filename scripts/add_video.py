#!/usr/bin/env python3
"""Add today's video (오늘의 뽀로로) to the site: writes "video" into data/<date>.json and rebuilds data/index.json.

Usually scripts/pick_video.py chooses the video and calls this. To set one by hand:
  python3 scripts/add_video.py --date 2026-11-08 --id VIDEO_ID --title "Episode title" [--series "Season 2"] [--length 5:08]

Only the video id, title and link are stored. The app embeds the official YouTube player; captions come from YouTube.
"""
import argparse, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from add_briefing import DATA, read_json, write_json, rebuild_index  # noqa: E402

CHANNEL = "Pororo the Little Penguin"


def used_videos():
    """{video id: last date it was used}"""
    used = {}
    for name in sorted(os.listdir(DATA)):
        if re.match(r"\d{4}-\d{2}-\d{2}\.json$", name):
            v = read_json(os.path.join(DATA, name)).get("video")
            if v:
                used[v["id"]] = name[:10]
    return used


def day_video(date):
    path = os.path.join(DATA, date + ".json")
    return read_json(path).get("video") if os.path.exists(path) else None


def add(date, vid, title, series=None, length=None, published=None, allow_repeat=False):
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", vid):
        sys.exit("video id must be the 11-character YouTube id")
    day_path = os.path.join(DATA, date + ".json")
    day = read_json(day_path) if os.path.exists(day_path) else {"date": date, "items": []}
    if not allow_repeat and (day.get("video") or {}).get("id") != vid and vid in used_videos():
        sys.exit("this video was already used on another day; pick another or pass --allow-repeat")
    v = {"id": vid, "title": title.strip(), "url": "https://www.youtube.com/watch?v=" + vid, "channel": CHANNEL}
    if series:
        v["series"] = series
    if length:
        v["length"] = length
    if published:
        v["published"] = published
    day["video"] = v
    write_json(day_path, day)
    n = rebuild_index()
    print("ok video %s %s %s days=%d" % (date, vid, json.dumps(v["title"], ensure_ascii=False), n))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--series")
    ap.add_argument("--length")
    ap.add_argument("--published")
    ap.add_argument("--allow-repeat", action="store_true")
    a = ap.parse_args()
    add(a.date, a.id, a.title, a.series, a.length, a.published, a.allow_repeat)


if __name__ == "__main__":
    main()
