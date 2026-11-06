# backend/app/main.py
import json
import random
from datetime import datetime, timedelta
from fastapi import FastAPI, Depends, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from .database import engine, Base, get_db
from .models import Artist, Album, Track, StreamHistory, PhysicalItem
from .services.parser import ingest_library_xml, ingest_play_activity_csv, get_or_create_entities
from .services.apple_api import enrich_missing_artwork, fetch_album_metadata_and_tracks
from enum import Enum
import os
from fastapi import Header
from .services.parser import ingest_library_xml, ingest_play_activity_csv, ingest_spotify_json, get_or_create_entities

# Defaults to empty string locally (unlocked for easy local use); set ADMIN_SECRET in production!
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "")

def verify_admin(x_admin_key: str = Header(default="")):
    if ADMIN_SECRET and x_admin_key != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Invalid or missing Admin Key. Read-only mode active.")

class TimeFrame(str, Enum):
    all = "all"
    month = "month"
    week = "week"

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Vinyl Stats API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class PhysicalItemCreate(BaseModel):
    artist: str
    title: str
    format: str  # "VINYL", "CD", or "CASSETTE"

@app.post("/api/sync/upload-xml")
async def upload_library_xml(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename.endswith(".xml"):
        raise HTTPException(status_code=400, detail="Please upload an Apple Music Library.xml file")
    content = await file.read()
    res = ingest_library_xml(db, content)
    await enrich_missing_artwork(db, limit=25)
    return res

@app.post("/api/sync/upload-csv")
async def upload_activity_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload Apple Music Play Activity.csv")
    res = ingest_play_activity_csv(db, file.file)
    await enrich_missing_artwork(db, limit=25)
    return res

@app.post("/api/sync/seed-mock")
async def seed_mock_data(db: Session = Depends(get_db)):
    """Seeds sample listening history across the past 45 days + physical shelf items."""
    sample_catalog = [
        ("Lil Uzi Vert", "Eternal Atake", "Baby Pluto", 210000),
        ("Daft Punk", "Random Access Memories", "Giorgio by Moroder", 544000),
        ("Kendrick Lamar", "good kid, m.A.A.d city", "Money Trees", 386000),
        ("Tame Impala", "Currents", "Let It Happen", 467000),
        ("Frank Ocean", "Blonde", "Nights", 307000),
        ("Radiohead", "In Rainbows", "Weird Fishes/ Arpeggi", 318000),
        ("Tyler, The Creator", "IGOR", "EARFQUAKE", 190000),
        ("Deftones", "White Pony", "Change (In the House of Flies)", 300000),
    ]

    tracks = []
    for artist_name, album_title, track_title, duration_ms in sample_catalog:
        _, _, track = get_or_create_entities(db, artist_name, album_title, track_title, duration_ms)
        tracks.append(track)

    now = datetime.utcnow()
    added = 0
    for i in range(300):
        t = random.choice(tracks)
        played_at = now - timedelta(hours=i * 3, minutes=random.randint(1, 50))
        exists = db.query(StreamHistory).filter_by(track_id=t.id, played_at=played_at).first()
        if not exists:
            db.add(StreamHistory(
                track_id=t.id,
                played_at=played_at,
                duration_played_ms=t.duration_ms,
                end_reason="NATURAL_END_OF_TRACK",
                source="MOCK_SEED"
            ))
            added += 1

    db.commit()
    art_res = await enrich_missing_artwork(db, limit=20)

    # Seed initial physical shelf items if empty
    if db.query(func.count(PhysicalItem.id)).scalar() == 0:
        starter_shelf = [
            ("Lil Uzi Vert", "Eternal Atake", "VINYL"),
            ("Daft Punk", "Discovery", "VINYL"),
            ("Deftones", "Around the Fur", "CD"),
            ("Radiohead", "OK Computer", "CD"),
            ("MF DOOM", "MM..FOOD", "CASSETTE"),
            ("Kendrick Lamar", "DAMN.", "VINYL"),
        ]
        for artist, title, fmt in starter_shelf:
            meta = await fetch_album_metadata_and_tracks(artist, title)
            db.add(PhysicalItem(format=fmt, **meta))
        db.commit()

    return {"status": "seeded", "mock_streams_added": added, **art_res}

@app.get("/api/stats/overview")
def get_stats_overview(
    timeframe: TimeFrame = TimeFrame.all,
    db: Session = Depends(get_db)
):
    """Returns stats filtered by timeframe: 'all', 'month' (last 30d), or 'week' (last 7d)."""
    stream_count = db.query(func.count(StreamHistory.id)).scalar() or 0
    use_streams = stream_count > 0

    cutoff = None
    if timeframe == "week":
        cutoff = datetime.utcnow() - timedelta(days=7)
    elif timeframe == "month":
        cutoff = datetime.utcnow() - timedelta(days=30)

    stream_filter = [StreamHistory.played_at >= cutoff] if (use_streams and cutoff) else []

    if use_streams:
        total_ms = db.query(func.sum(StreamHistory.duration_played_ms)).filter(*stream_filter).scalar() or 0
        filtered_streams = db.query(func.count(StreamHistory.id)).filter(*stream_filter).scalar() or 0
    else:
        total_ms = db.query(func.sum(Track.duration_ms * Track.library_play_count)).scalar() or 0
        filtered_streams = 0

    play_metric = func.count(StreamHistory.id) if use_streams else func.sum(Track.library_play_count)
    time_metric = func.sum(StreamHistory.duration_played_ms) if use_streams else func.sum(Track.duration_ms * Track.library_play_count)

    # Top Artists
    artist_q = db.query(
        Artist.id, Artist.name, Artist.artwork_url,
        play_metric.label("play_count"), time_metric.label("total_ms")
    ).join(Track, Track.artist_id == Artist.id)
    if use_streams:
        artist_q = artist_q.join(StreamHistory, StreamHistory.track_id == Track.id).filter(*stream_filter)
    top_artists = artist_q.group_by(Artist.id).order_by(desc("total_ms")).limit(15).all()

    # Top Albums
    album_q = db.query(
        Album.id, Album.title, Album.artwork_url, Artist.name.label("artist_name"),
        play_metric.label("play_count"), time_metric.label("total_ms")
    ).join(Artist, Album.artist_id == Artist.id).join(Track, Track.album_id == Album.id)
    if use_streams:
        album_q = album_q.join(StreamHistory, StreamHistory.track_id == Track.id).filter(*stream_filter)
    top_albums = album_q.group_by(Album.id, Artist.name).order_by(desc("total_ms")).limit(15).all()

    # Top Tracks
    track_q = db.query(
        Track.id, Track.title, Artist.name.label("artist_name"),
        Album.title.label("album_title"), Album.artwork_url,
        play_metric.label("play_count"), time_metric.label("total_ms")
    ).join(Artist, Track.artist_id == Artist.id).outerjoin(Album, Track.album_id == Album.id)
    if use_streams:
        track_q = track_q.join(StreamHistory, StreamHistory.track_id == Track.id).filter(*stream_filter)
    top_tracks = track_q.group_by(Track.id, Artist.name, Album.title, Album.artwork_url).order_by(desc("total_ms")).limit(20).all()

    # Recent Streams Log
    recent_q = (
        db.query(StreamHistory, Track, Artist, Album)
        .join(Track, StreamHistory.track_id == Track.id)
        .join(Artist, Track.artist_id == Artist.id)
        .outerjoin(Album, Track.album_id == Album.id)
        .order_by(desc(StreamHistory.played_at))
        .limit(25)
        .all()
    )

    return {
        "timeframe": timeframe,
        "total_streams": filtered_streams,
        "total_minutes_listened": round(total_ms / 60000, 1),
        "total_hours_listened": round(total_ms / 3600000, 1),
        "total_artists": db.query(func.count(Artist.id)).scalar() or 0,
        "total_albums": db.query(func.count(Album.id)).scalar() or 0,
        "total_tracks": db.query(func.count(Track.id)).scalar() or 0,
        "top_artists": [
            {"id": a.id, "name": a.name, "artwork_url": a.artwork_url, "play_count": a.play_count or 0, "minutes": round((a.total_ms or 0) / 60000, 1)}
            for a in top_artists
        ],
        "top_albums": [
            {"id": al.id, "title": al.title, "artist": al.artist_name, "artwork_url": al.artwork_url, "play_count": al.play_count or 0, "minutes": round((al.total_ms or 0) / 60000, 1)}
            for al in top_albums
        ],
        "top_tracks": [
            {"id": t.id, "title": t.title, "artist": t.artist_name, "album": t.album_title, "artwork_url": t.artwork_url, "play_count": t.play_count or 0, "minutes": round((t.total_ms or 0) / 60000, 1)}
            for t in top_tracks
        ],
        "recent_streams": [
            {
                "id": sh.id,
                "track": tr.title,
                "artist": ar.name,
                "album": al.title if al else "Single",
                "artwork_url": al.artwork_url if al else None,
                "played_at": sh.played_at.isoformat()
            }
            for sh, tr, ar, al in recent_q
        ]
    }

# --- PHYSICAL COLLECTION ENDPOINTS ---

@app.get("/api/collection")
def get_physical_collection(db: Session = Depends(get_db)):
    items = db.query(PhysicalItem).order_by(PhysicalItem.title.asc()).all()
    return [
        {
            "id": item.id,
            "title": item.title,
            "artist": item.artist,
            "format": item.format,
            "artwork_url": item.artwork_url,
            "apple_music_url": item.apple_music_url,
            "spotify_url": item.spotify_url,
            "tracks": json.loads(item.tracklist_json or "[]"),
        }
        for item in items
    ]

@app.post("/api/collection", dependencies=[Depends(verify_admin)])
async def add_physical_item(payload: PhysicalItemCreate, db: Session = Depends(get_db)):
    meta = await fetch_album_metadata_and_tracks(payload.artist, payload.title)
    item = PhysicalItem(format=payload.format.upper(), **meta)
    db.add(item)
    db.commit()
    db.refresh(item)
    return {
        "id": item.id,
        "title": item.title,
        "artist": item.artist,
        "format": item.format,
        "artwork_url": item.artwork_url,
        "apple_music_url": item.apple_music_url,
        "spotify_url": item.spotify_url,
        "tracks": json.loads(item.tracklist_json or "[]"),
    }

@app.delete("/api/collection/{item_id}", dependencies=[Depends(verify_admin)])
def delete_physical_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(PhysicalItem).filter(PhysicalItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()
    return {"status": "deleted"}

# backend/app/main.py (Append to the bottom of the file)

@app.post("/api/collection/seed-bulk")
def seed_bulk_collection(count: int = 220, db: Session = Depends(get_db)):
    """Instantly seeds 220+ physical items to stress-test infinite 3D shelf scrolling."""
    base_catalog = [
        ("Lil Uzi Vert", "Eternal Atake", "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/8c/31/6d/8c316d0b-8b9f-9a25-4c9a-3f5c4176158b/20UMGIM15985.rgb.jpg/1000x1000bb.jpg"),
        ("Daft Punk", "Random Access Memories", "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/e2/62/f8/e262f8c7-6273-4f88-b6a5-61096a95b37f/886443919266.jpg/1000x1000bb.jpg"),
        ("Kendrick Lamar", "good kid, m.A.A.d city", "https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/ca/5b/c0/ca5bc0b3-d8b6-96c6-7223-a0d6a4c288d0/12UMGIM52990.rgb.jpg/1000x1000bb.jpg"),
        ("Tame Impala", "Currents", "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/f6/97/2a/f6972a5d-074a-9f88-5891-4d4a6539c113/15UMGIM23312.rgb.jpg/1000x1000bb.jpg"),
        ("Frank Ocean", "Blonde", "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/c9/95/57/c9955727-79fb-2970-7646-32e1d57407f9/859718120285_cover.jpg/1000x1000bb.jpg"),
        ("Radiohead", "In Rainbows", "https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/dd/50/c7/dd50c790-99b3-c32c-414b-a132c9674736/634904032463.png/1000x1000bb.jpg"),
        ("Tyler, The Creator", "IGOR", "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/0c/f2/d0/0cf2d054-0b82-6c7b-3992-215d87e229a5/886447710180.jpg/1000x1000bb.jpg"),
        ("Deftones", "White Pony", "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/a7/1b/49/a71b490c-0c4a-9452-24b4-093653780388/093624917397.jpg/1000x1000bb.jpg"),
        ("MF DOOM", "MM..FOOD", "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/0a/87/2d/0a872d77-633c-3849-5f7e-32e3c825e188/826257005121.jpg/1000x1000bb.jpg"),
        ("Fleetwood Mac", "Rumours", "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/4b/15/36/4b1536a7-71a4-7389-2437-d4e023309d30/081227970949.jpg/1000x1000bb.jpg"),
        ("Pink Floyd", "The Dark Side of the Moon", "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/3c/74/05/3c7405d1-3428-9287-a759-b6d4a269a063/886445635829.jpg/1000x1000bb.jpg"),
        ("The Strokes", "Is This It", "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/5f/4f/4e/5f4f4e4a-8c80-3a2c-414b-1645727d8d0a/078636804521.jpg/1000x1000bb.jpg"),
    ]
    formats = ["VINYL", "CD", "CASSETTE"]
    editions = ["", " (Deluxe Edition)", " (Remastered)", " (Collector's Pressing)", " (Japan Import)", " (Anniversary LP)"]

    sample_tracks = json.dumps([
        {"number": 1, "title": "Intro / Side A Opening", "duration": "3:18"},
        {"number": 2, "title": "Midnight Signal", "duration": "4:12"},
        {"number": 3, "title": "Analog Dreams", "duration": "5:04"},
        {"number": 4, "title": "Subspace Resonance", "duration": "3:49"},
        {"number": 5, "title": "Side B Finale", "duration": "6:22"},
    ])

    new_items = []
    for i in range(count):
        artist, title, art_url = base_catalog[i % len(base_catalog)]
        edition = editions[(i // len(base_catalog)) % len(editions)]
        fmt = formats[i % len(formats)]
        full_title = f"{title}{edition} #{i + 1}"

        new_items.append(
            PhysicalItem(
                artist=artist,
                title=full_title,
                format=fmt,
                artwork_url=art_url,
                apple_music_url="https://music.apple.com",
                spotify_url="https://open.spotify.com",
                tracklist_json=sample_tracks,
            )
        )

    db.bulk_save_objects(new_items)
    db.commit()
    total = db.query(func.count(PhysicalItem.id)).scalar() or 0
    return {"status": "bulk_seeded", "added": count, "total_in_collection": total}

@app.delete("/api/collection/clear/all")
def clear_entire_collection(db: Session = Depends(get_db)):
    """Clears the shelf so you can reset after stress testing."""
    db.query(PhysicalItem).delete()
    db.commit()
    return {"status": "cleared"}


@app.post("/api/sync/upload", dependencies=[Depends(verify_admin)])
async def unified_sync_upload(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """User-friendly auto-detecting importer for Apple Music (.xml, .csv) and Spotify (.json)."""
    filename = (file.filename or "").lower()
    if filename.endswith(".xml"):
        content = await file.read()
        res = ingest_library_xml(db, content)
    elif filename.endswith(".csv"):
        res = ingest_play_activity_csv(db, file.file)
    elif filename.endswith(".json"):
        content = await file.read()
        res = ingest_spotify_json(db, content)
    else:
        raise HTTPException(status_code=400, detail="Unsupported file. Drop an Apple (.csv/.xml) or Spotify (.json) file.")

    # Automatically fetch high-res cover art for newly imported albums
    art = await enrich_missing_artwork(db, limit=30)
    return {**res, **art}