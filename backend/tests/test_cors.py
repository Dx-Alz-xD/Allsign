from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def preflight(client: "TestClient", origin: str):
    return client.options(
        "/api/triggers",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:3000",
        "app://.",
        "app://omnivoice",
        "http://127.0.0.1",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "file://",
        "null",
    ],
)
def test_local_app_origins_are_allowed(client: "TestClient", origin: str) -> None:
    response = preflight(client, origin)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert "POST" in response.headers["access-control-allow-methods"]


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.example",
        "http://localhost:5173",
        "https://localhost:3000",
        "http://127.0.0.1.evil.example",
        "http://127.0.0.1:3000.evil.example",
        "http://127.0.0.2:3000",
        "https://127.0.0.1:3000",
        "app://omnivoice/../evil",
    ],
)
def test_other_origins_are_rejected(client: "TestClient", origin: str) -> None:
    response = preflight(client, origin)
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_simple_requests_echo_the_allowed_origin(client: "TestClient") -> None:
    allowed = client.get("/health/live", headers={"Origin": "app://omnivoice"})
    assert allowed.headers["access-control-allow-origin"] == "app://omnivoice"
    assert allowed.headers["access-control-allow-credentials"] == "true"

    rejected = client.get("/health/live", headers={"Origin": "https://evil.example"})
    assert rejected.status_code == 200
    assert "access-control-allow-origin" not in rejected.headers
