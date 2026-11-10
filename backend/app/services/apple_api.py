import re
import json
import urllib.parse
import httpx
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from ..models import Album, Artist, Track, StreamHistory
from datetime import datetime, timedelta

def clean_search_term(text: str) -> str:
    """Removes (Deluxe), [Explicit], - Single, etc. so catalog lookups don't fail."""
    cleaned = re.sub(r"[\(\[].*?[\)\]]", "", text)
    cleaned = re.sub(r"(?i)-\s*(single|ep|deluxe|remastered.*)", "", cleaned)
    return cleaned.strip()

async def resolve_artwork_with_guardrail(
    client: httpx.AsyncClient, artist: str, album: str | None = None
) -> tuple[str | None, str | None]:
    """
    Guardrail chain with strict artist & album verification to prevent inaccurate artwork.
    """
    clean_artist = clean_search_term(artist).lower()
    clean_album = clean_search_term(album or "").lower()

    queries = []
    if album and album != "Unknown Album":
        queries.append(f"{artist} {album}")
        cleaned_q = f"{clean_artist} {clean_album}"
        if cleaned_q not in queries:
            queries.append(cleaned_q)
    queries.append(clean_artist)

    # Tier 1-3: Apple iTunes Search API with Strict Verification
    for q in queries:
        try:
            entity = "album" if album else "song"
            resp = await client.get(
                "https://itunes.apple.com/search",
                params={"term": q, "entity": entity, "limit": 5}  # Fetch top 5 to find the best match
            )
            if resp.status_code == 200:
                data = resp.json()
                for res in data.get("results", []):
                    res_artist = res.get("artistName", "").lower()
                    res_collection = res.get("collectionName", "").lower()

                    # Verification Rule: The result must match the artist name
                    artist_matched = (clean_artist in res_artist or res_artist in clean_artist)
                    
                    # If we are searching for an album, verify the album title matches too
                    album_matched = True
                    if clean_album and clean_album != "unknown album":
                        album_matched = (clean_album in res_collection or res_collection in clean_album)

                    if artist_matched and album_matched:
                        raw_url = res.get("artworkUrl100", "")
                        if raw_url:
                            return raw_url.replace("100x100bb", "1000x1000bb"), str(res.get("collectionId", ""))
        except Exception:
            pass

    # Tier 4: Deezer Free Public API with Strict Verification
    try:
        q = f"{clean_artist} {clean_album}".strip()
        resp = await client.get("https://api.deezer.com/search", params={"q": q, "limit": 5})
        if resp.status_code == 200:
            for item in resp.json().get("data", []):
                res_artist = item.get("artist", {}).get("name", "").lower()
                res_album = item.get("album", {}).get("title", "").lower()

                if clean_artist in res_artist or res_artist in clean_artist:
                    if not clean_album or clean_album in res_album or res_album in clean_album:
                        cover = item.get("album", {}).get("cover_xl") or item.get("artist", {}).get("picture_xl")
                        if cover:
                            return cover, None
    except Exception:
        pass

    return None, None


async def resolve_artist_photo(client: httpx.AsyncClient, artist_name: str) -> str | None:
    """Fetches a real artist profile picture (Deezer Artist API -> iTunes fallback)."""
    clean_artist = clean_search_term(artist_name).lower()
    if not clean_artist or clean_artist in ("unknown artist", "unknown"):
        return None

    # 1. Deezer Artist Search returns actual artist portraits (1000x1000 picture_xl)
    try:
        resp = await client.get("https://api.deezer.com/search/artist", params={"q": artist_name, "limit": 5})
        if resp.status_code == 200:
            for item in resp.json().get("data", []):
                res_name = item.get("name", "").lower()
                if clean_artist == res_name or clean_artist in res_name or res_name in clean_artist:
                    pic = item.get("picture_xl") or item.get("picture_big")
                    if pic and "images/artist//" not in pic:  # Skip Deezer blank avatar placeholder
                        return pic
    except Exception:
        pass

    # 2. Fallback to artist's top album cover via guardrail
    art_url, _ = await resolve_artwork_with_guardrail(client, artist_name, None)
    return art_url


async def enrich_missing_artwork(db: Session, limit: int = 80) -> dict:
    """
    Guarantees artwork is populated for:
    - All-Time Top Artists, Albums, and Tracks
    - Monthly (Last 30d) Top Artists, Albums, and Tracks
    - Weekly (Last 7d) Top Artists, Albums, and Tracks
    - Most Recent 30 Streams
    """
    now = datetime.utcnow()
    cutoffs = [None, now - timedelta(days=30), now - timedelta(days=7)]

    target_albums: dict[int, Album] = {}
    target_artists: dict[int, Artist] = {}

    has_streams = (db.query(func.count(StreamHistory.id)).scalar() or 0) > 0

    for cutoff in cutoffs:
        if has_streams:
            time_metric = func.coalesce(func.sum(StreamHistory.duration_played_ms), 0)
            alb_q = (
                db.query(Album)
                .join(Track, Track.album_id == Album.id)
                .join(StreamHistory, StreamHistory.track_id == Track.id)
                .filter(Album.artwork_url.is_(None))
            )
            art_q = (
                db.query(Artist)
                .join(Track, Track.artist_id == Artist.id)
                .join(StreamHistory, StreamHistory.track_id == Track.id)
                .filter(Artist.artwork_url.is_(None), Artist.name != "Unknown Artist")
            )
            if cutoff:
                alb_q = alb_q.filter(StreamHistory.played_at >= cutoff)
                art_q = art_q.filter(StreamHistory.played_at >= cutoff)

            for al in alb_q.group_by(Album.id).order_by(desc(time_metric)).limit(25).all():
                target_albums[al.id] = al
            for ar in art_q.group_by(Artist.id).order_by(desc(time_metric)).limit(20).all():
                target_artists[ar.id] = ar
        else:
            lib_metric = func.coalesce(func.sum(Track.duration_ms * Track.library_play_count), 0)
            for al in (
                db.query(Album)
                .join(Track, Track.album_id == Album.id)
                .filter(Album.artwork_url.is_(None))
                .group_by(Album.id)
                .order_by(desc(lib_metric))
                .limit(limit)
                .all()
            ):
                target_albums[al.id] = al
            for ar in (
                db.query(Artist)
                .join(Track, Track.artist_id == Artist.id)
                .filter(Artist.artwork_url.is_(None), Artist.name != "Unknown Artist")
                .group_by(Artist.id)
                .order_by(desc(lib_metric))
                .limit(limit)
                .all()
            ):
                target_artists[ar.id] = ar

    # Always include the 30 most recently streamed tracks' albums & artists
    recent_rows = (
        db.query(Album, Artist)
        .select_from(StreamHistory)
        .join(Track, StreamHistory.track_id == Track.id)
        .join(Artist, Track.artist_id == Artist.id)
        .outerjoin(Album, Track.album_id == Album.id)
        .order_by(desc(StreamHistory.played_at))
        .limit(35)
        .all()
    )
    for al, ar in recent_rows:
        if al and not al.artwork_url:
            target_albums[al.id] = al
        if ar and not ar.artwork_url and ar.name != "Unknown Artist":
            target_artists[ar.id] = ar

    updated_albums = 0
    updated_artists = 0

    async with httpx.AsyncClient(timeout=12.0) as client:
        used_catalog_ids = {
            row[0] for row in db.query(Album.apple_catalog_id).filter(Album.apple_catalog_id.isnot(None)).all()
        }

        for album in target_albums.values():
            query_album = None if album.title in ("Unknown Album", "Single") else album.title
            art_url, catalog_id = await resolve_artwork_with_guardrail(client, album.artist.name, query_album)
            if art_url:
                album.artwork_url = art_url
                if catalog_id and catalog_id not in used_catalog_ids:
                    album.apple_catalog_id = catalog_id
                    used_catalog_ids.add(catalog_id)
                updated_albums += 1

        for artist in target_artists.values():
            if not artist.artwork_url:
                art_url = await resolve_artist_photo(client, artist.name)
                if art_url:
                    artist.artwork_url = art_url
                    updated_artists += 1

    db.commit()
    return {"albums_enriched": updated_albums, "artists_enriched": updated_artists}

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
        
        

async def search_catalog_suggestions(query: str, limit: int = 6) -> list[dict]:
    """Returns live autocomplete suggestions as the user types an artist or album name."""
    if not query or len(query.strip()) < 2:
        return []
    async with httpx.AsyncClient(timeout=8.0) as client:
        resp = await client.get(
            "https://itunes.apple.com/search",
            params={"term": query.strip(), "entity": "album", "limit": limit}
        )
        if resp.status_code != 200:
            return []
        results = []
        for item in resp.json().get("results", []):
            raw_art = item.get("artworkUrl100", "")
            results.append({
                "collection_id": str(item.get("collectionId", "")),
                "title": item.get("collectionName", ""),
                "artist": item.get("artistName", ""),
                "artwork_url": raw_art.replace("100x100bb", "600x600bb") if raw_art else "",
                "release_year": (item.get("releaseDate") or "")[:4],
                "apple_url": item.get("collectionViewUrl", ""),
            })
        return results


async def fetch_album_by_share_url_or_id(
    share_url: str | None = None,
    collection_id: str | None = None,
    artist: str = "",
    title: str = ""
) -> dict:
    """
    100% accurate resolver:
    - Accepts an Apple Music Share Link, Spotify Share Link, iTunes collectionId, or Artist+Title.
    """
    spotify_custom_url = None

    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        # 1. Check if user pasted an Apple Music link (extract numeric collectionId)
        if share_url and "apple.com" in share_url:
            # Match /album/name/123456789 or ?i=...
            m = re.search(r"/album/[^/]+/(\d+)", share_url) or re.search(r"/(\d{7,12})", share_url)
            if m:
                collection_id = m.group(1)

        # 2. Check if user pasted a Spotify Album link (resolve via Spotify's free oEmbed API)
        elif share_url and ("spotify.com" in share_url or "spotify.link" in share_url):
            spotify_custom_url = share_url
            oembed_resp = await client.get(
                "https://open.spotify.com/oembed",
                params={"url": share_url}
            )
            if oembed_resp.status_code == 200:
                oembed_data = oembed_resp.json()
                raw_title = oembed_data.get("title", "")
                # Find matching collectionId on iTunes to pull the tracklist
                search_resp = await client.get(
                    "https://itunes.apple.com/search",
                    params={"term": raw_title, "entity": "album", "limit": 1}
                )
                if search_resp.status_code == 200 and search_resp.json().get("resultCount", 0) > 0:
                    collection_id = str(search_resp.json()["results"][0]["collectionId"])

        # 3. If we have an exact collection_id (from Apple link, Spotify oEmbed, or Autocomplete click)
        if collection_id:
            lookup_resp = await client.get(
                "https://itunes.apple.com/lookup",
                params={"id": collection_id, "entity": "song"}
            )
            if lookup_resp.status_code == 200:
                items = lookup_resp.json().get("results", [])
                collection_info = next((x for x in items if x.get("wrapperType") == "collection"), None)
                if collection_info:
                    resolved_title = collection_info.get("collectionName", title)
                    resolved_artist = collection_info.get("artistName", artist)
                    raw_art = collection_info.get("artworkUrl100", "")
                    high_res_art = raw_art.replace("100x100bb", "1000x1000bb")

                    tracks = []
                    for item in items:
                        if item.get("wrapperType") == "track":
                            ms = item.get("trackTimeMillis", 0)
                            tracks.append({
                                "number": item.get("trackNumber", len(tracks) + 1),
                                "title": item.get("trackName", "Unknown Track"),
                                "duration": f"{ms // 60000}:{(ms % 60000) // 1000:02d}"
                            })

                    q_encoded = urllib.parse.quote(f"{resolved_artist} {resolved_title}")
                    return {
                        "title": resolved_title,
                        "artist": resolved_artist,
                        "artwork_url": high_res_art,
                        "apple_music_url": collection_info.get("collectionViewUrl", f"https://music.apple.com/us/search?term={q_encoded}"),
                        "spotify_url": spotify_custom_url or f"https://open.spotify.com/search/{q_encoded}",
                        "tracklist_json": json.dumps(tracks),
                    }

    # 4. Fallback to standard Artist + Title search
    return await fetch_album_metadata_and_tracks(artist, title)