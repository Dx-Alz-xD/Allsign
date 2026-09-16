"""Argon2id password hashing (RFC 9106) with fixed parameters.

Each hash takes 64 MiB and three passes, so at most MAX_CONCURRENT_HASHES run at once: FastAPI serves sync
endpoints from a pool of 40 threads, and 40 simultaneous logins would otherwise need 2.5 GiB of memory.
"""

import threading
from functools import lru_cache

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError

TIME_COST = 3
MEMORY_COST_KIB = 65536  # 64 MiB
PARALLELISM = 4
SALT_LEN = 16
HASH_LEN = 32
MAX_CONCURRENT_HASHES = 4

_hasher = PasswordHasher(
    time_cost=TIME_COST,
    memory_cost=MEMORY_COST_KIB,
    parallelism=PARALLELISM,
    hash_len=HASH_LEN,
    salt_len=SALT_LEN,
    type=Type.ID,
)
_slots = threading.BoundedSemaphore(MAX_CONCURRENT_HASHES)


def hash_password(password: str) -> str:
    """Returns the encoded hash ($argon2id$v=19$m=65536,t=3,p=4$salt$hash) with a fresh random salt."""
    with _slots:
        return _hasher.hash(password)


def verify_password(password: str, hash: str) -> bool:
    """False for a wrong password and for anything that is not a valid Argon2 hash."""
    try:
        with _slots:
            return _hasher.verify(hash, password)
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(hash: str) -> bool:
    """True when the hash was made with parameters other than the ones above."""
    return _hasher.check_needs_rehash(hash)


@lru_cache(maxsize=1)
def _decoy_hash() -> str:
    return hash_password("decoy password for unknown accounts")


def spend_verification(password: str) -> None:
    """Does the work of a real check, so a login for an unknown email takes as long as a wrong password."""
    verify_password(password, _decoy_hash())
