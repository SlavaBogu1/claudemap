import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectPicker } from "./ProjectPicker";
import type { Project } from "../types";
import * as apiClient from "../api/client";

const projects: Project[] = [
  { id: "p1", path: "C:/repos/sudoku", sessionCount: 20, lastActiveAt: "2026-07-01T00:00:00Z" },
];

describe("ProjectPicker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists projects and a Browse… entry, and reports selection", () => {
    const onSelectProject = vi.fn();
    render(
      <ProjectPicker
        projects={projects}
        selectedProjectId={null}
        onSelectProject={onSelectProject}
        onProjectsAdded={vi.fn()}
      />,
    );
    const select = screen.getByLabelText("Project") as HTMLSelectElement;
    expect(screen.getByText(/Browse…/)).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "p1" } });
    expect(onSelectProject).toHaveBeenCalledWith("p1");
  });

  it("opens the path text input (not a native dialog) when Browse… is chosen, and adds the returned project on success", async () => {
    const scanned: Project = { id: "p2", path: "D:/exported/.claude", sessionCount: 5, lastActiveAt: "t" };
    vi.spyOn(apiClient, "browseProject").mockResolvedValue([scanned]);
    const onProjectsAdded = vi.fn();

    render(
      <ProjectPicker
        projects={projects}
        selectedProjectId={null}
        onSelectProject={vi.fn()}
        onProjectsAdded={onProjectsAdded}
      />,
    );

    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "__browse__" } });
    const pathInput = await screen.findByLabelText(/path/i);
    expect(pathInput.tagName).toBe("INPUT");
    expect(pathInput).toHaveAttribute("type", "text");

    fireEvent.change(pathInput, { target: { value: "D:/exported/.claude" } });
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));

    await waitFor(() => expect(onProjectsAdded).toHaveBeenCalledWith([scanned]));
  });

  it("shows the API's error message inline on a failed scan", async () => {
    vi.spyOn(apiClient, "browseProject").mockRejectedValue(
      new apiClient.ApiError("no valid session data found", 400),
    );

    render(
      <ProjectPicker
        projects={projects}
        selectedProjectId={null}
        onSelectProject={vi.fn()}
        onProjectsAdded={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "__browse__" } });
    const pathInput = await screen.findByLabelText(/path/i);
    fireEvent.change(pathInput, { target: { value: "C:/bad" } });
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no valid session data found");
  });
});
