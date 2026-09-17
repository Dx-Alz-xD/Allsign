"""WebRTC signalling relay for the caregiver link (frontend/src/lib/peer/caregiverLink.ts).

A room holds at most one speaker and one caregiver. The relay tells each side who is present and forwards
offer, answer and ice messages to the other role. Telemetry, alerts and sentences never pass through here: they
travel over the peer-to-peer data channel. Rooms live in this process's memory, so run the API with one worker.

A device may pass `?client=<id>`, an id it keeps across reconnects. When the same device comes back while the
relay still holds its old connection (a network drop is not always noticed at once), the new connection takes
over the role and the old one is closed with 4410. A different device asking for a taken role gets 4409.

The speaker's phone may join as `alerter`, signed in to the speaker's own account. It never takes part in the
WebRTC exchange: it sends `{"type": "alert", "kind": "emergency" | "message", "message": ...}` and the relay stamps
the alert and hands it to the caregiver and to the speaker's app over their signalling sockets, so an alert works
even when the desktop app is closed. The relay keeps every phone alert (up to 10 minutes) until a caregiver's
dashboard answers `{"type": "alert-ack", "id": ...}`, and sends the unacknowledged ones to each caregiver that joins,
so neither a caregiver who is not there yet nor a connection that drops mid-send loses one. The phone hears
`alert-sent` (whether a caregiver was in the room), `alert-received` once a dashboard acknowledged it, and when a
caregiver joins or leaves. Phone alerts are the one thing that passes through this server.

Sharing as the speaker is part of Voicematics Pro. Browsers cannot set headers on a WebSocket, and a token in
the URL would end up in access logs, so the session token travels as a subprotocol: the client offers
`voicematics.signal` and `voicematics.token.<token>`, and the relay accepts `voicematics.signal`. Without a
session (when accounts are required) the speaker is closed with 4401, on a plan without the caregiver link
with 4402. The caregiver side needs no account, so a family member can watch from any browser.
"""

import logging
import re
import time
import uuid
from collections import deque
from dataclasses import dataclass

from fastapi import APIRouter, WebSocket
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, TypeAdapter, ValidationError
from starlette.websockets import WebSocketState

from config import get_settings
from ownership import AccountError, resolve_account
from schemas import (
    CaregiverAlertSchema,
    PeerSignal,
    PhoneAlertRequest,
    SignalAlert,
    SignalAlertAck,
    SignalAlertReceived,
    SignalAlertSent,
    SignalError,
    SignalJoined,
    SignalPeerJoined,
    SignalPeerLeft,
)
from web_auth.plans import FEATURE_NAMES

router = APIRouter(tags=["caregiver-signalling"])
log = logging.getLogger(__name__)

ROLES = ("speaker", "caregiver")
ALERTER = "alerter"
ALL_ROLES = (*ROLES, ALERTER)
PENDING_ALERT_SECONDS = 600
MAX_PENDING_ALERTS = 20
PHONE_ALERTS_PER_MINUTE = 12
ROOM_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,64}")
CLIENT_PATTERN = re.compile(r"[A-Za-z0-9_-]{8,64}")
MAX_ROOMS = 1000
MAX_MESSAGE_CHARS = 64_000

CLOSE_TOO_BIG = 1009
CLOSE_TRY_AGAIN_LATER = 1013
CLOSE_BAD_REQUEST = 4400
CLOSE_UNAUTHORIZED = 4401
CLOSE_PLAN_REQUIRED = 4402
CLOSE_FORBIDDEN = 4403
CLOSE_ROLE_TAKEN = 4409
CLOSE_REPLACED = 4410

SIGNAL_PROTOCOL = "voicematics.signal"
TOKEN_PROTOCOL_PREFIX = "voicematics.token."

peer_signal = TypeAdapter(PeerSignal)
phone_alert = TypeAdapter(PhoneAlertRequest)
alert_ack = TypeAdapter(SignalAlertAck)


@dataclass(frozen=True)
class Member:
    socket: WebSocket
    client: str
    # The signed-in account, when there is one: a phone may only raise alerts in its own speaker's room.
    account: str | None = None


# room -> role -> member. Every check-and-update below runs without an await in between, so the event loop
# never interleaves two joins or a join and a leave.
rooms: dict[str, dict[str, Member]] = {}
# Phone alerts no caregiver's dashboard has acknowledged yet: room -> [(monotonic time held, alert)].
pending_alerts: dict[str, list[tuple[float, SignalAlert]]] = {}


def hold_alert(room: str, alert: SignalAlert) -> None:
    held = [item for item in pending_alerts.get(room, []) if item[0] > time.monotonic() - PENDING_ALERT_SECONDS]
    held.append((time.monotonic(), alert))
    pending_alerts[room] = held[-MAX_PENDING_ALERTS:]
    while len(pending_alerts) > MAX_ROOMS:
        pending_alerts.pop(next(iter(pending_alerts)))


def pending_for(room: str) -> list[SignalAlert]:
    """The room's unacknowledged alerts that have not expired, oldest first."""
    cutoff = time.monotonic() - PENDING_ALERT_SECONDS
    held = [item for item in pending_alerts.get(room, []) if item[0] > cutoff]
    if held:
        pending_alerts[room] = held
    else:
        pending_alerts.pop(room, None)
    return [alert for _, alert in held]


def acknowledge_alert(room: str, alert_id: str) -> bool:
    held = pending_alerts.get(room, [])
    remaining = [item for item in held if item[1].alert.id != alert_id]
    if len(remaining) == len(held):
        return False
    if remaining:
        pending_alerts[room] = remaining
    else:
        pending_alerts.pop(room, None)
    return True


def audience(members: dict[str, Member], role: str) -> list[WebSocket]:
    """Who hears that `role` joined or left: the speaker and caregiver hear about each other, and the phone hears
    about the caregiver. Nobody hears about the phone."""
    listeners = {"speaker": ("caregiver",), "caregiver": ("speaker", ALERTER)}.get(role, ())
    return [members[name].socket for name in listeners if name in members]


def origin_allowed(origin: str | None) -> bool:
    # CORS does not apply to WebSocket handshakes, so the relay checks the same allow-list itself. Browsers
    # always send Origin here; a client without one is not a web page and is let through.
    if origin is None:
        return True
    settings = get_settings()
    if "*" in settings.CORS_ORIGINS or origin in settings.CORS_ORIGINS:
        return True
    return bool(settings.CORS_ORIGIN_REGEX) and re.fullmatch(settings.CORS_ORIGIN_REGEX, origin) is not None


def offered_protocols(websocket: WebSocket) -> list[str]:
    header = websocket.headers.get("sec-websocket-protocol", "")
    return [value.strip() for value in header.split(",") if value.strip()]


def session_token(protocols: list[str]) -> str | None:
    return next((value[len(TOKEN_PROTOCOL_PREFIX) :] for value in protocols if value.startswith(TOKEN_PROTOCOL_PREFIX)), None)


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


def leave(room: str, role: str, socket: WebSocket) -> list[WebSocket]:
    """Removes the socket from its room. Returns the members to tell, none when the socket no longer held the role
    (it was replaced) or nobody who cares is left."""
    members = rooms.get(room)
    if members is None:
        return []
    member = members.get(role)
    if member is None or member.socket is not socket:
        return []
    del members[role]
    if not members:
        del rooms[room]
        return []
    return audience(members, role)


@router.websocket("/ws/signal/{room}")
async def signal(websocket: WebSocket, room: str, role: str = "", client: str = "") -> None:
    if not origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=CLOSE_FORBIDDEN, reason="Origin not allowed")
        return
    protocols = offered_protocols(websocket)
    # A browser drops the connection when the server does not pick one of the protocols it offered.
    await websocket.accept(subprotocol=SIGNAL_PROTOCOL if SIGNAL_PROTOCOL in protocols else None)
    if not ROOM_PATTERN.fullmatch(room) or role not in ALL_ROLES or (client and not CLIENT_PATTERN.fullmatch(client)):
        await websocket.close(
            code=CLOSE_BAD_REQUEST,
            reason="Use a room of letters, digits, - or _, ?role=speaker, caregiver or alerter, and an optional "
            "?client id of 8-64 such characters",
        )
        return

    token = session_token(protocols)
    account_id: str | None = None
    if role != "caregiver" or token is not None:
        try:
            account = await run_in_threadpool(resolve_account, token)
        except AccountError as error:
            await websocket.close(code=CLOSE_UNAUTHORIZED, reason=error.detail)
            return
        if role != "caregiver" and not account.has("caregiver_link"):
            await websocket.close(code=CLOSE_PLAN_REQUIRED, reason=f"{FEATURE_NAMES['caregiver_link']} is part of Voicematics Pro.")
            return
        account_id = account.id

    members = rooms.get(room)
    if members is None and len(rooms) >= MAX_ROOMS:
        await websocket.close(code=CLOSE_TRY_AGAIN_LATER, reason="Too many open rooms")
        return
    current = members.get(role) if members is not None else None
    if current is not None and (not client or current.client != client):
        await websocket.close(code=CLOSE_ROLE_TAKEN, reason=f"The {role} role is already taken in this room")
        return
    speaker = members.get("speaker") if members is not None else None
    if role == ALERTER and speaker is not None and speaker.account != account_id:
        await websocket.close(code=CLOSE_FORBIDDEN, reason="This room belongs to another account. Sign in with the speaker's account.")
        return
    members = rooms.setdefault(room, {})
    members[role] = Member(websocket, client, account_id)
    other_role = ROLES[1] if role == ROLES[0] else ROLES[0]
    sent_alerts: deque[float] = deque()

    try:
        if current is not None:
            await close_quietly(current.socket, CLOSE_REPLACED, "Replaced by a newer connection from this device")
        watched = "caregiver" if role == ALERTER else other_role
        await send(websocket, SignalJoined(room=room, role=role, peerPresent=watched in members))
        for listener in audience(members, role):
            await send(listener, SignalPeerJoined(role=role))
        if role == "caregiver":
            for alert in pending_for(room):
                await send(websocket, alert)

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
            if role == ALERTER:
                await relay_phone_alert(websocket, room, members, text, sent_alerts)
                continue
            if role == "caregiver" and '"alert-ack"' in text:
                try:
                    ack = alert_ack.validate_json(text)
                except ValidationError:
                    await send(websocket, SignalError(message="Expected an alert-ack with the alert's id."))
                    continue
                phone = members.get(ALERTER)
                if acknowledge_alert(room, ack.id) and phone is not None:
                    await send(phone.socket, SignalAlertReceived(id=ack.id))
                continue
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
        for listener in leave(room, role, websocket):
            await send(listener, SignalPeerLeft(role=role))


async def relay_phone_alert(websocket: WebSocket, room: str, members: dict[str, Member], text: str, sent: deque[float]) -> None:
    try:
        request = phone_alert.validate_json(text)
    except ValidationError:
        await send(websocket, SignalError(message="Expected an alert: kind emergency or message, and a message of up to 200 characters."))
        return
    now = time.monotonic()
    while sent and sent[0] <= now - 60:
        sent.popleft()
    if len(sent) >= PHONE_ALERTS_PER_MINUTE:
        await send(websocket, SignalError(message="Too many alerts in one minute. Wait a moment and try again."))
        return
    phone = members.get(ALERTER)
    speaker = members.get("speaker")
    # The speaker may have joined after the phone did, signed in to a different account.
    if speaker is not None and phone is not None and speaker.account != phone.account:
        await send(websocket, SignalError(message="This room belongs to another account. Sign in with the speaker's account."))
        return
    sent.append(now)
    alert = SignalAlert(
        alert=CaregiverAlertSchema(
            id=f"phone-{uuid.uuid4().hex[:16]}",
            kind=request.kind,
            message=request.message,
            timestamp=int(time.time() * 1000),
            origin="phone",
        )
    )
    # Held until a caregiver's dashboard acknowledges it, even when one is connected: the send can still be lost.
    hold_alert(room, alert)
    caregiver = members.get("caregiver")
    delivered = caregiver is not None and await send(caregiver.socket, alert)
    if speaker is not None:
        await send(speaker.socket, alert)
    await send(websocket, SignalAlertSent(id=alert.alert.id, delivered=delivered))
