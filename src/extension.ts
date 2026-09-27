import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { analyzeWorkspace } from "./analyzer";
import { GraphPanel } from "./graphPanel";
import type { AnalysisReport, SourceLocation } from "./model";
import { renderMarkdownReport } from "./report";
import { ExceptionItem, RouteItem, RoutesProvider, SummaryProvider } from "./treeProvider";

export function activate(context: vscode.ExtensionContext): void {
  const routesProvider = new RoutesProvider();
  const summaryProvider = new SummaryProvider();
  const diagnostics = vscode.languages.createDiagnosticCollection("exceptionLens");
  let report: AnalysisReport | undefined;

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("exceptionLens.routes", routesProvider),
    vscode.window.registerTreeDataProvider("exceptionLens.summary", summaryProvider),
    diagnostics,
    vscode.commands.registerCommand("exceptionLens.scan", async () => {
      const folder = await chooseWorkspaceFolder();
      if (!folder) return;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Exception Lens: tracing exception paths", cancellable: false },
        async () => {
          try {
            report = analyzeWorkspace(folder.uri.fsPath);
            routesProvider.setReport(report);
            summaryProvider.setReport(report);
            publishDiagnostics(report, diagnostics);
            const message = `${report.stats.routeCount} routes · ${report.stats.exceptionPathCount} exception paths · ${report.stats.unmappedCount} unmapped`;
            if (report.stats.unmappedCount) {
              await vscode.window.showWarningMessage(`Exception Lens found ${message}.`, "Open first route").then((choice) => {
                if (choice === "Open first route" && report?.routes[0]) GraphPanel.show(report.routes[0]);
              });
            } else {
              vscode.window.showInformationMessage(`Exception Lens: ${message}.`);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Exception Lens could not analyze this workspace: ${message}`);
          }
        },
      );
    }),
    vscode.commands.registerCommand("exceptionLens.showGraph", (item?: RouteItem) => {
      const route = item?.route ?? report?.routes[0];
      if (!route) {
        vscode.window.showInformationMessage("Run Exception Lens analysis first.");
        return;
      }
      GraphPanel.show(route);
    }),
    vscode.commands.registerCommand("exceptionLens.openLocation", async (location: SourceLocation) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(location.file));
      const position = new vscode.Position(location.line - 1, location.column - 1);
      await vscode.window.showTextDocument(document, { selection: new vscode.Range(position, position), preview: true });
    }),
    vscode.commands.registerCommand("exceptionLens.exportReport", async () => {
      if (!report) {
        vscode.window.showInformationMessage("Run Exception Lens analysis first.");
        return;
      }
      const target = vscode.Uri.file(path.join(report.workspaceRoot, "exception-lens-report.md"));
      await fs.writeFile(target.fsPath, renderMarkdownReport(report), "utf8");
      const document = await vscode.workspace.openTextDocument(target);
      await vscode.window.showTextDocument(document, { preview: false });
    }),
    vscode.commands.registerCommand("exceptionLens.createHandlerDraft", async (item?: ExceptionItem) => {
      const occurrence = item?.issue?.exception;
      if (!occurrence) return;
      const className = occurrence.name.replace(/[^A-Za-z0-9_$]/g, "") || "UnknownError";
      const snippet = `// Exception Lens draft: review status and response shape before merging.\nif (err instanceof ${className}) {\n  return res.status(500).json({\n    error: \"${className}\",\n    message: err.message,\n  });\n}\n`;
      const document = await vscode.workspace.openTextDocument({ language: "typescript", content: snippet });
      await vscode.window.showTextDocument(document, { preview: false });
    }),
  );
}

export function deactivate(): void {}

async function chooseWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    vscode.window.showErrorMessage("Open a TypeScript workspace before running Exception Lens.");
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  const chosen = await vscode.window.showQuickPick(
    folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
    { placeHolder: "Choose a workspace to analyze" },
  );
  return chosen?.folder;
}

function publishDiagnostics(report: AnalysisReport, collection: vscode.DiagnosticCollection): void {
  collection.clear();
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const route of report.routes) {
    for (const issue of route.issues) {
      const location = issue.exception.location;
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(location.line - 1, Math.max(0, location.column - 1), location.line - 1, Math.max(1, location.column)),
        issue.message,
        vscode.DiagnosticSeverity.Warning,
      );
      diagnostic.source = "Exception Lens";
      diagnostic.code = "unmapped-exception";
      const existing = byFile.get(location.file) ?? [];
      existing.push(diagnostic);
      byFile.set(location.file, existing);
    }
  }
  for (const [file, fileDiagnostics] of byFile) collection.set(vscode.Uri.file(file), fileDiagnostics);
}
