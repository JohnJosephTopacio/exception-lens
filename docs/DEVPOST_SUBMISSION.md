# Exception Lens — Devpost Submission Kit

## Project name

**Exception Lens**

## Tagline

**Map every backend exception before it becomes an accidental 500.**

## Track

**Track 03: Open — General Technical Invention**

## Project links

- Source code: https://github.com/JohnJosephTopacio/exception-lens
- Demo video: https://www.youtube.com/watch?v=7PJ_6ErEhxA

## Short description

Exception Lens is a VS Code extension that traces exceptions across TypeScript Express applications and verifies whether each failure has an explicit response in centralized error middleware. It converts hidden failure paths into an interactive graph, editor diagnostics, and a measurable boundary-coverage score.

## Inspiration

Backend error handling rarely breaks because a developer forgot to write a `try/catch`. It breaks because applications evolve across many files. A repository introduces a new custom error, a service begins calling it, and the shared error middleware is never updated. The code still compiles, but users receive an unintended generic `500` response.

Existing editor diagnostics are good at finding local code problems. I wanted a tool that could answer a broader architectural question: **What failures can this API route produce, and is the application actually prepared to handle all of them?**

That question became Exception Lens.

## What it does

Exception Lens analyzes a TypeScript Express workspace directly inside VS Code. Starting from each discovered route, it follows calls through controllers, services, and repositories. It detects exceptions created with `throw`, `Promise.reject(...)`, and `next(error)`, then compares those reachable failures with the application's centralized error middleware.

The results appear in a native VS Code sidebar and an interactive exception map:

- **Green** exceptions have an explicit middleware mapping.
- **Red** exceptions can reach the application boundary without a defined response.
- Editor diagnostics identify the exact source of each uncovered path.
- Clicking a graph node opens the corresponding source line.
- A boundary-coverage score summarizes how many discovered exception paths are intentionally handled.
- A Markdown report can be exported for code review or CI artifacts.
- For an uncovered exception, Exception Lens can create an editable middleware-handler draft.

In the included checkout demo, Exception Lens traces three exception paths across four files. It identifies `OrderNotFoundError` and `PaymentDeclinedError` as handled, while revealing that `InventoryUnavailableError` has no explicit response contract. After adding an HTTP `503` mapping and rescanning, boundary coverage increases from 67% to 100%.

## How I built it

The extension is written in TypeScript and uses the Visual Studio Code Extension API for commands, diagnostics, navigation, sidebar views, and the interactive webview.

The analysis engine creates a TypeScript `Program` and uses the TypeScript Compiler API to resolve symbols across files. It performs four main passes:

1. Discover function and method declarations in the workspace.
2. Identify Express routes and resolve their handler symbols.
3. Build a reachable call graph and collect exception-producing expressions.
4. Inspect four-argument Express error middleware for `instanceof` branches and HTTP status mappings.

Each route is converted into a graph of route, function, exception, middleware, and response nodes. The graph is rendered as a theme-aware SVG inside a secured VS Code webview. All analysis is deterministic and local: source code is never uploaded, and no API key or hosted model is required.

The repository includes automated analyzer tests, a GitHub Actions workflow, a reproducible VSIX packaging command, and a deliberately incomplete Express application for demonstrating the full detect-fix-rescan workflow.

## Challenges I ran into

The hardest challenge was distinguishing an exception's origin from its propagation. For example, `catch (error) { next(error); }` forwards an existing exception rather than creating a new type called `error`. Treating both as new failures would double-count paths and produce misleading results.

Cross-file symbol resolution was another challenge. Text matching is not enough when handlers and services are imported, aliased, or assigned to variables, so the analyzer uses the TypeScript type checker to connect call expressions to their declarations.

The visualization also had to stay synchronized with the latest scan. A successful rescan now refreshes an open graph automatically, allowing the user to see an uncovered red path turn green without reopening the panel.

Finally, I had to keep the prototype honest. Static analysis cannot perfectly predict dynamic JavaScript behavior, so the interface and documentation describe boundary coverage as coverage of **discovered** exception paths rather than a proof that no runtime failures exist.

## Accomplishments that I am proud of

- Built a working cross-file exception-propagation analyzer rather than a single-file linter.
- Created a concrete boundary-coverage metric that developers can improve and demonstrate.
- Integrated findings naturally into VS Code through diagnostics, a sidebar, source navigation, and an interactive graph.
- Kept analysis private and deterministic with no cloud dependency.
- Produced an installable VSIX and verified the complete build from a fresh GitHub clone.
- Built a concise demonstration where a real middleware gap can be found, fixed, and verified in under two minutes.

## What I learned

I learned how much semantic information is available through the TypeScript Compiler API beyond the syntax tree. Reliable cross-file analysis depends on symbol identity, declarations, and source locations—not just recognizing strings such as `throw` or `router.get`.

I also learned that developer tools need to explain their confidence. A useful analysis product should show both the result and the path that produced it, so developers can validate a finding instead of blindly trusting a score.

## What's next

The next version would add adapters for NestJS exception filters and Fastify error handlers, followed by Python and Java analyzers. Other planned improvements include error-code mappings, runtime trace correlation, test-coverage integration, and a CI mode that can fail a pull request when boundary coverage decreases.

Longer term, Exception Lens could maintain versioned error contracts for every endpoint, allowing teams to detect breaking API behavior before deployment.

## Built With

- TypeScript
- Visual Studio Code Extension API
- TypeScript Compiler API
- Node.js
- esbuild
- pnpm
- GitHub Actions
- OpenAI Codex / ChatGPT — ideation, implementation, testing, documentation, and code review

## AI assistance disclosure

This project was developed with assistance from **OpenAI Codex / ChatGPT** for ideation, implementation, testing, documentation, and code review.

## Suggested screenshot set

Devpost requires at least three images. Use 16:9 images where possible and keep the editor text large enough to read.

### Screenshot 1 — Boundary coverage dashboard

**Capture:** The Exception Lens sidebar after analyzing the intentionally incomplete demo. Show `67% boundary coverage`, one route, three exception paths, and one unmapped path.

**Caption:**

> Exception Lens summarizes the failure surface of the workspace and immediately identifies an uncovered exception path.

### Screenshot 2 — Unmapped exception graph

**Capture:** The graph for `POST /orders/:orderId/checkout` before the fix. Make sure the red `InventoryUnavailableError` node and the green mapped paths are visible.

**Caption:**

> The interactive map traces failures across route, service, and repository boundaries. Red highlights an exception with no explicit middleware response.

### Screenshot 3 — Source-level diagnosis

**Capture:** `repository.ts` with the `InventoryUnavailableError` throw site selected and the Exception Lens warning visible in the Problems panel or sidebar.

**Caption:**

> Every finding links back to its source, so developers can move directly from architectural overview to the exact line that needs attention.

### Screenshot 4 — Successful rescan

**Capture:** The graph after adding the HTTP `503` middleware mapping. Show `100% boundary coverage`, zero unmapped paths, and the previously red exception displayed in green.

**Caption:**

> After defining the missing response contract, a rescan verifies all three exception paths and raises boundary coverage to 100%.

## Screenshot capture checklist

- Hide unrelated applications, terminals, notifications, account names, and private files.
- Use a dark or light theme consistently across every image.
- Increase editor zoom until labels remain readable in Devpost's gallery.
- Keep the Exception Lens name or Activity Bar icon visible in at least one image.
- Capture the incomplete state before the fixed state.
- Crop out unused desktop space, but retain enough VS Code chrome to establish that this is a real extension.
- Export PNG files with descriptive names such as `01-coverage-dashboard.png`.

## Final Devpost checklist

- [ ] Register for GIBC V2 on Devpost.
- [ ] Select Track 03: Open.
- [ ] Paste the project story sections from this document.
- [ ] Add the public GitHub repository URL.
- [ ] Add the public or unlisted 2–5 minute video URL.
- [ ] Upload at least three high-quality screenshots.
- [ ] Paste the complete Built With list, including the AI-assistance disclosure.
- [ ] Add every teammate using their real full name and Devpost account.
- [ ] Confirm that the repository and video open in a private/incognito browser window.
- [ ] Confirm that the latest repository commit contains the README and working source.
- [ ] Submit before October 1, 2026 at 11:45 PM GMT+8.
