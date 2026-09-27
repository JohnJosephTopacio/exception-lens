export type NodeKind = "route" | "function" | "exception" | "middleware" | "response";

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

export interface FlowNode {
  id: string;
  label: string;
  detail?: string;
  kind: NodeKind;
  location?: SourceLocation;
  status?: "mapped" | "unmapped" | "ambiguous";
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface ExceptionOccurrence {
  id: string;
  name: string;
  expression: string;
  location: SourceLocation;
  functionId: string;
  origin: "throw" | "reject" | "next";
}

export interface MiddlewareMapping {
  errorType: string;
  statusCode?: number;
  location: SourceLocation;
  middlewareName: string;
}

export interface ExceptionIssue {
  exception: ExceptionOccurrence;
  routeId: string;
  message: string;
  severity: "warning" | "information";
}

export interface RouteFlow {
  id: string;
  method: string;
  path: string;
  handlerName: string;
  location: SourceLocation;
  nodes: FlowNode[];
  edges: FlowEdge[];
  exceptions: ExceptionOccurrence[];
  issues: ExceptionIssue[];
}

export interface AnalysisStats {
  routeCount: number;
  exceptionPathCount: number;
  mappedCount: number;
  unmappedCount: number;
  coveragePercent: number;
}

export interface AnalysisReport {
  generatedAt: string;
  workspaceRoot: string;
  routes: RouteFlow[];
  mappings: MiddlewareMapping[];
  stats: AnalysisStats;
  warnings: string[];
}
