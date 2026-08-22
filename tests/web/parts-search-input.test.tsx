// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { PartsSearchInput } from "../../src/web/components/parts/PartsSearchInput";

describe("PartsSearchInput", () => {
  it("commits Japanese input only after IME composition ends", () => {
    const onValueChange = vi.fn();
    render(<PartsSearchInput value="" onValueChange={onValueChange} />);
    const input = screen.getByRole("textbox", { name: "部品を検索" });

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "あ" } });
    fireEvent.change(input, { target: { value: "あk" } });

    expect(input).toHaveValue("あk");
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "あか" } });
    fireEvent.compositionEnd(input, { data: "か" });

    expect(input).toHaveValue("あか");
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenLastCalledWith("あか");
  });

  it("commits non-IME input immediately", () => {
    const onValueChange = vi.fn();
    render(<PartsSearchInput value="" onValueChange={onValueChange} />);
    const input = screen.getByRole("textbox", { name: "部品を検索" });

    fireEvent.change(input, { target: { value: "abc" } });

    expect(onValueChange).toHaveBeenCalledWith("abc");
  });
});
