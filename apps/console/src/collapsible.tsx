import { useEffect, useState, type ReactNode } from 'react';

export const Collapsible = ({ open, id, children, className }: { open: boolean; id: string; children: ReactNode; className?: string }) => {
  const [retained,setRetained] = useState(open);
  useEffect(()=>{
    if (open) { setRetained(true); return; }
    const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;
    const timer = window.setTimeout(()=>setRetained(false),delay);
    return ()=>window.clearTimeout(timer);
  },[open]);
  return <div id={id} className="console-collapse" data-open={open} inert={!open} hidden={!open&&!retained}>
    <div className="console-collapse-inner"><div className={className}>{(open||retained)&&children}</div></div>
  </div>;
};
