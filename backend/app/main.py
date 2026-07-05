from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db.init_db import create_tables
from app.api.tickets import router as ticket_router
from app.api.agent_decisions import router as agent_decision_router
from app.api.knowledge_base import router as kb_router
from app.api.agent_logs import router as log_router

app = FastAPI(
    title="Agentic Helpdesk API",
    description="Backend API for autonomous ticket resolution system",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In development, allow all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create tables on startup
@app.on_event("startup")
async def startup_event():
    create_tables()

# Include routers
app.include_router(ticket_router)
app.include_router(agent_decision_router)
app.include_router(kb_router)
app.include_router(log_router)

@app.get("/health")
async def health_check():
    return {"status": "ok"}
