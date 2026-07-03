import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BurgerMenu } from "./BurgerMenu";
import pkg from "../../package.json";

describe("BurgerMenu (CR-UI-02)", () => {
  it("shows exactly 3 menu items: Preferences, Documentation, About", () => {
    render(
      <BurgerMenu
        preferredLayout="cose"
        onPreferredLayoutChange={vi.fn()}
        preferredSort="date-desc"
        onPreferredSortChange={vi.fn()}
        showBanners={true}
        onShowBannersChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.textContent)).toEqual(["Preferences", "Documentation", "About"]);
  });

  it("About shows the app name and package.json version, with no network call", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <BurgerMenu
        preferredLayout="cose"
        onPreferredLayoutChange={vi.fn()}
        preferredSort="date-desc"
        onPreferredSortChange={vi.fn()}
        showBanners={true}
        onShowBannersChange={vi.fn()}
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
        showBanners={true}
        onShowBannersChange={vi.fn()}
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
        showBanners={true}
        onShowBannersChange={vi.fn()}
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
        showBanners={true}
        onShowBannersChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.change(screen.getByLabelText(/default sort/i), {
      target: { value: "agents-desc" },
    });
    expect(onSortChange).toHaveBeenCalledWith("agents-desc");
  });

  it("Preferences lets the user toggle session banners and reports the change (CR-UI-07)", () => {
    const onShowBannersChange = vi.fn();
    render(
      <BurgerMenu
        preferredLayout="cose"
        onPreferredLayoutChange={vi.fn()}
        preferredSort="date-desc"
        onPreferredSortChange={vi.fn()}
        showBanners={true}
        onShowBannersChange={onShowBannersChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    fireEvent.click(screen.getByLabelText(/show session banners/i));
    expect(onShowBannersChange).toHaveBeenCalledWith(false);
  });
});
