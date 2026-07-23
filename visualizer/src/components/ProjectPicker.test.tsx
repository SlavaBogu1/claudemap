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

  it("shows the API's error message in a modal (not inline in the panel) on a failed scan, without breaking panel layout", async () => {
    vi.spyOn(apiClient, "browseProject").mockRejectedValue(
      new apiClient.ApiError("no valid session data found", 400),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

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

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("no valid session data found");
    // VZ-9.1: the error lives in an overlay modal outside `.browse-panel`, not inside it.
    expect(alert.closest(".browse-panel")).toBeNull();
    expect(alert.closest(".modal")).not.toBeNull();
    // Panel controls remain present/accessible while the error modal is up.
    expect(screen.getByLabelText(/path/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^scan$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();

    // VZ-9.2: the raw error is also logged to the console for developer debugging.
    expect(errSpy).toHaveBeenCalled();
  });

  it("dismisses the error modal, clearing the error, and allows scanning a different path", async () => {
    const scanned: Project = { id: "p3", path: "D:/good", sessionCount: 1, lastActiveAt: "t" };
    vi.spyOn(apiClient, "browseProject")
      .mockRejectedValueOnce(new apiClient.ApiError("bad path", 400))
      .mockResolvedValueOnce([scanned]);
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    fireEvent.change(pathInput, { target: { value: "C:/bad" } });
    fireEvent.click(screen.getByRole("button", { name: /^scan$/i }));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(screen.getByLabelText(/path/i), { target: { value: "D:/good" } });
    fireEvent.click(screen.getByRole("button", { name: /^scan$/i }));

    await waitFor(() => expect(onProjectsAdded).toHaveBeenCalledWith([scanned]));
  });

  it("lists an added root with a Remove button, and removes it via DELETE without a reload", async () => {
    const scanned: Project = { id: "p4", path: "D:/exported/.claude", sessionCount: 3, lastActiveAt: "t" };
    vi.spyOn(apiClient, "browseProject").mockResolvedValue([scanned]);
    const removeSpy = vi
      .spyOn(apiClient, "removeProjectBrowseRoot")
      .mockResolvedValue({ ok: true });

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
    fireEvent.change(pathInput, { target: { value: "D:/exported/.claude" } });
    fireEvent.click(screen.getByRole("button", { name: /^scan$/i }));

    // Scanning closes the panel on success; reopen it to see the persisted-roots list.
    await waitFor(() => expect(screen.queryByLabelText(/path/i)).toBeNull());
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "__browse__" } });

    expect(await screen.findByText("D:/exported/.claude")).toBeInTheDocument();
    const removeButton = screen.getByRole("button", { name: /remove d:\/exported\/\.claude/i });
    fireEvent.click(removeButton);

    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith("D:/exported/.claude"));
    await waitFor(() => expect(screen.queryByText("D:/exported/.claude")).toBeNull());
  });
});
