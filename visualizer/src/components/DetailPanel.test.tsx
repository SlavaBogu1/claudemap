import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DetailPanel } from "./DetailPanel";
import type { Project, Session } from "../types";
import * as apiClient from "../api/client";

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
};

describe("DetailPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a hint when no session is selected", () => {
    render(<DetailPanel project={project} session={null} />);
    expect(screen.getByText(/select a session node/i)).toBeInTheDocument();
  });

  it("shows session detail fields and preview text when a session is selected", () => {
    render(<DetailPanel project={project} session={session} />);
    expect(screen.getByTestId("session-preview")).toHaveTextContent("Implemented the login flow");
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  it("shows the project's real folder path", () => {
    render(<DetailPanel project={project} session={null} />);
    expect(screen.getByLabelText(/project path/i)).toHaveValue(project.path);
  });

  it("calls the open-folder API with the project id when the button is clicked", async () => {
    const spy = vi.spyOn(apiClient, "openFolder").mockResolvedValue({ ok: true });
    render(<DetailPanel project={project} session={null} />);
    fireEvent.click(screen.getByRole("button", { name: /open folder/i }));
    expect(spy).toHaveBeenCalledWith("p1");
  });
});
