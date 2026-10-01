import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/**
 * A thin bar along the top of the window while an action runs or a page
 * loads for the first time. Background refreshes do not show it.
 */
export function ActivityBar() {
  const mutating = useIsMutating();
  const loading = useIsFetching({ predicate: (query) => query.state.data === undefined });
  const busy = mutating + loading > 0;
  // Wait a moment before showing it, so quick requests do not flash it.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!busy) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(timer);
  }, [busy]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden"
      role="progressbar"
      aria-label="Working"
      aria-hidden={!visible}
      hidden={!visible}
    >
      <div className="activity-stripe h-full w-1/3 animate-[activity-slide_1.1s_ease-in-out_infinite] bg-primary" />
    </div>
  );
}
