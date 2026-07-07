import { readFile } from "node:fs/promises";

const requiredFiles = [
  "LICENSE",
  "NOTICE",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
];

const requiredReadmeLinkTargets = [
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "NOTICE",
  "LICENSE",
];

const failures = [];

async function readRequired(path) {
  try {
    const content = await readFile(path, "utf8");
    if (!content.trim()) {
      failures.push(`${path} is empty`);
    }
    return content;
  } catch (error) {
    failures.push(`${path} is missing: ${error.message}`);
    return "";
  }
}

for (const file of requiredFiles) {
  await readRequired(file);
}

const packageJson = JSON.parse(await readRequired("package.json"));
if (packageJson.license !== "Apache-2.0") {
  failures.push(`package.json license must be Apache-2.0, got ${packageJson.license ?? "<missing>"}`);
}

const license = await readRequired("LICENSE");
if (!license.includes("Apache License") || !license.includes("Version 2.0")) {
  failures.push("LICENSE must contain Apache License 2.0 text");
}

const notice = await readRequired("NOTICE");
if (!notice.includes("EvoPilot") || !notice.includes("Apache License, Version 2.0")) {
  failures.push("NOTICE must identify EvoPilot and the Apache License 2.0 basis");
}

const readme = await readRequired("README.md");
for (const target of requiredReadmeLinkTargets) {
  const linkPattern = new RegExp(`\\[[^\\]]+\\]\\(${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`);
  if (!linkPattern.test(readme)) {
    failures.push(`README.md must link to ${target}`);
  }
}

if (failures.length > 0) {
  console.error("Open-source governance verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Open-source governance verification passed.");
