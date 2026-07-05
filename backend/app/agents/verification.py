import json
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from app.agents.gemini_client import generate_json
from app.models.ticket import Ticket
from app.models.agent_decision import AgentDecision
from app.models.agent_log import AgentLog
from app.models.enums import TicketStatus

class VerificationOutput(BaseModel):
    verified: bool = Field(description="True if the proposed solution is correct, complete, and safe to send to the customer; False otherwise.")
    confidence: float = Field(description="Confidence score for this verification (0.0 to 1.0).")
    reasoning: str = Field(description="Clear reasoning explaining why the solution is verified or rejected.")

def run_verification_agent(db: Session, ticket_id: int, proposed_solution: str) -> VerificationOutput:
    # Fetch ticket
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise ValueError(f"Ticket #{ticket_id} not found")

    # Log start
    start_msg = f"Verification Agent starting validation of the proposed solution for Ticket #{ticket_id}."
    db.add(AgentLog(ticket_id=ticket_id, agent_name="Verification Agent", log_level="INFO", message=start_msg))
    db.commit()

    # Build prompt
    prompt = f"""
    You are the Verification Agent. Carefully review the proposed solution for the customer support ticket.
    
    Ticket ID: {ticket.id}
    Title: {ticket.title}
    Description: {ticket.description}
    Category: {ticket.category}
    
    Proposed Solution:
    \"\"\"
    {proposed_solution}
    \"\"\"
    
    Tasks:
    1. Check if the proposed solution completely addresses the user's issue.
    2. Check if the solution is accurate, safe, and helpful.
    3. Determine if the solution is verified (True) or rejected (False).
    4. Provide your confidence score and detailed reasoning.
    """

    # Call LLM
    try:
        result_dict = generate_json(prompt, VerificationOutput)
        output = VerificationOutput(**result_dict)
    except Exception as e:
        err_msg = f"Verification Agent failed during LLM invocation: {str(e)}"
        db.add(AgentLog(ticket_id=ticket_id, agent_name="Verification Agent", log_level="ERROR", message=err_msg))
        db.commit()
        raise e

    # Save Agent Decision
    decision = AgentDecision(
        ticket_id=ticket_id,
        agent_name="Verification Agent",
        decision_type="VERIFICATION",
        decision_output=json.dumps(result_dict),
        confidence_score=output.confidence
    )
    db.add(decision)

    # If verified, mark ticket as RESOLVED
    if output.verified:
        ticket.status = TicketStatus.RESOLVED
        db.add(AgentLog(ticket_id=ticket_id, agent_name="Verification Agent", log_level="INFO", message=f"Proposed solution verified successfully. Ticket status set to RESOLVED."))
    else:
        db.add(AgentLog(ticket_id=ticket_id, agent_name="Verification Agent", log_level="WARNING", message=f"Proposed solution REJECTED. Routing to Escalation Agent. Reasoning: {output.reasoning}"))
    
    db.commit()

    return output
