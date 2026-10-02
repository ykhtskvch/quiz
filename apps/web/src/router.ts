// Minimal path router: three routes don't justify a dependency.
import { useSyncExternalStore } from "react";

const subscribe = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
};

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function navigate(to: string) {
  history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
