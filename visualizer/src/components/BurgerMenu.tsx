import { useState } from "react";
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
}: BurgerMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);

  return (
    <div className="burger-menu">
      <button
        type="button"
        className="burger-icon"
        aria-label="Menu"
        aria-haspopup="true"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
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
