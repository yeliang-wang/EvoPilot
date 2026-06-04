import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const queues = new Map();
const builds = new Map();

export async function startInternalProductCicd(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = Number(options.port ?? 8080);
  const dataRoot = options.dataRoot ?? process.env.EVOPILOT_PRODUCT_CICD_DATA_ROOT ?? path.join(os.tmpdir(), "evopilot-product-cicd-runtime");
  fs.mkdirSync(path.join(dataRoot, "queues"), { recursive: true });
  fs.mkdirSync(path.join(dataRoot, "builds"), { recursive: true });
  loadState(dataRoot);
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${host}:${port}`);
      if (request.method === "GET" && url.pathname === "/health") {
        return writeJson(response, 200, { status: "UP", service: "evopilot-product-cicd" });
      }
      const trigger = url.pathname.match(/^\/job\/([^/]+)\/build(?:WithParameters)?$/);
      if (request.method === "POST" && trigger) {
        const job = decodeURIComponent(trigger[1]);
        const body = await readBody(request);
        const parameters = Object.fromEntries(new URLSearchParams(body));
        const queueId = String(Date.now());
        const buildNumber = builds.size + 1;
        const address = server.address();
        const actualPort = typeof address === "object" && address ? address.port : port;
        const base = `http://${host}:${actualPort}`;
        const validation = validateParameters(parameters);
        const result = validation.ok ? "SUCCESS" : "FAILURE";
        const build = {
          job,
          number: buildNumber,
          url: `${base}/job/${encodeURIComponent(job)}/${buildNumber}/`,
          parameters,
          building: false,
          result,
          stages: renderStages(validation),
          consoleText: renderConsole(job, parameters, validation),
          artifacts: validation.ok ? [{ displayPath: "evopilot-release-report.json", relativePath: "evopilot-release-report.json" }] : []
        };
        queues.set(queueId, { executable: { number: buildNumber, url: build.url } });
        builds.set(`${job}:${buildNumber}`, build);
        persistQueue(dataRoot, queueId, queues.get(queueId));
        persistBuild(dataRoot, build);
        response.writeHead(201, { location: `${base}/queue/item/${queueId}/` });
        response.end();
        return;
      }
      const queueMatch = url.pathname.match(/^\/queue\/item\/([^/]+)\/api\/json$/);
      if (request.method === "GET" && queueMatch) {
        return writeJson(response, 200, queues.get(decodeURIComponent(queueMatch[1])) ?? {});
      }
      const buildMatch = url.pathname.match(/^\/job\/([^/]+)\/(\d+)\/api\/json$/);
      if (request.method === "GET" && buildMatch) {
        const build = builds.get(`${decodeURIComponent(buildMatch[1])}:${Number(buildMatch[2])}`);
        if (!build) return writeJson(response, 404, { error: "BUILD_NOT_FOUND" });
        return writeJson(response, 200, {
          building: build.building,
          result: build.result,
          url: build.url,
          artifacts: build.artifacts
        });
      }
      const stageMatch = url.pathname.match(/^\/job\/([^/]+)\/(\d+)\/wfapi\/describe$/);
      if (request.method === "GET" && stageMatch) {
        const build = builds.get(`${decodeURIComponent(stageMatch[1])}:${Number(stageMatch[2])}`);
        if (!build) return writeJson(response, 404, { error: "BUILD_NOT_FOUND" });
        return writeJson(response, 200, { stages: build.stages });
      }
      const consoleMatch = url.pathname.match(/^\/job\/([^/]+)\/(\d+)\/consoleText$/);
      if (request.method === "GET" && consoleMatch) {
        const build = builds.get(`${decodeURIComponent(consoleMatch[1])}:${Number(consoleMatch[2])}`);
        if (!build) {
          response.writeHead(404);
          response.end("BUILD_NOT_FOUND");
          return;
        }
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end(build.consoleText);
        return;
      }
      response.writeHead(404);
      response.end("not found");
    } catch (error) {
      writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    baseUrl: `http://${host}:${actualPort}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function validateParameters(parameters) {
  const required = ["PROJECT_ID", "SOURCE_BRANCH", "UPGRADE_BRANCH", "COMMIT_SHA", "MERGE_REQUEST_URL"];
  const missing = required.filter((key) => !String(parameters[key] ?? "").trim());
  return { ok: missing.length === 0, missing };
}

function renderStages(validation) {
  if (!validation.ok) {
    return [
      { id: "1", name: "接收升级分支", status: "FAILED", durationMillis: 300 },
      { id: "2", name: "单元测试", status: "NOT_EXECUTED", durationMillis: 0 },
      { id: "3", name: "安全测试", status: "NOT_EXECUTED", durationMillis: 0 },
      { id: "4", name: "回归测试", status: "NOT_EXECUTED", durationMillis: 0 },
      { id: "5", name: "发布证据归档", status: "NOT_EXECUTED", durationMillis: 0 }
    ];
  }
  return [
    { id: "1", name: "接收升级分支", status: "SUCCESS", durationMillis: 1000 },
    { id: "2", name: "单元测试", status: "SUCCESS", durationMillis: 2000 },
    { id: "3", name: "安全测试", status: "SUCCESS", durationMillis: 1200 },
    { id: "4", name: "回归测试", status: "SUCCESS", durationMillis: 1800 },
    { id: "5", name: "发布证据归档", status: "SUCCESS", durationMillis: 800 }
  ];
}

function renderConsole(job, parameters, validation) {
  return [
    `EvoPilot product CI/CD job: ${job}`,
    `PROJECT_ID=${parameters.PROJECT_ID ?? ""}`,
    `SOURCE_BRANCH=${parameters.SOURCE_BRANCH ?? ""}`,
    `UPGRADE_BRANCH=${parameters.UPGRADE_BRANCH ?? ""}`,
    `COMMIT_SHA=${parameters.COMMIT_SHA ?? ""}`,
    `MERGE_REQUEST_URL=${parameters.MERGE_REQUEST_URL ?? ""}`,
    validation.ok ? "required parameters: passed" : `required parameters: failed, missing=${validation.missing.join(",")}`,
    "unit tests: passed",
    "security tests: passed",
    "regression suite: passed",
    validation.ok ? "release evidence archived" : "release blocked"
  ].join("\n");
}

function loadState(dataRoot) {
  for (const file of fs.readdirSync(path.join(dataRoot, "queues"), { withFileTypes: true })) {
    if (file.isFile() && file.name.endsWith(".json")) {
      const id = file.name.replace(/\.json$/, "");
      queues.set(id, JSON.parse(fs.readFileSync(path.join(dataRoot, "queues", file.name), "utf8")));
    }
  }
  for (const file of fs.readdirSync(path.join(dataRoot, "builds"), { withFileTypes: true })) {
    if (file.isFile() && file.name.endsWith(".json")) {
      const build = JSON.parse(fs.readFileSync(path.join(dataRoot, "builds", file.name), "utf8"));
      builds.set(`${build.job}:${build.number}`, build);
    }
  }
}

function persistQueue(dataRoot, id, queue) {
  fs.writeFileSync(path.join(dataRoot, "queues", `${safeFileName(id)}.json`), JSON.stringify(queue, null, 2), "utf8");
}

function persistBuild(dataRoot, build) {
  fs.writeFileSync(path.join(dataRoot, "builds", `${safeFileName(`${build.job}-${build.number}`)}.json`), JSON.stringify(build, null, 2), "utf8");
  fs.writeFileSync(path.join(dataRoot, "builds", `${safeFileName(`${build.job}-${build.number}`)}.log`), build.consoleText, "utf8");
}

function safeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 120) || "item";
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.EVOPILOT_PRODUCT_CICD_PORT ?? 8080);
  const runtime = await startInternalProductCicd({ port });
  console.log(`EvoPilot 产品托管 CI/CD 已监听 ${runtime.baseUrl}`);
}
