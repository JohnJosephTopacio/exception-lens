import * as path from "node:path";
import * as vscode from "vscode";
import type { AnalysisReport, ExceptionIssue, RouteFlow } from "./model";

export type LensTreeItem = SummaryItem | RouteItem | ExceptionItem | EmptyItem;

export class SummaryProvider implements vscode.TreeDataProvider<LensTreeItem> {
  private readonly changed = new vscode.EventEmitter<LensTreeItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private report?: AnalysisReport;

  setReport(report: AnalysisReport): void {
    this.report = report;
    this.changed.fire(undefined);
  }

  getTreeItem(element: LensTreeItem): vscode.TreeItem { return element; }

  getChildren(): LensTreeItem[] {
    if (!this.report) return [new EmptyItem("Run an analysis to calculate coverage")];
    const { stats } = this.report;
    return [
      new SummaryItem(`${stats.coveragePercent}%`, "boundary coverage", coverageIcon(stats.coveragePercent)),
      new SummaryItem(String(stats.routeCount), "routes traced", new vscode.ThemeIcon("git-branch")),
      new SummaryItem(String(stats.exceptionPathCount), "exception paths", new vscode.ThemeIcon("symbol-event")),
      new SummaryItem(String(stats.unmappedCount), "unmapped paths", new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground"))),
    ];
  }
}

export class RoutesProvider implements vscode.TreeDataProvider<LensTreeItem> {
  private readonly changed = new vscode.EventEmitter<LensTreeItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private report?: AnalysisReport;

  setReport(report: AnalysisReport): void {
    this.report = report;
    this.changed.fire(undefined);
  }

  getTreeItem(element: LensTreeItem): vscode.TreeItem { return element; }

  getChildren(element?: LensTreeItem): LensTreeItem[] {
    if (!this.report) return [];
    if (!element) {
      if (!this.report.routes.length) return [new EmptyItem("No Express routes found")];
      return this.report.routes.map((route) => new RouteItem(route));
    }
    if (element instanceof RouteItem) {
      if (!element.route.exceptions.length) return [new EmptyItem("No exception paths detected")];
      const issueIds = new Set(element.route.issues.map((issue) => issue.exception.id));
      return element.route.exceptions.map((occurrence) => {
        const issue = element.route.issues.find((candidate) => candidate.exception.id === occurrence.id);
        return new ExceptionItem(element.route, occurrence, issue, issueIds.has(occurrence.id));
      });
    }
    return [];
  }
}

class SummaryItem extends vscode.TreeItem {
  constructor(label: string, description: string, icon: vscode.ThemeIcon) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = icon;
  }
}

export class RouteItem extends vscode.TreeItem {
  readonly contextValue = "route";
  constructor(readonly route: RouteFlow) {
    super(`${route.method.toUpperCase()} ${route.path}`, vscode.TreeItemCollapsibleState.Expanded);
    this.description = route.issues.length
      ? `${route.issues.length} gap${route.issues.length === 1 ? "" : "s"}`
      : `${route.exceptions.length} covered`;
    this.iconPath = route.issues.length
      ? new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground"))
      : new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("testing.iconPassed"));
    this.tooltip = new vscode.MarkdownString(`**${this.label}**\n\nHandler: \`${route.handlerName}\``);
    this.command = { command: "exceptionLens.showGraph", title: "Show exception map", arguments: [this] };
  }
}

export class ExceptionItem extends vscode.TreeItem {
  readonly contextValue: string;
  constructor(
    readonly route: RouteFlow,
    readonly occurrence: RouteFlow["exceptions"][number],
    readonly issue: ExceptionIssue | undefined,
    unmapped: boolean,
  ) {
    super(occurrence.name, vscode.TreeItemCollapsibleState.None);
    const exception = occurrence;
    this.label = exception.name;
    this.description = unmapped ? "unmapped" : "mapped";
    this.contextValue = unmapped ? "unmappedException" : "mappedException";
    this.iconPath = unmapped
      ? new vscode.ThemeIcon("error", new vscode.ThemeColor("problemsErrorIcon.foreground"))
      : new vscode.ThemeIcon("check", new vscode.ThemeColor("testing.iconPassed"));
    if (exception) {
      this.resourceUri = vscode.Uri.file(exception.location.file);
      this.command = {
        command: "exceptionLens.openLocation",
        title: "Open source",
        arguments: [exception.location],
      };
      this.tooltip = new vscode.MarkdownString(
        `${unmapped ? "**Unmapped exception path**" : "**Mapped exception path**"}\n\n`
        + `\`${exception.expression}\`\n\n${path.basename(exception.location.file)}:${exception.location.line}`,
      );
    }
  }
}

class EmptyItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon("info");
  }
}

function coverageIcon(percent: number): vscode.ThemeIcon {
  if (percent === 100) return new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("testing.iconPassed"));
  if (percent >= 70) return new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground"));
  return new vscode.ThemeIcon("error", new vscode.ThemeColor("problemsErrorIcon.foreground"));
}
