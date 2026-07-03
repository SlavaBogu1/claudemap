import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DetailPanel, type DetailPanelProps } from "./DetailPanel";
import type { Project, Session } from "../types";
import * as apiClient from "../api/client";

// CR-UI-08: shared default props for the new required fields so existing "Info" tab tests don't
// need to know about the Content tab's data plumbing.
const noopDetailPanelProps: Pick<
  DetailPanelProps,
  "selectedItem" | "notes" | "onNoteSaved" | "onNoteDeleted"
> = {
  selectedItem: null,
  notes: [],
  onNoteSaved: () => {},
  onNoteDeleted: () => {},
};

const project: Project = {
  id: "p1",
  path: "C:/Users/me/repos/sudoku",
  sessionCount: 3,
  lastActiveAt: "2026-07-01T00:00:00Z",
};

const session: Session = {
  id: "s1",
  startedAt: "2026-06-28T15:45:00Z",
  endedAt: "2026-06-28T16:00:00Z",
  messageCount: 42,
  gitBranch: "main",
  preview: "Implemented the login flow",
  subagentCount: 2,
  touchedMemory: true,
  memoryTouchCount: 1,
  toolResultCount: 0,
  hasNotedDescendant: false,
};

describe("DetailPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a hint when no session is selected", () => {
    render(<DetailPanel project={project} session={null} {...noopDetailPanelProps} />);
    expect(screen.getByText(/select a session node/i)).toBeInTheDocument();
  });

  it("shows session detail fields when a session is selected", () => {
    render(<DetailPanel project={project} session={session} {...noopDetailPanelProps} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  it("shows exactly two tabs, Info and Content — no Terminal tab (CR-UI-04 reopen)", () => {
    render(<DetailPanel project={project} session={null} {...noopDetailPanelProps} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Info", "Content"]);
  });

  it("shows the project's real folder path", () => {
    render(<DetailPanel project={project} session={null} {...noopDetailPanelProps} />);
    expect(screen.getByLabelText(/project path/i)).toHaveValue(project.path);
  });

  it("calls the open-folder API with the project id when the button is clicked", async () => {
    const spy = vi.spyOn(apiClient, "openFolder").mockResolvedValue({ ok: true });
    render(<DetailPanel project={project} session={null} {...noopDetailPanelProps} />);
    fireEvent.click(screen.getByRole("button", { name: /open folder/i }));
    expect(spy).toHaveBeenCalledWith("p1");
  });

  // CR-UI-04 (reopen, Sprint 5): resume command relocated from the deleted Terminal tab into Info,
  // directly below Path — visible immediately on the (default) Info tab, no tab switch needed.
  describe("Resume command field (relocated into Info)", () => {
    it("shows a hint, not a field, when nothing is selected", () => {
      render(<DetailPanel project={project} session={null} {...noopDetailPanelProps} />);
      expect(screen.getByText(/select a session \(or one of its items\)/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/resume command/i)).not.toBeInTheDocument();
    });

    it("shows `claude --resume <session-id>` for a session selection", () => {
      render(
        <DetailPanel
          project={project}
          session={session}
          {...noopDetailPanelProps}
          selectedItem={{ nodeType: "session", rawId: session.id, label: "session", sessionId: session.id }}
        />,
      );
      expect(screen.getByLabelText(/resume command/i)).toHaveValue(`claude --resume ${session.id}`);
    });

    it("shows the PARENT session's id for a sub-item selection, not the sub-item's own id", () => {
      render(
        <DetailPanel
          project={project}
          session={session}
          {...noopDetailPanelProps}
          selectedItem={{
            nodeType: "subagent",
            rawId: "agent-xyz",
            label: "◆ Agent",
            sessionId: session.id,
          }}
        />,
      );
      expect(screen.getByLabelText(/resume command/i)).toHaveValue(`claude --resume ${session.id}`);
    });
  });

  // CR-UI-26: Info tab's preview area shows the selected item's note (any item type), clickable to
  // jump to the Content tab.
  describe("Note preview area", () => {
    it("does not render when nothing is selected", () => {
      render(<DetailPanel project={project} session={null} {...noopDetailPanelProps} />);
      expect(screen.queryByTestId("session-preview")).not.toBeInTheDocument();
    });

    it("shows 'This item has no notes.' when the selected item has no saved note", () => {
      render(
        <DetailPanel
          project={project}
          session={session}
          {...noopDetailPanelProps}
          selectedItem={{ nodeType: "session", rawId: session.id, label: "session", sessionId: session.id }}
        />,
      );
      expect(screen.getByTestId("session-preview")).toHaveTextContent("This item has no notes.");
    });

    it("shows the note's content when the selected item has a saved note", () => {
      render(
        <DetailPanel
          project={project}
          session={session}
          selectedItem={{ nodeType: "session", rawId: session.id, label: "session", sessionId: session.id }}
          notes={[
            {
              projectId: "p1",
              nodeType: "session",
              nodeId: session.id,
              content: "Revisit this refactor before the release.",
              format: "markdown",
              createdAt: "2026-07-01T00:00:00Z",
              updatedAt: "2026-07-01T00:00:00Z",
            },
          ]}
          onNoteSaved={() => {}}
          onNoteDeleted={() => {}}
        />,
      );
      expect(screen.getByTestId("session-preview")).toHaveTextContent(
        "Revisit this refactor before the release.",
      );
    });

    it("works for a non-session item type (project)", () => {
      render(
        <DetailPanel
          project={project}
          session={null}
          {...noopDetailPanelProps}
          selectedItem={{ nodeType: "project", rawId: project.id, label: "project" }}
        />,
      );
      expect(screen.getByTestId("session-preview")).toHaveTextContent("This item has no notes.");
    });

    it("clicking the preview area switches to the Content tab", () => {
      vi.spyOn(apiClient, "fetchSessionContent").mockResolvedValue({ messages: [] });
      render(
        <DetailPanel
          project={project}
          session={session}
          {...noopDetailPanelProps}
          selectedItem={{ nodeType: "session", rawId: session.id, label: "session", sessionId: session.id }}
        />,
      );
      fireEvent.click(screen.getByTestId("session-preview"));
      expect(screen.getByTestId("content-tab")).toBeInTheDocument();
    });
  });
});
