"""WebRTC signalling relay for the caregiver link (frontend/src/lib/peer/caregiverLink.ts).

A room holds at most one speaker and one caregiver. The relay tells each side who is present and forwards
offer, answer and ice messages to the other role. Telemetry, alerts and sentences never pass through here: they
travel over the peer-to-peer data channel. Rooms live in this process's memory, so run the API with one worker.

A device may pass `?client=<id>`, an id it keeps across reconnects. When the same device comes back while the
relay still holds its old connection (a network drop is not always noticed at once), the new connection takes
over the role and the old one is closed with 4410. A different device asking for a taken role gets 4409.
"""

import logging
import re
from dataclasses import dataclass

from fastapi import APIRouter, WebSocket
from pydantic import BaseModel, TypeAdapter, ValidationError
from starlette.websockets import WebSocketState

from config import get_settings
from schemas import PeerSignal, SignalError, SignalJoined, SignalPeerJoined, SignalPeerLeft

router = APIRouter(tags=["caregiver-signalling"])
log = logging.getLogger(__name__)

ROLES = ("speaker", "caregiver")
ROOM_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,64}")
CLIENT_PATTERN = re.compile(r"[A-Za-z0-9_-]{8,64}")
MAX_ROOMS = 1000
MAX_MESSAGE_CHARS = 64_000

CLOSE_TOO_BIG = 1009
CLOSE_TRY_AGAIN_LATER = 1013
CLOSE_BAD_REQUEST = 4400
CLOSE_FORBIDDEN = 4403
CLOSE_ROLE_TAKEN = 4409
CLOSE_REPLACED = 4410

peer_signal = TypeAdapter(PeerSignal)



@dataclass(frozen=True)
class Member:
    socket: WebSocket
    client: str


# room -> role -> member. Every check-and-update below runs without an await in between, so the event loop
# never interleaves two joins or a join and a leave.
rooms: dict[str, dict[str, Member]] = {}


def origin_allowed(origin: str | None) -> bool:
    # CORS does not apply to WebSocket handshakes, so the relay checks the same allow-list itself. Browsers
    # always send Origin here; a client without one is not a web page and is let through.
    if origin is None:
        return True
    settings = get_settings()
    if "*" in settings.CORS_ORIGINS or origin in settings.CORS_ORIGINS:
        return True
    return bool(settings.CORS_ORIGIN_REGEX) and re.fullmatch(settings.CORS_ORIGIN_REGEX, origin) is not None


async def send(socket: WebSocket, message: BaseModel) -> bool:
    if socket.application_state != WebSocketState.CONNECTED:
        return False
    try:
        await socket.send_text(message.model_dump_json())
        return True
    except Exception as error:  # the other side may have gone away mid-send; its own handler cleans up
        log.debug("Signalling send failed: %s", error)
        return False


async def close_quietly(socket: WebSocket, code: int, reason: str) -> None:
    if socket.application_state != WebSocketState.CONNECTED:
        return
    try:
        await socket.close(code=code, reason=reason)
    except Exception as error:
        log.debug("Signalling close failed: %s", error)


def leave(room: str, role: str, socket: WebSocket) -> WebSocket | None:
    """Removes the socket from its room. Returns the peer to tell, or None when the socket no longer held the
    role (it was replaced) or nobody else is in the room."""
    members = rooms.get(room)
    if members is None:
        return None
    member = members.get(role)
    if member is None or member.socket is not socket:
        return None
    del members[role]
    if not members:
        del rooms[room]
        return None
    return next(iter(members.values())).socket


@router.websocket("/ws/signal/{room}")
async def signal(websocket: WebSocket, room: str, role: str = "", client: str = "") -> None:
    if not origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=CLOSE_FORBIDDEN, reason="Origin not allowed")
        return
    await websocket.accept()
    if not ROOM_PATTERN.fullmatch(room) or role not in ROLES or (client and not CLIENT_PATTERN.fullmatch(client)):
        await websocket.close(
            code=CLOSE_BAD_REQUEST,
            reason="Use a room of letters, digits, - or _, ?role=speaker or ?role=caregiver, and an optional "
            "?client id of 8-64 such characters",
        )
        return

    members = rooms.get(room)
    if members is None and len(rooms) >= MAX_ROOMS:
        await websocket.close(code=CLOSE_TRY_AGAIN_LATER, reason="Too many open rooms")
        return
    current = members.get(role) if members is not None else None
    if current is not None and (not client or current.client != client):
        await websocket.close(code=CLOSE_ROLE_TAKEN, reason=f"The {role} role is already taken in this room")
        return
    members = rooms.setdefault(room, {})
    members[role] = Member(websocket, client)
    other_role = ROLES[1] if role == ROLES[0] else ROLES[0]

    try:
        if current is not None:
            await close_quietly(current.socket, CLOSE_REPLACED, "Replaced by a newer connection from this device")
        peer = members.get(other_role)
        await send(websocket, SignalJoined(room=room, role=role, peerPresent=peer is not None))
        if peer is not None:
            await send(peer.socket, SignalPeerJoined(role=role))

        while True:
            event = await websocket.receive()
            if event["type"] == "websocket.disconnect":
                break
            text = event.get("text")
            if text is None:
                await send(websocket, SignalError(message="Send signalling messages as JSON text."))
                continue
            if len(text) > MAX_MESSAGE_CHARS:
                await websocket.close(code=CLOSE_TOO_BIG, reason="Message too large")
                break
            try:
                message = peer_signal.validate_json(text)
            except ValidationError:
                await send(websocket, SignalError(message="Expected an offer, answer or ice message."))
                continue
            peer = members.get(other_role)
            if peer is None:
                await send(websocket, SignalError(message=f"No {other_role} is in the room yet."))
                continue
            await send(peer.socket, message)
    finally:
        remaining = leave(room, role, websocket)
        if remaining is not None:
            await send(remaining, SignalPeerLeft(role=role))
