import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import type {
  AnalysisReport,
  ExceptionOccurrence,
  FlowNode,
  MiddlewareMapping,
  RouteFlow,
  SourceLocation,
} from "./model";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head", "all", "use"]);

interface FunctionInfo {
  id: string;
  name: string;
  node: ts.FunctionLikeDeclaration;
  location: SourceLocation;
  calls: Set<string>;
  exceptions: ExceptionOccurrence[];
}

interface RouteSeed {
  id: string;
  method: string;
  routePath: string;
  handlerId?: string;
  handlerName: string;
  location: SourceLocation;
}

export function analyzeWorkspace(workspaceRoot: string): AnalysisReport {
  const warnings: string[] = [];
  const configPath = ts.findConfigFile(workspaceRoot, ts.sys.fileExists, "tsconfig.json");
  let rootNames: string[];
  let options: ts.CompilerOptions;

  if (configPath) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) warnings.push(formatDiagnostic(config.error));
    const parsed = ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, path.dirname(configPath));
    rootNames = parsed.fileNames;
    options = parsed.options;
    warnings.push(...parsed.errors.map(formatDiagnostic));
  } else {
    rootNames = collectTypeScriptFiles(workspaceRoot);
    options = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowJs: false,
      skipLibCheck: true,
    };
    warnings.push("No tsconfig.json found; Exception Lens used default TypeScript settings.");
  }

  const program = ts.createProgram({ rootNames, options });
  const checker = program.getTypeChecker();
  const functions = new Map<string, FunctionInfo>();
  const nodeToFunctionId = new Map<ts.Node, string>();
  const routes: RouteSeed[] = [];
  const mappings: MiddlewareMapping[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || isDependencyFile(sourceFile.fileName)) continue;
    discoverFunctions(sourceFile, checker, functions, nodeToFunctionId);
  }

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || isDependencyFile(sourceFile.fileName)) continue;
    inspectSourceFile(sourceFile, checker, functions, nodeToFunctionId, routes, mappings);
  }

  const routeFlows = routes.map((route) => buildRouteFlow(route, functions, mappings));
  const exceptionPathCount = routeFlows.reduce((sum, route) => sum + route.exceptions.length, 0);
  const unmappedCount = routeFlows.reduce((sum, route) => sum + route.issues.length, 0);
  const mappedCount = Math.max(0, exceptionPathCount - unmappedCount);

  return {
    generatedAt: new Date().toISOString(),
    workspaceRoot,
    routes: routeFlows,
    mappings,
    stats: {
      routeCount: routeFlows.length,
      exceptionPathCount,
      mappedCount,
      unmappedCount,
      coveragePercent: exceptionPathCount === 0 ? 100 : Math.round((mappedCount / exceptionPathCount) * 100),
    },
    warnings,
  };
}

function discoverFunctions(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  functions: Map<string, FunctionInfo>,
  nodeToFunctionId: Map<ts.Node, string>,
): void {
  const visit = (node: ts.Node): void => {
    if (isAnalyzableFunction(node)) {
      const id = functionId(node, checker);
      const info: FunctionInfo = {
        id,
        name: functionName(node),
        node,
        location: locationOf(node, sourceFile),
        calls: new Set(),
        exceptions: [],
      };
      functions.set(id, info);
      nodeToFunctionId.set(node, id);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function inspectSourceFile(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  functions: Map<string, FunctionInfo>,
  nodeToFunctionId: Map<ts.Node, string>,
  routes: RouteSeed[],
  mappings: MiddlewareMapping[],
): void {
  const stack: string[] = [];
  const visit = (node: ts.Node): void => {
    const currentFunctionId = nodeToFunctionId.get(node);
    if (currentFunctionId) stack.push(currentFunctionId);
    const activeFunction = stack.length ? functions.get(stack[stack.length - 1]!) : undefined;

    if (activeFunction && ts.isThrowStatement(node) && node.expression) {
      activeFunction.exceptions.push(exceptionFromExpression(node.expression, "throw", activeFunction.id, sourceFile));
    }

    if (activeFunction && ts.isCallExpression(node)) {
      const calledId = resolveCalledFunction(node.expression, checker);
      if (calledId && calledId !== activeFunction.id) activeFunction.calls.add(calledId);

      const callName = node.expression.getText(sourceFile);
      if (callName.endsWith("Promise.reject") || callName === "Promise.reject") {
        const expression = node.arguments[0];
        if (expression) activeFunction.exceptions.push(exceptionFromExpression(expression, "reject", activeFunction.id, sourceFile));
      }
      if ((callName === "next" || callName.endsWith(".next")) && node.arguments[0]) {
        const forwarded = node.arguments[0]!;
        // `catch (error) { next(error) }` forwards failures already found in the
        // reachable call graph; treating the catch variable as a new exception
        // would double-count it as an artificial type named "error".
        if (!isCatchVariable(forwarded, checker)) {
          activeFunction.exceptions.push(exceptionFromExpression(forwarded, "next", activeFunction.id, sourceFile));
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const route = parseRoute(node, checker, nodeToFunctionId, sourceFile);
      if (route) routes.push(route);
    }

    ts.forEachChild(node, visit);
    if (currentFunctionId) stack.pop();
  };
  visit(sourceFile);

  for (const info of functions.values()) {
    if (info.node.getSourceFile() !== sourceFile || info.node.parameters.length !== 4) continue;
    const errorParameter = info.node.parameters[0]?.name.getText(sourceFile);
    if (!errorParameter || !info.node.body) continue;
    collectMiddlewareMappings(info, errorParameter, sourceFile, mappings);
  }
}

function buildRouteFlow(
  route: RouteSeed,
  functions: Map<string, FunctionInfo>,
  mappings: MiddlewareMapping[],
): RouteFlow {
  const nodes: FlowNode[] = [{
    id: route.id,
    label: `${route.method.toUpperCase()} ${route.routePath}`,
    kind: "route",
    location: route.location,
  }];
  const edges: RouteFlow["edges"] = [];
  const exceptions: ExceptionOccurrence[] = [];
  const issues: RouteFlow["issues"] = [];
  const visited = new Set<string>();

  const walk = (functionIdValue: string, parentId: string): void => {
    if (visited.has(functionIdValue)) {
      edges.push({ from: parentId, to: functionIdValue, label: "calls" });
      return;
    }
    const info = functions.get(functionIdValue);
    if (!info) return;
    visited.add(functionIdValue);
    nodes.push({ id: info.id, label: info.name, kind: "function", location: info.location });
    edges.push({ from: parentId, to: info.id, label: "calls" });

    for (const occurrence of info.exceptions) {
      exceptions.push(occurrence);
      const mapping = mappings.find((candidate) => candidate.errorType === occurrence.name);
      nodes.push({
        id: occurrence.id,
        label: occurrence.name,
        detail: occurrence.origin,
        kind: "exception",
        location: occurrence.location,
        status: mapping ? "mapped" : "unmapped",
      });
      edges.push({ from: info.id, to: occurrence.id, label: occurrence.origin });

      if (mapping) {
        const middlewareId = `middleware:${mapping.middlewareName}:${mapping.errorType}`;
        if (!nodes.some((node) => node.id === middlewareId)) {
          nodes.push({ id: middlewareId, label: mapping.middlewareName, kind: "middleware", location: mapping.location });
        }
        edges.push({ from: occurrence.id, to: middlewareId, label: "handled by" });
        if (mapping.statusCode) {
          const responseId = `${middlewareId}:${mapping.statusCode}`;
          if (!nodes.some((node) => node.id === responseId)) {
            nodes.push({ id: responseId, label: `HTTP ${mapping.statusCode}`, kind: "response", status: "mapped" });
          }
          edges.push({ from: middlewareId, to: responseId, label: "responds" });
        }
      } else {
        issues.push({
          exception: occurrence,
          routeId: route.id,
          message: `${occurrence.name} can reach ${route.method.toUpperCase()} ${route.routePath} without an explicit middleware mapping.`,
          severity: "warning",
        });
      }
    }

    for (const called of info.calls) walk(called, info.id);
  };

  if (route.handlerId) walk(route.handlerId, route.id);
  return { ...route, path: route.routePath, nodes, edges, exceptions, issues };
}

function parseRoute(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  nodeToFunctionId: Map<ts.Node, string>,
  sourceFile: ts.SourceFile,
): RouteSeed | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const method = call.expression.name.text.toLowerCase();
  if (!HTTP_METHODS.has(method) || call.arguments.length < 2) return undefined;
  const first = call.arguments[0];
  if (!first || !ts.isStringLiteralLike(first)) return undefined;
  const handler = call.arguments[call.arguments.length - 1];
  if (!handler) return undefined;
  const handlerId = isAnalyzableFunction(handler)
    ? nodeToFunctionId.get(handler)
    : resolveCalledFunction(handler, checker);
  const handlerNameValue = isAnalyzableFunction(handler) ? functionName(handler) : handler.getText(sourceFile);
  const location = locationOf(call, sourceFile);
  return {
    id: `route:${sourceFile.fileName}:${location.line}:${method}:${first.text}`,
    method,
    routePath: first.text,
    handlerId,
    handlerName: handlerNameValue,
    location,
  };
}

function collectMiddlewareMappings(
  info: FunctionInfo,
  errorParameter: string,
  sourceFile: ts.SourceFile,
  mappings: MiddlewareMapping[],
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
      if (node.left.getText(sourceFile) === errorParameter) {
        const errorType = node.right.getText(sourceFile);
        const statusCode = findStatusCode(node, sourceFile);
        mappings.push({
          errorType,
          statusCode,
          location: locationOf(node, sourceFile),
          middlewareName: info.name,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(info.node.body!);
}

function findStatusCode(node: ts.Node, sourceFile: ts.SourceFile): number | undefined {
  let cursor: ts.Node | undefined = node.parent;
  let scope: ts.Node | undefined;
  while (cursor && !ts.isFunctionLike(cursor)) {
    if (ts.isIfStatement(cursor) && cursor.expression === node) {
      scope = cursor.thenStatement;
      break;
    }
    cursor = cursor.parent;
  }
  scope ??= cursor;
  let found: number | undefined;
  const visit = (candidate: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isCallExpression(candidate) && ts.isPropertyAccessExpression(candidate.expression)) {
      if (candidate.expression.name.text === "status" && candidate.arguments[0] && ts.isNumericLiteral(candidate.arguments[0])) {
        found = Number(candidate.arguments[0].text);
      }
    }
    ts.forEachChild(candidate, visit);
  };
  if (scope) visit(scope);
  return found;
}

function isCatchVariable(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  if (!ts.isIdentifier(expression)) return false;
  const symbol = checker.getSymbolAtLocation(expression);
  return Boolean(symbol?.declarations?.some((declaration) => ts.isVariableDeclaration(declaration) && ts.isCatchClause(declaration.parent)));
}

function resolveCalledFunction(expression: ts.Expression, checker: ts.TypeChecker): string | undefined {
  let symbol = checker.getSymbolAtLocation(expression);
  if (!symbol && ts.isPropertyAccessExpression(expression)) symbol = checker.getSymbolAtLocation(expression.name);
  if (symbol && (symbol.flags & ts.SymbolFlags.Alias)) symbol = checker.getAliasedSymbol(symbol);
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  if (!declaration) return undefined;
  const functionNode = nearestFunctionDeclaration(declaration);
  return functionNode ? functionId(functionNode, checker) : undefined;
}

function nearestFunctionDeclaration(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  if (isAnalyzableFunction(node)) return node;
  if (ts.isVariableDeclaration(node) && node.initializer && isAnalyzableFunction(node.initializer)) return node.initializer;
  if (ts.isPropertyDeclaration(node) && node.initializer && isAnalyzableFunction(node.initializer)) return node.initializer;
  return undefined;
}

function exceptionFromExpression(
  expression: ts.Expression,
  origin: ExceptionOccurrence["origin"],
  functionIdValue: string,
  sourceFile: ts.SourceFile,
): ExceptionOccurrence {
  const name = exceptionName(expression, sourceFile);
  const location = locationOf(expression, sourceFile);
  return {
    id: `exception:${sourceFile.fileName}:${location.line}:${location.column}:${origin}`,
    name,
    expression: expression.getText(sourceFile),
    location,
    functionId: functionIdValue,
    origin,
  };
}

function exceptionName(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  if (ts.isNewExpression(expression)) return expression.expression.getText(sourceFile);
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isStringLiteralLike(expression)) return "Error";
  if (ts.isCallExpression(expression)) return expression.expression.getText(sourceFile);
  return "UnknownError";
}

function functionId(node: ts.FunctionLikeDeclaration, checker: ts.TypeChecker): string {
  const sourceFile = node.getSourceFile();
  const symbolNode = functionSymbolNode(node);
  let symbol = symbolNode ? checker.getSymbolAtLocation(symbolNode) : undefined;
  if (symbol && (symbol.flags & ts.SymbolFlags.Alias)) symbol = checker.getAliasedSymbol(symbol);
  const declared = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  const target = declared ? nearestFunctionDeclaration(declared) ?? node : node;
  const start = target.getStart(target.getSourceFile());
  return `function:${target.getSourceFile().fileName}:${start}`;
}

function functionSymbolNode(node: ts.FunctionLikeDeclaration): ts.Node | undefined {
  if (node.name) return node.name;
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent)) return parent.name;
  return undefined;
}

function functionName(node: ts.FunctionLikeDeclaration): string {
  if (node.name) return node.name.getText(node.getSourceFile());
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent)) return parent.name.getText(node.getSourceFile());
  return `<anonymous:${node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1}>`;
}

function isAnalyzableFunction(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node)
    || ts.isMethodDeclaration(node)
    || ts.isArrowFunction(node)
    || ts.isFunctionExpression(node);
}

function locationOf(node: ts.Node, sourceFile: ts.SourceFile): SourceLocation {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { file: path.resolve(sourceFile.fileName), line: position.line + 1, column: position.character + 1 };
}

function collectTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build" || entry.name.startsWith(".")) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(fullPath);
    }
  };
  visit(root);
  return files;
}

function isDependencyFile(fileName: string): boolean {
  return fileName.includes(`${path.sep}node_modules${path.sep}`) || fileName.includes(`${path.sep}dist${path.sep}`);
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}
