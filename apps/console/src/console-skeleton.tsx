import { translate, type ConsoleView, type Language } from './i18n';

export const ConsoleSkeleton = ({ view, language }: { view: ConsoleView | 'controls'; language: Language }) => (
  <div className="console-skeleton" role="status" aria-label={translate(language, "Loading status…")}>
    <div aria-hidden="true" className="skeleton-layout" data-view={view}>
      {view === 'overview' && <div className="skeleton-metrics">{Array.from({ length: 5 }, (_, index) => <div key={index} className="skeleton-block"/>)}</div>}
      {Array.from({ length: view === 'controls' ? 2 : 3 }, (_, index) => <div key={index} className="skeleton-row"><div className="skeleton-line"/><div className="skeleton-line"/></div>)}
    </div>
  </div>
);
