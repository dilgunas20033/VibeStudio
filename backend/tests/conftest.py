from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import session as db_session
from app.db.models import Base
from app.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    """API client backed by a fresh in-memory SQLite database per test."""
    # StaticPool shares one connection so every session sees the same in-memory DB.
    engine = db_session.make_engine("sqlite:///:memory:", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override() -> Iterator:
        with TestSession() as db:
            yield db

    app.dependency_overrides[db_session.get_db] = override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    engine.dispose()
