import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../../packages/server/dist/index.js";

test("dashboard ships responsive workbench contracts for dense operator pages", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-dashboard-responsive-"));
  const server = createServer({
    dataRoot,
    runtimeMode: "debug",
    dashboardRoot: path.resolve("apps/dashboard")
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const html = await (await fetch(baseUrl)).text();
    const app = await (await fetch(`${baseUrl}/assets/app.js`)).text();
    const css = await (await fetch(`${baseUrl}/assets/styles.css`)).text();

    assert.match(html, /EvoPilot 控制台/);
    assert.match(app, /renderHomeCommandCenter/);
    assert.match(app, /command-action/);
    assert.match(app, /navSections/);
    assert.match(app, /renderDiscoveryAndTargets/);
    assert.match(app, /renderLoopExecution/);
    assert.match(app, /renderEvaluationAndRelease/);
    assert.match(app, /renderLoopTargetRuntimePanel/);
    assert.match(app, /renderReleaseGuardrailPanel/);
    assert.match(app, /normalizePage/);
    assert.match(app, /loopBacklogModel/);
    assert.match(app, /backlog-summary/);
    assert.match(app, /renderReleaseInspector/);
    assert.match(app, /release-inspector/);
    assert.match(app, /renderEmptyState/);
    assert.match(app, /renderStatusNotice/);
    assert.match(app, /renderLoadingSkeleton/);
    assert.match(app, /data-label="\$\{escapeHtml\(headers\[index\] \?\? ""\)\}"/);
    assert.match(css, /\.command-center/);
    assert.match(css, /\.nav-section/);
    assert.match(css, /\.page-brief/);
    assert.match(css, /\.target-runtime-lists/);
    assert.match(css, /\.runtime-row/);
    assert.match(css, /\.backlog-summary/);
    assert.match(css, /\.release-inspector/);
    assert.match(css, /\.empty-state/);
    assert.match(css, /\.skeleton-panel/);
    assert.match(css, /@media \(max-width: 640px\)/);
    assert.match(css, /\.table-shell thead/);
    assert.match(css, /content: attr\(data-label\)/);
    assert.match(css, /grid-template-columns: 92px minmax\(0, 1fr\)/);
    assert.match(css, /\.release-inspector,\n  \.branch-strategy/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
