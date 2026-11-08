# backend/app/models.py
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint, Index, Text
from sqlalchemy.orm import relationship
from .database import Base
from datetime import datetime


class Artist(Base):
    __tablename__ = "artists"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    apple_catalog_id = Column(String, nullable=True)  # Removed unique=True
    artwork_url = Column(String, nullable=True)

    albums = relationship("Album", back_populates="artist")
    tracks = relationship("Track", back_populates="artist")

class Album(Base):
    __tablename__ = "albums"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True, nullable=False)
    artist_id = Column(Integer, ForeignKey("artists.id"), nullable=False)
    apple_catalog_id = Column(String, nullable=True)  # Removed unique=True
    artwork_url = Column(String, nullable=True)

    artist = relationship("Artist", back_populates="albums")
    tracks = relationship("Track", back_populates="album")

    __table_args__ = (UniqueConstraint("title", "artist_id", name="uq_album_artist"),)

class Track(Base):
    __tablename__ = "tracks"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True, nullable=False)
    artist_id = Column(Integer, ForeignKey("artists.id"), nullable=False)
    album_id = Column(Integer, ForeignKey("albums.id"), nullable=True)
    apple_catalog_id = Column(String, nullable=True)
    duration_ms = Column(Integer, default=0)
    library_play_count = Column(Integer, default=0) # Fallback counter from Library.xml

    artist = relationship("Artist", back_populates="tracks")
    album = relationship("Album", back_populates="tracks")
    streams = relationship("StreamHistory", back_populates="track")

    __table_args__ = (UniqueConstraint("title", "artist_id", "album_id", name="uq_track_identity"),)

class StreamHistory(Base):
    __tablename__ = "stream_history"
    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(Integer, ForeignKey("tracks.id"), nullable=False)
    played_at = Column(DateTime, index=True, nullable=False)
    duration_played_ms = Column(Integer, nullable=False)
    end_reason = Column(String, nullable=True)
    source = Column(String, default="CSV_IMPORT") # CSV_IMPORT or API_SYNC

    track = relationship("Track", back_populates="streams")

    __table_args__ = (
        UniqueConstraint("track_id", "played_at", name="uq_stream_event"),
        Index("idx_stream_played_at", "played_at"),
    )
    
class PhysicalItem(Base):
    __tablename__ = "physical_items"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True, nullable=False)
    artist = Column(String, index=True, nullable=False)
    format = Column(String, nullable=False)  # "VINYL", "CD", or "CASSETTE"
    artwork_url = Column(String, nullable=True)
    apple_music_url = Column(String, nullable=True)
    spotify_url = Column(String, nullable=True)
    tracklist_json = Column(Text, nullable=True)  # JSON array of tracks
    added_at = Column(DateTime, default=datetime.utcnow)