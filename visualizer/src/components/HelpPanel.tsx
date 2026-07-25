import { SafeMarkdown } from "./SafeMarkdown";

// CR-UI-20 (Sprint 6, after CR-UI-19): "Help" burger-menu entry documenting the Markdown syntax
// supported in notes. Same modal pattern as DocumentationPanel/AboutPanel. Every example is rendered
// through the SAME react-markdown + remark-gfm component ContentTab.tsx uses for a saved note's view
// mode — not hand-authored static HTML mockups of what the output "should" look like — so this page
// can never silently drift out of sync with what notes actually render.

export interface HelpPanelProps {
  // CR-UI-41: no longer called by a visible button in this panel — kept so BurgerMenu's
  // outside-click/burger-icon-click handlers still have a close path to invoke.
  onClose: () => void;
}

interface Example {
  label: string;
  source: string;
}

// Subset actually exercised: bold, italic, a link, an unordered list, a numbered list, a heading,
// inline code — matching what remark-gfm/CommonMark actually supports (per CR-UI-20's spec, verified
// against the installed react-markdown + remark-gfm rendering below, not assumed).
const EXAMPLES: Example[] = [
  { label: "Bold", source: "**bold text**" },
  { label: "Italic", source: "*italic text*" },
  { label: "Link", source: "[Claude Session Explorer](https://example.com)" },
  { label: "Unordered list", source: "- first item\n- second item" },
  { label: "Numbered list", source: "1. first step\n2. second step" },
  { label: "Heading", source: "### A heading" },
  { label: "Inline code", source: "`const x = 1;`" },
];

export function HelpPanel({ onClose: _onClose }: HelpPanelProps) {
  return (
    <div className="modal-overlay" role="dialog" aria-label="Help">
      {/* CR-UI-41: stops a click inside the panel from bubbling to BurgerMenu's document-level
          outside-click listener, mirroring CR-UI-38's error-modal pattern in ProjectPicker.tsx. */}
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Note formatting help</h2>
        <p className="hint">
          Notes support Markdown. While editing, type the raw syntax below — when you switch back to
          view mode (or Save), it renders as shown on the right.
        </p>
        <div className="help-examples" data-testid="help-examples">
          {EXAMPLES.map((example) => (
            <div className="help-example" key={example.label} data-testid="help-example">
              <h3>{example.label}</h3>
              <div className="help-example-row">
                <pre className="help-example-source" data-testid="help-example-source">
                  {example.source}
                </pre>
                <div className="help-example-rendered" data-testid="help-example-rendered">
                  <SafeMarkdown>{example.source}</SafeMarkdown>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
