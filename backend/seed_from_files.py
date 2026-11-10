# backend/seed_from_files.py
import os
import sys
import argparse
import asyncio
import pandas as pd

# 1. Parse arguments FIRST before importing app modules so --db-url overrides DATABASE_URL
parser = argparse.ArgumentParser(description="Seed music stats and collection from local files.")
parser.add_argument("--xml", type=str, help="Path to Apple Music Library.xml")
parser.add_argument("--activity-csv", type=str, help="Path to Apple Music Play Activity.csv")
parser.add_argument("--collection-csv", type=str, help="Path to physical collection CSV (artist,album,format)")
parser.add_argument("--db-url", type=str, help="Optional Neon Postgres URL override")
args = parser.parse_args()

if args.db_url:
    os.environ["DATABASE_URL"] = args.db_url

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy.orm import Session
from app.database import SessionLocal, engine, Base
from app.models import PhysicalItem
from app.services.parser import ingest_library_xml, ingest_play_activity_csv
from app.services.apple_api import fetch_album_metadata_and_tracks, enrich_missing_artwork


async def seed_collection_from_csv(db: Session, csv_path: str):
    print(f"Reading physical collection CSV from {csv_path}...")
    df = pd.read_csv(csv_path)
    df.columns = [c.strip().lower() for c in df.columns]

    artist_col = next((c for c in df.columns if "artist" in c), None)
    title_col = next((c for c in df.columns if "title" in c or "album" in c or "song" in c), None)
    format_col = next((c for c in df.columns if "format" in c or "media" in c or "type" in c), None)

    if not artist_col or not title_col:
        raise ValueError(f"CSV must contain Artist and Album columns. Found: {list(df.columns)}")

    added_count = 0
    for _, row in df.iterrows():
        artist = str(row[artist_col]).strip()
        title = str(row[title_col]).strip()
        fmt = str(row[format_col]).strip().upper() if format_col and pd.notna(row[format_col]) else "VINYL"
        if fmt not in ["VINYL", "CD", "CASSETTE"]:
            fmt = "VINYL"
        if not artist or artist == "nan" or not title or title == "nan":
            continue

        existing = db.query(PhysicalItem).filter_by(artist=artist, title=title, format=fmt).first()
        if existing:
            print(f"Skipping (already exists): {artist} - {title} ({fmt})")
            continue

        print(f"Fetching cover & tracklist for: {artist} - {title} [{fmt}]...")
        meta = await fetch_album_metadata_and_tracks(artist, title)
        db.add(PhysicalItem(format=fmt, **meta))
        db.commit()
        added_count += 1

    print(f"Added {added_count} new items to your 3D collection shelf!")

async def run():
    Base.metadata.create_all(bind=engine)

    # Step 1: Ingest XML
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

    # Step 3: Enrich Artwork in its own session
    if args.xml or args.activity_csv:
        print("Enriching top 80 most-played albums & artists with high-res artwork...")
        db = SessionLocal()
        try:
            art_res = await enrich_missing_artwork(db, limit=80)
            print("Artwork Enrichment Result:", art_res)
        finally:
            db.close()

    # Step 4: Seed Physical Collection CSV
    if args.collection_csv and os.path.exists(args.collection_csv):
        db = SessionLocal()
        try:
            await seed_collection_from_csv(db, args.collection_csv)
        finally:
            db.close()

    if not args.xml and not args.activity_csv and not args.collection_csv:
        print("No files provided. Use --help to see available arguments.")
        
        
    print("Pre-warming stats overview cache for all timeframes (all, month, week)...")
    from app.main import ensure_performance_indexes, refresh_all_stats_caches_sync
    ensure_performance_indexes()
    refresh_all_stats_caches_sync()
    print("All timeframe caches pre-warmed!")


if __name__ == "__main__":
    asyncio.run(run())