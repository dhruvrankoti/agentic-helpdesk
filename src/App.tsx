import { useState, useEffect, useRef } from 'react';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface Ticket {
  id: number;
  title: string;
  description: string;
  category: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'NEW' | 'IN_PROGRESS' | 'RESOLVED' | 'ESCALATED';
  created_at: string;
  updated_at: string;
}

interface AgentDecision {
  id: number;
  ticket_id: number;
  agent_name: string;
  decision_type: string;
  decision_output: string;
  confidence_score: number;
  created_at: string;
}

interface AgentLog {
  id: number;
  ticket_id: number;
  agent_name: string;
  log_level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  message: string;
  created_at: string;
}

interface KBArticle {
  id: number;
  title: string;
  content: string;
  category: string;
  created_at: string;
}

interface KBSearchResult {
  id: number;
  title: string;
  content: string;
  category: string;
  similarity_score: number;
}

// Custom Safe Markdown Parser
const formatBold = (text: string) => {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/`(.*?)`/g, '<code class="inline-code">$1</code>');
  return html;
};

const renderMarkdown = (text: string) => {
  if (!text) return null;
  const paragraphs = text.split('\n\n');
  return paragraphs.map((para, idx) => {
    const trimmed = para.trim();
    if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
      const items = trimmed.split('\n').map(line => line.trim().substring(2));
      return (
        <ul key={idx} className="md-list">
          {items.map((item, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: formatBold(item) }} />
          ))}
        </ul>
      );
    }
    
    if (/^\d+\./.test(trimmed)) {
      const items = trimmed.split('\n').map(line => {
        const match = line.trim().match(/^\d+\.\s*(.*)/);
        return match ? match[1] : line;
      });
      return (
        <ol key={idx} className="md-ol">
          {items.map((item, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: formatBold(item) }} />
          ))}
        </ol>
      );
    }

    if (trimmed.startsWith('###')) {
      return <h4 key={idx} className="md-h4">{trimmed.replace('###', '').trim()}</h4>;
    }
    if (trimmed.startsWith('##')) {
      return <h3 key={idx} className="md-h3">{trimmed.replace('##', '').trim()}</h3>;
    }

    return (
      <p key={idx} className="md-para" dangerouslySetInnerHTML={{ __html: formatBold(trimmed) }} />
    );
  });
};

function App() {
  const [activeTab, setActiveTab] = useState<'tickets' | 'kb' | 'insights'>('tickets');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [decisions, setDecisions] = useState<AgentDecision[]>([]);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [kbArticles, setKbArticles] = useState<KBArticle[]>([]);
  
  const [ticketSearch, setTicketSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  
  const [kbSearchQuery, setKbSearchQuery] = useState('');
  const [kbSearchResults, setKbSearchResults] = useState<KBSearchResult[]>([]);
  const [isSearchingKB, setIsSearchingKB] = useState(false);

  const [isCreatingTicket, setIsCreatingTicket] = useState(false);
  const [isCreatingKB, setIsCreatingKB] = useState(false);
  
  const [newTicket, setNewTicket] = useState({
    title: '',
    description: '',
    category: 'Technical Support',
    priority: 'MEDIUM' as const
  });
  
  const [newKB, setNewKB] = useState({
    title: '',
    content: '',
    category: 'Technical Support'
  });

  const [isPipelineRunning, setIsPipelineRunning] = useState(false);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetchTickets();
    fetchKBArticles();
  }, []);

  useEffect(() => {
    if (selectedTicket && (selectedTicket.status === 'NEW' || selectedTicket.status === 'IN_PROGRESS') && isPipelineRunning) {
      pollingIntervalRef.current = setInterval(() => {
        pollTicketDetails(selectedTicket.id);
      }, 1500);
    } else {
      stopPolling();
    }
    
    return () => stopPolling();
  }, [selectedTicket, isPipelineRunning]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  const fetchTickets = async () => {
    try {
      const res = await fetch(`${API_BASE}/tickets/`);
      if (res.ok) {
        const data = await res.json();
        setTickets(data);
        if (selectedTicket) {
          const updated = data.find((t: Ticket) => t.id === selectedTicket.id);
          if (updated) setSelectedTicket(updated);
        }
      }
    } catch (err) {
      console.error('Error fetching tickets:', err);
    }
  };

  const fetchTicketDetails = async (id: number) => {
    try {
      const ticketRes = await fetch(`${API_BASE}/tickets/${id}`);
      if (ticketRes.ok) {
        const ticketData = await ticketRes.json();
        setSelectedTicket(ticketData);
      }
      const decRes = await fetch(`${API_BASE}/agent-decisions/ticket/${id}`);
      if (decRes.ok) {
        const decData = await decRes.json();
        setDecisions(decData);
      }
      const logRes = await fetch(`${API_BASE}/agent-logs/ticket/${id}`);
      if (logRes.ok) {
        const logData = await logRes.json();
        setLogs(logData);
      }
    } catch (err) {
      console.error('Error fetching ticket details:', err);
    }
  };

  const pollTicketDetails = async (id: number) => {
    try {
      const ticketRes = await fetch(`${API_BASE}/tickets/${id}`);
      if (ticketRes.ok) {
        const ticketData: Ticket = await ticketRes.json();
        setSelectedTicket(ticketData);
        setTickets(prev => prev.map(t => t.id === id ? ticketData : t));

        const decRes = await fetch(`${API_BASE}/agent-decisions/ticket/${id}`);
        const logRes = await fetch(`${API_BASE}/agent-logs/ticket/${id}`);
        
        if (decRes.ok) setDecisions(await decRes.json());
        if (logRes.ok) setLogs(await logRes.json());

        if (ticketData.status === 'RESOLVED' || ticketData.status === 'ESCALATED') {
          setIsPipelineRunning(false);
          stopPolling();
          fetchTickets();
        }
      }
    } catch (err) {
      console.error('Error polling ticket:', err);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/tickets/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTicket)
      });
      if (res.ok) {
        const data = await res.json();
        setTickets([data, ...tickets]);
        setIsCreatingTicket(false);
        setNewTicket({
          title: '',
          description: '',
          category: 'Technical Support',
          priority: 'MEDIUM'
        });
        setSelectedTicket(data);
        setDecisions([]);
        setLogs([]);
      }
    } catch (err) {
      console.error('Error creating ticket:', err);
    }
  };

  const handleRunPipeline = async (id: number) => {
    setIsPipelineRunning(true);
    setDecisions([]);
    setLogs([]);
    try {
      const res = await fetch(`${API_BASE}/tickets/${id}/run-pipeline`, {
        method: 'POST'
      });
      if (!res.ok) {
        setIsPipelineRunning(false);
      }
    } catch (err) {
      console.error('Error running agent pipeline:', err);
      setIsPipelineRunning(false);
    }
  };

  const fetchKBArticles = async () => {
    try {
      const res = await fetch(`${API_BASE}/knowledge-base/`);
      if (res.ok) {
        const data = await res.json();
        setKbArticles(data);
      }
    } catch (err) {
      console.error('Error fetching KB articles:', err);
    }
  };

  const handleCreateKB = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/knowledge-base/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newKB)
      });
      if (res.ok) {
        const data = await res.json();
        setKbArticles([data, ...kbArticles]);
        setIsCreatingKB(false);
        setNewKB({ title: '', content: '', category: 'Technical Support' });
      }
    } catch (err) {
      console.error('Error creating KB article:', err);
    }
  };

  const handleKBSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kbSearchQuery.trim()) return;
    setIsSearchingKB(true);
    try {
      const res = await fetch(`${API_BASE}/knowledge-base/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: kbSearchQuery, limit: 5 })
      });
      if (res.ok) {
        const data = await res.json();
        setKbSearchResults(data);
      }
    } catch (err) {
      console.error('Error searching KB:', err);
    } finally {
      setIsSearchingKB(false);
    }
  };

  const parseDecisionOutput = (outputStr: string) => {
    try {
      return JSON.parse(outputStr);
    } catch {
      return { output: outputStr };
    }
  };

  const filteredTickets = tickets.filter(t => {
    const matchesSearch = t.title.toLowerCase().includes(ticketSearch.toLowerCase()) || 
                          t.description.toLowerCase().includes(ticketSearch.toLowerCase()) ||
                          t.category.toLowerCase().includes(ticketSearch.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || t.status === statusFilter;
    const matchesPriority = priorityFilter === 'ALL' || t.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const totalCount = tickets.length;
  const resolvedCount = tickets.filter(t => t.status === 'RESOLVED').length;
  const escalatedCount = tickets.filter(t => t.status === 'ESCALATED').length;
  const inProgressCount = tickets.filter(t => t.status === 'IN_PROGRESS').length;
  const newCount = tickets.filter(t => t.status === 'NEW').length;
  const resolutionRate = totalCount > 0 ? (resolvedCount / totalCount) * 100 : 0;
  const escalationRate = totalCount > 0 ? (escalatedCount / totalCount) * 100 : 0;

  const getPriorityBadgeClass = (p: string) => {
    if (p === 'HIGH') return 'badge badge-high';
    if (p === 'MEDIUM') return 'badge badge-med';
    return 'badge badge-low';
  };

  const getStatusBadgeClass = (s: string) => {
    if (s === 'RESOLVED') return 'badge badge-resolved';
    if (s === 'ESCALATED') return 'badge badge-escalated';
    if (s === 'IN_PROGRESS') return 'badge badge-progress';
    return 'badge badge-new';
  };

  const getStageStatus = (stage: string) => {
    if (!selectedTicket) return 'pending';
    
    const hasClassifier = decisions.some(d => d.agent_name === 'Classifier Agent');
    const hasPlanner = decisions.some(d => d.agent_name === 'Planner Agent');
    const hasResolution = decisions.some(d => d.agent_name === 'Resolution Agent');
    const hasVerification = decisions.some(d => d.agent_name === 'Verification Agent');
    const hasEscalation = decisions.some(d => d.agent_name === 'Escalation Agent');

    const plannerDecision = decisions.find(d => d.agent_name === 'Planner Agent');
    const plannerAction = plannerDecision ? parseDecisionOutput(plannerDecision.decision_output).action : '';

    if (stage === 'CLASSIFIER') {
      if (hasClassifier) return 'success';
      return isPipelineRunning ? 'active' : 'pending';
    }
    if (stage === 'PLANNER') {
      if (hasPlanner) return 'success';
      if (hasClassifier && isPipelineRunning) return 'active';
      return 'pending';
    }
    if (stage === 'RESOLUTION') {
      if (plannerAction === 'ESCALATE' || plannerAction === 'CLARIFY') return 'skipped';
      if (hasResolution) return 'success';
      if (hasPlanner && plannerAction === 'RESOLVE' && isPipelineRunning) return 'active';
      return 'pending';
    }
    if (stage === 'VERIFICATION') {
      if (plannerAction === 'ESCALATE' || plannerAction === 'CLARIFY') return 'skipped';
      if (hasVerification) return 'success';
      if (hasResolution && isPipelineRunning) return 'active';
      return 'pending';
    }
    if (stage === 'ESCALATION') {
      if (hasEscalation) return 'success';
      if (selectedTicket.status === 'ESCALATED') return 'success';
      if (plannerAction === 'ESCALATE' && isPipelineRunning) return 'active';
      return 'pending';
    }
    if (stage === 'COMPLETE') {
      if (selectedTicket.status === 'RESOLVED') return 'success';
      if (selectedTicket.status === 'ESCALATED') return 'escalated';
      return 'pending';
    }
    return 'pending';
  };

  const getDecisionCardClass = (name: string) => {
    if (name === 'Classifier Agent') return 'decision-box decision-classifier';
    if (name === 'Planner Agent') return 'decision-box decision-planner';
    if (name === 'Resolution Agent') return 'decision-box decision-resolution';
    if (name === 'Verification Agent') return 'decision-box decision-verification';
    return 'decision-box decision-escalation';
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo-section">
          <div className="logo-icon">🤖</div>
          <div>
            <h2>Antigravity</h2>
            <span className="logo-subtitle">Agentic Helpdesk</span>
          </div>
        </div>
        
        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${activeTab === 'tickets' ? 'active' : ''}`}
            onClick={() => setActiveTab('tickets')}
          >
            <span className="nav-icon">🎟️</span> Tickets Workspace
          </button>
          
          <button 
            className={`nav-item ${activeTab === 'kb' ? 'active' : ''}`}
            onClick={() => setActiveTab('kb')}
          >
            <span className="nav-icon">📚</span> Knowledge Base
          </button>
          
          <button 
            className={`nav-item ${activeTab === 'insights' ? 'active' : ''}`}
            onClick={() => setActiveTab('insights')}
          >
            <span className="nav-icon">📊</span> Insights & Metrics
          </button>
        </nav>

        <div className="connection-status">
          <span className="status-dot online"></span>
          <span>FastAPI Service Online</span>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        
        {/* TOPBAR */}
        <header className="topbar">
          <div className="topbar-left">
            <h1>{activeTab === 'tickets' ? 'Support Tickets Workspace' : activeTab === 'kb' ? 'Knowledge Base Manager' : 'Operational Insights'}</h1>
            <p className="subtitle">
              {activeTab === 'tickets' 
                ? 'Review, trace, and trigger multi-agent autonomous support resolution flows.' 
                : activeTab === 'kb' 
                  ? 'Manage reference articles and test semantic similarity searches.' 
                  : 'Aggregate operational performance and agent efficiency scores.'}
            </p>
          </div>
          <div className="topbar-right">
            {activeTab === 'tickets' && (
              <button className="btn btn-primary" onClick={() => setIsCreatingTicket(true)}>
                + Create Ticket
              </button>
            )}
            {activeTab === 'kb' && (
              <button className="btn btn-primary" onClick={() => setIsCreatingKB(true)}>
                + Add KB Article
              </button>
            )}
          </div>
        </header>

        {/* TAB CONTENTS */}

        {/* 1. TICKETS TAB */}
        {activeTab === 'tickets' && (
          <div className="tab-tickets-layout">
            
            {/* LEFT COLUMN: TICKETS LIST */}
            <section className="tickets-list-panel">
              <div className="filter-bar">
                <input 
                  type="text" 
                  placeholder="Search tickets..." 
                  className="search-input"
                  value={ticketSearch}
                  onChange={e => setTicketSearch(e.target.value)}
                />
                
                <div className="select-filters">
                  <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                    <option value="ALL">All Statuses</option>
                    <option value="NEW">New</option>
                    <option value="IN_PROGRESS">In Progress</option>
                    <option value="RESOLVED">Resolved</option>
                    <option value="ESCALATED">Escalated</option>
                  </select>

                  <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
                    <option value="ALL">All Priorities</option>
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                  </select>
                </div>
              </div>

              <div className="tickets-scroll-list">
                {filteredTickets.length === 0 ? (
                  <div className="empty-state">
                    <p>No tickets match your filters.</p>
                  </div>
                ) : (
                  filteredTickets.map(ticket => (
                    <div 
                      key={ticket.id} 
                      className={`ticket-card ${selectedTicket?.id === ticket.id ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedTicket(ticket);
                        fetchTicketDetails(ticket.id);
                        setIsPipelineRunning(false);
                      }}
                    >
                      <div className="ticket-card-header">
                        <span className="category-tag">{ticket.category}</span>
                        <span className={getPriorityBadgeClass(ticket.priority)}>{ticket.priority}</span>
                      </div>
                      <h3 className="ticket-card-title">{ticket.title}</h3>
                      <p className="ticket-card-desc">{ticket.description}</p>
                      <div className="ticket-card-footer">
                        <span className={getStatusBadgeClass(ticket.status)}>{ticket.status}</span>
                        <span className="ticket-date">{new Date(ticket.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* RIGHT COLUMN: DETAIL WORKSPACE */}
            <section className="ticket-workspace-panel">
              {selectedTicket ? (
                <div className="workspace-scroll-container">
                  
                  {/* WORKSPACE HEADER */}
                  <div className="workspace-header">
                    <div className="workspace-title-info">
                      <h2>Ticket #{selectedTicket.id}: {selectedTicket.title}</h2>
                      <div className="workspace-badges">
                        <span className="category-tag large">{selectedTicket.category}</span>
                        <span className={getPriorityBadgeClass(selectedTicket.priority)}>{selectedTicket.priority}</span>
                        <span className={getStatusBadgeClass(selectedTicket.status)}>{selectedTicket.status}</span>
                      </div>
                    </div>
                    
                    <div className="workspace-actions">
                      <button 
                        className={`btn btn-run ${isPipelineRunning ? 'running' : ''}`}
                        onClick={() => handleRunPipeline(selectedTicket.id)}
                        disabled={isPipelineRunning}
                      >
                        {isPipelineRunning ? (
                          <>
                            <span className="spinner"></span> Running Agents...
                          </>
                        ) : '🤖 Run Agent Pipeline'}
                      </button>
                    </div>
                  </div>

                  {/* TICKET DESCRIPTION */}
                  <div className="workspace-card description-card">
                    <h3>Ticket Description</h3>
                    <p className="description-text">{selectedTicket.description}</p>
                    <span className="creation-timestamp">Created: {new Date(selectedTicket.created_at).toLocaleString()}</span>
                  </div>

                  {/* MULTI-AGENT PIPELINE TIMELINE */}
                  <div className="workspace-card pipeline-card">
                    <h3>Multi-Agent Decision Pipeline</h3>
                    <div className="pipeline-timeline">
                      
                      <div className={`timeline-step ${getStageStatus('CLASSIFIER')}`}>
                        <div className="step-node">1</div>
                        <div className="step-details">
                          <h4>Classifier Agent</h4>
                          <span className="step-status-text">
                            {getStageStatus('CLASSIFIER') === 'success' ? 'Categorized' : getStageStatus('CLASSIFIER') === 'active' ? 'Analyzing...' : 'Pending'}
                          </span>
                        </div>
                      </div>

                      <div className={`timeline-step ${getStageStatus('PLANNER')}`}>
                        <div className="step-node">2</div>
                        <div className="step-details">
                          <h4>Planner Agent</h4>
                          <span className="step-status-text">
                            {getStageStatus('PLANNER') === 'success' ? 'Action Chosen' : getStageStatus('PLANNER') === 'active' ? 'Planning...' : 'Pending'}
                          </span>
                        </div>
                      </div>

                      <div className={`timeline-step ${getStageStatus('RESOLUTION')}`}>
                        <div className="step-node">3</div>
                        <div className="step-details">
                          <h4>Resolution Agent</h4>
                          <span className="step-status-text">
                            {getStageStatus('RESOLUTION') === 'success' ? 'Solution Drafted' : getStageStatus('RESOLUTION') === 'active' ? 'Drafting...' : getStageStatus('RESOLUTION') === 'skipped' ? 'Skipped' : 'Pending'}
                          </span>
                        </div>
                      </div>

                      <div className={`timeline-step ${getStageStatus('VERIFICATION')}`}>
                        <div className="step-node">4</div>
                        <div className="step-details">
                          <h4>Verification Agent</h4>
                          <span className="step-status-text">
                            {getStageStatus('VERIFICATION') === 'success' ? 'Verified' : getStageStatus('VERIFICATION') === 'active' ? 'Verifying...' : getStageStatus('VERIFICATION') === 'skipped' ? 'Skipped' : 'Pending'}
                          </span>
                        </div>
                      </div>

                      <div className={`timeline-step ${getStageStatus('ESCALATION')}`}>
                        <div className="step-node">🚨</div>
                        <div className="step-details">
                          <h4>Escalation Agent</h4>
                          <span className="step-status-text">
                            {getStageStatus('ESCALATION') === 'success' ? 'Escalated' : getStageStatus('ESCALATION') === 'active' ? 'Escalating...' : 'Pending'}
                          </span>
                        </div>
                      </div>

                      <div className={`timeline-step ${getStageStatus('COMPLETE')}`}>
                        <div className="step-node">✔</div>
                        <div className="step-details">
                          <h4>Final Outcome</h4>
                          <span className="step-status-text">
                            {selectedTicket.status === 'RESOLVED' ? 'RESOLVED' : selectedTicket.status === 'ESCALATED' ? 'ESCALATED' : 'Pending'}
                          </span>
                        </div>
                      </div>

                    </div>
                  </div>

                  {/* AGENT DECISIONS OUTPUTS */}
                  {decisions.length > 0 && (
                    <div className="workspace-card decisions-card">
                      <h3>Agent Decisions & Rationale</h3>
                      <div className="decisions-container">
                        {decisions.map(dec => {
                          const parsed = parseDecisionOutput(dec.decision_output);
                          return (
                            <div key={dec.id} className={getDecisionCardClass(dec.agent_name)}>
                              <div className="decision-box-header">
                                <span className="decision-agent-badge">{dec.agent_name}</span>
                                <div className="decision-score">
                                  <span>Confidence:</span>
                                  <span className="score-badge">{(dec.confidence_score * 100).toFixed(0)}%</span>
                                </div>
                              </div>
                              <div className="decision-box-body">
                                
                                {dec.agent_name === 'Classifier Agent' && (
                                  <>
                                    <div className="decision-field"><strong>Classified Category:</strong> <span className="highlight-val">{parsed.category}</span></div>
                                    <div className="decision-field"><strong>Assessed Urgency:</strong> <span className="highlight-val">{parsed.urgency}</span></div>
                                    <div className="decision-field"><strong>Reasoning:</strong> <span className="reasoning-text">{parsed.reasoning}</span></div>
                                  </>
                                )}

                                {dec.agent_name === 'Planner Agent' && (
                                  <>
                                    <div className="decision-field">
                                      <strong>Next Step Action:</strong> 
                                      <span className={`badge ${parsed.action === 'RESOLVE' ? 'badge-resolved' : parsed.action === 'ESCALATE' ? 'badge-escalated' : 'badge-progress'}`}>
                                        {parsed.action}
                                      </span>
                                    </div>
                                    <div className="decision-field"><strong>Plan Details:</strong> <span className="reasoning-text">{parsed.reasoning}</span></div>
                                  </>
                                )}

                                {dec.agent_name === 'Resolution Agent' && (
                                  <>
                                    <div className="decision-field"><strong>Proposed Solution:</strong></div>
                                    <div className="solution-markdown-container">
                                      {renderMarkdown(parsed.solution)}
                                    </div>
                                    {parsed.referenced_kb_ids && parsed.referenced_kb_ids.length > 0 && (
                                      <div className="decision-field" style={{ marginTop: '14px' }}>
                                        <strong>Referenced KB ID(s):</strong> <span className="kb-ref-links">#{parsed.referenced_kb_ids.join(', #')}</span>
                                      </div>
                                    )}
                                    <div className="decision-field" style={{ marginTop: '10px' }}>
                                      <strong>Resolution Logic:</strong> <span className="reasoning-text">{parsed.reasoning}</span>
                                    </div>
                                  </>
                                )}

                                {dec.agent_name === 'Verification Agent' && (
                                  <>
                                    <div className="decision-field">
                                      <strong>Verification Status:</strong> 
                                      <span className={`badge ${parsed.verified ? 'badge-resolved' : 'badge-escalated'}`}>
                                        {parsed.verified ? 'VERIFIED' : 'REJECTED'}
                                      </span>
                                    </div>
                                    <div className="decision-field"><strong>Evaluation Notes:</strong> <span className="reasoning-text">{parsed.reasoning}</span></div>
                                  </>
                                )}

                                {dec.agent_name === 'Escalation Agent' && (
                                  <>
                                    <div className="decision-field"><strong>Escalation Reason:</strong> <span className="highlight-val color-err">{parsed.escalation_reason}</span></div>
                                    <div className="decision-field" style={{ marginTop: '6px' }}><strong>Summary for Human Agent:</strong></div>
                                    <div className="escalation-summary-box">
                                      {parsed.summary_for_human}
                                    </div>
                                  </>
                                )}

                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* OBSERVABILITY CONSOLE (LOGS) */}
                  <div className="workspace-card console-card">
                    <div className="console-header">
                      <h3>Observability Logs Console</h3>
                      <span className="console-indicator">Active</span>
                    </div>
                    
                    <div className="terminal-container">
                      <div className="terminal-window-bar">
                        <div className="terminal-window-dots">
                          <span className="t-dot t-dot-red"></span>
                          <span className="t-dot t-dot-yellow"></span>
                          <span className="t-dot t-dot-green"></span>
                        </div>
                        <span className="terminal-window-title">bash - agent_stream.log</span>
                      </div>
                      
                      <div className="console-terminal">
                        {logs.length === 0 ? (
                          <div className="console-line system-line">[SYSTEM] Terminal initialized. Waiting for agent pipeline triggers...</div>
                        ) : (
                          logs.map(log => {
                            const dateStr = new Date(log.created_at).toLocaleTimeString();
                            let lineClass = 'info';
                            if (log.log_level === 'WARNING') lineClass = 'warning';
                            if (log.log_level === 'ERROR' || log.log_level === 'CRITICAL') lineClass = 'error';
                            
                            return (
                              <div key={log.id} className={`console-line ${lineClass}-line`}>
                                <span className="log-time">[{dateStr}]</span>
                                <span className="log-agent">[{log.agent_name}]</span>
                                <span className="log-level">[{log.log_level}]</span>
                                <span className="log-msg">{log.message}</span>
                              </div>
                            );
                          })
                        )}
                        <div ref={terminalEndRef} />
                      </div>
                    </div>
                  </div>

                </div>
              ) : (
                <div className="workspace-empty">
                  <span className="workspace-empty-icon">🎟️</span>
                  <h3>Select a Ticket</h3>
                  <p>Choose a support ticket from the list or create a new one to view details and execute AI agent reasoning.</p>
                </div>
              )}
            </section>

          </div>
        )}

        {/* 2. KNOWLEDGE BASE TAB */}
        {activeTab === 'kb' && (
          <div className="tab-kb-layout">
            
            {/* SEMANTIC SEARCH SANDBOX */}
            <section className="kb-sandbox-panel">
              <div className="workspace-card">
                <h3>Semantic Search Testing Sandbox</h3>
                <p className="subtitle">
                  Verify how your tickets map to KB articles. Enter a query to run a real-time semantic embedding similarity search against your SQLite database.
                </p>
                <form onSubmit={handleKBSearch} className="kb-search-form">
                  <input 
                    type="text" 
                    placeholder="Enter query (e.g., 'cannot connect to server' or 'refund policy')"
                    className="search-input"
                    value={kbSearchQuery}
                    onChange={e => setKbSearchQuery(e.target.value)}
                  />
                  <button type="submit" className="btn btn-primary" disabled={isSearchingKB}>
                    {isSearchingKB ? 'Embedding & Searching...' : 'Search KB'}
                  </button>
                </form>

                {kbSearchResults.length > 0 && (
                  <div className="search-results">
                    <h4>Search Matches (Cosine Similarity)</h4>
                    <div className="results-list">
                      {kbSearchResults.map(res => (
                        <div key={res.id} className="search-result-card">
                          <div className="result-card-header">
                            <span className="category-tag">{res.category}</span>
                            <span className="similarity-badge">
                              Match: {(res.similarity_score * 100).toFixed(1)}%
                            </span>
                          </div>
                          <h4>{res.title}</h4>
                          <p>{res.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* KB ARTICLES LIST */}
            <section className="kb-list-panel">
              <div className="workspace-card">
                <h3>All Knowledge Base Articles ({kbArticles.length})</h3>
                <div className="kb-articles-grid">
                  {kbArticles.length === 0 ? (
                    <div className="empty-state">
                      <p>No articles found. Add some articles to enable AI agent grounded resolutions.</p>
                    </div>
                  ) : (
                    kbArticles.map(art => (
                      <div key={art.id} className="kb-article-card">
                        <div className="kb-article-card-header">
                          <span className="category-tag">{art.category}</span>
                          <span className="kb-id">ID: #{art.id}</span>
                        </div>
                        <h3>{art.title}</h3>
                        <p>{art.content}</p>
                        <span className="kb-article-date">Added: {new Date(art.created_at).toLocaleDateString()}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>

          </div>
        )}

        {/* 3. INSIGHTS TAB */}
        {activeTab === 'insights' && (
          <div className="tab-insights-layout">
            {/* METRICS CARDS */}
            <div className="metrics-grid">
              
              <div className="metric-card">
                <span className="metric-icon">🎟️</span>
                <div className="metric-val">{totalCount}</div>
                <div className="metric-label">Total Tickets Processed</div>
              </div>

              <div className="metric-card">
                <span className="metric-icon success">✅</span>
                <div className="metric-val">{resolvedCount}</div>
                <div className="metric-label">Successfully Resolved</div>
              </div>

              <div className="metric-card">
                <span className="metric-icon warning">🚨</span>
                <div className="metric-val">{escalatedCount}</div>
                <div className="metric-label">Escalated to Human</div>
              </div>

              <div className="metric-card">
                <span className="metric-icon info">🔄</span>
                <div className="metric-val">{inProgressCount + newCount}</div>
                <div className="metric-label">Active / In Progress</div>
              </div>

            </div>

            {/* CHARTS CARD */}
            <div className="workspace-card charts-card">
              <h3>Operational Summary</h3>
              <div className="chart-split">
                
                {/* Chart 1: Resolution Ratio */}
                <div className="chart-box">
                  <h4>Automation Efficiency</h4>
                  <div className="progress-bar-group">
                    <div className="progress-bar-label">
                      <span>Autonomous Resolution Rate</span>
                      <strong>{resolutionRate.toFixed(1)}%</strong>
                    </div>
                    <div className="progress-bar-container">
                      <div className="progress-bar fill-success" style={{ width: `${resolutionRate}%` }}></div>
                    </div>
                  </div>

                  <div className="progress-bar-group">
                    <div className="progress-bar-label">
                      <span>Human Escalation Rate</span>
                      <strong>{escalationRate.toFixed(1)}%</strong>
                    </div>
                    <div className="progress-bar-container">
                      <div className="progress-bar fill-escalated" style={{ width: `${escalationRate}%` }}></div>
                    </div>
                  </div>
                </div>

                {/* Chart 2: Status breakdown */}
                <div className="chart-box">
                  <h4>Status Breakdown</h4>
                  <div className="css-bar-chart">
                    <div className="bar-column">
                      <div className="bar-value">{newCount}</div>
                      <div className="bar-fill bg-new" style={{ height: `${totalCount > 0 ? (newCount/totalCount)*120 : 0}px` }}></div>
                      <div className="bar-label">NEW</div>
                    </div>
                    <div className="bar-column">
                      <div className="bar-value">{inProgressCount}</div>
                      <div className="bar-fill bg-progress" style={{ height: `${totalCount > 0 ? (inProgressCount/totalCount)*120 : 0}px` }}></div>
                      <div className="bar-label">PROG</div>
                    </div>
                    <div className="bar-column">
                      <div className="bar-value">{resolvedCount}</div>
                      <div className="bar-fill bg-resolved" style={{ height: `${totalCount > 0 ? (resolvedCount/totalCount)*120 : 0}px` }}></div>
                      <div className="bar-label">RESOLV</div>
                    </div>
                    <div className="bar-column">
                      <div className="bar-value">{escalatedCount}</div>
                      <div className="bar-fill bg-escalated" style={{ height: `${totalCount > 0 ? (escalatedCount/totalCount)*120 : 0}px` }}></div>
                      <div className="bar-label">ESCAL</div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}

      </main>

      {/* CREATE TICKET MODAL */}
      {isCreatingTicket && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">
              <h3>Create Support Ticket</h3>
              <button className="btn-close" onClick={() => setIsCreatingTicket(false)}>×</button>
            </div>
            <form onSubmit={handleCreateTicket} className="modal-form">
              <div className="form-group">
                <label>Ticket Title</label>
                <input 
                  type="text" 
                  required
                  placeholder="Summarize the issue..."
                  value={newTicket.title}
                  onChange={e => setNewTicket({ ...newTicket, title: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Category</label>
                <select 
                  value={newTicket.category}
                  onChange={e => setNewTicket({ ...newTicket, category: e.target.value })}
                >
                  <option value="Technical Support">Technical Support</option>
                  <option value="Billing">Billing</option>
                  <option value="Account Access">Account Access</option>
                  <option value="General Inquiry">General Inquiry</option>
                </select>
              </div>

              <div className="form-group">
                <label>Priority</label>
                <select 
                  value={newTicket.priority}
                  onChange={e => setNewTicket({ ...newTicket, priority: e.target.value as any })}
                >
                  <option value="LOW">LOW</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                </select>
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea 
                  required
                  rows={5}
                  placeholder="Provide all details about the problem..."
                  value={newTicket.description}
                  onChange={e => setNewTicket({ ...newTicket, description: e.target.value })}
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setIsCreatingTicket(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Submit Ticket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE KB ARTICLE MODAL */}
      {isCreatingKB && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">
              <h3>Add Knowledge Base Article</h3>
              <button className="btn-close" onClick={() => setIsCreatingKB(false)}>×</button>
            </div>
            <form onSubmit={handleCreateKB} className="modal-form">
              <div className="form-group">
                <label>Article Title</label>
                <input 
                  type="text" 
                  required
                  placeholder="e.g., How to reset password"
                  value={newKB.title}
                  onChange={e => setNewKB({ ...newKB, title: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Category</label>
                <select 
                  value={newKB.category}
                  onChange={e => setNewKB({ ...newKB, category: e.target.value })}
                >
                  <option value="Technical Support">Technical Support</option>
                  <option value="Billing">Billing</option>
                  <option value="Account Access">Account Access</option>
                  <option value="General Inquiry">General Inquiry</option>
                </select>
              </div>

              <div className="form-group">
                <label>Content</label>
                <textarea 
                  required
                  rows={7}
                  placeholder="Write the step-by-step instructions or policy..."
                  value={newKB.content}
                  onChange={e => setNewKB({ ...newKB, content: e.target.value })}
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setIsCreatingKB(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Add Article
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
