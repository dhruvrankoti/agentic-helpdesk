import json
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from app.agents.gemini_client import generate_json
from app.models.ticket import Ticket
from app.models.agent_decision import AgentDecision
from app.models.agent_log import AgentLog
from app.models.enums import TicketStatus

class EscalationOutput(BaseModel):
    escalated: bool = Field(description="Must be set to True.")
    escalation_reason: str = Field(description="The primary reason why the ticket is being escalated (e.g., 'Verification failed', 'Planner instruction', 'System error').")
    summary_for_human: str = Field(description="A concise summary of the issue and what the AI agents did, to help the human support representative.")
    confidence: float = Field(description="Confidence score for the escalation decision (0.0 to 1.0).")

def run_escalation_agent(db: Session, ticket_id: int, reason: str) -> EscalationOutput:
    # Fetch ticket
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise ValueError(f"Ticket #{ticket_id} not found")

    # Set status to ESCALATED
    ticket.status = TicketStatus.ESCALATED
    db.commit()

    # Log start
    start_msg = f"Escalation Agent processing Ticket #{ticket_id}. Reason: {reason}."
    db.add(AgentLog(ticket_id=ticket_id, agent_name="Escalation Agent", log_level="INFO", message=start_msg))
    db.commit()

    # Retrieve other agent decisions for context
    decisions = db.query(AgentDecision).filter(AgentDecision.ticket_id == ticket_id).all()
    decisions_summary = ""
    for d in decisions:
        decisions_summary += f"- {d.agent_name} ({d.decision_type}): {d.decision_output}\n"

    # Build prompt
    prompt = f"""
    You are the Escalation Agent. This ticket requires human assistance.
    
    Ticket ID: {ticket.id}
    Title: {ticket.title}
    Description: {ticket.description}
    Category: {ticket.category}
    Priority: {ticket.priority}
    
    Escalation Reason: {reason}
    
    Previous Agent Decisions:
    {decisions_summary}
    
    Tasks:
    1. Write a professional, concise summary of the customer's issue and what the AI agents tried to do.
    2. Document clearly why we are escalating (e.g. classifier unsure, planner escalated, verification failed).
    3. Output the structured JSON response.
    """

    # Call LLM
    try:
        result_dict = generate_json(prompt, EscalationOutput)
        result_dict["escalated"] = True
        output = EscalationOutput(**result_dict)
    except Exception as e:
        err_msg = f"Escalation Agent failed during LLM invocation: {str(e)}"
        db.add(AgentLog(ticket_id=ticket_id, agent_name="Escalation Agent", log_level="ERROR", message=err_msg))
        db.commit()
        raise e

    # Save Agent Decision
    decision = AgentDecision(
        ticket_id=ticket_id,
        agent_name="Escalation Agent",
        decision_type="ESCALATION",
        decision_output=json.dumps(result_dict),
        confidence_score=output.confidence
    )
    db.add(decision)
    
    # Log completion
    complete_msg = (
        f"Escalation completed. Reason: '{output.escalation_reason}'. "
        f"Summary for Human: {output.summary_for_human}"
    )
    db.add(AgentLog(ticket_id=ticket_id, agent_name="Escalation Agent", log_level="INFO", message=complete_msg))
    db.commit()

    return output
