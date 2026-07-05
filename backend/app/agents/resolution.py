import json
import numpy as np
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List
from app.agents.gemini_client import get_embedding, generate_json
from app.models.ticket import Ticket
from app.models.knowledge_base import KnowledgeBase
from app.models.agent_decision import AgentDecision
from app.models.agent_log import AgentLog
from app.models.enums import TicketStatus

class ResolutionOutput(BaseModel):
    solution: str = Field(description="The proposed solution or draft response to the customer. Must be detailed, structured, and helpful.")
    confidence: float = Field(description="Confidence score for this resolution (0.0 to 1.0).")
    referenced_kb_ids: List[int] = Field(description="List of IDs of Knowledge Base articles referenced to construct this solution.")
    reasoning: str = Field(description="Internal technical reasoning detailing how this resolution solves the problem.")

def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    a = np.array(v1)
    b = np.array(b_from_list := v2)
    dot_product = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot_product / (norm_a * norm_b))

def run_resolution_agent(db: Session, ticket_id: int) -> ResolutionOutput:
    # 1. Fetch ticket
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise ValueError(f"Ticket #{ticket_id} not found")

    # Set status to IN_PROGRESS
    ticket.status = TicketStatus.IN_PROGRESS
    db.commit()

    # Log start
    start_msg = f"Resolution Agent starting to draft solution for Ticket #{ticket_id}. Status set to IN_PROGRESS."
    db.add(AgentLog(ticket_id=ticket_id, agent_name="Resolution Agent", log_level="INFO", message=start_msg))
    db.commit()

    # 2. Get Embedding for ticket details
    try:
        search_text = f"Title: {ticket.title}\nDescription: {ticket.description}\nCategory: {ticket.category}"
        ticket_emb = get_embedding(search_text)
    except Exception as e:
        ticket_emb = None
        db.add(AgentLog(ticket_id=ticket_id, agent_name="Resolution Agent", log_level="WARNING", message=f"Failed to generate embedding for ticket: {str(e)}. Proceeding without semantic KB search."))
        db.commit()

    # 3. Retrieve and rank KB articles
    kb_context_str = ""
    referenced_kb_ids = []
    
    if ticket_emb:
        kb_articles = db.query(KnowledgeBase).all()
        ranked_articles = []
        for art in kb_articles:
            if art.embedding:
                try:
                    art_emb = json.loads(art.embedding)
                    sim = cosine_similarity(ticket_emb, art_emb)
                    ranked_articles.append((art, sim))
                except Exception as ex:
                    print(f"Error parsing embedding for KB #{art.id}: {ex}")
        
        # Sort by similarity score descending
        ranked_articles.sort(key=lambda x: x[1], reverse=True)
        
        # Select articles with similarity > 0.6 (take top 3 max)
        top_matches = [x for x in ranked_articles if x[1] > 0.6][:3]
        
        if top_matches:
            kb_log_msg = f"Semantic search matched {len(top_matches)} Knowledge Base articles."
            db.add(AgentLog(ticket_id=ticket_id, agent_name="Resolution Agent", log_level="INFO", message=kb_log_msg))
            db.commit()
            
            kb_context_str = "Relevant Knowledge Base Articles:\n"
            for art, sim in top_matches:
                referenced_kb_ids.append(art.id)
                kb_context_str += f"--- KB Article #{art.id}: {art.title} (Similarity: {sim:.2f}) ---\nCategory: {art.category}\nContent: {art.content}\n\n"
        else:
            db.add(AgentLog(ticket_id=ticket_id, agent_name="Resolution Agent", log_level="INFO", message="Semantic search completed. No relevant Knowledge Base articles found."))
            db.commit()

    # 4. Build prompt for solution generation
    prompt = f"""
    You are the Resolution Agent. Draft a detailed customer support response to resolve the ticket.
    
    Ticket ID: {ticket.id}
    Title: {ticket.title}
    Description: {ticket.description}
    Category: {ticket.category}
    
    {kb_context_str}
    
    Instructions:
    1. If relevant KB articles are provided, ground your solution strictly on the information in them. Do not hallucinate external policies.
    2. If no relevant KB articles are provided, write a helpful general troubleshooting response, but note in your reasoning that no specific KB article was matched.
    3. The response should be empathetic, professional, clear, and provide step-by-step instructions where appropriate.
    4. Provide a confidence score (0.0 to 1.0) on how likely this solution is to resolve the user's issue.
    """

    # 5. Call LLM
    try:
        result_dict = generate_json(prompt, ResolutionOutput)
        # Ensure referenced_kb_ids matches what we found semantically if not set by LLM
        if not result_dict.get("referenced_kb_ids"):
            result_dict["referenced_kb_ids"] = referenced_kb_ids
        output = ResolutionOutput(**result_dict)
    except Exception as e:
        err_msg = f"Resolution Agent failed during LLM invocation: {str(e)}"
        db.add(AgentLog(ticket_id=ticket_id, agent_name="Resolution Agent", log_level="ERROR", message=err_msg))
        db.commit()
        raise e

    # 6. Save Agent Decision
    decision = AgentDecision(
        ticket_id=ticket_id,
        agent_name="Resolution Agent",
        decision_type="RESOLUTION",
        decision_output=json.dumps(result_dict),
        confidence_score=output.confidence
    )
    db.add(decision)
    db.commit()

    # Log completion
    complete_msg = (
        f"Resolution completed. Confidence: {output.confidence:.2f}. "
        f"Referenced KB IDs: {output.referenced_kb_ids}. "
        f"Reasoning: {output.reasoning}"
    )
    db.add(AgentLog(ticket_id=ticket_id, agent_name="Resolution Agent", log_level="INFO", message=complete_msg))
    db.commit()

    return output
