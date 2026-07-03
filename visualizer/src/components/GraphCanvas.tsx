import { useEffect, useMemo, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type cytoscape from "cytoscape";
import type { Core, ElementDefinition, LayoutOptions } from "cytoscape";
import type { LayoutName, Project, Session } from "../types";

function formatSessionLabel(startedAt: string): string {
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return startedAt;
  const datePart = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const timePart = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart}\n${timePart}`;
}

function layoutOptionsFor(name: LayoutName): LayoutOptions {
  if (name === "breadthfirst") {
    return {
      name: "breadthfirst",
      directed: true,
      padding: 30,
      spacingFactor: 1.2,
      animate: false,
    } as LayoutOptions;
  }
  return {
    name: "cose",
    padding: 30,
    animate: false,
  } as LayoutOptions;
}

const stylesheet: cytoscape.StylesheetJson = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "text-wrap": "wrap",
      "text-valign": "center",
      "text-halign": "center",
      "font-size": 11,
      color: "#08060d",
      "background-color": "#e5e4e7",
      "border-width": 1,
      "border-color": "#6b6375",
      width: 70,
      height: 70,
    },
  },
  {
    selector: 'node[type = "project"]',
    style: {
      "background-color": "#aa3bff",
      color: "#fff",
      width: 90,
      height: 90,
      "font-weight": "bold",
    },
  },
  {
    selector: 'node[type = "session"]',
    style: {
      shape: "round-rectangle",
    },
  },
  {
    selector: "node.selected",
    style: {
      "border-width": 3,
      "border-color": "#aa3bff",
    },
  },
  {
    selector: "edge",
    style: {
      width: 1.5,
      "line-color": "#c9c7cf",
      "curve-style": "bezier",
      "target-arrow-shape": "none",
    },
  },
];

export interface GraphCanvasProps {
  project: Project;
  sessions: Session[];
  layout: LayoutName;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
}

// Pure element-builder pulled out of the component so extremes (1 vs 20+ sessions, VZ-1.5) can be
// unit-tested without mounting Cytoscape (which needs a real canvas, unavailable under jsdom).
export function buildGraphElements(project: Project, sessions: Session[]): ElementDefinition[] {
  const projectNode: ElementDefinition = {
    data: {
      id: `project:${project.id}`,
      label: `🎯 ${project.path.split(/[/\\]/).pop() ?? project.id}`,
      type: "project",
    },
  };
  const sessionNodes: ElementDefinition[] = sessions.map((s) => ({
    data: {
      id: s.id,
      label: formatSessionLabel(s.startedAt),
      type: "session",
    },
  }));
  const edges: ElementDefinition[] = sessions.map((s) => ({
    data: {
      id: `edge:${project.id}:${s.id}`,
      source: `project:${project.id}`,
      target: s.id,
    },
  }));
  return [projectNode, ...sessionNodes, ...edges];
}

export function GraphCanvas({
  project,
  sessions,
  layout,
  selectedSessionId,
  onSelectSession,
}: GraphCanvasProps) {
  const cyRef = useRef<Core | null>(null);
  // Test/observability hook only (not part of the approved mockup, D6): reflects the layout name
  // Cytoscape most recently finished running, so Playwright can assert layout switches happened
  // via Cytoscape's own state rather than a pixel diff (VZ-1.6 acceptance 2).
  const [appliedLayout, setAppliedLayout] = useState<LayoutName>(layout);

  const elements: ElementDefinition[] = useMemo(
    () => buildGraphElements(project, sessions),
    [project, sessions],
  );

  // Re-run layout whenever the layout algorithm changes, without touching data/elements.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.layout(layoutOptionsFor(layout)).run();
  }, [layout, elements]);

  // Reflect external selection state (e.g. programmatic) onto the canvas.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass("selected");
    if (selectedSessionId) {
      cy.getElementById(selectedSessionId).addClass("selected");
    }
  }, [selectedSessionId, elements]);

  return (
    <div className="graph-canvas-wrapper">
      <CytoscapeComponent
        elements={elements}
        stylesheet={stylesheet}
        style={{ width: "100%", height: "100%" }}
        layout={layoutOptionsFor(layout)}
        cy={(cy: Core) => {
          cyRef.current = cy;
          // Test hook only (Playwright e2e, VZ-1.6/1.9): lets tests locate a node's real rendered
          // position to simulate a genuine canvas click, since Cytoscape renders to <canvas> with no
          // per-node DOM to select. Harmless in a local, single-user, read-mostly tool.
          (window as unknown as { __cy?: Core }).__cy = cy;
          cy.off("tap", "node");
          cy.on("tap", "node", (evt) => {
            const node = evt.target;
            if (node.data("type") === "session") {
              onSelectSession(node.id());
            }
          });
          cy.off("layoutstop");
          cy.on("layoutstop", (evt) => {
            const name = evt.layout && evt.layout.options && evt.layout.options.name;
            if (name) setAppliedLayout(name as LayoutName);
          });
        }}
      />
      {/* Visually hidden test hook — not part of the approved mockup (D6). Lets Playwright assert
          node count and the currently-applied Cytoscape layout without pixel diffing or reaching
          into canvas internals. */}
      <span
        className="sr-only"
        data-testid="graph-status"
        data-node-count={elements.filter((e) => !("source" in e.data)).length}
        data-layout={appliedLayout}
      />
    </div>
  );
}
