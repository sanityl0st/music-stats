# backend/seed_from_files.py
import argparse
import asyncio
import os
import sys

import pandas as pd

# Allow --db-url to override DATABASE_URL BEFORE importing app.database
parser = argparse.ArgumentParser(description="Seed local SQLite or production Neon Postgres database.")
parser.add_argument("--xml", type=str, help="Path to Apple Music Library.xml")
parser.add_argument("--activity-csv", type=str, help="Path to Apple Music Play Activity.csv")
parser.add_argument("--collection-csv", type=str, help="Path to Physical Collection CSV")
parser.add_argument("--export-collection", type=str, help="Export current DB physical_items to a CSV path")
parser.add_argument("--db-url", type=str, help="Optional DATABASE_URL override (e.g. Neon Postgres URL)")
args = parser.parse_args()

if args.db_url:
    os.environ["DATABASE_URL"] = args.db_url

from app.database import Base, SessionLocal, engine
from app.main import ensure_performance_indexes, refresh_all_stats_caches_sync
from app.models import PhysicalItem
from app.services.apple_api import enrich_missing_artwork, fetch_album_by_share_url_or_id
from app.services.parser import clean_str, ingest_library_xml, ingest_play_activity_csv


def export_collection_to_csv(db, output_path: str):
    """Exports all rows in physical_items to a full-schema CSV for instant re-seeding."""
    items = db.query(PhysicalItem).order_by(PhysicalItem.id.asc()).all()
    rows = [
        {
            "artist": i.artist,
            "title": i.title,
            "format": i.format,
            "artwork_url": i.artwork_url or "",
            "apple_music_url": i.apple_music_url or "",
            "spotify_url": i.spotify_url or "",
            "tracklist_json": i.tracklist_json or "[]",
        }
        for i in items
    ]
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    pd.DataFrame(rows).to_csv(output_path, index=False)
    print(f"Exported {len(rows)} physical collection items to {output_path}")


async def seed_collection_from_csv(db, csv_path: str):
    """
    Seeds physical_items from CSV.
    Supports both:
    - Full schema: artist, title (or album), format, artwork_url, apple_music_url, spotify_url, tracklist_json
    - Minimal schema: artist, title (or album), format, share_url, collection_id (auto-fetches missing metadata)
    """
    df = pd.read_csv(csv_path)
    existing = {
        (i.artist.strip().lower(), i.title.strip().lower(), i.format.strip().upper()): i
        for i in db.query(PhysicalItem).all()
    }

    added = 0
    updated = 0

    for _, row in df.iterrows():
        artist = clean_str(row.get("artist") if "artist" in row else row.get("Artist"), "")
        title = clean_str(
            row.get("title")
            if "title" in row and pd.notna(row.get("title"))
            else (row.get("album") if "album" in row else row.get("Title")),
            "",
        )
        fmt = clean_str(row.get("format") if "format" in row else row.get("Format"), "VINYL").upper()
        share_url = clean_str(row.get("share_url"), "") or None
        collection_id = clean_str(row.get("collection_id"), "") or None

        artwork_url = clean_str(row.get("artwork_url"), "")
        apple_music_url = clean_str(row.get("apple_music_url"), "")
        spotify_url = clean_str(row.get("spotify_url"), "")
        tracklist_json = clean_str(row.get("tracklist_json"), "")

        if not artist and not title and not share_url:
            continue

        key = (artist.lower(), title.lower(), fmt)

        # Fast path: CSV already has pre-enriched artwork & tracklist! Zero API calls needed.
        if artwork_url and tracklist_json and tracklist_json != "[]":
            meta = {
                "artist": artist,
                "title": title,
                "artwork_url": artwork_url,
                "apple_music_url": apple_music_url or "https://music.apple.com",
                "spotify_url": spotify_url or f"https://open.spotify.com/search/{artist}%20{title}",
                "tracklist_json": tracklist_json,
            }
        else:
            # Slow path fallback: Fetch missing artwork & tracklist from iTunes/Deezer API
            print(f"Fetching metadata from API for: {artist} - {title} ({fmt})...")
            meta = await fetch_album_by_share_url_or_id(
                share_url=share_url,
                collection_id=collection_id,
                artist=artist,
                title=title,
            )
            # Keep any existing non-empty fields from CSV if API missed them
            if artwork_url and not meta.get("artwork_url"):
                meta["artwork_url"] = artwork_url

        if key in existing:
            item = existing[key]
            item.artwork_url = meta.get("artwork_url") or item.artwork_url
            item.apple_music_url = meta.get("apple_music_url") or item.apple_music_url
            item.spotify_url = meta.get("spotify_url") or item.spotify_url
            if meta.get("tracklist_json") and meta.get("tracklist_json") != "[]":
                item.tracklist_json = meta["tracklist_json"]
            updated += 1
        else:
            item = PhysicalItem(format=fmt, **meta)
            db.add(item)
            existing[key] = item
            added += 1

    db.commit()
    print(f"Collection CSV Result: {{'added': {added}, 'updated': {updated}}}")


async def run():
    Base.metadata.create_all(bind=engine)
    ensure_performance_indexes()

    if args.export_collection:
        db = SessionLocal()
        try:
            export_collection_to_csv(db, args.export_collection)
        finally:
            db.close()
        return

    # Step 1: Ingest Library.xml
    if args.xml and os.path.exists(args.xml):
        print(f"Ingesting Library.xml from {args.xml}...")
        db = SessionLocal()
        try:
            with open(args.xml, "rb") as f:
                res = ingest_library_xml(db, f.read())
            print("XML Result:", res)
        finally:
            db.close()

    # Step 2: Ingest Play Activity CSV
    if args.activity_csv and os.path.exists(args.activity_csv):
        print(f"Ingesting Apple Music Play Activity.csv from {args.activity_csv}...")
        db = SessionLocal()
        try:
            with open(args.activity_csv, "rb") as f:
                res = ingest_play_activity_csv(db, f)
            print("Play Activity CSV Result:", res)
        finally:
            db.close()

    # Step 3: Enrich Artwork across All-Time, Monthly, Weekly, and Recent Streams
    if args.xml or args.activity_csv:
        print("Enriching top albums & artists across all timeframes and recent streams...")
        db = SessionLocal()
        try:
            art_res = await enrich_missing_artwork(db, limit=80)
            print("Artwork Enrichment Result:", art_res)
        finally:
            db.close()

    # Step 4: Seed Physical Collection CSV
    if args.collection_csv and os.path.exists(args.collection_csv):
        print(f"Seeding physical collection from {args.collection_csv}...")
        db = SessionLocal()
        try:
            await seed_collection_from_csv(db, args.collection_csv)
        finally:
            db.close()

    # Step 5: Pre-warm the AppCache for 'all', 'month', and 'week'
    if args.xml or args.activity_csv:
        print("Pre-warming stats overview cache for all timeframes (all, month, week)...")
        refresh_all_stats_caches_sync()
        print("All timeframe caches pre-warmed!")


if __name__ == "__main__":
    asyncio.run(run())