import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

// CR-UI-19 (Sprint 6): shared Markdown renderer for note view mode (ContentTab.tsx) and the Help
// guide's live examples (HelpPanel.tsx) — one place to preserve the security invariant this CR
// depends on: react-markdown's DEFAULT safe configuration only, no `rehype-raw` (which would let
// raw HTML in the source render as real DOM). Never needs React's raw-HTML-injection escape hatch
// either — react-markdown renders to real React elements, not an HTML string.
//
// The only customization is the `a` element: react-markdown's default doesn't add
// `target`/`rel`, but the CR's spec requires opening links in a new tab without granting the
// opened page a `window.opener` handle back to this app (`rel="noopener noreferrer"`).
// `defaultUrlTransform` (react-markdown's own default `urlTransform`, unchanged/not overridden
// here) already rejects unsafe schemes like `javascript:` before this component ever sees the
// `href`, so this override is presentation-only, not a safety mechanism.
const LINK_COMPONENT: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};

export interface SafeMarkdownProps {
  children: string;
}

export function SafeMarkdown({ children }: SafeMarkdownProps) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={LINK_COMPONENT}>
      {children}
    </ReactMarkdown>
  );
}
