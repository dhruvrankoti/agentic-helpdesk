import os
import sys
import json

# Add backend directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.config import Base
from app.models.ticket import Ticket
from app.models.knowledge_base import KnowledgeBase
from app.models.agent_decision import AgentDecision
from app.models.agent_log import AgentLog
from app.models.enums import TicketStatus, TicketPriority
from app.agents.orchestrator import orchestrate_ticket_pipeline
from app.agents.gemini_client import get_embedding

# Use local test SQLite database
TEST_DB_URL = "sqlite:///./test_agentic_helpdesk.db"
engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def setup_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    
    # 1. Insert KB Articles with real embeddings from Gemini
    print("Generating embeddings for test Knowledge Base articles...")
    kb1_content = "To reset your password: Go to the login page, click 'Forgot Password', enter your email, and follow the link sent to your inbox to set a new password."
    kb2_content = "Our refund policy allows refunds within 14 days of purchase. To request a refund, please send your order ID to billing@example.com."
    
    kb1_emb = get_embedding(kb1_content)
    kb2_emb = get_embedding(kb2_content)
    
    articles = [
        KnowledgeBase(
            title="How to Reset Password",
            content=kb1_content,
            category="Account Access",
            embedding=json.dumps(kb1_emb)
        ),
        KnowledgeBase(
            title="Refund Policy Guidelines",
            content=kb2_content,
            category="Billing",
            embedding=json.dumps(kb2_emb)
        )
    ]
    db.add_all(articles)
    db.commit()
    db.close()
    print("SUCCESS: Setup test database successfully.")

def test_resolvable_ticket():
    db = TestingSessionLocal()
    try:
        # Create ticket
        ticket = Ticket(
            title="Forgot password, need help",
            description="I tried logging into my account but I forgot my password and there is no reset link on the mobile app. How can I reset my password?",
            category="Technical Support",
            priority=TicketPriority.MEDIUM,
            status=TicketStatus.NEW
        )
        db.add(ticket)
        db.commit()
        db.refresh(ticket)
        ticket_id = ticket.id
        print(f"\nRunning pipeline on resolvable ticket #{ticket_id}: '{ticket.title}'")

        # Run pipeline
        result = orchestrate_ticket_pipeline(db, ticket_id)
        db.refresh(ticket)
        
        print(f"Pipeline Result: {result}")
        print(f"Final Ticket Status: {ticket.status}")
        
        # Verify decisions were saved
        decisions = db.query(AgentDecision).filter(AgentDecision.ticket_id == ticket_id).all()
        print(f"Agent Decisions Recorded ({len(decisions)}):")
        for dec in decisions:
            print(f" - {dec.agent_name}: {dec.decision_type} (Confidence: {dec.confidence_score:.2f})")
        
        assert ticket.status == TicketStatus.RESOLVED, "Resolvable ticket should end up as RESOLVED"
        assert len(decisions) >= 4, "Should have Classifier, Planner, Resolution, and Verification decisions"
        print("SUCCESS: Resolvable ticket test PASSED!")
    finally:
        db.close()

def test_escalated_ticket():
    db = TestingSessionLocal()
    try:
        # Create ticket
        ticket = Ticket(
            title="CRITICAL: Database SQL injection vulnerability",
            description="Our security scanner detected a SQL injection endpoint on our main production website that allows attackers to read arbitrary tables.",
            category="Technical Support",
            priority=TicketPriority.HIGH,
            status=TicketStatus.NEW
        )
        db.add(ticket)
        db.commit()
        db.refresh(ticket)
        ticket_id = ticket.id
        print(f"\nRunning pipeline on critical escalation ticket #{ticket_id}: '{ticket.title}'")

        # Run pipeline
        result = orchestrate_ticket_pipeline(db, ticket_id)
        db.refresh(ticket)
        
        print(f"Pipeline Result: {result}")
        print(f"Final Ticket Status: {ticket.status}")
        
        # Verify decisions were saved
        decisions = db.query(AgentDecision).filter(AgentDecision.ticket_id == ticket_id).all()
        print(f"Agent Decisions Recorded ({len(decisions)}):")
        for dec in decisions:
            print(f" - {dec.agent_name}: {dec.decision_type} (Confidence: {dec.confidence_score:.2f})")
            
        assert ticket.status == TicketStatus.ESCALATED, "Critical security ticket should end up as ESCALATED"
        print("SUCCESS: Escalated ticket test PASSED!")
    finally:
        db.close()

if __name__ == "__main__":
    setup_database()
    test_resolvable_ticket()
    test_escalated_ticket()
    
    # Cleanup
    engine.dispose()
    if os.path.exists("./test_agentic_helpdesk.db"):
        try:
            os.remove("./test_agentic_helpdesk.db")
            print("Removed test database file.")
        except Exception as e:
            print(f"Could not remove test DB: {e}")
