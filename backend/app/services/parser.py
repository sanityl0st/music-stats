# backend/app/services/parser.py
import json
import plistlib
from collections import defaultdict
from datetime import datetime
import pandas as pd
from sqlalchemy.orm import Session
from ..models import Artist, Album, Track, StreamHistory

MIN_STREAM_MS = 30_000  # 30-second minimum threshold


def clean_str(val, fallback: str) -> str:
    if val is None or pd.isna(val):
        return fallback
    s = str(val).strip()
    return fallback if (not s or s.lower() == "nan") else s


def safe_int(val, default: int = 0) -> int:
    if val is None or pd.isna(val):
        return default
    num = pd.to_numeric(val, errors="coerce")
    if pd.isna(num):
        return default
    return int(num)


def norm(s: str) -> str:
    return (s or "").strip().lower()


def build_entity_caches(db: Session):
    """
    Preloads artists, albums, and tracks using composite normalized keys
    so songs with identical titles by different artists NEVER collide.
    """
    artists = {norm(a.name): a for a in db.query(Artist).all()}
    albums = {(norm(al.title), al.artist_id): al for al in db.query(Album).all()}
    tracks = {(norm(t.title), t.artist_id, t.album_id): t for t in db.query(Track).all()}

    # Secondary lookup indexes for resolving CSV rows where Apple omitted Artist Name
    tracks_by_title_album = defaultdict(list)
    tracks_by_title_only = defaultdict(list)

    for t in tracks.values():
        if t.artist and norm(t.artist.name) not in ("unknown artist", "unknown"):
            al_title = norm(t.album.title) if t.album else "unknown album"
            tracks_by_title_album[(norm(t.title), al_title)].append(t)
            tracks_by_title_only[norm(t.title)].append(t)

    return artists, albums, tracks, tracks_by_title_album, tracks_by_title_only


def get_or_create_cached(
    db: Session,
    caches: tuple,
    artist_name: str,
    album_title: str,
    track_title: str,
    duration_ms: int = 0,
):
    artists, albums, tracks, tracks_by_title_album, tracks_by_title_only = caches

    artist_name = clean_str(artist_name, "Unknown Artist")
    album_title = clean_str(album_title, "Unknown Album")
    track_title = clean_str(track_title, "Unknown Track")

    a_key = norm(artist_name)
    al_t_key = norm(album_title)
    tr_t_key = norm(track_title)

    artist = artists.get(a_key)
    if not artist:
        artist = Artist(name=artist_name)
        db.add(artist)
        db.flush()
        artists[a_key] = artist

    album_key = (al_t_key, artist.id)
    album = albums.get(album_key)
    if not album:
        album = Album(title=album_title, artist_id=artist.id)
        db.add(album)
        db.flush()
        albums[album_key] = album

    track_key = (tr_t_key, artist.id, album.id)
    track = tracks.get(track_key)
    if not track:
        track = Track(
            title=track_title,
            artist_id=artist.id,
            album_id=album.id,
            duration_ms=duration_ms,
        )
        db.add(track)
        db.flush()
        tracks[track_key] = track

        if a_key not in ("unknown artist", "unknown"):
            tracks_by_title_album[(tr_t_key, al_t_key)].append(track)
            tracks_by_title_only[tr_t_key].append(track)
    else:
        if duration_ms > 0 and (not track.duration_ms or track.duration_ms == 0):
            track.duration_ms = duration_ms

    return artist, album, track


def reconcile_unknown_artist_tracks(db: Session, caches: tuple) -> int:
    """
    Ensures order-independence (CSV -> XML vs XML -> CSV).
    If Play Activity CSV was imported first and created 'Unknown Artist' tracks,
    this merges their streams into the real Artist's track once Library.xml is loaded.
    """
    artists, _, _, tracks_by_title_album, tracks_by_title_only = caches
    unknown_artist = artists.get("unknown artist")
    if not unknown_artist:
        return 0

    orphan_tracks = db.query(Track).filter(Track.artist_id == unknown_artist.id).all()
    merged_count = 0

    for orphan in orphan_tracks:
        t_key = norm(orphan.title)
        al_key = norm(orphan.album.title) if orphan.album else "unknown album"

        # 1. Match by both Track Title + Album Title first
        candidates = [
            c for c in tracks_by_title_album.get((t_key, al_key), [])
            if c.id != orphan.id
        ]
        # 2. Only fall back to title-only if there is 1 unambiguous artist in the library with that song title
        if not candidates and al_key == "unknown album":
            title_matches = [c for c in tracks_by_title_only.get(t_key, []) if c.id != orphan.id]
            unique_artist_ids = {c.artist_id for c in title_matches}
            if len(unique_artist_ids) == 1:
                candidates = title_matches

        if len(candidates) == 1:
            target = candidates[0]
            db.query(StreamHistory).filter(StreamHistory.track_id == orphan.id).update(
                {StreamHistory.track_id: target.id}, synchronize_session=False
            )
            if orphan.library_play_count > target.library_play_count:
                target.library_play_count = orphan.library_play_count
            db.delete(orphan)
            merged_count += 1

    if merged_count > 0:
        db.commit()
    return merged_count


def ingest_library_xml(db: Session, xml_bytes: bytes) -> dict:
    plist_data = plistlib.loads(xml_bytes)
    tracks_dict = plist_data.get("Tracks", {})
    caches = build_entity_caches(db)
    imported_count = 0

    for _, item in tracks_dict.items():
        if item.get("Podcast") or item.get("Kind", "").startswith("QuickTime"):
            continue

        title = item.get("Name")
        artist_name = item.get("Artist") or item.get("Album Artist")
        if not title or not artist_name:
            continue

        album_title = item.get("Album", "Unknown Album")
        duration_ms = safe_int(item.get("Total Time"), 0)
        play_count = safe_int(item.get("Play Count"), 0)

        _, _, track = get_or_create_cached(db, caches, artist_name, album_title, title, duration_ms)
        if play_count > track.library_play_count:
            track.library_play_count = play_count
        imported_count += 1

    db.commit()
    reconciled = reconcile_unknown_artist_tracks(db, caches)
    return {"status": "success", "tracks_processed": imported_count, "orphans_reconciled": reconciled}


def ingest_play_activity_csv(db: Session, csv_file) -> dict:
    df = pd.read_csv(csv_file, low_memory=False)

    required_cols = ["Song Name", "Play Duration Milliseconds", "Event Start Timestamp"]
    for col in required_cols:
        if col not in df.columns:
            raise ValueError(f"Missing expected column in CSV: {col}")

    df["Play Duration Milliseconds"] = pd.to_numeric(df["Play Duration Milliseconds"], errors="coerce").fillna(0)
    df = df[df["Play Duration Milliseconds"] >= MIN_STREAM_MS]
    df = df.dropna(subset=["Song Name", "Event Start Timestamp"])

    df["played_at"] = pd.to_datetime(df["Event Start Timestamp"], errors="coerce", utc=True)
    df = df.dropna(subset=["played_at"])

    caches = build_entity_caches(db)
    _, _, _, tracks_by_title_album, tracks_by_title_only = caches

    existing_streams = set(db.query(StreamHistory.track_id, StreamHistory.played_at).all())
    new_streams = []

    for _, row in df.iterrows():
        song_name = clean_str(row.get("Song Name"), "Unknown Track")
        album_name = clean_str(
            row.get("Album Name") if pd.notna(row.get("Album Name")) else row.get("Container Name"),
            "Unknown Album"
        )

        # Check all possible artist columns in Apple's CSV
        artist_name = ""
        for col in ("Artist Name", "Album Artist Name", "Container Artist Name"):
            if col in row and pd.notna(row[col]):
                candidate = clean_str(row[col], "")
                if candidate and candidate.lower() not in ("unknown artist", "unknown", "various artists"):
                    artist_name = candidate
                    break

        # Safe disambiguation when CSV omits Artist Name
        if not artist_name:
            t_key = norm(song_name)
            al_key = norm(album_name)

            # Priority 1: Match by BOTH Song Name and Album Name
            matches = tracks_by_title_album.get((t_key, al_key), [])
            if len(matches) == 1:
                artist_name = matches[0].artist.name
            else:
                # Priority 2: Match by Song Name ONLY if there is a single unique artist with that song
                title_matches = tracks_by_title_only.get(t_key, [])
                unique_artists = {m.artist.name for m in title_matches if m.artist}
                if len(unique_artists) == 1:
                    artist_name = next(iter(unique_artists))
                    if album_name == "Unknown Album" and title_matches[0].album:
                        album_name = title_matches[0].album.title
                else:
                    artist_name = "Unknown Artist"

        duration_played = safe_int(row.get("Play Duration Milliseconds"), 0)
        media_duration = safe_int(row.get("Media Duration In Milliseconds"), duration_played)
        played_at = row["played_at"].to_pydatetime().replace(tzinfo=None)
        end_reason = clean_str(row.get("End Reason Type"), "NATURAL_END_OF_TRACK")

        _, _, track = get_or_create_cached(db, caches, artist_name, album_name, song_name, media_duration)

        stream_key = (track.id, played_at)
        if stream_key not in existing_streams:
            existing_streams.add(stream_key)
            new_streams.append(
                StreamHistory(
                    track_id=track.id,
                    played_at=played_at,
                    duration_played_ms=duration_played,
                    end_reason=end_reason,
                    source="CSV_IMPORT",
                )
            )

    if new_streams:
        db.bulk_save_objects(new_streams)
    db.commit()
    return {"status": "success", "streams_added": len(new_streams)}

def get_or_create_entities(
    db: Session,
    artist_name: str,
    album_title: str,
    track_title: str,
    duration_ms: int = 0,
):
    """Single-item helper for backwards compatibility."""
    caches = build_entity_caches(db)
    return get_or_create_cached(db, caches, artist_name, album_title, track_title, duration_ms)


def ingest_spotify_json(db: Session, json_bytes: bytes) -> dict:
    """Fast cached parser for Spotify Extended/Standard Streaming History JSON."""
    records = json.loads(json_bytes.decode("utf-8"))
    if not isinstance(records, list):
        raise ValueError("Expected a JSON array of Spotify stream events.")

    caches = build_entity_caches(db)
    existing_streams = set(db.query(StreamHistory.track_id, StreamHistory.played_at).all())
    new_streams = []

    for row in records:
        duration_ms = safe_int(row.get("ms_played") or row.get("msPlayed"), 0)
        if duration_ms < MIN_STREAM_MS:
            continue

        track_title = clean_str(row.get("master_metadata_track_name") or row.get("trackName"), "")
        artist_name = clean_str(row.get("master_metadata_album_artist_name") or row.get("artistName"), "")
        album_title = clean_str(row.get("master_metadata_album_album_name") or row.get("albumName"), "Unknown Album")
        ts_str = row.get("ts") or row.get("endTime")

        if not track_title or not artist_name or not ts_str:
            continue

        try:
            played_at = datetime.fromisoformat(str(ts_str).replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            try:
                played_at = datetime.strptime(str(ts_str), "%Y-%m-%d %H:%M")
            except ValueError:
                continue

        _, _, track = get_or_create_cached(db, caches, artist_name, album_title, track_title, duration_ms)

        stream_key = (track.id, played_at)
        if stream_key not in existing_streams:
            existing_streams.add(stream_key)
            new_streams.append(
                StreamHistory(
                    track_id=track.id,
                    played_at=played_at,
                    duration_played_ms=duration_ms,
                    end_reason=clean_str(row.get("reason_end"), "SPOTIFY_STREAM"),
                    source="SPOTIFY_IMPORT",
                )
            )

    if new_streams:
        db.bulk_save_objects(new_streams)
    db.commit()
    return {"status": "success", "source": "spotify_json", "streams_added": len(new_streams)}