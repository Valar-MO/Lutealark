"""Source-normalization template for an OpenTrek script task.

Do not deploy until a real document-retrieval output has been captured in
Trace. Replace FIELD_MAP values with the observed field names; never guess
platform-specific fields in production.
"""

FIELD_MAP = {
    "id": None,
    "title": None,
    "url": None,
    "chunk_id": None,
    "excerpt": None,
    "score": None,
}


def main(retrieval_items):
    if not all(FIELD_MAP.values()):
        raise ValueError("Capture a real Trace output and configure FIELD_MAP first")
    seen = set()
    sources = []
    for item in retrieval_items or []:
        source_id = str(item.get(FIELD_MAP["id"], "")).strip()
        title = str(item.get(FIELD_MAP["title"], "")).strip()
        if not source_id or not title or source_id in seen:
            continue
        seen.add(source_id)
        source = {"sourceId": source_id[:200], "title": title[:300]}
        for output_name, field_name in (
            ("url", "url"), ("chunkId", "chunk_id"),
            ("excerpt", "excerpt"), ("score", "score"),
        ):
            value = item.get(FIELD_MAP[field_name])
            if value not in (None, ""):
                source[output_name] = value
        sources.append(source)
        if len(sources) == 3:
            break
    return {"sources": sources}
