import os

# Must run before config/database are imported: tests get a private in-memory DB, never omnivoice.db.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["WEB_AUTH_DATABASE_URL"] = "sqlite://"
# A fixed test key, so no generated key file is written.
os.environ["AUTH_JWT_SECRET"] = "test-signing-key-" + "0" * 32

import pytest  # noqa: E402


@pytest.fixture(scope="session")
def client():
    # Imported lazily so scripts/evaluate_benchmarks.py can reuse the grammar CASES without loading the app.
    from fastapi.testclient import TestClient

    import main

    with TestClient(main.app) as test_client:
        yield test_client
