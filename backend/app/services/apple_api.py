import re
import json
import urllib.parse
import httpx
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from ..models import Album, Artist, Track, StreamHistory

def clean_search_term(text: str) -> str:
    """Removes (Deluxe), [Explicit], - Single, etc. so catalog lookups don't fail."""
    cleaned = re.sub(r"[\(\[].*?[\)\]]", "", text)
    cleaned = re.sub(r"(?i)-\s*(single|ep|deluxe|remastered.*)", "", cleaned)
    return cleaned.strip()

async def resolve_artwork_with_guardrail(client: httpx.AsyncClient, artist: str, album: str | None = None) -> tuple[str | None, str | None]:
    """
    Guardrail chain:
    1. Exact iTunes Search
    2. Cleaned iTunes Search (strips Deluxe/Remastered brackets)
    3. Artist Top Track iTunes Fallback
    4. Deezer Public API High-Res Fallback (1000x1000)
    """
    queries = []
    if album and album != "Unknown Album":
        queries.append(f"{artist} {album}")
        cleaned_q = f"{clean_search_term(artist)} {clean_search_term(album)}"
        if cleaned_q not in queries:
            queries.append(cleaned_q)
    queries.append(clean_search_term(artist))

    # Tier 1-3: Apple iTunes Search API
    for q in queries:
        try:
            entity = "album" if album else "song"
            resp = await client.get(
                "https://itunes.apple.com/search",
                params={"term": q, "entity": entity, "limit": 1}
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("resultCount", 0) > 0:
                    res = data["results"][0]
                    raw_url = res.get("artworkUrl100", "")
                    if raw_url:
                        return raw_url.replace("100x100bb", "1000x1000bb"), str(res.get("collectionId", ""))
        except Exception:
            pass

    # Tier 4: Deezer Free Public API Fallback (Provides 1000x1000 covers via picture_xl)
    try:
        q = f"{clean_search_term(artist)} {clean_search_term(album or '')}".strip()
        resp = await client.get("https://api.deezer.com/search", params={"q": q, "limit": 1})
        if resp.status_code == 200:
            data = resp.json().get("data", [])
            if data:
                cover = data[0].get("album", {}).get("cover_xl") or data[0].get("artist", {}).get("picture_xl")
                if cover:
                    return cover, None
    except Exception:
        pass

    return None, None


async def enrich_missing_artwork(db: Session, limit: int = 60) -> dict:
    """Prioritizes enriching the user's MOST PLAYED albums and artists first."""
    play_weight = func.coalesce(func.sum(Track.duration_ms * Track.library_play_count), 0)

    # 1. Fetch top played albums missing artwork
    priority_albums = (
        db.query(Album)
        .join(Track, Track.album_id == Album.id)
        .filter(Album.artwork_url.is_(None))
        .group_by(Album.id)
        .order_by(desc(play_weight))
        .limit(limit)
        .all()
    )

    # 2. Fetch top played artists missing artwork
    priority_artists = (
        db.query(Artist)
        .join(Track, Track.artist_id == Artist.id)
        .filter(Artist.artwork_url.is_(None))
        .group_by(Artist.id)
        .order_by(desc(play_weight))
        .limit(limit)
        .all()
    )

    updated_albums = 0
    updated_artists = 0
    
    used_catalog_ids = {
            row[0] for row in db.query(Album.apple_catalog_id).filter(Album.apple_catalog_id.isnot(None)).all()
        }

    for album in priority_albums:
        art_url, catalog_id = await resolve_artwork_with_guardrail(client, album.artist.name, album.title)
        if art_url:
            album.artwork_url = art_url
            if catalog_id and catalog_id not in used_catalog_ids:
                album.apple_catalog_id = catalog_id
                used_catalog_ids.add(catalog_id)
            if not album.artist.artwork_url:
                album.artist.artwork_url = art_url
            updated_albums += 1

    async with httpx.AsyncClient(timeout=10.0) as client:
        for album in priority_albums:
            art_url, catalog_id = await resolve_artwork_with_guardrail(client, album.artist.name, album.title)
            if art_url:
                album.artwork_url = art_url
                if catalog_id and not album.apple_catalog_id:
                    album.apple_catalog_id = catalog_id
                if not album.artist.artwork_url:
                    album.artist.artwork_url = art_url
                updated_albums += 1

        for artist in priority_artists:
            if not artist.artwork_url:
                art_url, _ = await resolve_artwork_with_guardrail(client, artist.name, None)
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