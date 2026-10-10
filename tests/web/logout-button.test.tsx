// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react/pure";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogoutButton } from "../../src/web/components/layout/LogoutButton";

afterEach(cleanup);

describe("logout instructions", () => {
  it("keeps the current page when the user cancels the explanation", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LogoutButton className="logout" />);
    const form = screen.getByRole("button", { name: "ログアウト" }).closest("form")!;
    expect(fireEvent.submit(form)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("ID・パスワードを入力せず「キャンセル」"));
  });

  it("allows native POST navigation after the user reads the cancellation instructions", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<LogoutButton className="logout" />);
    const form = screen.getByRole("button", { name: "ログアウト" }).closest("form")!;
    expect(fireEvent.submit(form)).toBe(true);
    expect(form.method).toBe("post");
    expect(form.getAttribute("action")).toBe("/api/logout");
  });
});
