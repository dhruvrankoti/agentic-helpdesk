import os
import sys
import json

# Add parent directory to system path to resolve local imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mcp.server.fastmcp import FastMCP
from app.db.config import SessionLocal
from app.models.ticket import Ticket
from app.models.knowledge_base import KnowledgeBase
from app.agents.orchestrator import orchestrate_ticket_pipeline

# Initialize FastMCP Server
mcp = FastMCP("Antigravity Helpdesk")

@mcp.tool()
def list_tickets() -> str:
    """List all support tickets currently in the database."""
    db = SessionLocal()
    try:
        tickets = db.query(Ticket).all()
        result = []
        for t in tickets:
            result.append({
                "id": t.id,
                "title": t.title,
                "category": t.category,
                "priority": t.priority,
                "status": t.status
            })
        return json.dumps(result, indent=2)
    finally:
        db.close()

@mcp.tool()
def get_ticket_details(ticket_id: int) -> str:
    """Get the full details of a specific ticket including its description and current status."""
    db = SessionLocal()
    try:
        ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
        if not ticket:
            return f"Ticket #{ticket_id} not found."
        return json.dumps({
            "id": ticket.id,
            "title": ticket.title,
            "description": ticket.description,
            "category": ticket.category,
            "priority": ticket.priority,
            "status": ticket.status,
            "created_at": str(ticket.created_at)
        }, indent=2)
    finally:
        db.close()

@mcp.tool()
def run_resolution_pipeline(ticket_id: int) -> str:
    """Execute the multi-agent AI pipeline to classify, plan, and attempt automated resolution on a ticket."""
    db = SessionLocal()
    try:
        result = orchestrate_ticket_pipeline(db, ticket_id)
        return json.dumps(result, indent=2)
    finally:
        db.close()

@mcp.tool()
def search_knowledge_base(query: str, limit: int = 3) -> str:
    """Search the semantic Knowledge Base for matching help articles using embedding similarity."""
    from app.agents.gemini_client import get_embedding
    from app.agents.resolution import cosine_similarity
    
    db = SessionLocal()
    try:
        query_emb = get_embedding(query)
        articles = db.query(KnowledgeBase).all()
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
                except Exception:
                    continue
        matches.sort(key=lambda x: x["similarity_score"], reverse=True)
        return json.dumps(matches[:limit], indent=2)
    finally:
        db.close()

if __name__ == "__main__":
    # Start the stdio MCP server transport
    mcp.run()
