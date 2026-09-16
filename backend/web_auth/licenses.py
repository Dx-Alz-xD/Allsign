"""License keys (VM-XXXX-YYYY-ZZZZ) and the hardware fingerprints they are bound to."""

import hashlib
import re
import secrets

# 32 symbols without 0/O and 1/I, which people misread when typing a key: 60 random bits per key.
LICENSE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
LICENSE_PATTERN = re.compile(r"VM(?:-[A-HJ-NP-Z2-9]{4}){3}")
GROUPS = 3
GROUP_LENGTH = 4


def generate_license_key() -> str:
    groups = ("".join(secrets.choice(LICENSE_ALPHABET) for _ in range(GROUP_LENGTH)) for _ in range(GROUPS))
    return "VM-" + "-".join(groups)


def normalise_license_key(raw: str) -> str | None:
    """Upper-cases a typed key; None when it cannot be a Voicematics key."""
    candidate = raw.strip().upper()
    return candidate if LICENSE_PATTERN.fullmatch(candidate) else None


def hardware_fingerprint(hardware_id: str) -> str:
    return hashlib.sha256(hardware_id.strip().encode("utf-8")).hexdigest()
