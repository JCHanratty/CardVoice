"""Database models for CardVoice collection manager."""
from sqlalchemy import create_engine, Column, Integer, String, Float, ForeignKey, UniqueConstraint
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
import os
import shutil
import glob as globmod

# --- DB location: %APPDATA%/CardVoice/ (falls back to project folder) ---
_OLD_DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'cardvoice.db')
_APPDATA = os.environ.get('APPDATA') or os.environ.get('XDG_DATA_HOME')

if _APPDATA:
    DB_DIR = os.path.join(_APPDATA, 'CardVoice')
else:
    DB_DIR = os.path.join(os.path.dirname(__file__), '..')

os.makedirs(DB_DIR, exist_ok=True)
DB_PATH = os.path.join(DB_DIR, 'cardvoice.db')

# Auto-migrate: if old location has a DB but new location doesn't, move it
if os.path.exists(_OLD_DB_PATH) and os.path.abspath(_OLD_DB_PATH) != os.path.abspath(DB_PATH):
    if not os.path.exists(DB_PATH):
        shutil.copy2(_OLD_DB_PATH, DB_PATH)
        # Rename old file so it's clear it migrated
        os.rename(_OLD_DB_PATH, _OLD_DB_PATH + '.migrated')

engine = create_engine(f'sqlite:///{DB_PATH}', echo=False)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


def backup_db(max_backups=3):
    """Rotate backup copies of the database. Keeps the last `max_backups` versions."""
    if not os.path.exists(DB_PATH):
        return
    # Shift existing backups: .bak3 → delete, .bak2 → .bak3, .bak1 → .bak2, current → .bak1
    for i in range(max_backups, 1, -1):
        older = f"{DB_PATH}.bak{i - 1}"
        newer = f"{DB_PATH}.bak{i}"
        if os.path.exists(older):
            shutil.copy2(older, newer)
    shutil.copy2(DB_PATH, f"{DB_PATH}.bak1")


class CardSet(Base):
    """A card set (e.g., '2022 Bowman')."""
    __tablename__ = 'card_sets'

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)  # e.g., "2022 Bowman"
    year = Column(Integer)
    brand = Column(String)  # e.g., "Bowman", "Topps", "Donruss"
    sport = Column(String, default="Baseball")
    total_cards = Column(Integer, default=0)

    cards = relationship("Card", back_populates="card_set", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<CardSet {self.name}>"


class Card(Base):
    """A single card entry in a set (including parallel variants as separate rows)."""
    __tablename__ = 'cards'

    id = Column(Integer, primary_key=True)
    set_id = Column(Integer, ForeignKey('card_sets.id'), nullable=False)
    card_number = Column(String, nullable=False)  # "1", "BP-50", "BRES-AAS"
    player = Column(String, nullable=False)
    team = Column(String, default="")
    rc_sp = Column(String, default="")  # "RC", "SP", "1st", "SSP"
    insert_type = Column(String, default="Base")  # "Base", "Prospects", "Rated Prospect"
    parallel = Column(String, default="")  # "", "Green", "Purple /150", "Refractor"
    qty = Column(Integer, default=0)  # 0 = don't have, >0 = quantity owned

    card_set = relationship("CardSet", back_populates="cards")

    __table_args__ = (
        UniqueConstraint('set_id', 'card_number', 'insert_type', 'parallel',
                         name='uq_card_variant'),
    )

    def __repr__(self):
        p = f" [{self.parallel}]" if self.parallel else ""
        return f"<Card #{self.card_number} {self.player}{p} qty={self.qty}>"


class VoiceSession(Base):
    """Tracks a voice entry session for undo/history."""
    __tablename__ = 'voice_sessions'

    id = Column(Integer, primary_key=True)
    set_id = Column(Integer, ForeignKey('card_sets.id'))
    timestamp = Column(String)
    insert_type_filter = Column(String, default="Base")
    numbers_raw = Column(String, default="")  # Raw transcript
    numbers_parsed = Column(String, default="")  # Parsed card numbers
    cards_updated = Column(Integer, default=0)


def init_db():
    """Create all tables."""
    Base.metadata.create_all(engine)


def get_db():
    """Get database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
