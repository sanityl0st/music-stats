# backend/app/services/apple_api.py
import httpx
from sqlalchemy.orm import Session
from ..models import Album, Artist
import json
import urllib.parse

async def enrich_missing_artwork(db: Session, limit: int = 25) -> dict:
    """Fetches high-res 1000x1000 album & artist artwork from Apple's public catalog."""
    albums_missing_art = (
        db.query(Album)
        .filter(Album.artwork_url.is_(None))
        .limit(limit)
        .all()
    )

    updated = 0
    async with httpx.AsyncClient(timeout=10.0) as client:
        for album in albums_missing_art:
            query = f"{album.artist.name} {album.title}"
            try:
                resp = await client.get(
                    "https://itunes.apple.com/search",
                    params={"term": query, "entity": "album", "limit": 1}
                )
                data = resp.json()
                if data.get("resultCount", 0) > 0:
                    result = data["results"][0]
                    raw_url = result.get("artworkUrl100", "")
                    if raw_url:
                        # Upgrade resolution from 100x100 to 1000x1000 for 3D vinyl textures
                        high_res_url = raw_url.replace("100x100bb", "1000x1000bb")
                        album.artwork_url = high_res_url
                        album.apple_catalog_id = str(result.get("collectionId", ""))
                        if not album.artist.artwork_url:
                            album.artist.artwork_url = high_res_url
                        updated += 1
            except Exception:
                continue

    db.commit()
    return {"albums_enriched": updated}

async def fetch_album_metadata_and_tracks(artist: str, title: str) -> dict:
    """Fetches high-res cover art, Apple Music URL, and full tracklist from iTunes Lookup API."""
    query = f"{artist} {title}".strip()
    spotify_q = urllib.parse.quote(query)
    fallback = {
        "title": title,
        "artist": artist,
        "artwork_url": "https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=800&q=80",
        "apple_music_url": f"https://music.apple.com/us/search?term={spotify_q}",
        "spotify_url": f"https://open.spotify.com/search/{spotify_q}",
        "tracklist_json": json.dumps([{"number": 1, "title": title, "duration": "3:45"}]),
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(
                "https://itunes.apple.com/search",
                params={"term": query, "entity": "album", "limit": 1}
            )
            data = resp.json()
            if data.get("resultCount", 0) == 0:
                return fallback

            album_info = data["results"][0]
            collection_id = album_info.get("collectionId")
            raw_art = album_info.get("artworkUrl100", "")
            high_res_art = raw_art.replace("100x100bb", "1000x1000bb") if raw_art else fallback["artwork_url"]

            # Fetch all songs on the album using collectionId
            lookup_resp = await client.get(
                "https://itunes.apple.com/lookup",
                params={"id": collection_id, "entity": "song"}
            )
            lookup_data = lookup_resp.json()
            tracks = []
            for item in lookup_data.get("results", []):
                if item.get("wrapperType") == "track":
                    ms = item.get("trackTimeMillis", 0)
                    mins = ms // 60000
                    secs = (ms % 60000) // 1000
                    tracks.append({
                        "number": item.get("trackNumber", len(tracks) + 1),
                        "title": item.get("trackName", "Unknown Track"),
                        "duration": f"{mins}:{secs:02d}"
                    })

            return {
                "title": album_info.get("collectionName", title),
                "artist": album_info.get("artistName", artist),
                "artwork_url": high_res_art,
                "apple_music_url": album_info.get("collectionViewUrl", fallback["apple_music_url"]),
                "spotify_url": f"https://open.spotify.com/search/{urllib.parse.quote(album_info.get(' artistName', artist) + ' ' + album_info.get('collectionName', title))}",
                "tracklist_json": json.dumps(tracks),
            }
        except Exception:
            return fallback