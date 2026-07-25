import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BurgerMenu } from "./BurgerMenu";
import pkg from "../../package.json";

// Shared default props for every render below — only the prop(s) each test cares about are
// overridden per-call, matching this suite's pre-existing style.
function baseProps() {
  return {
    preferredLayout: "cose" as const,
    onPreferredLayoutChange: vi.fn(),
    preferredSort: "date-desc" as const,
    onPreferredSortChange: vi.fn(),
    preferredTimeRange: "all" as const,
    onPreferredTimeRangeChange: vi.fn(),
    showBanners: true,
    onShowBannersChange: vi.fn(),
    theme: "system" as const,
    onThemeChange: vi.fn(),
    sessionColorScheme: "default" as const,
    onSessionColorSchemeChange: vi.fn(),
    expandOnDoubleClick: false,
    onExpandOnDoubleClickChange: vi.fn(),
    onRefresh: vi.fn(),
    onCollapseAll: vi.fn(),
  };
}

describe("BurgerMenu (CR-UI-02)", () => {
  it("shows exactly 6 menu items: Preferences, Documentation, About, Help, Refresh, Collapse All (CR-UI-20, CR-CORE-04, CR-UI-39)", () => {
    render(<BurgerMenu {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(6);
    expect(items.map((i) => i.textContent)).toEqual([
      "Preferences",
      "Documentation",
      "About",
      "Help",
      "Refresh",
      "Collapse All",
    ]);
  });

  it("Refresh calls onRefresh and closes the menu (CR-CORE-04)", () => {
    const onRefresh = vi.fn();
    render(<BurgerMenu {...baseProps()} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("Collapse All calls onCollapseAll and closes the menu (CR-UI-39)", () => {
    const onCollapseAll = vi.fn();
    render(<BurgerMenu {...baseProps()} onCollapseAll={onCollapseAll} />);
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse All" }));
    expect(onCollapseAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("Help opens a Markdown formatting guide with no network call (CR-UI-20)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<BurgerMenu {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("dialog", { name: /help/i })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("About shows the app name and package.json version, with no network call", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<BurgerMenu {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(screen.getByTestId("app-version")).toHaveTextContent(pkg.version);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Documentation opens a help panel with no network call", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<BurgerMenu {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Documentation" }));
    expect(screen.getByRole("dialog", { name: /documentation/i })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Preferences lets the user pick a layout and reports the change", () => {
    const onChange = vi.fn();
    render(<BurgerMenu {...baseProps()} onPreferredLayoutChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.change(screen.getByLabelText(/default graph layout/i), {
      target: { value: "breadthfirst" },
    });
    expect(onChange).toHaveBeenCalledWith("breadthfirst");
  });

  it("Preferences lets the user pick a default sort and reports the change (CR-UI-10)", () => {
    const onSortChange = vi.fn();
    render(<BurgerMenu {...baseProps()} onPreferredSortChange={onSortChange} />);
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.change(screen.getByLabelText(/default sort/i), {
      target: { value: "agents-desc" },
    });
    expect(onSortChange).toHaveBeenCalledWith("agents-desc");
  });

  it("Preferences lets the user pick a default time range and reports the change (CR-UI-27)", () => {
    const onTimeRangeChange = vi.fn();
    render(<BurgerMenu {...baseProps()} onPreferredTimeRangeChange={onTimeRangeChange} />);
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.change(screen.getByLabelText(/default time range/i), {
      target: { value: "week" },
    });
    expect(onTimeRangeChange).toHaveBeenCalledWith("week");
  });

  it("Preferences lets the user toggle session banners and reports the change (CR-UI-07)", () => {
    const onShowBannersChange = vi.fn();
    render(<BurgerMenu {...baseProps()} onShowBannersChange={onShowBannersChange} />);
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.click(screen.getByLabelText(/show session banners/i));
    expect(onShowBannersChange).toHaveBeenCalledWith(false);
  });

  it("Preferences lets the user pick a theme and reports the change (CR-UI-24)", () => {
    const onThemeChange = vi.fn();
    render(<BurgerMenu {...baseProps()} onThemeChange={onThemeChange} />);
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.change(screen.getByLabelText(/theme/i), { target: { value: "dark" } });
    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });

  it("Preferences lets the user pick a session color scheme and reports the change (CR-UI-33)", () => {
    const onSessionColorSchemeChange = vi.fn();
    render(<BurgerMenu {...baseProps()} onSessionColorSchemeChange={onSessionColorSchemeChange} />);
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.change(screen.getByLabelText(/session color scheme/i), { target: { value: "sizeGrad" } });
    expect(onSessionColorSchemeChange).toHaveBeenCalledWith("sizeGrad");
  });

  it("Preferences lets the user toggle 'Require double-click to expand/collapse' and reports the change (CR-UI-40)", () => {
    const onExpandOnDoubleClickChange = vi.fn();
    render(
      <BurgerMenu {...baseProps()} onExpandOnDoubleClickChange={onExpandOnDoubleClickChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.click(screen.getByLabelText(/require double-click to expand\/collapse/i));
    expect(onExpandOnDoubleClickChange).toHaveBeenCalledWith(true);
  });

  // CR-UI-41: none of the four panels render a visible "Close" button anymore. Inverted (not
  // deleted) from this suite's former Close-button-click assertions so a future accidental re-add
  // of the button is still caught.
  it("no panel renders a visible Close button (CR-UI-41)", () => {
    render(<BurgerMenu {...baseProps()} />);
    for (const panelName of ["Preferences", "Documentation", "About", "Help"]) {
      fireEvent.click(screen.getByRole("button", { name: /menu/i }));
      fireEvent.click(screen.getByRole("button", { name: panelName }));
      expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
      // Clean up before opening the next panel.
      fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    }
  });

  it("clicking the burger icon while a panel is open closes it without reopening the dropdown (CR-UI-41)", () => {
    render(<BurgerMenu {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(screen.getByRole("dialog", { name: /about/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    expect(screen.queryByRole("dialog", { name: /about/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("clicking outside an open panel closes it (CR-UI-41)", () => {
    render(
      <div>
        <div data-testid="outside">outside content</div>
        <BurgerMenu {...baseProps()} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(screen.getByRole("dialog", { name: /about/i })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("dialog", { name: /about/i })).not.toBeInTheDocument();
  });

  it("clicking inside an open panel does not close it (CR-UI-41)", () => {
    render(<BurgerMenu {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.pointerDown(screen.getByLabelText(/show session banners/i));
    expect(screen.getByRole("dialog", { name: /preferences/i })).toBeInTheDocument();
  });
});
