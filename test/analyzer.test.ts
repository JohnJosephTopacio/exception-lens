import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { analyzeWorkspace } from "../src/analyzer";
import { renderMarkdownReport } from "../src/report";

let fixtureRoot = "";

before(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exception-lens-test-"));
  fs.writeFileSync(path.join(fixtureRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "CommonJS", strict: true },
    include: ["*.ts"],
  }));
  fs.writeFileSync(path.join(fixtureRoot, "app.ts"), `
    class KnownError extends Error {}
    class MissingError extends Error {}
    declare const app: { get(path: string, handler: Function): void; use(handler: Function): void };
    function deepWork(value: string) {
      if (value === "known") throw new KnownError("known");
      if (value === "missing") throw new MissingError("missing");
    }
    function handler(req: any, res: any, next: any) {
      try { deepWork(req.params.value); res.json({ ok: true }); }
      catch (error) { next(error); }
    }
    app.get("/work/:value", handler);
    function errors(err: Error, _req: any, res: any, _next: any) {
      if (err instanceof KnownError) return res.status(409).json({ error: err.message });
      return res.status(500).json({ error: "unknown" });
    }
    app.use(errors);
  `);
});

after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

describe("analyzeWorkspace", () => {
  it("traces route calls and separates mapped from unmapped exceptions", () => {
    const report = analyzeWorkspace(fixtureRoot);
    assert.equal(report.stats.routeCount, 1);
    assert.equal(report.stats.exceptionPathCount, 2);
    assert.equal(report.stats.mappedCount, 1);
    assert.equal(report.stats.unmappedCount, 1);
    assert.equal(report.stats.coveragePercent, 50);
    assert.equal(report.routes[0]?.issues[0]?.exception.name, "MissingError");
    assert.equal(report.mappings[0]?.statusCode, 409);
  });

  it("exports a readable Markdown report", () => {
    const markdown = renderMarkdownReport(analyzeWorkspace(fixtureRoot));
    assert.match(markdown, /Boundary coverage \| \*\*50%\*\*/);
    assert.match(markdown, /`MissingError` \| ⚠️ Unmapped/);
    assert.match(markdown, /GET \/work\/:value/);
  });
});
