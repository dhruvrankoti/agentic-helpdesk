from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List

class KnowledgeBaseCreate(BaseModel):
    title: str
    content: str
    category: str

class KnowledgeBaseResponse(BaseModel):
    id: int
    title: str
    content: str
    category: str
    created_at: datetime

    class Config:
        from_attributes = True

class KnowledgeBaseSearchQuery(BaseModel):
    query: str
    limit: Optional[int] = 5

class KnowledgeBaseSearchResponse(BaseModel):
    id: int
    title: str
    content: str
    category: str
    similarity_score: float

    class Config:
        from_attributes = True
