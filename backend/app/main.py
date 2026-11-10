import asyncio
import json
import os
import secrets
import threading
from datetime import datetime, timedelta
from enum import Enum

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Security, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security.api_key import APIKeyHeader
from pydantic import BaseModel
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine, get_db
from .models import Album, AppCache, Artist, PhysicalItem, StreamHistory, Track
from .services.apple_api import (
    enrich_missing_artwork,
    fetch_album_by_share_url_or_id,
    search_catalog_suggestions,
)
from .services.parser import (
    ingest_library_xml,
    ingest_play_activity_csv,
    ingest_spotify_json,
)


class PhysicalItemCreate(BaseModel):
    artist: str = ""
    title: str = ""
    format: str  # "VINYL", "CD", or "CASSETTE"
    share_url: str | None = None
    collection_id: str | None = None


class TimeFrame(str, Enum):
    all = "all"
    month = "month"
    week = "week"


# Defaults to empty string locally (unlocked for easy local dev); set ADMIN_SECRET in production!
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "")
api_key_header = APIKeyHeader(name="X-Admin-Key", auto_error=False)

# Non-blocking lock so background cache refreshes never collide
_cache_refresh_lock = threading.Lock()


def verify_admin(x_admin_key: str | None = Security(api_key_header)):
    """Verifies the admin key without hanging if missing."""
    if ADMIN_SECRET:
        if not x_admin_key or not secrets.compare_digest(x_admin_key, ADMIN_SECRET):
            raise HTTPException(
                status_code=403,
                detail="Unauthorized: Invalid or missing Admin Key.",
            )
    return True


Base.metadata.create_all(bind=engine)

app = FastAPI(title="Vinyl Stats API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://music-stats-six.vercel.app/",  # <--- Add your exact Vercel frontend URL here
        "https://music-stats-6cch.onrender.com",
        "https://www.stevie-moosic.com/",
        os.getenv("FRONTEND_URL", "*")
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

from decimal import Decimal

def serialize_stats(data: dict) -> str:
    """Recursively converts Decimals to floats/ints so json.dumps never fails on Postgres."""
    def default_encoder(obj):
        if isinstance(obj, Decimal):
            return float(obj)
        raise TypeError(f"Object of type {type(obj)} is not JSON serializable")
    return json.dumps(data, default=default_encoder)

def ensure_performance_indexes():
    """Creates SQL indexes on SQLite/Postgres tables so 60k+ row aggregations run in milliseconds."""
    with engine.begin() as conn:
        for stmt in [
            "CREATE INDEX IF NOT EXISTS ix_sh_played_at ON stream_history (played_at)",
            "CREATE INDEX IF NOT EXISTS ix_sh_track_played ON stream_history (track_id, played_at)",
            "CREATE INDEX IF NOT EXISTS ix_tracks_artist_id ON tracks (artist_id)",
            "CREATE INDEX IF NOT EXISTS ix_tracks_album_id ON tracks (album_id)",
            "CREATE INDEX IF NOT EXISTS ix_albums_artist_id ON albums (artist_id)",
        ]:
            try:
                conn.exec_driver_sql(stmt)
            except Exception:
                pass


def compute_overview_stats(timeframe: TimeFrame | str, db: Session) -> dict:
    """
    Fast subquery-aggregated stats calculation.
    Aggregates integer track_ids first before joining string metadata,
    and falls back to artist artwork whenever album artwork is missing.
    """
    tf_str = timeframe.value if hasattr(timeframe, "value") else str(timeframe)

    latest_stream_dt = db.query(func.max(StreamHistory.played_at)).scalar()
    use_streams = latest_stream_dt is not None
    reference_now = max(datetime.utcnow(), latest_stream_dt) if latest_stream_dt else datetime.utcnow()

    cutoff = None
    if tf_str == "week":
        cutoff = reference_now - timedelta(days=7)
    elif tf_str == "month":
        cutoff = reference_now - timedelta(days=30)

    stream_filter = [StreamHistory.played_at >= cutoff] if (use_streams and cutoff) else []

    if use_streams:
        totals_row = (
            db.query(
                func.count(StreamHistory.id),
                func.coalesce(func.sum(StreamHistory.duration_played_ms), 0),
            )
            .filter(*stream_filter)
            .first()
        )
        filtered_streams, total_ms = (totals_row[0] or 0), (totals_row[1] or 0)

        # Subquery: group by integer track_id FIRST
        track_agg_subq = (
            db.query(
                StreamHistory.track_id.label("track_id"),
                func.count(StreamHistory.id).label("play_count"),
                func.coalesce(func.sum(StreamHistory.duration_played_ms), 0).label("total_ms"),
            )
            .filter(*stream_filter)
            .group_by(StreamHistory.track_id)
            .subquery()
        )
        play_col = func.coalesce(func.sum(track_agg_subq.c.play_count), 0)
        time_col = func.coalesce(func.sum(track_agg_subq.c.total_ms), 0)

        # 1. Top Artists
        top_artists = (
            db.query(
                Artist.id,
                Artist.name,
                Artist.artwork_url,
                play_col.label("play_count"),
                time_col.label("total_ms"),
            )
            .join(Track, Track.artist_id == Artist.id)
            .join(track_agg_subq, track_agg_subq.c.track_id == Track.id)
            .filter(Artist.name != "Unknown Artist", Artist.name != "Unknown")
            .group_by(Artist.id, Artist.name, Artist.artwork_url)
            .order_by(desc("total_ms"))
            .limit(15)
            .all()
        )

        # 2. Top Albums
        top_albums = (
            db.query(
                Album.id,
                Album.title,
                Album.artwork_url,
                Artist.name.label("artist_name"),
                Artist.artwork_url.label("artist_artwork_url"),
                play_col.label("play_count"),
                time_col.label("total_ms"),
            )
            .join(Artist, Album.artist_id == Artist.id)
            .join(Track, Track.album_id == Album.id)
            .join(track_agg_subq, track_agg_subq.c.track_id == Track.id)
            .filter(
                Album.title != "Unknown Album",
                Artist.name != "Unknown Artist",
                Artist.name != "Unknown",
            )
            .group_by(Album.id, Album.title, Album.artwork_url, Artist.name, Artist.artwork_url)
            .order_by(desc("total_ms"))
            .limit(15)
            .all()
        )

        # 3. Top Tracks
        top_tracks = (
            db.query(
                Track.id,
                Track.title,
                Artist.name.label("artist_name"),
                Artist.artwork_url.label("artist_artwork_url"),
                Album.title.label("album_title"),
                Album.artwork_url.label("album_artwork_url"),
                track_agg_subq.c.play_count.label("play_count"),
                track_agg_subq.c.total_ms.label("total_ms"),
            )
            .join(track_agg_subq, track_agg_subq.c.track_id == Track.id)
            .join(Artist, Track.artist_id == Artist.id)
            .outerjoin(Album, Track.album_id == Album.id)
            .filter(Artist.name != "Unknown Artist", Artist.name != "Unknown")
            .order_by(desc(track_agg_subq.c.total_ms))
            .limit(20)
            .all()
        )
    else:
        total_ms = db.query(func.coalesce(func.sum(Track.duration_ms * Track.library_play_count), 0)).scalar() or 0
        filtered_streams = 0
        play_col = func.coalesce(func.sum(Track.library_play_count), 0)
        time_col = func.coalesce(func.sum(Track.duration_ms * Track.library_play_count), 0)

        top_artists = (
            db.query(
                Artist.id,
                Artist.name,
                Artist.artwork_url,
                play_col.label("play_count"),
                time_col.label("total_ms"),
            )
            .join(Track, Track.artist_id == Artist.id)
            .filter(Artist.name != "Unknown Artist", Artist.name != "Unknown")
            .group_by(Artist.id, Artist.name, Artist.artwork_url)
            .order_by(desc("total_ms"))
            .limit(15)
            .all()
        )
        top_albums = (
            db.query(
                Album.id,
                Album.title,
                Album.artwork_url,
                Artist.name.label("artist_name"),
                Artist.artwork_url.label("artist_artwork_url"),
                play_col.label("play_count"),
                time_col.label("total_ms"),
            )
            .join(Artist, Album.artist_id == Artist.id)
            .join(Track, Track.album_id == Album.id)
            .filter(Album.title != "Unknown Album", Artist.name != "Unknown Artist")
            .group_by(Album.id, Album.title, Album.artwork_url, Artist.name, Artist.artwork_url)
            .order_by(desc("total_ms"))
            .limit(15)
            .all()
        )
        top_tracks = (
            db.query(
                Track.id,
                Track.title,
                Artist.name.label("artist_name"),
                Artist.artwork_url.label("artist_artwork_url"),
                Album.title.label("album_title"),
                Album.artwork_url.label("album_artwork_url"),
                play_col.label("play_count"),
                time_col.label("total_ms"),
            )
            .join(Artist, Track.artist_id == Artist.id)
            .outerjoin(Album, Track.album_id == Album.id)
            .filter(Artist.name != "Unknown Artist")
            .group_by(Track.id, Track.title, Artist.name, Artist.artwork_url, Album.title, Album.artwork_url)
            .order_by(desc("total_ms"))
            .limit(20)
            .all()
        )

    # 4. Recent Streams Log
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
        "timeframe": tf_str,
        "total_streams": filtered_streams,
        "total_minutes_listened": round(total_ms / 60000, 1),
        "total_hours_listened": round(total_ms / 3600000, 1),
        "total_artists": db.query(func.count(Artist.id)).filter(Artist.name != "Unknown Artist").scalar() or 0,
        "total_albums": db.query(func.count(Album.id)).filter(Album.title != "Unknown Album").scalar() or 0,
        "total_tracks": db.query(func.count(Track.id)).scalar() or 0,
        "top_artists": [
            {
                "id": a.id,
                "name": a.name,
                "artwork_url": a.artwork_url,
                "play_count": a.play_count or 0,
                "minutes": round((a.total_ms or 0) / 60000, 1),
            }
            for a in top_artists
        ],
        "top_albums": [
            {
                "id": al.id,
                "title": al.title,
                "artist": al.artist_name,
                "artwork_url": al.artwork_url or al.artist_artwork_url,
                "play_count": al.play_count or 0,
                "minutes": round((al.total_ms or 0) / 60000, 1),
            }
            for al in top_albums
        ],
        "top_tracks": [
            {
                "id": t.id,
                "title": t.title,
                "artist": t.artist_name,
                "album": t.album_title,
                "artwork_url": t.album_artwork_url or t.artist_artwork_url,
                "play_count": t.play_count or 0,
                "minutes": round((t.total_ms or 0) / 60000, 1),
            }
            for t in top_tracks
        ],
        "recent_streams": [
            {
                "id": sh.id,
                "track": tr.title,
                "artist": ar.name,
                "album": al.title if al else "Single",
                "artwork_url": (al.artwork_url if al and al.artwork_url else ar.artwork_url),
                "played_at": sh.played_at.isoformat(),
            }
            for sh, tr, ar, al in recent_q
        ],
    }


def refresh_all_stats_caches_sync():
    """
    Recomputes and stores ALL 3 timeframes ('all', 'month', 'week') in the background.
    Uses a non-blocking lock so multiple user clicks never pile up duplicate refreshes.
    """
    if not _cache_refresh_lock.acquire(blocking=False):
        return
    db = SessionLocal()
    try:
        for tf in ("all", "month", "week"):
            data = compute_overview_stats(tf, db)
            db.merge(AppCache(key=f"stats_overview_{tf}", payload_json=serialize_stats(data), updated_at=datetime.utcnow()))
            db.commit()
    except Exception as e:
        db.rollback()
        print(f"Background cache refresh error: {e}")
    finally:
        db.close()
        _cache_refresh_lock.release()


async def background_enrich_and_refresh_task():
    """Enriches missing artwork across all timeframes & recent streams, then updates the caches."""
    db = SessionLocal()
    try:
        await enrich_missing_artwork(db, limit=60)
    finally:
        db.close()
    await asyncio.to_thread(refresh_all_stats_caches_sync)


@app.on_event("startup")
async def on_startup_warm_caches():
    """Builds SQL indexes and pre-warms all 3 timeframe caches when the server boots."""
    ensure_performance_indexes()
    threading.Thread(target=refresh_all_stats_caches_sync, daemon=True).start()


# --- AUTHENTICATION ---

@app.get("/api/auth/verify")
def check_admin_key(authorized: bool = Depends(verify_admin)):
    """Verifies if the provided X-Admin-Key matches ADMIN_SECRET."""
    return {"status": "authorized"}


# --- SYNC & INGESTION ENDPOINTS ---

@app.post("/api/sync/upload", dependencies=[Depends(verify_admin)])
async def unified_sync_upload(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
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
        raise HTTPException(status_code=400, detail="Unsupported file format.")

    background_tasks.add_task(background_enrich_and_refresh_task)
    return {**res, "artwork_enrichment": "running_in_background"}


@app.post("/api/sync/upload-xml", dependencies=[Depends(verify_admin)])
async def upload_library_xml(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not (file.filename or "").lower().endswith(".xml"):
        raise HTTPException(status_code=400, detail="Please upload an Apple Music Library.xml file")
    content = await file.read()
    res = ingest_library_xml(db, content)
    background_tasks.add_task(background_enrich_and_refresh_task)
    return res


@app.post("/api/sync/upload-csv", dependencies=[Depends(verify_admin)])
async def upload_activity_csv(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload Apple Music Play Activity.csv")
    res = ingest_play_activity_csv(db, file.file)
    background_tasks.add_task(background_enrich_and_refresh_task)
    return res


# --- STATS OVERVIEW ENDPOINT ---

@app.get("/api/stats/overview")
def get_stats_overview(
    timeframe: TimeFrame = TimeFrame.all,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
):
    """Returns cached stats instantly while refreshing stale caches in the background."""
    tf_str = timeframe.value if hasattr(timeframe, "value") else str(timeframe)
    cache_key = f"stats_overview_{tf_str}"

    cached = db.query(AppCache).filter(AppCache.key == cache_key).first()
    if cached:
        age_seconds = (datetime.utcnow() - (cached.updated_at or datetime.utcnow())).total_seconds()
        if age_seconds > 60:
            background_tasks.add_task(refresh_all_stats_caches_sync)
        return json.loads(cached.payload_json)

    # First-load fallback: compute requested timeframe immediately, then warm the other two in background
    data = compute_overview_stats(tf_str, db)
    db.merge(AppCache(key=cache_key, payload_json=serialize_stats(data), updated_at=datetime.utcnow()))
    db.commit()
    background_tasks.add_task(refresh_all_stats_caches_sync)
    return data


# --- PHYSICAL COLLECTION ENDPOINTS ---

@app.get("/api/collection")
def get_physical_collection(
    background_tasks: BackgroundTasks,
    sort_by: str = "artist",
    db: Session = Depends(get_db),
):
    """
    Returns all physical Vinyl, CD, and Cassette items on the shelf.
    Also warms the stats cache in the background if missing or stale while the user browses the 3D shelf!
    """
    cached_all = db.query(AppCache).filter(AppCache.key == "stats_overview_all").first()
    if not cached_all or (datetime.utcnow() - (cached_all.updated_at or datetime.utcnow())).total_seconds() > 120:
        background_tasks.add_task(refresh_all_stats_caches_sync)
        
    query = db.query(PhysicalItem)
    
    if sort_by == "title":
        query = query.order_by(func.lower(PhysicalItem.title).asc(), func.lower(PhysicalItem.artist).asc())
    elif sort_by == "format":
        query = query.order_by(PhysicalItem.format.asc(), func.lower(PhysicalItem.artist).asc(), func.lower(PhysicalItem.title).asc())
    else:
        # Default: Sort alphabetically by Artist (A-Z), then Album Title (A-Z)
        query = query.order_by(func.lower(PhysicalItem.artist).asc(), func.lower(PhysicalItem.title).asc())

    items = query.all()
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


@app.get("/api/collection/search")
async def autocomplete_collection_search(q: str = ""):
    """Live autocomplete endpoint for the Add Media modal."""
    return await search_catalog_suggestions(q, limit=6)


@app.post("/api/collection", dependencies=[Depends(verify_admin)])
async def add_physical_item(payload: PhysicalItemCreate, db: Session = Depends(get_db)):
    meta = await fetch_album_by_share_url_or_id(
        share_url=payload.share_url,
        collection_id=payload.collection_id,
        artist=payload.artist,
        title=payload.title,
    )
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

@app.get("/api/health")
def health_check(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Keeps both Render AND Neon Postgres compute awake, and ensures cache is warm."""
    cached = db.query(AppCache.updated_at).filter(AppCache.key == "stats_overview_all").first()
    if not cached:
        background_tasks.add_task(refresh_all_stats_caches_sync)
    return {"status": "ok", "cache_warm": bool(cached)}