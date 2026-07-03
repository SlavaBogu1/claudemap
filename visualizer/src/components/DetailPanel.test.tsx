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
};

describe("DetailPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a hint when no session is selected", () => {
    render(<DetailPanel project={project} session={null} {...noopDetailPanelProps} />);
    expect(screen.getByText(/select a session node/i)).toBeInTheDocument();
  });

  it("shows session detail fields and preview text when a session is selected", () => {
    render(<DetailPanel project={project} session={session} {...noopDetailPanelProps} />);
    expect(screen.getByTestId("session-preview")).toHaveTextContent("Implemented the login flow");
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
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
});
