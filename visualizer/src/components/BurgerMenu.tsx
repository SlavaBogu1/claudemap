import { useEffect, useRef, useState } from "react";
import type { LayoutName, SortName, TimeRangeName } from "../types";
import type { SessionColorScheme, ThemeName } from "../lib/preferences";
import { PreferencesPanel } from "./PreferencesPanel";
import { AboutPanel } from "./AboutPanel";
import { DocumentationPanel } from "./DocumentationPanel";
import { HelpPanel } from "./HelpPanel";

type ActivePanel = "preferences" | "about" | "documentation" | "help" | null;

export interface BurgerMenuProps {
  preferredLayout: LayoutName;
  onPreferredLayoutChange: (layout: LayoutName) => void;
  preferredSort: SortName;
  onPreferredSortChange: (sort: SortName) => void;
  // CR-UI-27: default time range, same bidirectional-sync pattern as sort.
  preferredTimeRange: TimeRangeName;
  onPreferredTimeRangeChange: (range: TimeRangeName) => void;
  showBanners: boolean;
  onShowBannersChange: (show: boolean) => void;
  // CR-UI-24: Light/Dark/System theme preference.
  theme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  // CR-UI-33: "Session color scheme" preference.
  sessionColorScheme: SessionColorScheme;
  onSessionColorSchemeChange: (scheme: SessionColorScheme) => void;
  // CR-UI-40: "Require double-click to expand/collapse" preference.
  expandOnDoubleClick: boolean;
  onExpandOnDoubleClickChange: (value: boolean) => void;
  // CR-CORE-04 (Sprint 7): manual refresh — a direct action (not a panel), re-fetches the current
  // project's sessions and notes so deletions since the last load are reflected without a full page
  // reload.
  onRefresh: () => void;
  // CR-UI-39: "Collapse All" — a direct action (not a panel), identical shape to onRefresh above.
  // Resets every session's drill-down expansion state across the whole graph.
  onCollapseAll: () => void;
}

export function BurgerMenu({
  preferredLayout,
  onPreferredLayoutChange,
  preferredSort,
  onPreferredSortChange,
  preferredTimeRange,
  onPreferredTimeRangeChange,
  showBanners,
  onShowBannersChange,
  theme,
  onThemeChange,
  sessionColorScheme,
  onSessionColorSchemeChange,
  expandOnDoubleClick,
  onExpandOnDoubleClickChange,
  onRefresh,
  onCollapseAll,
}: BurgerMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  // CR-UI-41: the burger icon itself is excluded from the outside-click-close check below — its own
  // onClick already handles closing an open panel explicitly, so letting the document-level listener
  // also react to that same click would double-handle it (see the onClick body's comment).
  const burgerIconRef = useRef<HTMLButtonElement>(null);

  // CR-UI-41: no existing outside-click-detection code anywhere in this codebase — new document-level
  // `pointerdown` listener, attached only while a panel is open, that closes the panel when the click
  // lands outside its `.modal` box. `.modal-overlay` (the full-screen backdrop all four panels render
  // into) intentionally does NOT count as "inside" — clicking the backdrop (visually anywhere over the
  // canvas/header, since the overlay sits on top of everything at z-index 100) must close the panel,
  // only a click that lands inside the `.modal` box itself should not.
  useEffect(() => {
    if (activePanel === null) return;
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (burgerIconRef.current?.contains(target)) return;
      if (target.closest(".modal")) return;
      setActivePanel(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [activePanel]);

  return (
    <div className="burger-menu">
      <button
        type="button"
        className="burger-icon"
        aria-label="Menu"
        aria-haspopup="true"
        aria-expanded={menuOpen}
        ref={burgerIconRef}
        onClick={() => {
          // CR-UI-41: while a panel is open, clicking the icon closes that panel instead of also
          // re-opening the dropdown list underneath it (today's bug this CR fixes) — only toggle the
          // dropdown's own open/closed state when no panel is currently open.
          if (activePanel !== null) {
            setActivePanel(null);
            setMenuOpen(false);
          } else {
            setMenuOpen((v) => !v);
          }
        }}
      >
        ☰
      </button>

      {menuOpen && (
        <ul className="burger-dropdown" role="menu">
          <li role="menuitem">
            <button
              type="button"
              onClick={() => {
                setActivePanel("preferences");
                setMenuOpen(false);
              }}
            >
              Preferences
            </button>
          </li>
          <li role="menuitem">
            <button
              type="button"
              onClick={() => {
                setActivePanel("documentation");
                setMenuOpen(false);
              }}
            >
              Documentation
            </button>
          </li>
          <li role="menuitem">
            <button
              type="button"
              onClick={() => {
                setActivePanel("about");
                setMenuOpen(false);
              }}
            >
              About
            </button>
          </li>
          {/* CR-UI-20: scoped specifically to note Markdown formatting, distinct from the existing
              generic "Documentation" entry above. */}
          <li role="menuitem">
            <button
              type="button"
              onClick={() => {
                setActivePanel("help");
                setMenuOpen(false);
              }}
            >
              Help
            </button>
          </li>
          {/* CR-CORE-04: a direct action (not a panel) — closes the menu immediately and re-fetches
              the current project's sessions/notes so deletions since the last load are reflected. */}
          <li role="menuitem">
            <button
              type="button"
              onClick={() => {
                onRefresh();
                setMenuOpen(false);
              }}
            >
              Refresh
            </button>
          </li>
          {/* CR-UI-39: a direct action (not a panel), identical shape/handler pattern to Refresh
              above — collapses every session's expanded drill-down children across the whole graph. */}
          <li role="menuitem">
            <button
              type="button"
              onClick={() => {
                onCollapseAll();
                setMenuOpen(false);
              }}
            >
              Collapse All
            </button>
          </li>
        </ul>
      )}

      {activePanel === "preferences" && (
        <PreferencesPanel
          layout={preferredLayout}
          onChange={onPreferredLayoutChange}
          sort={preferredSort}
          onSortChange={onPreferredSortChange}
          timeRange={preferredTimeRange}
          onTimeRangeChange={onPreferredTimeRangeChange}
          showBanners={showBanners}
          onShowBannersChange={onShowBannersChange}
          theme={theme}
          onThemeChange={onThemeChange}
          sessionColorScheme={sessionColorScheme}
          onSessionColorSchemeChange={onSessionColorSchemeChange}
          expandOnDoubleClick={expandOnDoubleClick}
          onExpandOnDoubleClickChange={onExpandOnDoubleClickChange}
          onClose={() => setActivePanel(null)}
        />
      )}
      {activePanel === "about" && <AboutPanel onClose={() => setActivePanel(null)} />}
      {activePanel === "documentation" && (
        <DocumentationPanel onClose={() => setActivePanel(null)} />
      )}
      {activePanel === "help" && <HelpPanel onClose={() => setActivePanel(null)} />}
    </div>
  );
}
