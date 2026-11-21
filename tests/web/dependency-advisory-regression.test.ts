import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("dependency advisory regression invariants", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    version: string;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    pnpm: { overrides: Record<string, string> };
  };
  const lock = readFileSync("pnpm-lock.yaml", "utf8");

  it("uses a patched SheetJS release from the vendor CDN", () => {
    expect(pkg.dependencies.xlsx).toBe("https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz");
    expect(lock).toContain("xlsx@https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz");
    expect(lock).toContain("integrity: sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==");
  });
  it("does not ship the build-time Vite React plugin as a runtime dependency", () => {
    expect(pkg.dependencies["@vitejs/plugin-react"]).toBeUndefined();
    expect(pkg.devDependencies["@vitejs/plugin-react"]).toBeTruthy();
  });
  it("keeps DOMPurify at or above the patched version during automated updates", () => {
    // SemVer floors are security invariants; exact pins would incorrectly block
    // future patched Dependabot upgrades.
    function parts(version: string): number[] {
      const match = version.match(/^[~^]?(\d+)\.(\d+)\.(\d+)$/);
      expect(match).not.toBeNull();
      return match!.slice(1).map(Number);
    }
    function isAtLeast(version: string, minimum: string): boolean {
      const left = parts(version);
      const right = parts(minimum);
      for (let index = 0; index < 3; index++) {
        if (left[index] !== right[index]) return left[index] > right[index];
      }
      return true;
    }
    expect(isAtLeast(pkg.pnpm.overrides.dompurify, "3.4.18")).toBe(true);
    const resolved = [...lock.matchAll(/^  dompurify@(\d+\.\d+\.\d+):$/gm)].map(match => match[1]);
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.every(version => isAtLeast(version, "3.4.18"))).toBe(true);
  });
  it("tracks the data integrity patch version after the regression gate", () => {
    expect(pkg.version).toBe("0.2.1");
  });
});
