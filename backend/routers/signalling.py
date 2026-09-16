"""WebRTC signalling relay for the caregiver link (frontend/src/lib/peer/caregiverLink.ts).

A room holds at most one speaker and one caregiver. The relay tells each side who is present and forwards
offer, answer and ice messages to the other role. Telemetry and alerts never pass through here: they travel
over the peer-to-peer data channel. Rooms live in this process's memory, so run the API with one worker.
"""

import logging
import re

from fastapi import APIRouter, WebSocket
from pydantic import BaseModel, TypeAdapter, ValidationError
from starlette.websockets import WebSocketState

from config import get_settings
from schemas import PeerSignal, SignalError, SignalJoined, SignalPeerJoined, SignalPeerLeft

router = APIRouter(tags=["caregiver-signalling"])
log = logging.getLogger(__name__)

ROLES = ("speaker", "caregiver")
ROOM_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,64}")
MAX_ROOMS = 1000
MAX_MESSAGE_CHARS = 64_000

CLOSE_TOO_BIG = 1009
CLOSE_TRY_AGAIN_LATER = 1013
CLOSE_BAD_REQUEST = 4400
CLOSE_FORBIDDEN = 4403
CLOSE_ROLE_TAKEN = 4409

peer_signal = TypeAdapter(PeerSignal)

# room -> role -> socket. Every check-and-update below runs without an await in between, so the event loop
# never interleaves two joins or a join and a leave.
rooms: dict[str, dict[str, WebSocket]] = {}


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


def leave(room: str, role: str, socket: WebSocket) -> WebSocket | None:
    """Removes the socket from its room and returns the peer that is still there, if any."""
    members = rooms.get(room)
    if members is None:
        return None
    if members.get(role) is socket:
        del members[role]
    if not members:
        del rooms[room]
    return next(iter(members.values()), None)


@router.websocket("/ws/signal/{room}")
async def signal(websocket: WebSocket, room: str, role: str = "") -> None:
    if not origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=CLOSE_FORBIDDEN, reason="Origin not allowed")
        return
    await websocket.accept()
    if not ROOM_PATTERN.fullmatch(room) or role not in ROLES:
        await websocket.close(
            code=CLOSE_BAD_REQUEST,
            reason="Use a room of letters, digits, - or _ and ?role=speaker or ?role=caregiver",
        )
        return

    members = rooms.get(room)
    if members is None and len(rooms) >= MAX_ROOMS:
        await websocket.close(code=CLOSE_TRY_AGAIN_LATER, reason="Too many open rooms")
        return
    if members is not None and role in members:
        await websocket.close(code=CLOSE_ROLE_TAKEN, reason=f"The {role} role is already taken in this room")
        return
    members = rooms.setdefault(room, {})
    members[role] = websocket
    other_role = ROLES[1] if role == ROLES[0] else ROLES[0]

    try:
        peer = members.get(other_role)
        await send(websocket, SignalJoined(room=room, role=role, peerPresent=peer is not None))
        if peer is not None:
            await send(peer, SignalPeerJoined(role=role))

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
            await send(peer, message)
    finally:
        peer = leave(room, role, websocket)
        if peer is not None:
            await send(peer, SignalPeerLeft(role=role))
