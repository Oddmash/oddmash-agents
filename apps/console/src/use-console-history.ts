import { useEffect, useRef } from 'react';
import { consoleRoute, localizedUrl, type ConsoleView, type Language } from './i18n';

type Route = { language: Language; view: ConsoleView };
const historyKey = 'oddmashConsoleIndex';

export const useConsoleHistory = (route: Route, setRoute: (route: Route) => void, unsaved: boolean, guard: (action: () => void) => void) => {
  const index = useRef<number>(Number.isInteger(window.history.state?.[historyKey]) ? window.history.state[historyKey] : 0);
  const restoring = useRef<number>();
  const replay = useRef(false);
  useEffect(() => {
    window.history.replaceState({ ...window.history.state, [historyKey]: index.current }, '', window.location.href);
  }, []);
  const navigateNow = (language: Language, view: ConsoleView) => {
    const url = localizedUrl(window.location.href, language, view);
    if (url.href !== window.location.href) {
      index.current++;
      window.history.pushState({ ...window.history.state, [historyKey]: index.current }, '', url);
    }
    setRoute({ language, view });
  };
  const navigate = (language: Language, view: ConsoleView) => {
    if (view !== route.view) guard(() => navigateNow(language, view));
    else navigateNow(language, view);
  };
  useEffect(() => {
    const sync = () => {
      const next = consoleRoute(window.location.href);
      const target = window.history.state?.[historyKey];
      if (restoring.current !== undefined && target === index.current) {
        const delta = restoring.current;
        restoring.current = undefined;
        guard(() => { replay.current = true; window.history.go(delta); });
        return;
      }
      if (unsaved && !replay.current && next.view !== route.view && Number.isInteger(target) && target !== index.current) {
        restoring.current = target - index.current;
        window.history.go(-restoring.current);
        return;
      }
      replay.current = false;
      if (Number.isInteger(target)) index.current = target;
      setRoute({ language: next.language ?? route.language, view: next.view });
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [route.language, route.view, unsaved, guard, setRoute]);
  return navigate;
};
