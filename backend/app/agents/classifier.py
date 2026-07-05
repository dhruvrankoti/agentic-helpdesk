import json
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from app.agents.gemini_client import generate_json
from app.models.ticket import Ticket
from app.models.agent_decision import AgentDecision
from app.models.agent_log import AgentLog
from app.models.enums import TicketPriority

class ClassificationOutput(BaseModel):
    category: str = Field(description="The primary category of the ticket. E.g., 'Technical Support', 'Billing', 'Account Access', or 'General Inquiry'.")
    urgency: str = Field(description="Urgency level, must be one of: 'LOW', 'MEDIUM', 'HIGH'.")
    confidence: float = Field(description="Confidence score between 0.0 and 1.0.")
    reasoning: str = Field(description="A brief explanation of why this category and urgency were selected.")

def run_classifier_agent(db: Session, ticket_id: int) -> ClassificationOutput:
    # 1. Fetch ticket
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise ValueError(f"Ticket #{ticket_id} not found")

    # Log start
    start_msg = f"Classifier Agent starting analysis for Ticket #{ticket_id}: '{ticket.title}'"
    db.add(AgentLog(ticket_id=ticket_id, agent_name="Classifier Agent", log_level="INFO", message=start_msg))
    db.commit()

    # 2. Build prompt
    prompt = f"""
    Analyze the following support ticket and classify it:
    
    Ticket ID: {ticket.id}
    Title: {ticket.title}
    Description: {ticket.description}
    
    Tasks:
    1. Identify the domain/category of the issue (e.g., Technical Support, Billing, Account Access, General Inquiry).
    2. Estimate the urgency/priority (LOW, MEDIUM, HIGH) based on the severity of the user's issue.
    3. Calculate a confidence score (0.0 to 1.0) for your classification.
    4. Provide your logical reasoning.
    """

    # 3. Call LLM
    try:
        result_dict = generate_json(prompt, ClassificationOutput)
        output = ClassificationOutput(**result_dict)
    except Exception as e:
        err_msg = f"Classifier Agent failed during LLM invocation: {str(e)}"
        db.add(AgentLog(ticket_id=ticket_id, agent_name="Classifier Agent", log_level="ERROR", message=err_msg))
        db.commit()
        raise e

    # 4. Save Agent Decision
    decision = AgentDecision(
        ticket_id=ticket_id,
        agent_name="Classifier Agent",
        decision_type="CLASSIFICATION",
        decision_output=json.dumps(result_dict),
        confidence_score=output.confidence
    )
    db.add(decision)

    # 5. Update ticket with classified category and priority
    ticket.category = output.category
    try:
        ticket.priority = TicketPriority(output.urgency)
    except ValueError:
        # Fallback to MEDIUM if invalid enum value returned
        ticket.priority = TicketPriority.MEDIUM
    
    db.commit()

    # Log completion
    complete_msg = (
        f"Classifier completed. Category: '{output.category}', "
        f"Urgency: '{output.urgency}', Confidence: {output.confidence:.2f}. "
        f"Reasoning: {output.reasoning}"
    )
    db.add(AgentLog(ticket_id=ticket_id, agent_name="Classifier Agent", log_level="INFO", message=complete_msg))
    db.commit()

    return output
