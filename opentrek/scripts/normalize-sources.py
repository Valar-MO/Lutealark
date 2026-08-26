"""Normalize the document-retrieval fields observed in OpenTrek Trace."""


def first_value(item, field_names):
    """Read the first populated field without relying on dict.get()."""
    for field_name in field_names:
        try:
            value = item[field_name]
        except:
            value = None
        if value is not None and value != "":
            return value
    return None


def execute_sources(params):
    retrieval_items = params.retrieval_items
    sources = []
    seen = {}
    source_count = 0
    if not retrieval_items:
        return sources
    for item in retrieval_items:
        # ChunkDetail supports key access but is not a normal Python dict in
        # OpenTrek's sandbox, so calling item.get(...) fails at runtime.
        source_id = first_value(
            item,
            ["file_code", "fileCode", "documentId", "document_id", "itemId"],
        )
        title = first_value(
            item,
            ["fileName", "file_name", "documentName", "document_name", "title"],
        )
        if not source_id or not title or source_id in seen:
            continue
        seen[source_id] = True
        source = {
            "sourceId": source_id[:200],
            "title": title[:300],
        }
        chunk_id = first_value(
            item,
            ["sys_data_id", "chunkId", "chunk_id", "id"],
        )
        excerpt = first_value(
            item,
            ["chunk_content", "chunkContent", "show_content", "content", "text"],
        )
        score = first_value(
            item,
            ["score", "similarity", "relevanceScore", "relevance_score"],
        )
        if chunk_id:
            source["chunkId"] = chunk_id[:200]
        if excerpt:
            source["excerpt"] = excerpt[:600]
        if score is not None:
            source["score"] = score
        sources = sources + [source]
        source_count += 1
        if source_count == 3:
            break
    return sources
