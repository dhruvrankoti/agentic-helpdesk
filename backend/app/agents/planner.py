import json
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from app.agents.gemini_client import generate_json
from app.models.ticket import Ticket
from app.models.agent_decision import AgentDecision
from app.models.agent_log import AgentLog

class PlannerOutput(BaseModel):
    action: str = Field(description="The planned next action for the ticket. Must be one of: 'RESOLVE', 'CLARIFY', 'ESCALATE'.")
    confidence: float = Field(description="Confidence score for this decision (0.0 to 1.0).")
    reasoning: str = Field(description="Clear explanation of the decided plan, stating why this action was selected.")

def run_planner_agent(db: Session, ticket_id: int, category: str, urgency: str, classifier_confidence: float) -> PlannerOutput:
    # Fetch ticket
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise ValueError(f"Ticket #{ticket_id} not found")

    # Log start
    start_msg = f"Planner Agent starting decision process for Ticket #{ticket_id}. Inputs: Category='{category}', Urgency='{urgency}', Classifier Confidence={classifier_confidence:.2f}"
    db.add(AgentLog(ticket_id=ticket_id, agent_name="Planner Agent", log_level="INFO", message=start_msg))
    db.commit()

    # Build prompt
    prompt = f"""
    You are the Planner Agent. Determine the best next action for this customer support ticket.
    
    Ticket ID: {ticket.id}
    Title: {ticket.title}
    Description: {ticket.description}
    Classified Category: {category}
    Assessed Urgency: {urgency}
    Classifier Confidence: {classifier_confidence}
    
    Determine which action to take:
    - 'RESOLVE': Select this if the issue is clear, matches standard support domains (Technical Support, Billing, Account Access, General Inquiry), and we have a high chance of auto-resolving it.
    - 'CLARIFY': Select this if the ticket description is vague, incomplete, or missing critical info needed to fix it.
    - 'ESCALATE': Select this if the issue involves highly critical systems, security breaches, custom requests beyond general automation, or if the classifier confidence is very low (< 0.5) and urgency is HIGH.
    """

    # Call LLM
    try:
        result_dict = generate_json(prompt, PlannerOutput)
        # Ensure action is valid
        action = result_dict.get("action", "").upper()
        if action not in ["RESOLVE", "CLARIFY", "ESCALATE"]:
            action = "ESCALATE" # Fallback
        result_dict["action"] = action
        output = PlannerOutput(**result_dict)
    except Exception as e:
        err_msg = f"Planner Agent failed during LLM invocation: {str(e)}"
        db.add(AgentLog(ticket_id=ticket_id, agent_name="Planner Agent", log_level="ERROR", message=err_msg))
        db.commit()
        raise e

    # Save Agent Decision
    decision = AgentDecision(
        ticket_id=ticket_id,
        agent_name="Planner Agent",
        decision_type="PLANNING",
        decision_output=json.dumps(result_dict),
        confidence_score=output.confidence
    )
    db.add(decision)
    db.commit()

    # Log completion
    complete_msg = (
        f"Planner completed. Action selected: '{output.action}', "
        f"Confidence: {output.confidence:.2f}. "
        f"Reasoning: {output.reasoning}"
    )
    db.add(AgentLog(ticket_id=ticket_id, agent_name="Planner Agent", log_level="INFO", message=complete_msg))
    db.commit()

    return output
