import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BurgerMenu } from "./BurgerMenu";
import pkg from "../../package.json";

describe("BurgerMenu (CR-UI-02)", () => {
  it("shows exactly 4 menu items: Preferences, Documentation, About, Help (CR-UI-20)", () => {
    render(
      <BurgerMenu
        preferredLayout="cose"
        onPreferredLayoutChange={vi.fn()}
        preferredSort="date-desc"
        onPreferredSortChange={vi.fn()}
        preferredTimeRange="all"
        onPreferredTimeRangeChange={vi.fn()}
        showBanners={true}
        onShowBannersChange={vi.fn()}
        theme="system"
        onThemeChange={vi.fn()}
        sessionColorScheme="default"
        onSessionColorSchemeChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.textContent)).toEqual(["Preferences", "Documentation", "About", "Help"]);
  });

  it("Help opens a Markdown formatting guide with no network call (CR-UI-20)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <BurgerMenu
        preferredLayout="cose"
        onPreferredLayoutChange={vi.fn()}
        preferredSort="date-desc"
        onPreferredSortChange={vi.fn()}
        preferredTimeRange="all"
        onPreferredTimeRangeChange={vi.fn()}
        showBanners={true}
        onShowBannersChange={vi.fn()}
        theme="system"
        onThemeChange={vi.fn()}
        sessionColorScheme="default"
        onSessionColorSchemeChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("dialog", { name: /help/i })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("About shows the app name and package.json version, with no network call", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <BurgerMenu
        preferredLayout="cose"
        onPreferredLayoutChange={vi.fn()}
        preferredSort="date-desc"
        onPreferredSortChange={vi.fn()}
        preferredTimeRange="all"
        onPreferredTimeRangeChange={vi.fn()}
        showBanners={true}
        onShowBannersChange={vi.fn()}
        theme="system"
        onThemeChange={vi.fn()}
        sessionColorScheme="default"
        onSessionColorSchemeChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(screen.getByTestId("app-version")).toHaveTextContent(pkg.version);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Documentation opens a help panel with no network call", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <BurgerMenu
        preferredLayout="cose"
        onPreferredLayoutChange={vi.fn()}
        preferredSort="date-desc"
        onPreferredSortChange={vi.fn()}
        preferredTimeRange="all"
        onPreferredTimeRangeChange={vi.fn()}
        showBanners={true}
        onShowBannersChange={vi.fn()}
        theme="system"
        onThemeChange={vi.fn()}
        sessionColorScheme="default"
        onSessionColorSchemeChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Documentation" }));
    expect(screen.getByRole("dialog", { name: /documentation/i })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Preferences lets the user pick a layout and reports the change", () => {
    const onChange = vi.fn();
    render(
      <BurgerMenu
        preferredLayout="cose"
        onPreferredLayoutChange={onChange}
        preferredSort="date-desc"
        onPreferredSortChange={vi.fn()}
        preferredTimeRange="all"
        onPreferredTimeRangeChange={vi.fn()}
        showBanners={true}
        onShowBannersChange={vi.fn()}
        theme="system"
        onThemeChange={vi.fn()}
        sessionColorScheme="default"
        onSessionColorSchemeChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.change(screen.getByLabelText(/default graph layout/i), {
      target: { value: "breadthfirst" },
    });
    expect(onChange).toHaveBeenCalledWith("breadthfirst");
  });

  it("Preferences lets the user pick a default sort and reports the change (CR-UI-10)", () => {
    const onSortChange = vi.fn();
    render(
      <BurgerMenu
        preferredLayout="cose"
        onPreferredLayoutChange={vi.fn()}
        preferredSort="date-desc"
        onPreferredSortChange={onSortChange}
        preferredTimeRange="all"
        onPreferredTimeRangeChange={vi.fn()}
        showBanners={true}
        onShowBannersChange={vi.fn()}
        theme="system"
        onThemeChange={vi.fn()}
        sessionColorScheme="default"
        onSessionColorSchemeChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.change(screen.getByLabelText(/default sort/i), {
      target: { value: "agents-desc" },
    });
    expect(onSortChange).toHaveBeenCalledWith("agents-desc");
  });

  it("Preferences lets the user pick a default time range and reports the change (CR-UI-27)", () => {
    const onTimeRangeChange = vi.fn();
    render(
      <BurgerMenu
        preferredLayout="cose"
        onPreferredLayoutChange={vi.fn()}
        preferredSort="date-desc"
        onPreferredSortChange={vi.fn()}
        preferredTimeRange="all"
        onPreferredTimeRangeChange={onTimeRangeChange}
        showBanners={true}
        onShowBannersChange={vi.fn()}
        theme="system"
        onThemeChange={vi.fn()}
        sessionColorScheme="default"
        onSessionColorSchemeChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.change(screen.getByLabelText(/default time range/i), {
      target: { value: "week" },
    });
    expect(onTimeRangeChange).toHaveBeenCalledWith("week");
  });

  it("Preferences lets the user toggle session banners and reports the change (CR-UI-07)", () => {
    const onShowBannersChange = vi.fn();
    render(
      <BurgerMenu
        preferredLayout="cose"
        onPreferredLayoutChange={vi.fn()}
        preferredSort="date-desc"
        onPreferredSortChange={vi.fn()}
        preferredTimeRange="all"
        onPreferredTimeRangeChange={vi.fn()}
        showBanners={true}
        onShowBannersChange={onShowBannersChange}
        theme="system"
        onThemeChange={vi.fn()}
        sessionColorScheme="default"
        onSessionColorSchemeChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.click(screen.getByLabelText(/show session banners/i));
    expect(onShowBannersChange).toHaveBeenCalledWith(false);
  });

  it("Preferences lets the user pick a theme and reports the change (CR-UI-24)", () => {
    const onThemeChange = vi.fn();
    render(
      <BurgerMenu
        preferredLayout="cose"
        onPreferredLayoutChange={vi.fn()}
        preferredSort="date-desc"
        onPreferredSortChange={vi.fn()}
        preferredTimeRange="all"
        onPreferredTimeRangeChange={vi.fn()}
        showBanners={true}
        onShowBannersChange={vi.fn()}
        theme="system"
        onThemeChange={onThemeChange}
        sessionColorScheme="default"
        onSessionColorSchemeChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.change(screen.getByLabelText(/theme/i), { target: { value: "dark" } });
    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });

  it("Preferences lets the user pick a session color scheme and reports the change (CR-UI-33)", () => {
    const onSessionColorSchemeChange = vi.fn();
    render(
      <BurgerMenu
        preferredLayout="cose"
        onPreferredLayoutChange={vi.fn()}
        preferredSort="date-desc"
        onPreferredSortChange={vi.fn()}
        preferredTimeRange="all"
        onPreferredTimeRangeChange={vi.fn()}
        showBanners={true}
        onShowBannersChange={vi.fn()}
        theme="system"
        onThemeChange={vi.fn()}
        sessionColorScheme="default"
        onSessionColorSchemeChange={onSessionColorSchemeChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.change(screen.getByLabelText(/session color scheme/i), { target: { value: "sizeGrad" } });
    expect(onSessionColorSchemeChange).toHaveBeenCalledWith("sizeGrad");
  });
});
