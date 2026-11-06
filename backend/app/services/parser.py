# backend/app/services/parser.py
import plistlib
import pandas as pd
from sqlalchemy.orm import Session
from ..models import Artist, Album, Track, StreamHistory
import json
from datetime import datetime

MIN_STREAM_MS = 30_000  # 30-second threshold matching stats.fm

def get_or_create_entities(db: Session, artist_name: str, album_title: str, track_title: str, duration_ms: int = 0):
    artist_name = (artist_name or "Unknown Artist").strip()
    album_title = (album_title or "Unknown Album").strip()
    track_title = (track_title or "Unknown Track").strip()

    artist = db.query(Artist).filter(Artist.name == artist_name).first()
    if not artist:
        artist = Artist(name=artist_name)
        db.add(artist)
        db.flush()

    album = db.query(Album).filter(Album.title == album_title, Album.artist_id == artist.id).first()
    if not album:
        album = Album(title=album_title, artist_id=artist.id)
        db.add(album)
        db.flush()

    track = db.query(Track).filter(
        Track.title == track_title,
        Track.artist_id == artist.id,
        Track.album_id == album.id
    ).first()
    if not track:
        track = Track(
            title=track_title,
            artist_id=artist.id,
            album_id=album.id,
            duration_ms=duration_ms
        )
        db.add(track)
        db.flush()

    return artist, album, track


def ingest_library_xml(db: Session, xml_bytes: bytes) -> dict:
    """Parses Apple Music's exported Library.xml using Python's built-in plistlib."""
    plist_data = plistlib.loads(xml_bytes)
    tracks_dict = plist_data.get("Tracks", {})
    imported_count = 0

    for _, item in tracks_dict.items():
        # Skip podcasts, voice memos, or non-music files
        if item.get("Podcast") or item.get("Kind", "").startswith("QuickTime"):
            continue

        title = item.get("Name")
        artist_name = item.get("Artist")
        if not title or not artist_name:
            continue

        album_title = item.get("Album", "Unknown Album")
        duration_ms = int(item.get("Total Time", 0))
        play_count = int(item.get("Play Count", 0))

        _, _, track = get_or_create_entities(db, artist_name, album_title, title, duration_ms)
        if play_count > track.library_play_count:
            track.library_play_count = play_count
        imported_count += 1

    db.commit()
    return {"status": "success", "tracks_processed": imported_count}


def ingest_play_activity_csv(db: Session, csv_file) -> dict:
    """Parses Apple's privacy export 'Apple Music Play Activity.csv'."""
    df = pd.read_csv(csv_file, low_memory=False)

    # Normalize expected columns from Apple's privacy export
    required_cols = ["Song Name", "Play Duration Milliseconds", "Event Start Timestamp"]
    for col in required_cols:
        if col not in df.columns:
            raise ValueError(f"Missing expected column in CSV: {col}")

    # 1. Clean & filter out skips (< 30 seconds)
    df["Play Duration Milliseconds"] = pd.to_numeric(df["Play Duration Milliseconds"], errors="coerce").fillna(0)
    df = df[df["Play Duration Milliseconds"] >= MIN_STREAM_MS]
    df = df.dropna(subset=["Song Name", "Event Start Timestamp"])

    # 2. Parse ISO timestamps
    df["played_at"] = pd.to_datetime(df["Event Start Timestamp"], errors="coerce", utc=True)
    df = df.dropna(subset=["played_at"])

    streams_added = 0
    for _, row in df.iterrows():
        song_name = str(row.get("Song Name", "")).strip()
        # Apple CSVs sometimes store artist in 'Artist Name' or 'Content Provider' or require Library lookup
        artist_name = str(row.get("Artist Name", row.get("Container Artist Name", "Unknown Artist")))
        if artist_name == "nan" or not artist_name.strip():
            # Fallback: Check if we already know this song's artist from Library.xml
            existing_track = db.query(Track).filter(Track.title == song_name).first()
            artist_name = existing_track.artist.name if existing_track else "Unknown Artist"

        album_name = str(row.get("Album Name", "Unknown Album"))
        if album_name == "nan":
            album_name = "Unknown Album"

        duration_played = int(row["Play Duration Milliseconds"])
        media_duration = int(pd.to_numeric(row.get("Media Duration In Milliseconds", 0), errors="coerce") or 0)
        played_at = row["played_at"].to_pydatetime().replace(tzinfo=None)
        end_reason = str(row.get("End Reason Type", ""))

        _, _, track = get_or_create_entities(db, artist_name, album_name, song_name, media_duration)

        # Deduplicate against existing stream timestamp
        exists = db.query(StreamHistory).filter(
            StreamHistory.track_id == track.id,
            StreamHistory.played_at == played_at
        ).first()

        if not exists:
            stream = StreamHistory(
                track_id=track.id,
                played_at=played_at,
                duration_played_ms=duration_played,
                end_reason=end_reason,
                source="CSV_IMPORT"
            )
            db.add(stream)
            streams_added += 1

    db.commit()
    return {"status": "success", "streams_added": streams_added}


def ingest_spotify_json(db: Session, json_bytes: bytes) -> dict:
    """Parses both Spotify 'Extended Streaming History' and standard 'Account Data' JSON files."""
    records = json.loads(json_bytes.decode("utf-8"))
    if not isinstance(records, list):
        raise ValueError("Expected a JSON array of Spotify stream events.")

    streams_added = 0
    for row in records:
        # Support both Extended ('ms_played', 'master_metadata_track_name') and Standard ('msPlayed', 'trackName')
        duration_ms = int(row.get("ms_played") or row.get("msPlayed") or 0)
        if duration_ms < MIN_STREAM_MS:
            continue

        track_title = row.get("master_metadata_track_name") or row.get("trackName")
        artist_name = row.get("master_metadata_album_artist_name") or row.get("artistName")
        album_title = row.get("master_metadata_album_album_name") or row.get("albumName") or "Unknown Album"
        ts_str = row.get("ts") or row.get("endTime")

        if not track_title or not artist_name or not ts_str:
            continue

        try:
            played_at = datetime.fromisoformat(ts_str.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            try:
                played_at = datetime.strptime(ts_str, "%Y-%m-%d %H:%M")
            except ValueError:
                continue

        _, _, track = get_or_create_entities(db, artist_name, album_title, track_title, duration_ms)

        exists = db.query(StreamHistory).filter(
            StreamHistory.track_id == track.id,
            StreamHistory.played_at == played_at
        ).first()

        if not exists:
            db.add(StreamHistory(
                track_id=track.id,
                played_at=played_at,
                duration_played_ms=duration_ms,
                end_reason=row.get("reason_end", "SPOTIFY_STREAM"),
                source="SPOTIFY_IMPORT"
            ))
            streams_added += 1

    db.commit()
    return {"status": "success", "source": "spotify_json", "streams_added": streams_added}