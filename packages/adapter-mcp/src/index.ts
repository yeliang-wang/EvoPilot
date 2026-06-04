export interface McpEvidenceSignal {
  toolName: string;
  traceId?: string;
  status: "SUCCEEDED" | "FAILED" | "PARTIAL";
  message: string;
  attributes?: Record<string, unknown>;
}

