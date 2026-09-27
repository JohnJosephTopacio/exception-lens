# Exception Lens

> Code coverage tells you which lines ran. Exception Lens tells you which failures your application is prepared to handle.

Exception Lens is a VS Code extension that traces exceptions from TypeScript Express routes through controllers, services, and repositories to centralized error middleware. It turns an invisible failure surface into an interactive map and calls out every exception that reaches the application boundary without an explicit response contract.

Built for the **Global Innovation Build Challenge V2 — Track 03: Open (General Technical Invention)**.

## Why it exists

Backend error handling tends to drift as an application grows. A service adds a new custom error, a route starts calling that service, but the shared middleware is never updated. The result is an accidental `500`, an inconsistent response, or a production-only surprise.

Exception Lens catches that gap while you are still in the editor.

## What it does

- Finds Express routes such as `router.get(...)` and `app.post(...)`.
- Builds a workspace-level call graph using the TypeScript compiler.
- Detects `throw`, `Promise.reject(...)`, and `next(error)` paths.
- Finds custom error mappings in four-argument Express middleware.
- Matches `err instanceof SomeError` branches to their HTTP status codes.
- Calculates **boundary coverage**: discovered exception paths with an explicit middleware mapping.
- Adds editor diagnostics at unmapped throw sites.
- Shows routes and exceptions in a native VS Code sidebar.
- Renders an interactive exception-flow graph with click-to-source navigation.
- Exports a reviewable Markdown coverage report.
- Creates a draft middleware branch for an uncovered exception.

## Demo scenario

The repository includes [`example/express-api`](example/express-api), a deliberately small API with:

- a mapped `OrderNotFoundError → HTTP 404` path;
- a mapped `PaymentDeclinedError → HTTP 402` path; and
- an intentionally unmapped `InventoryUnavailableError` path.

Analyzing the example makes the missing contract visible immediately. Add an `instanceof InventoryUnavailableError` branch to the middleware, scan again, and watch the route turn green.

## Run the extension

### Prerequisites

- Node.js 20 or newer
- pnpm 9 or newer (npm also works if you translate the commands)
- VS Code 1.95 or newer

### Development

```bash
pnpm install
pnpm run package
```

### Build and install a VSIX

Create an installable extension package:

```bash
pnpm run package:vsix
```

This verifies the project and creates `exception-lens-0.1.0.vsix`. Install it from the command line:

```bash
code --install-extension exception-lens-0.1.0.vsix
```

Alternatively, open VS Code's Extensions view, choose **Install from VSIX...** from the `...` menu, and select the generated file.

Open this repository in VS Code and press `F5` to start an Extension Development Host. In the new window:

1. Open the `example/express-api` folder.
2. Open the Command Palette.
3. Run **Exception Lens: Analyze Workspace**.
4. Select a route in the Exception Lens sidebar to open its exception map.

### Commands

| Command | Purpose |
| --- | --- |
| `Exception Lens: Analyze Workspace` | Scan the selected TypeScript workspace. |
| `Exception Lens: Show Exception Map` | Visualize the selected route's propagation graph. |
| `Exception Lens: Export Coverage Report` | Write `exception-lens-report.md` at the workspace root. |
| `Exception Lens: Draft Middleware Handler` | Open a safe, editable handler draft for an unmapped error. |

## How the analysis works

```text
Express route
    │
    ▼
route handler ──calls──▶ service ──calls──▶ repository
                              │                   │
                              ▼                   ▼
                       custom exception      rejected error
                              │                   │
                              └───────┬───────────┘
                                      ▼
                           centralized middleware
                                      │
                                      ▼
                              explicit HTTP response
```

Exception Lens creates a TypeScript `Program`, resolves function symbols through the type checker, and walks reachable functions from each discovered route handler. It then compares reachable exception types with `instanceof` branches found in Express error middleware.

The engine is deterministic and local. Source code is not uploaded, and no API key or hosted model is required.

## Current limitations

This hackathon prototype intentionally optimizes for a convincing, reliable TypeScript/Express workflow.

- Analysis is conservative and may not resolve dynamic dispatch, dependency injection containers, decorators, or runtime monkey-patching.
- Middleware mapping detection currently recognizes `instanceof` branches and numeric `.status(...)` calls.
- Calls into third-party packages are treated as opaque.
- JavaScript and non-Express frameworks are not yet supported.
- A green result means every *discovered* exception is mapped; it is not a proof that no runtime failure exists.

Planned work includes NestJS filters, error-code mappings, runtime trace correlation, test-coverage integration, and additional languages through adapter-based analyzers.

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/analyzer.ts` | TypeScript AST discovery, call tracing, route and middleware analysis |
| `src/model.ts` | Stable analysis and graph data model |
| `src/treeProvider.ts` | Native VS Code sidebar and coverage summary |
| `src/graphPanel.ts` | Theme-aware interactive SVG graph |
| `src/extension.ts` | Commands, diagnostics, editor navigation, report export |
| `src/report.ts` | Portable Markdown coverage report |

## Privacy and security

- All analysis happens on the developer's machine.
- No source code, file names, or analysis results leave the workspace.
- The graph webview uses a restrictive Content Security Policy and contains no remote assets.
- Generated middleware is opened as an unsaved draft and is never inserted automatically.

## AI assistance disclosure

This project was developed with assistance from **OpenAI Codex / ChatGPT** for ideation, implementation, testing, documentation, and code review.

## Built with

- TypeScript
- Visual Studio Code Extension API
- TypeScript Compiler API
- esbuild
- Node.js test runner
- OpenAI Codex / ChatGPT (disclosed AI coding assistance)

## License

[MIT](LICENSE)
