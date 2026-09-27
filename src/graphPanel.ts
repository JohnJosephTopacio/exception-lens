import * as path from "node:path";
import * as vscode from "vscode";
import type { FlowNode, RouteFlow } from "./model";

export class GraphPanel {
  private static current?: GraphPanel;

  static show(route: RouteFlow): void {
    if (GraphPanel.current) {
      GraphPanel.current.panel.reveal(vscode.ViewColumn.One);
      GraphPanel.current.update(route);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "exceptionLens.graph",
      "Exception Map",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    GraphPanel.current = new GraphPanel(panel, route);
  }

  private constructor(private readonly panel: vscode.WebviewPanel, route: RouteFlow) {
    this.panel.onDidDispose(() => { GraphPanel.current = undefined; });
    this.panel.webview.onDidReceiveMessage(async (message: { type?: string; file?: string; line?: number; column?: number }) => {
      if (message.type === "open" && message.file) {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(message.file));
        const position = new vscode.Position(Math.max(0, (message.line ?? 1) - 1), Math.max(0, (message.column ?? 1) - 1));
        await vscode.window.showTextDocument(document, { selection: new vscode.Range(position, position), preview: true });
      }
    });
    this.update(route);
  }

  private update(route: RouteFlow): void {
    this.panel.title = `${route.method.toUpperCase()} ${route.path} · Exception Map`;
    this.panel.webview.html = renderHtml(route);
  }
}

function renderHtml(route: RouteFlow): string {
  const nonce = String(Date.now());
  const levels = layoutLevels(route);
  const width = Math.max(900, levels.length * 250 + 100);
  const height = Math.max(440, Math.max(...levels.map((level) => level.length), 1) * 120 + 160);
  const positions = new Map<string, { x: number; y: number }>();
  levels.forEach((level, column) => {
    const spacing = height / (level.length + 1);
    level.forEach((node, row) => positions.set(node.id, { x: 70 + column * 250, y: spacing * (row + 1) }));
  });

  const edges = route.edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return "";
    const x1 = from.x + 170;
    const x2 = to.x;
    const mid = (x1 + x2) / 2;
    return `<path class="edge" d="M ${x1} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${x2} ${to.y}" marker-end="url(#arrow)" />`
      + `<text class="edge-label" x="${mid}" y="${(from.y + to.y) / 2 - 6}">${escapeHtml(edge.label ?? "")}</text>`;
  }).join("");

  const cards = route.nodes.map((node) => {
    const position = positions.get(node.id);
    if (!position) return "";
    const stateClass = node.status ? ` ${node.status}` : "";
    const location = node.location
      ? `data-file="${escapeHtml(node.location.file)}" data-line="${node.location.line}" data-column="${node.location.column}" tabindex="0" role="button"`
      : "";
    const detail = node.location ? `${path.basename(node.location.file)}:${node.location.line}` : (node.detail ?? node.kind);
    return `<g class="node${stateClass}" transform="translate(${position.x}, ${position.y - 34})" ${location}>
      <rect width="170" height="68" rx="10" />
      <text class="node-kind" x="12" y="18">${escapeHtml(node.kind.toUpperCase())}</text>
      <text class="node-label" x="12" y="39">${escapeHtml(truncate(node.label, 23))}</text>
      <text class="node-detail" x="12" y="57">${escapeHtml(truncate(detail, 27))}</text>
    </g>`;
  }).join("");

  const coverage = route.exceptions.length === 0
    ? 100
    : Math.round(((route.exceptions.length - route.issues.length) / route.exceptions.length) * 100);
  const issueSummary = route.issues.length
    ? `${route.issues.length} unmapped exception path${route.issues.length === 1 ? "" : "s"}`
    : "Every discovered exception has an explicit middleware mapping";

  return `<!doctype html>
  <html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    body { margin:0; padding:24px; color:var(--vscode-foreground); background:var(--vscode-editor-background); font-family:var(--vscode-font-family); }
    header { display:flex; justify-content:space-between; align-items:flex-start; gap:24px; margin-bottom:18px; }
    h1 { margin:0 0 5px; font-size:23px; } .subtitle { color:var(--vscode-descriptionForeground); }
    .score { min-width:150px; padding:12px 16px; border:1px solid var(--vscode-widget-border); border-radius:12px; background:var(--vscode-sideBar-background); }
    .score strong { display:block; font-size:26px; color:${coverage === 100 ? "var(--vscode-testing-iconPassed)" : "var(--vscode-testing-iconFailed)"}; }
    .legend { display:flex; gap:16px; margin:12px 0; color:var(--vscode-descriptionForeground); font-size:12px; }
    .dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:5px; }
    .map { overflow:auto; border:1px solid var(--vscode-widget-border); border-radius:12px; background:var(--vscode-sideBar-background); }
    svg { display:block; }
    .edge { fill:none; stroke:var(--vscode-editorIndentGuide-background); stroke-width:1.6; }
    .edge-label { fill:var(--vscode-descriptionForeground); font-size:10px; text-anchor:middle; paint-order:stroke; stroke:var(--vscode-sideBar-background); stroke-width:4px; }
    .node rect { fill:var(--vscode-editor-background); stroke:var(--vscode-widget-border); stroke-width:1.4; }
    .node[role=button] { cursor:pointer; } .node[role=button]:hover rect, .node[role=button]:focus rect { stroke:var(--vscode-focusBorder); stroke-width:2; }
    .node.mapped rect { stroke:var(--vscode-testing-iconPassed); } .node.unmapped rect { stroke:var(--vscode-testing-iconFailed); stroke-width:2.2; }
    .node-kind { fill:var(--vscode-descriptionForeground); font-size:8px; letter-spacing:1.3px; }
    .node-label { fill:var(--vscode-foreground); font-size:12px; font-weight:600; }
    .node-detail { fill:var(--vscode-descriptionForeground); font-size:9px; }
    .issue { margin-top:16px; padding:12px 14px; border-left:3px solid ${route.issues.length ? "var(--vscode-testing-iconFailed)" : "var(--vscode-testing-iconPassed)"}; background:var(--vscode-textBlockQuote-background); }
  </style></head><body>
    <header><div><h1>${escapeHtml(route.method.toUpperCase())} ${escapeHtml(route.path)}</h1><div class="subtitle">${escapeHtml(route.handlerName)} · click any source node to open it</div></div>
    <div class="score"><strong>${coverage}%</strong><span>boundary coverage</span></div></header>
    <div class="legend"><span><i class="dot" style="background:var(--vscode-testing-iconPassed)"></i>mapped</span><span><i class="dot" style="background:var(--vscode-testing-iconFailed)"></i>unmapped</span><span><i class="dot" style="background:var(--vscode-descriptionForeground)"></i>flow</span></div>
    <div class="map"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--vscode-editorIndentGuide-background)"/></marker></defs>${edges}${cards}</svg></div>
    <div class="issue">${escapeHtml(issueSummary)}</div>
    <script nonce="${nonce}">const vscode=acquireVsCodeApi();document.querySelectorAll('[data-file]').forEach(node=>{const open=()=>vscode.postMessage({type:'open',file:node.dataset.file,line:Number(node.dataset.line),column:Number(node.dataset.column)});node.addEventListener('click',open);node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});});</script>
  </body></html>`;
}

function layoutLevels(route: RouteFlow): FlowNode[][] {
  const byId = new Map(route.nodes.map((node) => [node.id, node]));
  const depth = new Map<string, number>([[route.id, 0]]);
  for (let pass = 0; pass < route.nodes.length; pass++) {
    for (const edge of route.edges) {
      const fromDepth = depth.get(edge.from);
      if (fromDepth !== undefined) depth.set(edge.to, Math.max(depth.get(edge.to) ?? 0, fromDepth + 1));
    }
  }
  const maxDepth = Math.min(7, Math.max(...depth.values(), 0));
  const levels = Array.from({ length: maxDepth + 1 }, () => [] as FlowNode[]);
  for (const [id, node] of byId) levels[Math.min(depth.get(id) ?? 1, maxDepth)]!.push(node);
  return levels.filter((level) => level.length);
}

function truncate(value: string, max: number): string { return value.length > max ? `${value.slice(0, max - 1)}…` : value; }
function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}
