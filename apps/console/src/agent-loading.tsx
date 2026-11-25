const lead = new URL('../../../assets/agents/lead.svg', import.meta.url).href;

export const AgentLoading = ({ label }: { label: string }) => (
  <div className="agent-loading" role="status" aria-live="polite">
    <div className="loading-avatar" aria-hidden="true"><img src={lead} alt=""/><span className="loading-spinner"/></div>
    <span>{label}</span>
  </div>
);
