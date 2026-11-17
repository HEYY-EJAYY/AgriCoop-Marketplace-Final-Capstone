import React, { KeyboardEvent, ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";

export const ADMIN_WORKSPACE_TABS = [
  { id: "moderation", label: "Moderation" },
  { id: "orders", label: "Orders" },
  { id: "users", label: "Users" },
] as const;

export type AdminWorkspaceTabId = (typeof ADMIN_WORKSPACE_TABS)[number]["id"];

function isAdminTab(value: string | null): value is AdminWorkspaceTabId {
  return ADMIN_WORKSPACE_TABS.some(tab => tab.id === value);
}

export function parseAdminWorkspaceTab(search: string): AdminWorkspaceTabId {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = params.get("tab");
  return isAdminTab(raw) ? raw : ADMIN_WORKSPACE_TABS[0].id;
}

type AdminWorkspaceTabsProps = {
  panels: Record<AdminWorkspaceTabId, ReactNode>;
};

/**
 * Spreadsheet-style body tabs for Admin / SuperAdmin dashboard.
 * Active tab persists in ?tab=; panels lazy-mount on first visit and stay cached.
 */
export function AdminWorkspaceTabs({ panels }: AdminWorkspaceTabsProps) {
  const search = useSearch();
  const [location, setLocation] = useLocation();
  const active = parseAdminWorkspaceTab(search);
  const [visited, setVisited] = useState(() => new Set<AdminWorkspaceTabId>([active]));
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const liveRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisited(prev => {
      if (prev.has(active)) return prev;
      const next = new Set(prev);
      next.add(active);
      return next;
    });
  }, [active]);

  useEffect(() => {
    if (liveRef.current) {
      const label = ADMIN_WORKSPACE_TABS.find(tab => tab.id === active)?.label ?? active;
      liveRef.current.textContent = `${label} panel selected`;
    }
  }, [active]);

  const setTab = useCallback(
    (next: AdminWorkspaceTabId) => {
      const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
      params.set("tab", next);
      const path = location.split("?")[0] || "/dashboard";
      setLocation(`${path}?${params.toString()}`, { replace: false });
    },
    [location, search, setLocation],
  );

  const focusTab = (index: number) => {
    const clamped = (index + ADMIN_WORKSPACE_TABS.length) % ADMIN_WORKSPACE_TABS.length;
    tabRefs.current[clamped]?.focus();
    setTab(ADMIN_WORKSPACE_TABS[clamped]!.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        focusTab(index + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        focusTab(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusTab(0);
        break;
      case "End":
        event.preventDefault();
        focusTab(ADMIN_WORKSPACE_TABS.length - 1);
        break;
      default:
        break;
    }
  };

  const tabIds = useMemo(
    () => Object.fromEntries(ADMIN_WORKSPACE_TABS.map(tab => [tab.id, `${baseId}-tab-${tab.id}`])) as Record<AdminWorkspaceTabId, string>,
    [baseId],
  );
  const panelIds = useMemo(
    () => Object.fromEntries(ADMIN_WORKSPACE_TABS.map(tab => [tab.id, `${baseId}-panel-${tab.id}`])) as Record<AdminWorkspaceTabId, string>,
    [baseId],
  );

  return (
    <div className="mt-8" data-testid="admin-workspace-tabs">
      <div
        role="tablist"
        aria-label="Administration sections"
        className="flex gap-1 overflow-x-auto rounded-2xl border border-[#dce4d6] bg-[#f3f7f0] p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {ADMIN_WORKSPACE_TABS.map((tab, index) => {
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              ref={el => {
                tabRefs.current[index] = el;
              }}
              id={tabIds[tab.id]}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelIds[tab.id]}
              tabIndex={selected ? 0 : -1}
              data-testid={`admin-tab-${tab.id}`}
              className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5a3c] ${
                selected
                  ? "bg-white text-[#1f5a3c] shadow-sm"
                  : "text-[#5f7264] hover:bg-white/70 hover:text-[#1f5a3c]"
              }`}
              onClick={() => setTab(tab.id)}
              onKeyDown={event => onKeyDown(event, index)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div ref={liveRef} className="sr-only" aria-live="polite" />
      {ADMIN_WORKSPACE_TABS.map(tab => {
        if (!visited.has(tab.id)) return null;
        const selected = active === tab.id;
        return (
          <div
            key={tab.id}
            id={panelIds[tab.id]}
            role="tabpanel"
            aria-labelledby={tabIds[tab.id]}
            hidden={!selected}
            data-testid={`admin-panel-${tab.id}`}
            className="mt-6 outline-none"
            tabIndex={0}
          >
            {panels[tab.id]}
          </div>
        );
      })}
    </div>
  );
}
