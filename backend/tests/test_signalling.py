from typing import TYPE_CHECKING

import pytest
from starlette.websockets import WebSocketDisconnect

from routers import signalling

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

OFFER = {"type": "offer", "sdp": "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n"}
ANSWER = {"type": "answer", "sdp": "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\n"}
ICE = {"type": "ice", "candidate": "candidate:1 1 udp 2122260223 192.168.1.2 54321 typ host", "sdpMid": "0", "sdpMLineIndex": 0}


@pytest.fixture(autouse=True)
def no_rooms(client: "TestClient"):
    signalling.rooms.clear()
    signalling.pending_alerts.clear()
    yield
    assert signalling.rooms == {}
    signalling.pending_alerts.clear()


def url(room: str = "K7P3XQ", role: str = "speaker") -> str:
    return f"/ws/signal/{room}?role={role}"


def test_first_member_waits_alone(client: "TestClient") -> None:
    with client.websocket_connect(url()) as speaker:
        assert speaker.receive_json() == {"type": "joined", "room": "K7P3XQ", "role": "speaker", "peerPresent": False}
        assert set(signalling.rooms["K7P3XQ"]) == {"speaker"}


def test_peers_learn_about_each_other(client: "TestClient") -> None:
    with client.websocket_connect(url()) as speaker:
        speaker.receive_json()
        with client.websocket_connect(url(role="caregiver")) as caregiver:
            assert caregiver.receive_json() == {
                "type": "joined", "room": "K7P3XQ", "role": "caregiver", "peerPresent": True,
            }
            assert speaker.receive_json() == {"type": "peer-joined", "role": "caregiver"}
        assert speaker.receive_json() == {"type": "peer-left", "role": "caregiver"}
        assert set(signalling.rooms["K7P3XQ"]) == {"speaker"}


def test_offer_answer_and_ice_reach_the_other_role(client: "TestClient") -> None:
    with client.websocket_connect(url(role="caregiver")) as caregiver:
        caregiver.receive_json()
        with client.websocket_connect(url()) as speaker:
            assert speaker.receive_json()["peerPresent"] is True
            caregiver.receive_json()  # peer-joined

            speaker.send_json(OFFER)
            assert caregiver.receive_json() == OFFER
            caregiver.send_json(ANSWER)
            assert speaker.receive_json() == ANSWER
            speaker.send_json(ICE)
            assert caregiver.receive_json() == ICE
            caregiver.send_json({"type": "ice", "candidate": "candidate:2 1 tcp 1 10.0.0.1 9 typ host"})
            assert speaker.receive_json() == {
                "type": "ice", "candidate": "candidate:2 1 tcp 1 10.0.0.1 9 typ host", "sdpMid": None, "sdpMLineIndex": None,
            }


def test_rooms_are_isolated(client: "TestClient") -> None:
    with client.websocket_connect(url(room="ROOM-A")) as first, client.websocket_connect(url(room="ROOM-B", role="caregiver")) as second:
        assert first.receive_json()["peerPresent"] is False
        assert second.receive_json()["peerPresent"] is False
        first.send_json(OFFER)
        assert first.receive_json() == {"type": "error", "message": "No caregiver is in the room yet."}


def test_a_taken_role_is_refused_with_4409(client: "TestClient") -> None:
    with client.websocket_connect(url()) as speaker:
        speaker.receive_json()
        with client.websocket_connect(url()) as duplicate:
            with pytest.raises(WebSocketDisconnect) as closed:
                duplicate.receive_json()
        assert closed.value.code == signalling.CLOSE_ROLE_TAKEN
        # The original speaker keeps its place and hears nothing about the refused socket.
        with client.websocket_connect(url(role="caregiver")) as caregiver:
            caregiver.receive_json()
            assert speaker.receive_json() == {"type": "peer-joined", "role": "caregiver"}


def test_a_role_can_rejoin_after_leaving(client: "TestClient") -> None:
    with client.websocket_connect(url()) as speaker:
        speaker.receive_json()
    assert signalling.rooms == {}
    with client.websocket_connect(url()) as speaker:
        assert speaker.receive_json()["type"] == "joined"


@pytest.mark.parametrize(
    "message",
    ['{"type": "telemetry"}', "not json", '{"type": "offer"}', '{"type": "joined", "peerPresent": true}'],
)
def test_bad_messages_get_an_error_and_keep_the_socket(client: "TestClient", message: str) -> None:
    with client.websocket_connect(url()) as speaker:
        speaker.receive_json()
        speaker.send_text(message)
        assert speaker.receive_json() == {"type": "error", "message": "Expected an offer, answer or ice message."}
        speaker.send_bytes(b"\x00")
        assert speaker.receive_json()["type"] == "error"


def test_oversized_messages_close_the_socket(client: "TestClient") -> None:
    with client.websocket_connect(url()) as speaker:
        speaker.receive_json()
        speaker.send_text("x" * (signalling.MAX_MESSAGE_CHARS + 1))
        with pytest.raises(WebSocketDisconnect) as closed:
            speaker.receive_json()
        assert closed.value.code == signalling.CLOSE_TOO_BIG


@pytest.mark.parametrize("path", [url(role="doctor"), "/ws/signal/K7P3XQ", url(room="bad.room"), url(room="x" * 65)])
def test_bad_rooms_and_roles_are_closed_with_4400(client: "TestClient", path: str) -> None:
    with client.websocket_connect(path) as socket:
        with pytest.raises(WebSocketDisconnect) as closed:
            socket.receive_json()
    assert closed.value.code == signalling.CLOSE_BAD_REQUEST
    # Longer reasons do not fit in a close frame, and the connection just drops instead.
    assert len(closed.value.reason.encode()) <= 123


@pytest.mark.parametrize("origin", ["http://localhost:3000", "app://omnivoice", "http://127.0.0.1:5173"])
def test_app_origins_may_connect(client: "TestClient", origin: str) -> None:
    with client.websocket_connect(url(), headers={"origin": origin}) as speaker:
        assert speaker.receive_json()["type"] == "joined"


# "null" is what file:// pages and sandboxed iframes on any website send.
@pytest.mark.parametrize("origin", ["https://evil.example", "http://localhost:3000.evil.example", "null"])
def test_other_origins_are_refused_at_the_handshake(client: "TestClient", origin: str) -> None:
    with pytest.raises(WebSocketDisconnect) as refused:
        with client.websocket_connect(url(), headers={"origin": origin}):
            pass
    assert refused.value.code == signalling.CLOSE_FORBIDDEN


def test_room_count_is_capped(client: "TestClient", monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(signalling, "MAX_ROOMS", 1)
    with client.websocket_connect(url(room="FIRST")) as first:
        first.receive_json()
        with client.websocket_connect(url(room="SECOND")) as second:
            with pytest.raises(WebSocketDisconnect) as closed:
                second.receive_json()
        assert closed.value.code == signalling.CLOSE_TRY_AGAIN_LATER
        with client.websocket_connect(url(room="FIRST", role="caregiver")) as joining:
            assert joining.receive_json()["peerPresent"] is True


def test_the_same_device_takes_over_its_stale_connection(client: "TestClient") -> None:
    device = url() + "&client=device-0001"
    with client.websocket_connect(url(role="caregiver")) as caregiver:
        caregiver.receive_json()
        with client.websocket_connect(device) as stale:
            stale.receive_json()
            assert caregiver.receive_json() == {"type": "peer-joined", "role": "speaker"}
            with client.websocket_connect(device) as fresh:
                assert fresh.receive_json() == {"type": "joined", "room": "K7P3XQ", "role": "speaker", "peerPresent": True}
                with pytest.raises(WebSocketDisconnect) as closed:
                    stale.receive_json()
                assert closed.value.code == signalling.CLOSE_REPLACED
                # The caregiver hears a fresh join (so it renegotiates), never a leave.
                assert caregiver.receive_json() == {"type": "peer-joined", "role": "speaker"}
                fresh.send_json(OFFER)
                assert caregiver.receive_json() == OFFER
            assert caregiver.receive_json() == {"type": "peer-left", "role": "speaker"}
        # The replaced socket leaving later changes nothing.
        caregiver.send_json(ANSWER)
        assert caregiver.receive_json() == {"type": "error", "message": "No speaker is in the room yet."}
        assert set(signalling.rooms["K7P3XQ"]) == {"caregiver"}


@pytest.mark.parametrize("second", ["&client=device-0002", ""])
def test_another_device_cannot_take_a_role(client: "TestClient", second: str) -> None:
    with client.websocket_connect(url() + "&client=device-0001") as speaker:
        speaker.receive_json()
        with client.websocket_connect(url() + second) as other:
            with pytest.raises(WebSocketDisconnect) as closed:
                other.receive_json()
        assert closed.value.code == signalling.CLOSE_ROLE_TAKEN


@pytest.mark.parametrize("client_id", ["short", "x" * 65, "bad id!!"])
def test_malformed_client_ids_are_rejected(client: "TestClient", client_id: str) -> None:
    with client.websocket_connect(url() + f"&client={client_id}") as socket:
        with pytest.raises(WebSocketDisconnect) as closed:
            socket.receive_json()
    assert closed.value.code == signalling.CLOSE_BAD_REQUEST


# ---------------------------------------------------------------------------
# The speaker's phone (role=alerter)

EMERGENCY = {"type": "alert", "kind": "emergency", "message": "I need help now"}


def test_a_phone_alert_reaches_the_caregiver_and_the_speaker(client: "TestClient") -> None:
    with client.websocket_connect(url()) as speaker, client.websocket_connect(url(role="caregiver")) as caregiver:
        speaker.receive_json()
        caregiver.receive_json()
        speaker.receive_json()  # peer-joined caregiver
        with client.websocket_connect(url(role="alerter")) as phone:
            assert phone.receive_json() == {"type": "joined", "room": "K7P3XQ", "role": "alerter", "peerPresent": True}
            phone.send_json(EMERGENCY)
            sent = phone.receive_json()
            assert sent["type"] == "alert-sent" and sent["delivered"] is True
            for member in (caregiver, speaker):
                alert = member.receive_json()
                assert alert["type"] == "alert"
                assert alert["alert"]["id"] == sent["id"]
                assert {key: alert["alert"][key] for key in ("kind", "message", "origin")} == {"kind": "emergency", "message": "I need help now", "origin": "phone"}
            # Only the caregiver's acknowledgement settles it, and the phone hears about that.
            speaker.send_json({"type": "alert-ack", "id": sent["id"]})
            assert speaker.receive_json()["type"] == "error"
            assert len(signalling.pending_for("K7P3XQ")) == 1
            caregiver.send_json({"type": "alert-ack", "id": sent["id"]})
            assert phone.receive_json() == {"type": "alert-received", "id": sent["id"]}
            assert signalling.pending_for("K7P3XQ") == []
        # Neither of them hears about the phone coming or going: the next thing each receives is a relayed offer.
        speaker.send_json(OFFER)
        assert caregiver.receive_json() == OFFER


def test_a_phone_alert_waits_for_a_caregiver_that_acknowledges_it(client: "TestClient") -> None:
    with client.websocket_connect(url(role="alerter")) as phone:
        assert phone.receive_json()["peerPresent"] is False
        phone.send_json({"type": "alert", "kind": "message", "message": "  Please come to the kitchen  "})
        sent = phone.receive_json()
        assert sent["delivered"] is False
        # A caregiver connection that goes away before acknowledging does not use the alert up.
        with client.websocket_connect(url(role="caregiver")) as dropped:
            assert dropped.receive_json()["type"] == "joined"
            assert dropped.receive_json()["alert"]["id"] == sent["id"]
        assert phone.receive_json() == {"type": "peer-joined", "role": "caregiver"}
        assert phone.receive_json() == {"type": "peer-left", "role": "caregiver"}
        with client.websocket_connect(url(role="caregiver")) as caregiver:
            assert caregiver.receive_json()["type"] == "joined"
            held = caregiver.receive_json()
            assert held["alert"]["id"] == sent["id"] and held["alert"]["message"] == "Please come to the kitchen"
            assert phone.receive_json() == {"type": "peer-joined", "role": "caregiver"}
            caregiver.send_json({"type": "alert-ack", "id": sent["id"]})
            assert phone.receive_json() == {"type": "alert-received", "id": sent["id"]}
        assert phone.receive_json() == {"type": "peer-left", "role": "caregiver"}
    assert signalling.pending_alerts == {}


def test_held_alerts_expire(client: "TestClient", monkeypatch: pytest.MonkeyPatch) -> None:
    with client.websocket_connect(url(role="alerter")) as phone:
        phone.receive_json()
        phone.send_json(EMERGENCY)
        phone.receive_json()
    later = signalling.time.monotonic() + signalling.PENDING_ALERT_SECONDS + 1
    monkeypatch.setattr(signalling.time, "monotonic", lambda: later)
    assert signalling.pending_for("K7P3XQ") == []
    assert signalling.pending_alerts == {}


@pytest.mark.parametrize(
    "message",
    ['{"type": "alert", "kind": "fatigue", "message": "x"}', '{"type": "alert", "kind": "emergency", "message": ""}', OFFER["sdp"], '{"type": "offer", "sdp": "v=0"}'],
)
def test_a_phone_can_only_send_alerts(client: "TestClient", message: str) -> None:
    with client.websocket_connect(url(role="alerter")) as phone:
        phone.receive_json()
        phone.send_text(message)
        assert phone.receive_json()["type"] == "error"
        phone.send_json({**EMERGENCY, "message": "x" * 201})
        assert phone.receive_json()["type"] == "error"
    assert signalling.pending_alerts == {}


def test_phone_alerts_are_rate_limited(client: "TestClient") -> None:
    with client.websocket_connect(url(role="alerter")) as phone:
        phone.receive_json()
        for _ in range(signalling.PHONE_ALERTS_PER_MINUTE):
            phone.send_json(EMERGENCY)
            assert phone.receive_json()["type"] == "alert-sent"
        phone.send_json(EMERGENCY)
        assert phone.receive_json() == {"type": "error", "message": "Too many alerts in one minute. Wait a moment and try again."}
    assert len(signalling.pending_alerts["K7P3XQ"]) == signalling.PHONE_ALERTS_PER_MINUTE
