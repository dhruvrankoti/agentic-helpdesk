import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.db.config import get_db
from app.models.knowledge_base import KnowledgeBase
from app.schemas.knowledge_base import (
    KnowledgeBaseCreate, 
    KnowledgeBaseResponse, 
    KnowledgeBaseSearchQuery, 
    KnowledgeBaseSearchResponse
)
from app.agents.gemini_client import get_embedding
from app.agents.resolution import cosine_similarity

router = APIRouter(prefix="/knowledge-base", tags=["Knowledge Base"])

@router.post("/", response_model=KnowledgeBaseResponse)
async def create_kb_article(article: KnowledgeBaseCreate, db: Session = Depends(get_db)):
    # 1. Generate embedding
    try:
        embedding_vector = get_embedding(article.content)
        embedding_json = json.dumps(embedding_vector)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate embedding for the article: {str(e)}"
        )

    # 2. Save to database
    db_article = KnowledgeBase(
        title=article.title,
        content=article.content,
        category=article.category,
        embedding=embedding_json
    )
    db.add(db_article)
    db.commit()
    db.refresh(db_article)
    return db_article

@router.get("/", response_model=List[KnowledgeBaseResponse])
async def list_kb_articles(db: Session = Depends(get_db)):
    articles = db.query(KnowledgeBase).order_by(KnowledgeBase.created_at.desc()).all()
    return articles

@router.post("/search", response_model=List[KnowledgeBaseSearchResponse])
async def search_kb_articles(search: KnowledgeBaseSearchQuery, db: Session = Depends(get_db)):
    # 1. Get embedding for the query
    try:
        query_emb = get_embedding(search.query)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate embedding for the query: {str(e)}"
        )

    # 2. Fetch all articles
    articles = db.query(KnowledgeBase).all()
    
    # 3. Calculate cosine similarity
    matches = []
    for art in articles:
        if art.embedding:
            try:
                art_emb = json.loads(art.embedding)
                sim = cosine_similarity(query_emb, art_emb)
                matches.append({
                    "id": art.id,
                    "title": art.title,
                    "content": art.content,
                    "category": art.category,
                    "similarity_score": sim
                })
            except Exception as e:
                # Log error and skip
                print(f"Error computing similarity for article #{art.id}: {e}")
                continue

    # 4. Sort and filter
    matches.sort(key=lambda x: x["similarity_score"], reverse=True)
    
    # Return top-k results
    limit = search.limit or 5
    return matches[:limit]
