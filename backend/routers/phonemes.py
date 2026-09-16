import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from database import get_db
from models import CustomPhonemeTarget, Phoneme, PhonemeTrieNode, Pronunciation
from ownership import Owner, get_owned_or_404, owned
from schemas import (
    PhonemeLookupBranch,
    PhonemeLookupResponse,
    PhonemeLookupWord,
    PhonemeTargetInput,
    PhonemeTargetOut,
)

router = APIRouter(prefix="/api/phonemes", tags=["phonemes"])

DbSession = Annotated[Session, Depends(get_db)]
MAX_PREFIX_PHONEMES = 32
PREFIX_SEPARATOR = re.compile(r"[\s,]+")
ARPABET_SYMBOL = re.compile(r"[A-Z]{1,3}")


def get_target_or_404(db: Session, target_id: str, owner: str | None) -> CustomPhonemeTarget:
    return get_owned_or_404(db, CustomPhonemeTarget, target_id, owner, "Phoneme target")


def invalid_prefix(detail: str) -> HTTPException:
    # A plain-string detail, so the aphasia panel can show it as is. The status constant for 422 was renamed
    # in newer Starlette releases, and requirements.txt allows older ones.
    return HTTPException(status_code=422, detail=detail)


def normalise_prefix(prefix: str, inventory: set[str]) -> list[str]:
    """Turn "w ao1, t" into ["W", "AO", "T"]. Stress digits are dropped, as they are in the trie paths."""
    symbols = [part.upper().rstrip("012") for part in PREFIX_SEPARATOR.split(prefix.strip()) if part]
    if len(symbols) > MAX_PREFIX_PHONEMES:
        raise invalid_prefix(f"Use at most {MAX_PREFIX_PHONEMES} phonemes.")
    for symbol in symbols:
        # An unseeded dictionary has no inventory to check against, and every lookup simply finds nothing.
        if not ARPABET_SYMBOL.fullmatch(symbol) or (inventory and symbol not in inventory):
            raise invalid_prefix(f"'{symbol}' is not an ARPAbet phoneme. Separate phonemes with spaces, as in W AO.")
    return symbols


@router.get("/targets", response_model=list[PhonemeTargetOut])
def list_targets(db: DbSession, owner: Owner) -> list[PhonemeTargetOut]:
    query = owned(select(CustomPhonemeTarget), CustomPhonemeTarget, owner)
    targets = db.scalars(query.order_by(CustomPhonemeTarget.createdAt, CustomPhonemeTarget.id))
    return [PhonemeTargetOut.model_validate(target) for target in targets]


@router.post("/targets", response_model=PhonemeTargetOut, status_code=status.HTTP_201_CREATED)
def create_target(payload: PhonemeTargetInput, db: DbSession, owner: Owner) -> PhonemeTargetOut:
    target = CustomPhonemeTarget(**payload.model_dump(), userId=owner)
    db.add(target)
    db.commit()
    return PhonemeTargetOut.model_validate(target)


@router.delete("/targets/{target_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_target(target_id: str, db: DbSession, owner: Owner) -> Response:
    db.delete(get_target_or_404(db, target_id, owner))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/lookup", response_model=PhonemeLookupResponse)
def lookup_prefix(
    db: DbSession,
    prefix: Annotated[str, Query(max_length=200, description="ARPAbet phonemes separated by spaces")] = "",
    limit: Annotated[int, Query(ge=0, le=50)] = 10,
) -> PhonemeLookupResponse:
    """Word-finding cues: the most frequent words that start with these sounds, and the sounds that can follow.

    Reads the prefix trie seeded by scripts/kaggle_sync.py. An empty prefix describes the whole vocabulary.
    """
    inventory = set(db.scalars(select(Phoneme.symbol)))
    symbols = normalise_prefix(prefix, inventory)
    path = " ".join(symbols)
    node = db.scalar(select(PhonemeTrieNode).where(PhonemeTrieNode.path == path))
    if node is None:
        return PhonemeLookupResponse(prefix=symbols, found=False, wordCount=0, words=[], next=[])

    words: list[PhonemeLookupWord] = []
    if limit:
        # Trie words are the pronunciations with a terminal node; see PhonemeTrieNode for the prefix range.
        query = select(Pronunciation.word, Pronunciation.arpabet, Pronunciation.frequency).where(
            Pronunciation.trieNodeId.is_not(None)
        )
        if path:
            query = query.where(
                or_(
                    Pronunciation.phonemes == path,
                    and_(Pronunciation.phonemes >= f"{path} ", Pronunciation.phonemes < f"{path}!"),
                )
            )
        query = query.order_by(
            Pronunciation.frequency.desc().nulls_last(), Pronunciation.word, Pronunciation.variant
        ).limit(limit)
        words = [PhonemeLookupWord(word=row.word, arpabet=row.arpabet, frequency=row.frequency) for row in db.execute(query)]

    children = db.scalars(
        select(PhonemeTrieNode)
        .where(PhonemeTrieNode.parentId == node.id)
        .order_by(PhonemeTrieNode.wordCount.desc(), PhonemeTrieNode.phoneme)
    )
    return PhonemeLookupResponse(
        prefix=symbols,
        found=node.wordCount > 0,
        wordCount=node.wordCount,
        words=words,
        next=[
            PhonemeLookupBranch(phoneme=child.phoneme, wordCount=child.wordCount, topWord=child.topWord)
            for child in children
        ],
    )
