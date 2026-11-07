#!/usr/bin/env python3
"""Add today's video (오늘의 뽀로로) to the site: writes "video" into data/<date>.json and rebuilds data/index.json.

Usage:
  python3 scripts/add_video.py --date 2026-11-08 --id VIDEO_ID --title "Episode title" [--published 2026-11-05T09:00:00+00:00]

Only the video id, title and link are stored. The app embeds the official YouTube player; captions come from YouTube.
"""
import argparse, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from add_briefing import DATA, read_json, write_json, rebuild_index  # noqa: E402

CHANNEL = "Pororo the Little Penguin"


def used_ids():
    ids = set()
    for name in os.listdir(DATA):
        if re.match(r"\d{4}-\d{2}-\d{2}\.json$", name):
            v = read_json(os.path.join(DATA, name)).get("video")
            if v:
                ids.add(v["id"])
    return ids


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--published")
    ap.add_argument("--allow-repeat", action="store_true")
    a = ap.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", a.id):
        sys.exit("video id must be the 11-character YouTube id")
    day_path = os.path.join(DATA, a.date + ".json")
    day = read_json(day_path) if os.path.exists(day_path) else {"date": a.date, "items": []}
    if not a.allow_repeat and (day.get("video") or {}).get("id") != a.id and a.id in used_ids():
        sys.exit("this video was already used on another day; pick another or pass --allow-repeat")
    day["video"] = {"id": a.id, "title": a.title.strip(), "url": "https://www.youtube.com/watch?v=" + a.id,
                    "channel": CHANNEL, "published": a.published}
    write_json(day_path, day)
    n = rebuild_index()
    print("ok video %s %s days=%d" % (a.date, a.id, n))


if __name__ == "__main__":
    main()
