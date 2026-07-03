import { useState } from "react";
import type { LayoutName, SortName } from "../types";
import { PreferencesPanel } from "./PreferencesPanel";
import { AboutPanel } from "./AboutPanel";
import { DocumentationPanel } from "./DocumentationPanel";

type ActivePanel = "preferences" | "about" | "documentation" | null;

export interface BurgerMenuProps {
  preferredLayout: LayoutName;
  onPreferredLayoutChange: (layout: LayoutName) => void;
  preferredSort: SortName;
  onPreferredSortChange: (sort: SortName) => void;
  showBanners: boolean;
  onShowBannersChange: (show: boolean) => void;
}

export function BurgerMenu({
  preferredLayout,
  onPreferredLayoutChange,
  preferredSort,
  onPreferredSortChange,
  showBanners,
  onShowBannersChange,
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
        </ul>
      )}

      {activePanel === "preferences" && (
        <PreferencesPanel
          layout={preferredLayout}
          onChange={onPreferredLayoutChange}
          sort={preferredSort}
          onSortChange={onPreferredSortChange}
          showBanners={showBanners}
          onShowBannersChange={onShowBannersChange}
          onClose={() => setActivePanel(null)}
        />
      )}
      {activePanel === "about" && <AboutPanel onClose={() => setActivePanel(null)} />}
      {activePanel === "documentation" && (
        <DocumentationPanel onClose={() => setActivePanel(null)} />
      )}
    </div>
  );
}
