from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.db.config import get_db
from app.models.agent_log import AgentLog
from app.schemas.agent_log import AgentLogResponse

router = APIRouter(prefix="/agent-logs", tags=["Agent Logs"])

@router.get("/ticket/{ticket_id}", response_model=List[AgentLogResponse])
async def get_ticket_agent_logs(ticket_id: int, db: Session = Depends(get_db)):
    logs = db.query(AgentLog).filter(
        AgentLog.ticket_id == ticket_id
    ).order_by(AgentLog.created_at.asc()).all()
    return logs
