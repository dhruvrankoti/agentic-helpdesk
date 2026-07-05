from sqlalchemy.orm import Session
from app.models.agent_log import AgentLog
from app.agents.classifier import run_classifier_agent
from app.agents.planner import run_planner_agent
from app.agents.resolution import run_resolution_agent
from app.agents.verification import run_verification_agent
from app.agents.escalation import run_escalation_agent

def orchestrate_ticket_pipeline(db: Session, ticket_id: int) -> dict:
    """
    Orchestrates the multi-agent pipeline for a single ticket.
    Returns a dictionary summarizing the execution result.
    """
    db.add(AgentLog(ticket_id=ticket_id, agent_name="Orchestrator", log_level="INFO", message="Pipeline started."))
    db.commit()

    try:
        # Step 1: Classification
        classification = run_classifier_agent(db, ticket_id)
        
        # Step 2: Planning
        plan = run_planner_agent(
            db, 
            ticket_id, 
            category=classification.category, 
            urgency=classification.urgency, 
            classifier_confidence=classification.confidence
        )
        
        # Step 3: Branching based on Plan
        if plan.action == "RESOLVE":
            # Step 3.1: Resolution
            resolution = run_resolution_agent(db, ticket_id)
            
            # Step 3.2: Verification
            verification = run_verification_agent(db, ticket_id, proposed_solution=resolution.solution)
            
            if verification.verified:
                db.add(AgentLog(ticket_id=ticket_id, agent_name="Orchestrator", log_level="INFO", message="Pipeline completed successfully. Ticket resolved."))
                db.commit()
                return {"status": "RESOLVED", "reason": "Solution verified"}
            else:
                # Escalation due to failed verification
                escalation_reason = f"Verification failed. Reasoning: {verification.reasoning}"
                run_escalation_agent(db, ticket_id, reason=escalation_reason)
                return {"status": "ESCALATED", "reason": "Verification failed"}
                
        elif plan.action == "CLARIFY":
            # Clarification requested - log and keep ticket in IN_PROGRESS
            # (We could add a specific state, but since we are sticking to enums.py, we keep IN_PROGRESS)
            db.add(AgentLog(ticket_id=ticket_id, agent_name="Orchestrator", log_level="INFO", message=f"Pipeline paused: Clarification requested. Details: {plan.reasoning}"))
            db.commit()
            return {"status": "IN_PROGRESS", "reason": f"Clarification requested: {plan.reasoning}"}
            
        elif plan.action == "ESCALATE":
            # Direct escalation
            run_escalation_agent(db, ticket_id, reason=f"Planner escalated. Reasoning: {plan.reasoning}")
            return {"status": "ESCALATED", "reason": "Planner escalated"}
            
        else:
            raise ValueError(f"Unknown planner action: {plan.action}")
            
    except Exception as e:
        # Graceful fallback: escalate any system error
        error_msg = f"Pipeline execution failed: {str(e)}"
        db.add(AgentLog(ticket_id=ticket_id, agent_name="Orchestrator", log_level="ERROR", message=error_msg))
        db.commit()
        
        try:
            run_escalation_agent(db, ticket_id, reason=f"System Exception: {str(e)}")
            return {"status": "ESCALATED", "reason": f"Pipeline exception: {str(e)}"}
        except Exception as esc_err:
            db.add(AgentLog(ticket_id=ticket_id, agent_name="Orchestrator", log_level="CRITICAL", message=f"Failed to run Escalation Agent: {str(esc_err)}"))
            db.commit()
            return {"status": "ERROR", "reason": f"System error: {str(e)}. Escalation failed: {str(esc_err)}"}
