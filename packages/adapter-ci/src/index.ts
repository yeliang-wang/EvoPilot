import { exec } from "node:child_process";

export interface CiRunRequest {
  projectId: string;
  ref: string;
  commands: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface CiRunResult {
  status: "PENDING" | "RUNNING" | "PASSED" | "FAILED";
  url?: string;
  summary: string;
  commandResults?: Array<{
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}

export async function runLocalCi(request: CiRunRequest): Promise<CiRunResult> {
  const commandResults = [];
  for (const command of request.commands) {
    const result = await execCommand(command, request.cwd, request.timeoutMs);
    commandResults.push({ command, ...result });
    if (result.exitCode !== 0) {
      return {
        status: "FAILED",
        summary: `CI failed on command: ${command}`,
        commandResults
      };
    }
  }
  return {
    status: "PASSED",
    summary: `${request.commands.length} CI command(s) passed for ${request.projectId}@${request.ref}.`,
    commandResults
  };
}

function execCommand(command: string, cwd?: string, timeoutMs: number = 30_000): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        exitCode: typeof (error as any)?.code === "number" ? (error as any).code : error ? 1 : 0,
        stdout,
        stderr
      });
    });
  });
}
