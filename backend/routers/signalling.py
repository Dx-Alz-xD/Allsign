"""WebRTC signalling relay for the caregiver link (frontend/src/lib/peer/caregiverLink.ts).

A room holds at most one speaker, one caregiver and the speaker's phone. The relay tells each side who is present
and forwards offer, answer and ice messages between speaker and caregiver. Telemetry, alerts and sentences from the
desktop app never pass through here: they travel over the peer-to-peer data channel. Rooms live in this process's
memory, so run the API with one worker.

A device may pass `?client=<id>`, an id it keeps across reconnects. When the same device comes back while the
relay still holds its old connection (a network drop is not always noticed at once), the new connection takes
over the role and the old one is closed with 4410. A different device asking for a taken role gets 4409.

Nobody watches a speaker by knowing a room code. A caregiver signs in, and the relay admits it only when the room's
speaker has approved that account (web_auth/allowances.py): until then the caregiver hears `approval` with
`waiting-for-speaker` or `pending`, and the speaker hears `access-request` with the caregiver's username. The speaker
answers `access-decision` here or through /api/caregivers; an approved caregiver is let in at once, a denied or
removed one is closed with 4403. A caregiver that is not admitted hears nothing about the room, receives no alerts
and cannot signal. The room belongs to the account of its speaker (or of the speaker's phone): another account
joining as speaker or phone is closed with 4403. A local install without accounts admits every caregiver.

The speaker's phone may join as `alerter`, signed in to the speaker's own account. It never takes part in the
WebRTC exchange: it sends `{"type": "alert", "kind": "emergency" | "message", "message": ...}` and the relay stamps
the alert and hands it to the admitted caregiver and to the speaker's app over their signalling sockets, so an alert
works even when the desktop app is closed. The relay keeps every phone alert (up to 10 minutes) until a caregiver's
dashboard answers `{"type": "alert-ack", "id": ...}`, and sends the unacknowledged ones to each caregiver it admits.
The phone hears `alert-sent` (whether a caregiver was in the room), `alert-received` once a dashboard acknowledged it,
and when a caregiver is admitted or leaves. Phone alerts are the one thing that passes through this server.

Sharing as the speaker (and alerting from the phone) is part of Voicematics Pro. Browsers cannot set headers on a
WebSocket, and a token in the URL would end up in access logs, so the session token travels as a subprotocol: the
client offers `voicematics.signal` and `voicematics.token.<token>`, and the relay accepts `voicematics.signal`.
Without a session (when accounts are required) every role is closed with 4401; a speaker or phone on a plan without
the caregiver link with 4402.
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
    SignalAccessDecision,
    SignalAccessRequest,
    SignalAlert,
    SignalAlertAck,
    SignalAlertReceived,
    SignalAlertSent,
    SignalApproval,
    SignalError,
    SignalJoined,
    SignalPeerJoined,
    SignalPeerLeft,
    SignalSpeaker,
)
from web_auth import allowances
from web_auth.plans import FEATURE_NAMES

router = APIRouter(tags=["caregiver-signalling"])
log = logging.getLogger(__name__)

ROLES = ("speaker", "caregiver")
ALERTER = "alerter"
ALL_ROLES = (*ROLES, ALERTER)
OWNER_ROLES = ("speaker", ALERTER)
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

# Close reasons fit in 123 bytes.
NOT_ALLOWED = "The speaker has not allowed this account to watch them."
REMOVED = "The speaker removed this account's access."
OTHER_ACCOUNT = "This room belongs to another account. Sign in with the speaker's account."

SIGNAL_PROTOCOL = "voicematics.signal"
TOKEN_PROTOCOL_PREFIX = "voicematics.token."

peer_signal = TypeAdapter(PeerSignal)
phone_alert = TypeAdapter(PhoneAlertRequest)
alert_ack = TypeAdapter(SignalAlertAck)
access_decision = TypeAdapter(SignalAccessDecision)


@dataclass
class Member:
    socket: WebSocket
    client: str
    # The signed-in account, or None on a local install without accounts.
    account: str | None = None
    # A caregiver with an account waits for the speaker's approval; everyone else is in from the start.
    admitted: bool = True


# room -> role -> member. Check-and-update steps run without an await in between; where a database lookup has to
# happen, the member is looked up again afterwards in case it left meanwhile.
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


def host(members: dict[str, Member]) -> Member | None:
    """The member whose account owns the room: the speaker, or the speaker's phone."""
    return members.get("speaker") or members.get(ALERTER)


def admitted_caregiver(members: dict[str, Member]) -> Member | None:
    caregiver = members.get("caregiver")
    return caregiver if caregiver is not None and caregiver.admitted else None


def audience(members: dict[str, Member], role: str) -> list[WebSocket]:
    """Who hears that `role` joined or left: the speaker and an admitted caregiver hear about each other, and the
    phone hears about the caregiver. Nobody hears about the phone or a caregiver still waiting."""
    listeners = {"speaker": ("caregiver",), "caregiver": ("speaker", ALERTER)}.get(role, ())
    return [members[name].socket for name in listeners if name in members and members[name].admitted]


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
    (it was replaced), was a caregiver nobody had admitted, or nobody who cares is left."""
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
    return audience(members, role) if member.admitted else []


async def turn_away(caregiver: Member, status: str) -> None:
    await send(caregiver.socket, SignalApproval(status=status))
    await close_quietly(caregiver.socket, CLOSE_FORBIDDEN, REMOVED if status == "removed" else NOT_ALLOWED)


def still_there(room: str, role: str, member: Member) -> bool:
    members = rooms.get(room)
    return members is not None and members.get(role) is member


async def admit(room: str, members: dict[str, Member], caregiver: Member) -> None:
    if caregiver.admitted:
        return
    caregiver.admitted = True
    owner = host(members)
    speaker_identity = await run_in_threadpool(allowances.identity, owner.account) if owner and owner.account else None
    if not still_there(room, "caregiver", caregiver):
        return
    await send(
        caregiver.socket,
        SignalApproval(
            status="approved",
            speaker=SignalSpeaker(username=speaker_identity.username, displayName=speaker_identity.display_name) if speaker_identity else None,
        ),
    )
    if "speaker" in members:
        await send(caregiver.socket, SignalPeerJoined(role="speaker"))
    for listener in audience(members, "caregiver"):
        await send(listener, SignalPeerJoined(role="caregiver"))
    for alert in pending_for(room):
        await send(caregiver.socket, alert)


async def review_caregiver(room: str, members: dict[str, Member], caregiver: Member) -> None:
    """Admits a waiting caregiver, asks the speaker about it, or turns it away."""
    if caregiver.admitted:
        return
    owner = host(members)
    if owner is None:
        await send(caregiver.socket, SignalApproval(status="waiting-for-speaker"))
        return
    if owner.account is None or owner.account == caregiver.account:
        await admit(room, members, caregiver)
        return
    result = await run_in_threadpool(allowances.request_access, owner.account, caregiver.account)
    if not still_there(room, "caregiver", caregiver) or host(members) is not owner:
        return
    if result is None:
        await turn_away(caregiver, "denied")
        return
    status, request = result
    if status == "approved":
        await admit(room, members, caregiver)
    elif status == "denied":
        await turn_away(caregiver, "denied")
    else:
        await send(caregiver.socket, SignalApproval(status="pending"))
        speaker = members.get("speaker")
        if speaker is not None:
            await send(speaker.socket, SignalAccessRequest(request=request))


async def allowance_changed(speaker_account: str, caregiver_account: str, status: str | None) -> None:
    """Applies a decision to live connections: admits an approved caregiver waiting in the speaker's room, closes a
    denied or removed one."""
    for room, members in list(rooms.items()):
        owner = host(members)
        caregiver = members.get("caregiver")
        if owner is None or caregiver is None or owner.account != speaker_account or caregiver.account != caregiver_account:
            continue
        if status == "approved":
            await admit(room, members, caregiver)
        elif status is None or status == "denied":
            await turn_away(caregiver, "removed" if caregiver.admitted else "denied")


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
            reason="Room: letters, digits, - or _. role: speaker, caregiver or alerter. client: 8-64 such characters.",
        )
        return

    try:
        account = await run_in_threadpool(resolve_account, session_token(protocols))
    except AccountError as error:
        await websocket.close(code=CLOSE_UNAUTHORIZED, reason=error.detail)
        return
    if role in OWNER_ROLES and not account.has("caregiver_link"):
        await websocket.close(code=CLOSE_PLAN_REQUIRED, reason=f"{FEATURE_NAMES['caregiver_link']} is part of Voicematics Pro.")
        return

    members = rooms.get(room)
    if members is None and len(rooms) >= MAX_ROOMS:
        await websocket.close(code=CLOSE_TRY_AGAIN_LATER, reason="Too many open rooms")
        return
    current = members.get(role) if members is not None else None
    if current is not None and (not client or current.client != client):
        await websocket.close(code=CLOSE_ROLE_TAKEN, reason=f"The {role} role is already taken in this room")
        return
    if role in OWNER_ROLES and members is not None:
        others = [members[name] for name in OWNER_ROLES if name != role and name in members]
        if any(other.account != account.id for other in others):
            await websocket.close(code=CLOSE_FORBIDDEN, reason=OTHER_ACCOUNT)
            return
    members = rooms.setdefault(room, {})
    member = Member(websocket, client, account.id, admitted=role != "caregiver" or account.id is None)
    members[role] = member
    other_role = ROLES[1] if role == ROLES[0] else ROLES[0]
    sent_alerts: deque[float] = deque()

    try:
        if current is not None:
            await close_quietly(current.socket, CLOSE_REPLACED, "Replaced by a newer connection from this device")
        if role == "caregiver":
            await send(websocket, SignalJoined(room=room, role=role, peerPresent=member.admitted and "speaker" in members))
            if member.admitted:
                for listener in audience(members, role):
                    await send(listener, SignalPeerJoined(role=role))
                for alert in pending_for(room):
                    await send(websocket, alert)
            else:
                await review_caregiver(room, members, member)
        else:
            await send(websocket, SignalJoined(room=room, role=role, peerPresent=admitted_caregiver(members) is not None))
            for listener in audience(members, role):
                await send(listener, SignalPeerJoined(role=role))
            waiting = members.get("caregiver")
            if waiting is not None and not waiting.admitted:
                await review_caregiver(room, members, waiting)

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
            if role == "speaker" and '"access-decision"' in text:
                await apply_decision(websocket, member, text)
                continue
            if role == "caregiver" and not member.admitted:
                await send(websocket, SignalError(message="Waiting for the speaker's approval."))
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
            if peer is None or not peer.admitted:
                await send(websocket, SignalError(message=f"No {other_role} is in the room yet."))
                continue
            await send(peer.socket, message)
    finally:
        for listener in leave(room, role, websocket):
            await send(listener, SignalPeerLeft(role=role))


async def apply_decision(websocket: WebSocket, speaker: Member, text: str) -> None:
    try:
        decision = access_decision.validate_json(text)
    except ValidationError:
        await send(websocket, SignalError(message="Expected an access-decision with the request's id and approve."))
        return
    result = await run_in_threadpool(allowances.decide_now, speaker.account, decision.id, decision.approve) if speaker.account else None
    if result is None:
        await send(websocket, SignalError(message="There is no such request."))
        return
    caregiver_account, status = result
    await allowance_changed(speaker.account, caregiver_account, status)


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
    if speaker is not None and phone is not None and speaker.account != phone.account:
        await send(websocket, SignalError(message=OTHER_ACCOUNT))
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
    caregiver = admitted_caregiver(members)
    delivered = caregiver is not None and await send(caregiver.socket, alert)
    if speaker is not None:
        await send(speaker.socket, alert)
    await send(websocket, SignalAlertSent(id=alert.alert.id, delivered=delivered))
