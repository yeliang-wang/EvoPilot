const navItems = ["首页", "接入项目", "证据策略", "评测集", "机会点", "Loop", "流水线", "历史记录"];
const requestedPage = new URLSearchParams(window.location.search).get("page");

const state = {
  active: navItems.includes(requestedPage) ? requestedPage : "首页",
  apiStatus: "示例数据",
  apiToken: window.localStorage.getItem("evopilot.apiToken") ?? "",
  authNotice: "",
  operationNotice: "",
  projectRegistration: {
    message: "",
    status: ""
  },
  deployConnectors: [],
  sourceReleaseRuns: [],
  loopOrchestrationPresets: [],
  loopOrchestrationTargets: [],
  loopWorkerQueue: [],
  serviceScorecards: [],
  intelligence: {
    selfLearningDatasetCount: 0,
    opportunityInsightCount: 0,
    opportunityInsightQuality: 0,
    learningRecordCount: 0,
    averageServiceScore: 0,
    sloHealth: 100,
    errorBudgetRemaining: 100,
    failedPolicyCount: 0,
    supplyChainRiskCount: 0,
    runtimeReadyCount: 0,
    costRiskCount: 0,
    costHealth: 100,
    releaseReadyCount: 0,
    releaseBlockedCount: 0,
    releaseReadinessScore: 100,
    releaseEvidenceCount: 0,
    releaseTargetCount: 0,
    releaseDecisionCount: 0,
    latestReleaseDecisionStatus: "未判定",
    canaryReadyCount: 0,
    rolloutBlockedCount: 0,
    evolutionBatchCount: 0,
    activeEvolutionBatchCount: 0,
    costOptimizationEvolutionBatchCount: 0,
    costOptimizationReadyCount: 0,
    frozenProjectCount: 0,
    successfulEvolutionBatchCount: 0,
    failedEvolutionBatchCount: 0,
    insights: []
  },
  showProjectRegistrationModal: false,
  reviewingOpportunityId: "",
  editingProposalId: "",
  proposalNotice: "",
  confirmingOpportunityId: "",
  showOpportunityComposer: false,
  opportunityDraftNotice: "",
  selectedDatasetIds: ["eval-latency", "eval-rag-drift", "eval-cost-latency"],
  evidenceDetailId: "",
  historyDetailId: "",
  projects: [
    {
      id: "domainforge-fabric",
      name: "DomainForge Fabric",
      status: "健康",
      validation: "已验证",
      repository: "内置项目画像",
      credentials: "无需凭据",
      lastSignal: "MCP 链路 p95 3.5s",
      score: 86,
      level: "良好",
      recommendedAction: "继续积累发布后学习记录。"
    },
    {
      id: "simple-agent-project",
      name: "Simple Agent Project",
      status: "观察中",
      validation: "待验证",
      repository: "尚未完成 Git 注册",
      credentials: "未配置",
      lastSignal: "工具失败率上升",
      score: 42,
      level: "高风险",
      recommendedAction: "优先完成项目注册验证。"
    }
  ],
  rules: [
    {
      id: "chain-latency-over-3s",
      projectId: "domainforge-fabric",
      prompt: "所有链路调用小于 3 秒",
      compiledPath: "rules/chain-latency-over-3s.md",
      status: "已启用",
      triggers: "链路耗时 > 3000ms 时生成性能优化机会点"
    },
    {
      id: "tool-failure-recovery",
      projectId: "simple-agent-project",
      prompt: "工具连续失败时需要恢复设计",
      compiledPath: "rules/tool-failure-recovery.md",
      status: "已启用",
      triggers: "工具失败事件连续出现时生成可靠性机会点"
    }
  ],
  evaluationDatasets: [
    {
      id: "eval-latency",
      projectId: "domainforge-fabric",
      name: "高延迟链路问答",
      source: "Trace 聚类",
      status: "REGRESSION_READY",
      severity: "HIGH",
      sampleCount: 428,
      metric: "p95 3.6s",
      scope: "MCP Trace / 订单问答链路",
      triggeredAt: "2026-06-03T09:28:00.000Z"
    },
    {
      id: "eval-tool-recovery",
      projectId: "simple-agent-project",
      name: "工具失败恢复",
      source: "Tool Call",
      status: "NEEDS_LABELING",
      severity: "MEDIUM",
      sampleCount: 96,
      metric: "失败率 8.4%",
      scope: "Tool Call / 恢复路径",
      triggeredAt: "2026-06-03T09:34:00.000Z"
    },
    {
      id: "eval-rag-drift",
      projectId: "domainforge-fabric",
      name: "RAG 引用漂移",
      source: "RAG Context",
      status: "REGRESSION_READY",
      severity: "MEDIUM",
      sampleCount: 171,
      metric: "命中率下降 6.2%",
      scope: "RAG Context / 知识引用",
      triggeredAt: "2026-06-03T09:39:00.000Z"
    },
    {
      id: "eval-cost-latency",
      projectId: "domainforge-fabric",
      name: "成本与延迟异常",
      source: "Cost / Latency",
      status: "EVALUATED",
      severity: "MEDIUM",
      sampleCount: 142,
      metric: "成本 +12%",
      scope: "LLM 调用 / 路由策略",
      triggeredAt: "2026-06-03T09:45:00.000Z"
    }
  ],
  opportunities: [
    {
      id: "opp-domainforge-latency",
      projectId: "domainforge-fabric",
      title: "降低 MCP 链路调用 p95 延迟",
      triggerSource: "接入系统 / MCP Trace",
      triggerRules: ["所有链路调用小于 3 秒"],
      triggeredAt: "2026-06-03 09:28",
      ip: "10.24.8.31",
      evidence: "最近 24 小时 MCP 调用 durationMs 多次超过 3000ms",
      datasetIds: ["eval-latency", "eval-rag-drift", "eval-cost-latency"],
      impact: "高",
      confidence: 0.91,
      attribution: "链路性能退化",
      governanceLevel: "方案确认",
      status: "待确认",
      reviewId: "",
      deliveryPlanId: "",
      proposal: {
        problem: "运行证据显示 Agent 链路性能已经突破用户定义的体验阈值，主要风险是交互等待变长并拖慢后续工具编排。",
        decision: "按软件架构师输出生成性能优化方案：先收敛链路边界和依赖方向，再引入可观测的适应度函数，把 p95 阈值作为 CI 门禁。",
        alternatives: [
          "方案 A：仅优化单个慢调用，实现快，但无法防止后续链路退化。",
          "方案 B：增加链路级缓存、超时预算和性能适应度函数，改动更完整，验证成本更高。"
        ],
        impact: "更容易定位性能退化并阻断不合格变更；代价是需要维护链路指标和阈值门禁。",
        validation: "根据方案进行代码升级后，单元测试覆盖超时预算；冒烟测试覆盖一次运行到机会点生成；功能闭环测试覆盖确认后触发 CI/CD 流水线。"
      }
    },
    {
      id: "opp-tool-recovery",
      projectId: "simple-agent-project",
      title: "补齐工具失败恢复策略",
      triggerSource: "接入系统 / Tool Event",
      triggerRules: ["工具连续失败时需要恢复设计", "出现高严重级别运行信号"],
      triggeredAt: "2026-06-03 09:41",
      ip: "10.24.8.46",
      evidence: "工具失败事件集中在恢复路径，缺少稳定降级策略",
      datasetIds: ["eval-tool-recovery"],
      impact: "中",
      confidence: 0.84,
      attribution: "工具恢复失败",
      governanceLevel: "方案确认",
      status: "可排期",
      reviewId: "",
      deliveryPlanId: "",
      proposal: {
        problem: "工具失败后 Agent 缺少明确恢复路径，用户可能看到中断式失败而不是可解释的降级结果。",
        decision: "以领域事件方式记录工具失败，补齐重试、降级和人工确认边界，并形成 ADR。",
        alternatives: [
          "方案 A：在调用点增加重试，改动小但容易形成分散策略。",
          "方案 B：抽象恢复端口并集中治理，初始工作量更高，但可维护性更好。"
        ],
        impact: "恢复策略可复用，失败原因更可观测；需要新增恢复契约和回归测试。",
        validation: "构造工具失败场景，验证恢复路径、审计记录和流水线门禁。"
      }
    }
  ],
  codeUpgrades: [],
  loops: [],
  loopStore: undefined,
  loopTraces: [],
  pipelines: [
    {
      opportunityId: "opp-domainforge-latency",
      projectId: "domainforge-fabric",
      title: "降低 MCP 链路调用 p95 延迟",
      jobName: "domainforge-fabric-evolution",
      buildNumber: 128,
      status: "RUNNING",
      startedAt: "2026-06-03T09:35:00.000Z",
      agentTrace: [
        { type: "agent", role: "升级执行器", status: "SUCCEEDED", message: "我会基于用户确认的 Markdown 进化方案执行代码升级。先检查项目结构和相关测试，再生成可审查的补丁。", elapsed: "1s" },
        { type: "tool", role: "Shell", status: "SUCCEEDED", command: "rg -n \"timeout|durationMs|p95\" src tests", message: "定位链路超时预算、性能指标和测试入口。", elapsed: "1s" },
        { type: "file", role: "Code Agent", status: "SUCCEEDED", file: "src/runtime-performance.ts", diffStat: "+42 -8", message: "写入链路超时预算和 p95 适应度函数。", elapsed: "2s" },
        { type: "file", role: "Code Agent", status: "SUCCEEDED", file: "tests/runtime-performance.test.ts", diffStat: "+31", message: "补齐性能预算回归测试。", elapsed: "1s" },
        { type: "tool", role: "验证器", status: "RUNNING", command: "npm run check", message: "运行本地验证；通过后才允许进入 CI/CD。", elapsed: "3s" }
      ],
      stages: [
        { name: "根据方案进行代码升级", status: "SUCCEEDED", durationMs: 47000 },
        { name: "单元测试", status: "SUCCEEDED", durationMs: 26000 },
        { name: "冒烟测试", status: "RUNNING", durationMs: 64000 },
        { name: "功能闭环测试", status: "PENDING" },
        { name: "质量报告", status: "PENDING" }
      ]
    }
  ],
  history: [
    {
      projectId: "domainforge-fabric",
      title: "补齐 CI/CD 流水线接入",
      completedAt: "2026-06-03 08:40",
      result: "成功",
      evidence: "单元测试、冒烟测试、功能闭环测试通过",
      artifact: "CI/CD 构建 #127",
      datasets: ["高延迟链路问答", "RAG 引用漂移"],
      pipeline: "代码升级成功，CI/CD 通过"
    },
    {
      projectId: "domainforge-fabric",
      title: "规则 Markdown 存储",
      completedAt: "2026-06-02 22:18",
      result: "成功",
      evidence: "管理员可读 rules/*.md，执行读取 JSON 规则块",
      artifact: "规则存储目录",
      datasets: ["规则编译回归"],
      pipeline: "规则存储验证通过"
    }
  ]
};

const nav = document.querySelector("#nav");
const content = document.querySelector("#content");
const title = document.querySelector("#page-title");

function renderNav() {
  nav.innerHTML = navItems.map((item) => `
    <button class="nav-item ${state.active === item ? "active" : ""}" data-page="${item}">${item}</button>
  `).join("");
  for (const button of nav.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      state.active = button.dataset.page;
      render();
    });
  }
}

function renderPage(page) {
  if (page === "首页") return renderHome();
  if (page === "接入项目") return renderProjects();
  if (page === "证据策略") return renderRules();
  if (page === "评测集") return renderEvaluationDatasets();
  if (page === "机会点") return renderOpportunities();
  if (page === "Loop") return renderLoops();
  if (page === "流水线") return renderPipelines();
  if (page === "历史记录") return renderHistory();
  return "";
}

function renderHome() {
  return `
    ${renderEvolutionObservabilityMap()}
  `;
}

function renderFlowHeader() {
  const steps = [
    ["接入项目", "接入状态与证据采集"],
    ["证据策略", "用户 Prompt 到执行规则"],
    ["评测集", "证据沉淀与回归集合"],
    ["机会点", "多评测集形成进化方案"],
    ["流水线", "代码升级成功后进入 CI/CD"],
    ["历史记录", "已完成进化与结果"]
  ];
  return `
    <section class="flow-header">
      ${steps.map(([name, desc], index) => `
        <button class="flow-card ${state.active === name ? "active" : ""}" data-page="${name}">
          <span>${index + 1}</span>
          <strong>${name}</strong>
          <small>${desc}</small>
        </button>
      `).join("")}
    </section>
  `;
}

function renderEvolutionObservabilityMap() {
  const model = evolutionObservabilityModel();
  return `
    <section class="card observability-map" aria-label="进化观测图">
      <div class="section-title observability-title">
        <div>
          <h2>进化观测图</h2>
          <p>以 APM 拓扑视角展示接入项目、证据源、评测集、机会点与流水线之间的实时进化证据流。</p>
        </div>
        <span class="map-live-badge">已接入 ${model.projectCount} 个项目</span>
      </div>
      <div class="observability-shell">
        <div class="topology-board" role="img" aria-label="项目拓扑和证据流">
          <div class="topology-orbit orbit-a"></div>
          <div class="topology-orbit orbit-b"></div>
          <div class="topology-glow glow-a"></div>
          <div class="topology-glow glow-b"></div>
          <div class="topology-edges" aria-hidden="true">
            <span class="edge edge-a"></span>
            <span class="edge edge-b"></span>
            <span class="edge edge-c"></span>
            <span class="edge edge-d"></span>
            <span class="edge edge-e"></span>
          </div>
          ${renderTopologyColumn("项目拓扑", model.projectNodes, "project")}
          ${renderTopologyColumn("运行证据", model.evidenceNodes, "evidence")}
          ${renderTopologyColumn("评测归因", model.datasetNodes, "dataset")}
          ${renderTopologyColumn("进化交付", model.deliveryNodes, "delivery")}
        </div>
        <aside class="topology-side">
          <div class="side-metric">
            <span>接入项目</span>
            <strong>${model.projectCount}</strong>
            <small>${model.verifiedCount} 个验证通过，${model.collectingCount} 个正在收集</small>
          </div>
          <div class="side-list">
            <strong>证据源</strong>
            <div>${model.sourceTags.map((source) => `<span class="tag">${source}</span>`).join("")}</div>
          </div>
          <div class="side-list">
            <strong>热点信号</strong>
            ${model.hotSignals.map((signal) => `
              <div class="hot-signal">
                <span>${signal.projectId}</span>
                <b>${signal.title}</b>
              </div>
            `).join("")}
          </div>
        </aside>
      </div>
      <div class="observability-status">
        ${model.statusItems.map((item) => `
          <div>
            <span>${item.label}</span>
            <strong>${item.value}</strong>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderTopologyColumn(title, nodes, type) {
  return `
    <div class="topology-column ${type}">
      <div class="topology-column-title">${title}</div>
      ${nodes.map((node) => `
        <div class="topology-node ${node.tone ?? ""}">
          <span>${node.label}</span>
          <strong>${node.value}</strong>
          <small>${node.detail}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function evolutionObservabilityModel() {
  const projectCount = state.projects.length;
  const verifiedCount = state.projects.filter((project) => /已验证|健康/.test(`${project.validation}${project.status}`)).length;
  const collectingCount = state.projects.filter((project) => /观察中|正在收集|待验证/.test(`${project.status}${project.validation}`)).length;
  const sourceTags = unique([
    "OpenTelemetry",
    "SkyWalking",
    ...state.evaluationDatasets.map((dataset) => dataset.source),
    "用户反馈"
  ]).slice(0, 7);
  const datasetReadyCount = state.evaluationDatasets.filter((dataset) => dataset.status === "REGRESSION_READY").length;
  const selfLearningCount = state.intelligence.selfLearningDatasetCount || state.evaluationDatasets.filter((dataset) => dataset.generatedBy === "self-learning").length;
  const runningPipelineCount = state.pipelines.filter((pipeline) => ["RUNNING", "QUEUED"].includes(pipeline.status)).length + state.codeUpgrades.filter((run) => ["RUNNING", "QUEUED"].includes(run.status)).length;
  const healthClass = projectCount > 0 && verifiedCount === projectCount ? "good" : "warn";
  const projectNodes = state.projects.slice(0, 3).map((project) => ({
    label: project.name,
    value: project.status,
    detail: project.lastSignal,
    tone: /健康|已验证/.test(`${project.status}${project.validation}`) ? "good" : "warn"
  }));
  const evidenceNodes = [
    { label: "Trace / Log", value: `${state.evaluationDatasets.filter((dataset) => /Trace|Log/.test(dataset.source)).length} 类`, detail: "链路、日志与延迟证据", tone: "good" },
    { label: "Tool Call", value: `${state.evaluationDatasets.filter((dataset) => /Tool/.test(dataset.source)).length} 类`, detail: "工具调用成功率与恢复路径", tone: "warn" },
    { label: "RAG / Cost", value: `${state.evaluationDatasets.filter((dataset) => /RAG|Cost|Latency/.test(dataset.source)).length} 类`, detail: "检索漂移、成本和时延", tone: "warn" }
  ];
  const datasetNodes = [
    { label: "Eval Dataset", value: `${state.evaluationDatasets.length} 个`, detail: "线上证据沉淀为评测集", tone: "good" },
    { label: "Regression Suite", value: `${datasetReadyCount} 个`, detail: "可进入回归门禁", tone: datasetReadyCount > 0 ? "good" : "warn" },
    { label: "自学习沉淀", value: `${selfLearningCount} 个`, detail: "系统自动生成评测集", tone: selfLearningCount > 0 ? "good" : "warn" },
    { label: "智能机会洞察", value: `${state.intelligence.opportunityInsightCount || state.opportunities.length} 个`, detail: "自学习机会发现", tone: state.opportunities.length > 0 ? "warn" : "" }
  ];
  const deliveryNodes = [
    { label: "机会点", value: `${state.opportunities.length} 个`, detail: "查看方案后确认进化", tone: "warn" },
    { label: "进化调度", value: `${state.intelligence.activeEvolutionBatchCount}/${state.intelligence.evolutionBatchCount} 个`, detail: "EvoPilot 按评测集批次持续触发", tone: state.intelligence.activeEvolutionBatchCount > 0 ? "warn" : "good" },
    { label: "成本优化", value: `${state.intelligence.costOptimizationReadyCount}/${state.intelligence.costOptimizationEvolutionBatchCount} 个`, detail: "预算冻结时仍可进化", tone: state.intelligence.costOptimizationReadyCount > 0 ? "warn" : "good" },
    { label: "代码升级", value: `${state.codeUpgrades.length || state.pipelines.length} 个`, detail: "白盒执行，成功后进入 CI/CD", tone: runningPipelineCount > 0 ? "warn" : "" },
    { label: "流水线", value: `${state.pipelines.length} 条`, detail: "单测、冒烟、闭环测试", tone: runningPipelineCount > 0 ? "good" : "" }
  ];
  return {
    projectCount,
    verifiedCount,
    collectingCount,
    runningPipelineCount,
    sourceTags,
    healthClass,
    projectNodes,
    evidenceNodes,
    datasetNodes,
    deliveryNodes,
    hotSignals: state.opportunities.slice(0, 3),
    statusItems: [
      { label: "项目", value: projectCount },
      { label: "平均服务分", value: state.intelligence.averageServiceScore || averageProjectScore() },
      { label: "SLO健康", value: `${state.intelligence.sloHealth}%` },
      { label: "错误预算", value: `${state.intelligence.errorBudgetRemaining}%` },
      { label: "失败策略", value: state.intelligence.failedPolicyCount },
      { label: "供应链风险", value: state.intelligence.supplyChainRiskCount },
      { label: "运行时就绪", value: state.intelligence.runtimeReadyCount },
      { label: "成本健康", value: `${state.intelligence.costHealth}%` },
      { label: "冻结项目", value: state.intelligence.frozenProjectCount },
      { label: "成本优化待执行", value: state.intelligence.costOptimizationReadyCount },
      { label: "发布就绪", value: `${state.intelligence.releaseReadinessScore}%` },
      { label: "发布阻断", value: state.intelligence.releaseBlockedCount },
      { label: "发布证据包", value: state.intelligence.releaseEvidenceCount },
      { label: "GA目标", value: state.intelligence.releaseTargetCount },
      { label: "发布结论", value: state.intelligence.latestReleaseDecisionStatus },
      { label: "Loop任务", value: state.loops.length },
      { label: "灰度就绪", value: state.intelligence.canaryReadyCount },
      { label: "灰度阻断", value: state.intelligence.rolloutBlockedCount },
      { label: "证据源", value: sourceTags.length },
      { label: "评测集", value: state.evaluationDatasets.length },
      { label: "机会点", value: state.opportunities.length },
      { label: "智能洞察", value: state.intelligence.opportunityInsightCount || state.opportunities.length },
      { label: "流水线", value: state.pipelines.length },
      { label: "最近刷新", value: state.apiStatus }
    ]
  };
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function averageProjectScore() {
  if (state.projects.length === 0) return 0;
  return Math.round(state.projects.reduce((sum, project) => sum + Number(project.score ?? 0), 0) / state.projects.length);
}

function renderProjects() {
  return `
    ${renderFlowHeader()}
    <section class="card">
      <div class="section-title">
        <div>
          <h2>接入项目</h2>
          <p>这里显示已经通过 Git 注册并验证的 AI Agent 项目。只有验证通过的项目才能进入证据策略、机会点和流水线。</p>
        </div>
        <div class="row-actions">
          <span class="pill ${state.apiStatus === "实时数据" ? "good" : "warn"}">${state.apiStatus}</span>
          <button class="primary" data-action="open-project-registration">注册项目</button>
        </div>
      </div>
      ${!state.showProjectRegistrationModal && state.projectRegistration.message ? `<div class="notice ${state.projectRegistration.status}">${state.projectRegistration.message}</div>` : ""}
      ${table(["项目", "状态", "成熟度", "等级", "仓库注册", "凭据", "CI/CD", "验证", "最近信号", "建议动作"], state.projects.map((project) => [
        `<strong>${project.name}</strong><span class="subtext">${project.id}</span>`,
        statusPill(project.status),
        scorePill(project.score),
        statusPill(project.level),
        project.repository,
        project.credentials,
        project.cicd ?? "系统默认 Jenkins",
        statusPill(project.validation),
        project.lastSignal,
        project.recommendedAction ?? "等待更多证据"
      ]))}
    </section>
    <section class="card">
      <div class="section-title">
        <div>
          <h2>部署连接器</h2>
          <p>source closure 的 deploy gate 可调用部署连接器，再由 EvoPilot 探测 health/ready。</p>
        </div>
        <span class="pill">${state.deployConnectors.length} 个连接器</span>
      </div>
      ${state.deployConnectors.length === 0 ? `<div class="empty">暂无部署连接器。可通过 API 注册 HTTP webhook、ECS、K8s 或云发布编排入口。</div>` : table(["连接器", "类型", "地址/工作目录", "保护", "凭据", "健康路径", "超时"], state.deployConnectors.map((connector) => [
        `<strong>${connector.name}</strong><span class="subtext">${connector.id}</span>`,
        connector.type,
        connector.url ?? connector.workingDir ?? "-",
        [
          connector.deployLock ? "锁" : null,
          connector.idempotency ? "幂等" : null,
          connector.rollbackOnFailure ? "启动失败回滚" : null,
          connector.rollbackOnHealthFailure ? "健康回滚" : null
        ].filter(Boolean).join(" / ") || "-",
        connector.tokenConfigured ? "已配置" : "未配置",
        `${connector.healthPath ?? "/health"} / ${connector.readyPath ?? "/ready"}`,
        `${connector.timeoutSeconds ?? 30}s`
      ]))}
    </section>
    ${state.showProjectRegistrationModal ? renderProjectRegistrationModal() : ""}
  `;
}

function renderProjectRegistrationModal() {
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="project-registration-title">
        <div class="section-title">
          <div>
            <h2 id="project-registration-title">注册项目</h2>
            <p>填写 Git 仓库、用户名、密码或 token。EvoPilot 会先验证仓库可访问，验证通过后才允许进入下游流程。</p>
          </div>
          <button data-action="close-project-registration" aria-label="关闭注册项目弹窗">关闭</button>
        </div>
        <span class="pill warn modal-status">验证通过才可用</span>
        ${state.projectRegistration.message ? `<div class="notice ${state.projectRegistration.status}">${state.projectRegistration.message}</div>` : ""}
        <form class="project-form" id="project-registration-form">
          <label>
            <span>项目 ID</span>
            <input name="id" placeholder="agent-prod" required />
          </label>
          <label>
            <span>项目名称</span>
            <input name="name" placeholder="Agent Product" required />
          </label>
          <label>
            <span>接入方式</span>
            <select name="provider">
              <option value="local-git">本地 Git</option>
              <option value="gitlab">GitLab</option>
              <option value="github">GitHub</option>
            </select>
          </label>
          <label>
            <span>Git URL</span>
            <input name="gitUrl" placeholder="https://gitlab.example.com/group/agent.git" />
          </label>
          <label>
            <span>本地目录</span>
            <input name="root" placeholder="/Users/me/project/agent" />
          </label>
          <label>
            <span>默认分支</span>
            <input name="defaultBranch" value="main" />
          </label>
          <label>
            <span>用户名</span>
            <input name="username" autocomplete="username" />
          </label>
          <label>
            <span>密码</span>
            <input name="password" type="password" autocomplete="current-password" />
          </label>
          <label>
            <span>Token</span>
            <input name="token" type="password" autocomplete="off" />
          </label>
          <label>
            <span>Token 环境变量</span>
            <input name="tokenRef" placeholder="GITLAB_TOKEN" />
          </label>
          <label>
            <span>CI/CD 配置</span>
            <select name="cicdMode">
              <option value="system-default">使用系统默认 Jenkins</option>
              <option value="project-override">使用项目独立 Jenkins</option>
            </select>
          </label>
          <label>
            <span>Jenkins 地址</span>
            <input name="jenkinsBaseUrl" placeholder="https://jenkins.example.com" />
          </label>
          <label>
            <span>Jenkins 用户名</span>
            <input name="jenkinsUsername" autocomplete="username" />
          </label>
          <label>
            <span>Jenkins API Token</span>
            <input name="jenkinsApiToken" type="password" autocomplete="off" />
          </label>
          <label>
            <span>Jenkins Job</span>
            <input name="jenkinsJob" placeholder="agent-product-evolution" />
          </label>
          <label>
            <span>项目语言</span>
            <select name="runtimeLanguage">
              <option value="generic">通用</option>
              <option value="python">Python</option>
              <option value="node">Node.js</option>
              <option value="java">Java</option>
              <option value="go">Go</option>
            </select>
          </label>
          <label>
            <span>单元测试命令</span>
            <input name="unitCommands" placeholder="python3 -m unittest discover -s tests -p 'test_*.py'" />
          </label>
          <label>
            <span>服务启动命令</span>
            <input name="serviceStartCommand" placeholder="python3 app.py --host 127.0.0.1 --port 49318" />
          </label>
          <label>
            <span>服务端口</span>
            <input name="servicePort" placeholder="49318" />
          </label>
          <label>
            <span>健康检查路径</span>
            <input name="serviceHealthPath" value="/health" />
          </label>
          <label>
            <span>冒烟测试命令</span>
            <input name="smokeCommands" placeholder="python3 scripts/smoke.py" />
          </label>
          <label>
            <span>功能闭环测试命令</span>
            <input name="functionalCommands" placeholder="python3 scripts/functional.py" />
          </label>
          <div class="form-actions">
            <button data-action="close-project-registration" type="button">取消</button>
            <button class="primary" type="submit">验证并注册</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderRules() {
  return `
    ${renderFlowHeader()}
    <section class="card">
      <div class="section-title">
        <div>
          <h2>证据策略</h2>
          <p>用户用简单 Prompt 定义规则；EvoPilot 通过 LLM 编译成系统执行规则，并以 Markdown 存储，管理员可以直接审查。</p>
        </div>
        <span class="pill">系统执行规则存储为 Markdown</span>
      </div>
      ${table(["项目", "用户看到的规则", "执行触发", "系统规则存储", "状态"], state.rules.map((rule) => [
        rule.projectId,
        `<strong>${rule.prompt}</strong>`,
        rule.triggers,
        `<code>${rule.compiledPath}</code>`,
        statusPill(rule.status)
      ]))}
    </section>
  `;
}

function renderEvaluationDatasets() {
  const selected = selectedDatasets();
  return `
    ${renderFlowHeader()}
    <section class="card">
      <div class="section-title">
        <div>
          <h2>评测集</h2>
          <p>线上 Trace、Log、Tool Call、Prompt Version、RAG Context、Cost、Latency 和用户反馈沉淀为 Eval Dataset / Regression Suite。用户可以多选评测集形成一个机会点。</p>
        </div>
        <span class="pill ${selected.length > 0 ? "warn" : ""}">已选择 ${selected.length} 个</span>
      </div>
      ${state.opportunityDraftNotice ? `<div class="notice good">${state.opportunityDraftNotice}</div>` : ""}
      <div class="table-scroll">
        ${table(["选择", "评测集", "项目", "来源", "状态", "严重级别", "样本数", "指标", "范围", "学习方式", "触发时间"], state.evaluationDatasets.map((dataset) => [
          `<input type="checkbox" class="dataset-checkbox" data-id="${dataset.id}" ${state.selectedDatasetIds.includes(dataset.id) ? "checked" : ""} aria-label="选择 ${dataset.name}" />`,
          `<strong>${dataset.name}</strong><span class="subtext">${dataset.id}</span>`,
          dataset.projectId,
          dataset.source,
          datasetStatusPill(dataset.status),
          severityPill(dataset.severity),
          String(dataset.sampleCount),
          dataset.metric,
          dataset.scope,
          dataset.generatedBy === "self-learning" ? statusPill("智能沉淀") : statusPill("人工导入"),
          formatDate(dataset.triggeredAt)
        ]))}
      </div>
      <div class="selection-bar">
        <div>
          <strong>形成机会点</strong>
          <span>选择多个评测集后，由系统生成一个可编辑的 Markdown 进化方案。</span>
        </div>
        <button class="primary" data-action="open-opportunity-composer" ${selected.length === 0 ? "disabled" : ""}>形成机会点</button>
      </div>
    </section>
    ${state.showOpportunityComposer ? renderOpportunityComposerModal(selected) : ""}
  `;
}

function renderOpportunityComposerModal(datasets) {
  const projectIds = [...new Set(datasets.map((dataset) => dataset.projectId))];
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="opportunity-composer-title">
        <div class="section-title">
          <div>
            <h2 id="opportunity-composer-title">形成机会点</h2>
            <p>将已选择的评测集合并为一个机会点，系统会基于证据生成软件架构师风格的 Markdown 进化方案。</p>
          </div>
          <button data-action="close-opportunity-composer">关闭</button>
        </div>
        <form class="project-form" id="opportunity-composer-form">
          <label>
            <span>机会点标题</span>
            <input name="title" value="${escapeHtml(defaultOpportunityTitle(datasets))}" required />
          </label>
          <label>
            <span>项目</span>
            <input name="projectId" value="${escapeHtml(projectIds[0] ?? "domainforge-fabric")}" required />
          </label>
          <label class="wide-field">
            <span>进化目标</span>
            <input name="target" value="端到端响应时间提升 5%，p95 小于 3 秒，RAG 命中率不下降" required />
          </label>
          <div class="selected-datasets">
            ${datasets.map((dataset) => `<span class="tag">${dataset.name}</span>`).join("")}
          </div>
          <div class="form-actions">
            <button type="button" data-action="close-opportunity-composer">取消</button>
            <button class="primary" type="submit">生成机会点</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderOpportunities() {
  const reviewing = state.opportunities.find((opportunity) => opportunity.id === state.reviewingOpportunityId);
  const evidence = state.opportunities.find((opportunity) => opportunity.id === state.evidenceDetailId);
  const confirming = state.opportunities.find((opportunity) => opportunity.id === state.confirmingOpportunityId);
  return `
    ${renderFlowHeader()}
    <section class="card">
      <div class="section-title">
        <div>
          <h2>机会点</h2>
          <p>机会点由已接入项目的运行证据触发。EvoPilot 根据证据策略识别性能、可靠性、工具失败和发布风险等演进机会。</p>
        </div>
        <span class="pill warn">查看方案并确认后才进入流水线</span>
      </div>
      <div class="table-scroll">
      ${table(["操作", "机会点", "项目", "关联评测集", "触发来源", "触发策略", "触发时间", "IP", "证据摘要", "置信度", "归因", "治理等级", "影响", "状态"], state.opportunities.map((opportunity) => [
        `<div class="row-actions">
          <button data-action="view-proposal" data-id="${opportunity.id}">查看方案</button>
          <button data-action="view-opportunity-evidence" data-id="${opportunity.id}">关联评测集</button>
        </div>`,
        `<strong>${opportunity.title}</strong>`,
        opportunity.projectId,
        `${opportunityDatasets(opportunity).length} 个`,
        opportunity.triggerSource,
        opportunity.triggerRules.map((rule) => `<span class="tag">${rule}</span>`).join(""),
        opportunity.triggeredAt,
        opportunity.ip,
        opportunity.evidence,
        confidencePill(opportunity.confidence),
        opportunity.attribution ?? "待归因",
        statusPill(opportunity.governanceLevel ?? "方案确认"),
        translateImpactPill(opportunity.impact),
        statusPill(opportunity.status)
      ]))}
      </div>
    </section>
    ${reviewing ? renderProposalModal(reviewing) : ""}
    ${evidence ? renderOpportunityEvidenceModal(evidence) : ""}
    ${confirming ? renderConfirmEvolutionModal(confirming) : ""}
  `;
}

function renderProposalModal(opportunity) {
  const isEditing = state.editingProposalId === opportunity.id;
  const markdown = proposalMarkdown(opportunity);
  return `
    <div class="modal-backdrop" role="presentation">
    <section class="modal-panel proposal-review" role="dialog" aria-modal="true" aria-labelledby="proposal-editor-title">
      <div class="section-title">
        <div>
          <h2 id="proposal-editor-title">编辑进化方案：${opportunity.title}</h2>
          <p>方案以 Markdown 展示，双击正文即可修改。提交后，流水线会按当前 Markdown 方案先执行代码升级，升级成功后才进入 CI/CD。</p>
        </div>
        <span class="pill">Markdown 方案</span>
      </div>
      <div class="proposal-meta">
        <span>项目：${opportunity.projectId}</span>
        <span>触发来源：${opportunity.triggerSource}</span>
        <span>触发时间：${opportunity.triggeredAt}</span>
        <span>IP：${opportunity.ip}</span>
      </div>
      ${state.proposalNotice ? `<div class="notice good">${state.proposalNotice}</div>` : ""}
      <form class="proposal-markdown-form" id="proposal-markdown-form" data-id="${opportunity.id}">
        <div class="proposal-markdown-toolbar">
          <strong>Markdown 方案正文</strong>
          <span>${isEditing ? "编辑后点击提交方案" : "双击正文进入编辑"}</span>
        </div>
        ${isEditing ? `
          <textarea name="proposalMarkdown" class="proposal-editor" spellcheck="false">${escapeHtml(markdown)}</textarea>
          <div class="form-actions">
            <button type="button" data-action="cancel-proposal-edit">取消编辑</button>
            <button type="submit" class="primary">提交方案修改</button>
          </div>
        ` : `
          <article class="markdown-document" data-action="edit-proposal-markdown" data-id="${opportunity.id}" title="双击编辑方案">
            ${renderMarkdown(markdown)}
          </article>
        `}
      </form>
      <div class="form-actions proposal-actions">
        <button data-action="close-proposal-review">继续查看</button>
        <button class="primary" data-action="confirm-proposal" data-id="${opportunity.id}">确认进化</button>
      </div>
    </section>
    </div>
  `;
}

function renderOpportunityEvidenceModal(opportunity) {
  const datasets = opportunityDatasets(opportunity);
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="opportunity-evidence-title">
        <div class="section-title">
          <div>
            <h2 id="opportunity-evidence-title">关联评测集：${opportunity.title}</h2>
            <p>这里展示机会点从哪些评测集触发，以及每个评测集的来源、指标和回归状态。</p>
          </div>
          <button data-action="close-opportunity-evidence">关闭</button>
        </div>
        ${datasets.length === 0 ? `<div class="empty">当前机会点暂无关联评测集。</div>` : table(["评测集", "来源", "状态", "样本数", "指标", "范围"], datasets.map((dataset) => [
          `<strong>${dataset.name}</strong><span class="subtext">${dataset.id}</span>`,
          dataset.source,
          datasetStatusPill(dataset.status),
          String(dataset.sampleCount),
          dataset.metric,
          dataset.scope
        ]))}
      </section>
    </div>
  `;
}

function renderConfirmEvolutionModal(opportunity) {
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="confirm-evolution-title">
        <div class="section-title">
          <div>
            <h2 id="confirm-evolution-title">确认进化</h2>
            <p>确认后会创建执行任务：第一步按 Markdown 方案进行代码升级；代码升级失败则停止，成功后才进入 CI/CD。</p>
          </div>
          <button data-action="close-confirm-evolution">关闭</button>
        </div>
        <div class="proposal-meta">
          <span>项目：${opportunity.projectId}</span>
          <span>机会点：${opportunity.title}</span>
          <span>关联评测集：${opportunityDatasets(opportunity).length} 个</span>
        </div>
        <div class="confirm-actions">
          <button data-action="start-evolution-now" data-id="${opportunity.id}" class="primary">马上开始</button>
          <label class="schedule-box">
            <span>定时触发</span>
            <input type="datetime-local" id="schedule-at" />
          </label>
          <button data-action="schedule-evolution" data-id="${opportunity.id}">保存排期</button>
        </div>
      </section>
    </div>
  `;
}

function renderPipelines() {
  const confirmed = state.pipelines;
  const codeUpgrades = state.codeUpgrades;
  if (confirmed.length === 0 && codeUpgrades.length === 0) {
    return `
      ${renderFlowHeader()}
      <section class="card">
        <div class="section-title"><h2>流水线</h2></div>
        <div class="empty">暂无执行中的进化方案，请先在机会点查看方案并确认进化。</div>
      </section>
    `;
  }
  const stageNames = pipelineStageNames(confirmed);
  const activeCodeUpgrade = codeUpgrades[0] ?? codeUpgradeFromPipeline(confirmed[0]);
  const hasSuccessfulUpgrade = activeCodeUpgrade?.status === "SUCCEEDED";
  return `
    ${renderFlowHeader()}
    <div class="pipeline-layout">
      <aside class="jenkins-panel card">
        <div class="delivery-context">
          <span>已确认进化方案</span>
          <strong>${confirmed[0]?.jobName ?? activeCodeUpgrade?.title ?? "等待代码升级"}</strong>
        </div>
        ${renderDeliveryExecutionFlow(activeCodeUpgrade, confirmed.length > 0)}
        <div class="delivery-menu">
          ${["阶段视图", "构建日志", "测试报告", "变更与制品", "失败分析"].map((item, index) => `
            <button class="${index === 0 ? "active" : ""}">${item}</button>
          `).join("")}
        </div>
        <div class="build-history">
          <div class="section-title"><h2>执行列表</h2><span class="pill">代码升级 + CI/CD</span></div>
          ${codeUpgrades.map((run) => `
            <div class="history-row ${pipelineStatusClass(run.status)}">
              <span class="build-dot"></span>
              <strong>升级</strong>
              <span>${run.title ?? run.projectId}</span>
            </div>
          `).join("")}
          ${confirmed.map((pipeline) => `
            <div class="history-row ${pipelineStatusClass(pipeline.status)}">
              <span class="build-dot"></span>
              <strong>#${pipeline.buildNumber ?? "-"}</strong>
              <span>${pipeline.title}</span>
            </div>
          `).join("")}
        </div>
      </aside>
      <section class="card stage-view">
        <div class="section-title">
          <div>
            <h2>流水线阶段视图</h2>
            <p>用户确认方案后，EvoPilot 先执行代码升级。只有代码升级成功，才会进入 CI/CD；如果升级失败，流程停止并保留失败证据。</p>
          </div>
          <span class="pill good">CI/CD 阶段视图</span>
        </div>
        ${renderAgentTrace(activeCodeUpgrade)}
        ${confirmed.length === 0 ? `<div class="empty">${activeCodeUpgrade?.status === "FAILED" ? "代码升级失败，流程已停止，不会进入 CI/CD。" : "代码升级成功后才会进入 CI/CD。"}</div>` : `
        <div class="stage-grid" style="--stage-count:${stageNames.length}">
          <div class="stage-corner">
            <strong>平均阶段耗时</strong>
            <span>平均总耗时：${averagePipelineDuration(confirmed)}</span>
          </div>
          ${stageNames.map((stage) => `<div class="stage-header"><strong>${stage}</strong><span>${averageStageDuration(confirmed, stage)}</span></div>`).join("")}
          ${confirmed.map((pipeline) => `
            <div class="build-cell ${pipelineStatusClass(pipeline.status)}">
              <strong>#${pipeline.buildNumber ?? "-"}</strong>
              <span>${pipeline.startedAt ? formatDate(pipeline.startedAt) : "待开始"}</span>
              <small>${translatePipelineStatus(pipeline.status)}</small>
            </div>
            ${stageNames.map((stageName) => renderStageCell(findStage(pipeline, stageName))).join("")}
          `).join("")}
        </div>
        `}
      </section>
    </div>
  `;
}

function renderDeliveryExecutionFlow(codeUpgrade, hasPipeline) {
  const upgradeStatus = codeUpgrade?.status ?? "PENDING";
  const cicdStatus = upgradeStatus === "FAILED" ? "SKIPPED" : (hasPipeline ? "RUNNING" : "PENDING");
  return `
    <div class="execution-flow">
      ${renderExecutionFlowStep("方案确认", "SUCCEEDED")}
      ${renderExecutionFlowStep("代码升级", upgradeStatus)}
      ${renderExecutionFlowStep("CI/CD", cicdStatus)}
      ${renderExecutionFlowStep("历史记录", hasPipeline ? "PENDING" : "SKIPPED")}
    </div>
  `;
}

function renderExecutionFlowStep(label, status) {
  return `
    <div class="execution-flow-step ${pipelineStatusClass(status)}">
      <span></span>
      <strong>${label}</strong>
      <small>${translatePipelineStatus(status)}</small>
    </div>
  `;
}

function renderHistory() {
  const detail = state.history.find((item) => historyId(item) === state.historyDetailId);
  return `
    ${renderFlowHeader()}
    <section class="card">
      <div class="section-title">
        <div>
          <h2>历史记录</h2>
          <p>历史记录告诉用户已经完成了哪些演进、结果如何，以及留下了哪些验证证据。</p>
        </div>
        <span class="pill good">${state.history.length} 条完成记录</span>
      </div>
      ${table(["操作", "项目", "已完成演进", "完成时间", "结果", "验证证据", "产物"], state.history.map((item) => [
        `<button data-action="view-history-detail" data-id="${historyId(item)}">历史详情</button>`,
        item.projectId,
        `<strong>${item.title}</strong>`,
        item.completedAt,
        statusPill(item.result),
        item.evidence,
        item.artifact
      ]))}
    </section>
    ${detail ? renderHistoryDetailModal(detail) : ""}
  `;
}

function renderLoops() {
  const loops = state.loops;
  const store = state.loopStore;
  return `
    ${renderLoopOrchestrationPanel()}
    ${renderLoopTargetBacklogPanel()}
    ${renderLoopWorkerQueuePanel()}
    <section class="card">
      <div class="section-title">
        <div>
          <h2>Loop Runtime</h2>
          <p>长任务的跨轮状态、executor graph、独立证据、worker lease、replay、sandbox、trace 与 watchdog 决策。</p>
        </div>
        <span class="pill ${loops.some((loop) => loop.status === "RUNNING") ? "good" : "warn"}">${loops.length} 个 Loop</span>
      </div>
      <div class="dashboard-stats">
        <div><span>Store</span><strong>${store?.backend ?? "file"}</strong><small>${store?.lockProvider ?? "file-lease"}</small></div>
        <div><span>恢复语义</span><strong>${store?.recovery ?? "idempotent-replay"}</strong><small>幂等恢复</small></div>
        <div><span>运行中</span><strong>${loops.filter((loop) => loop.status === "RUNNING").length}</strong><small>含 worker lease</small></div>
        <div><span>失败签名</span><strong>${state.loopTraces.reduce((sum, trace) => sum + (trace.failureSignatures?.length ?? 0), 0)}</strong><small>trace 聚合</small></div>
      </div>
      ${loops.length === 0 ? `<div class="empty">暂无 LoopRun。生产模式请先输入 API Token；命令入口、IM、定时任务或 API 创建后会显示在这里。</div>` : table(["操作", "Loop", "状态", "轮次", "源码闭环", "执行图", "Sandbox", "Worker", "Trace"], loops.map((loop) => [
        renderLoopActions(loop),
        `<strong>${loop.objective}</strong><span class="subtext">${loop.id}</span>`,
        statusPill(loop.status),
        `${loop.currentIteration}/${loop.stopPolicy?.maxIterations ?? "-"}`,
        renderLoopSourceClosure(loop),
        `${loop.executorGraphId}<span class="subtext">${loop.coordination?.mode ?? "serial"}</span>`,
        `${loop.sandbox?.runtime ?? "host"}<span class="subtext">${loop.sandbox?.network ?? "restricted"} / ${loop.sandbox?.credentialScope ?? "loop"}</span>`,
        loop.workerLease ? `${loop.workerLease.workerId}<span class="subtext">到期 ${formatDate(loop.workerLease.expiresAt)}</span>` : "未持有",
        `${loop.trace?.executorStepCount ?? 0} steps / ${loop.trace?.failedStepCount ?? 0} failed<span class="subtext">${loop.timeline?.at(-1)?.message ?? "等待启动"}</span>`
      ]))}
    </section>
    ${loops.slice(0, 3).map(renderLoopDetail).join("")}
  `;
}

function renderLoopWorkerQueuePanel() {
  const queue = state.loopWorkerQueue ?? [];
  const claimable = queue.filter((item) => item.claimable).length;
  return `
    <section class="card">
      <div class="section-title">
        <div>
          <h2>Worker Queue Workbench</h2>
          <p>查看 durable queue、worker claim/renew/failover、crash-resume 和 source-closure 重复副作用保护。</p>
        </div>
        <span class="pill ${claimable > 0 ? "warn" : "good"}">${claimable} 个可 Claim</span>
      </div>
      <div class="table-actions">
        <button class="primary" data-action="claim-loop-worker">Claim 下一 Loop</button>
        <button data-action="watchdog-loop">Watchdog</button>
      </div>
      ${queue.length === 0 ? `<div class="empty">暂无 worker queue 数据。生产模式请先输入 API Token。</div>` : table(["Loop", "状态", "轮次", "Lease", "下一步", "副作用保护"], queue.map((item) => [
        `<strong>${escapeHtml(item.loopId)}</strong><span class="subtext">${escapeHtml(item.objective ?? "")}</span>`,
        statusPill(item.status),
        `${item.currentIteration}/${item.maxIterations}`,
        item.workerLease ? `${escapeHtml(item.workerLease.workerId)}<span class="subtext">${item.leaseExpired ? "已过期" : `到期 ${formatDate(item.workerLease.expiresAt)}`}</span>` : "未持有",
        escapeHtml(item.nextAction),
        `${escapeHtml(item.sideEffectGuard?.sourceClosureState ?? "PLANNED")}<span class="subtext">duplicate source closure ${item.sideEffectGuard?.duplicateSourceClosureBlocked ? "blocked" : "allowed"}</span>`
      ]))}
    </section>
  `;
}

function renderLoopTargetBacklogPanel() {
  const targets = state.loopOrchestrationTargets;
  return `
    <section class="card">
      <div class="section-title">
        <div>
          <h2>Target Loop Backlog</h2>
          <p>按 Sandbox、Context、Harness、Loop 四层持续推进 Codex target loop，记录 next action、stop condition 和独立证据。</p>
        </div>
        <span class="pill ${targets.some((target) => target.status === "RUNNING") ? "good" : "warn"}">${targets.length || 0} 个 Target</span>
      </div>
      <div class="table-actions">
        <button class="primary" data-action="advance-loop-target" data-target-id="">推进下一 Target</button>
      </div>
      ${targets.length === 0 ? `<div class="empty">暂无 target backlog。生产模式请先输入 API Token。</div>` : table(["Target", "层", "状态", "下一步", "验收", "证据", "操作"], targets.map((target) => [
        `<strong>${escapeHtml(target.title)}</strong><span class="subtext">${escapeHtml(target.id)}${target.loopId ? ` / ${escapeHtml(target.loopId)}` : ""}</span>`,
        escapeHtml(target.layer),
        statusPill(target.status),
        escapeHtml(target.nextAction),
        (target.acceptanceCriteria ?? []).map(escapeHtml).join("<br />"),
        (target.evidence ?? []).map(escapeHtml).join("<br />"),
        `<button data-action="advance-loop-target" data-target-id="${escapeHtml(target.id)}">推进</button>`
      ]))}
    </section>
  `;
}

function renderLoopOrchestrationPanel() {
  const presets = state.loopOrchestrationPresets;
  const defaultProject = state.projects[0]?.id ?? "evopilot";
  return `
    <section class="card">
      <div class="section-title">
        <div>
          <h2>闭环编排</h2>
          <p>从 Dashboard 创建标准 source-to-production target loop，包含 typed executor graph、sandbox enforcement、worker lease、deploy connector 和 health-ready rollback。</p>
        </div>
        <span class="pill ${presets.some((preset) => preset.ready) ? "good" : "warn"}">${presets.length || 0} 个预设</span>
      </div>
      <form class="project-form" id="loop-orchestration-form">
        <label>
          <span>接入项目</span>
          <select name="projectId">
            ${state.projects.map((project) => `<option value="${escapeHtml(project.id)}" ${project.id === defaultProject ? "selected" : ""}>${escapeHtml(project.name)} (${escapeHtml(project.id)})</option>`).join("")}
          </select>
        </label>
        <label>
          <span>编排预设</span>
          <select name="presetId">
            ${presets.map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}${preset.ready ? "" : " - 待部署连接器"}</option>`).join("") || `<option value="source-release-closure">Source to Production Closure</option>`}
          </select>
        </label>
        <label>
          <span>目标版本</span>
          <input name="targetVersion" placeholder="vNext 或 loop-2026-06-27" />
        </label>
        <label>
          <span>目标描述</span>
          <input name="objective" placeholder="让该项目完成源码到生产发布闭环" />
        </label>
        <button class="primary" type="submit">创建闭环 Loop</button>
      </form>
      ${presets.map((preset) => `
        <div class="notice ${preset.ready ? "good" : "warn"}">
          ${escapeHtml(preset.name)}：${escapeHtml((preset.capabilities ?? []).join(" / "))}<br />
          ${(preset.evidence ?? []).map(escapeHtml).join("；")}
        </div>
      `).join("")}
    </section>
  `;
}

function renderLoopActions(loop) {
  const encodedId = escapeHtml(loop.id);
  const finalGate = Number(loop.currentIteration ?? 0) >= Number(loop.stopPolicy?.maxIterations ?? Number.POSITIVE_INFINITY);
  const buttons = [];
  if (loop.status === "WAITING_APPROVAL") {
    buttons.push(`<button class="primary" data-action="approve-loop" data-id="${encodedId}" data-final-gate="${finalGate ? "true" : "false"}">${finalGate ? "批准完成" : "批准并继续"}</button>`);
    buttons.push(`<button data-action="resume-loop" data-id="${encodedId}">继续</button>`);
  } else if (loop.status === "PENDING") {
    buttons.push(`<button class="primary" data-action="start-loop" data-id="${encodedId}">启动</button>`);
  } else if (loop.status === "RUNNING" || loop.status === "BLOCKED") {
    buttons.push(`<button class="primary" data-action="resume-loop" data-id="${encodedId}">继续</button>`);
  }
  if (["github", "gitlab"].includes(loop.sourceClosure?.repositoryProvider) && loop.sourceClosure?.closureState !== "PROMOTED") {
    buttons.push(`<button data-action="execute-source-closure" data-id="${encodedId}">执行闭环</button>`);
  }
  buttons.push(`<button data-action="watchdog-loop" data-id="${encodedId}">Watchdog</button>`);
  return `<div class="table-actions">${buttons.join("")}</div>`;
}

function renderLoopSourceClosure(loop) {
  const closure = loop.sourceClosure ?? {};
  const ref = closure.sourceUrl ?? closure.sourceRoot ?? "未绑定源码";
  const gates = (closure.requiredGates ?? []).join(" / ") || "未声明 gate";
  const artifacts = closure.artifacts ?? {};
  const releaseRef = artifacts.pullRequestUrl ?? artifacts.mergeRequestUrl ?? artifacts.commitSha ?? artifacts.branch ?? "未执行";
  return `${escapeHtml(closure.repositoryProvider ?? "unknown")}<span class="subtext">${escapeHtml(ref)}</span><span class="subtext">${statusPill(translateSourceClosureState(closure.closureState ?? "PLANNED"))} ${escapeHtml(closure.targetVersion ?? "target version 未声明")} / ${escapeHtml(closure.releaseStrategy ?? "none")}</span><span class="subtext">${escapeHtml(gates)}</span><span class="subtext">${escapeHtml(releaseRef)}</span>`;
}

function renderLoopDetail(loop) {
  const closure = loop.sourceClosure ?? {};
  const artifacts = closure.artifacts ?? {};
  const gateEvidence = closure.gateEvidence ?? {};
  const releaseRun = latestSourceReleaseRun(loop.id) ?? {
    status: closure.closureState ?? "PLANNED",
    stages: (closure.requiredGates ?? []).map((gate) => ({
      gate,
      label: gate,
      status: gateEvidence[gate]?.status ?? "PENDING",
      evidence: gateEvidence[gate]?.evidence ?? []
    })),
    capabilities: [closure.repositoryProvider, closure.releaseStrategy].filter(Boolean),
    nextAction: closure.closureState === "PROMOTED" ? "promoted" : "write-source",
    artifacts
  };
  return `
    <section class="card loop-detail">
      <div class="section-title">
        <div>
          <h2>${loop.id}</h2>
          <p>${loop.objective}</p>
        </div>
        <span class="pill">${loop.source}</span>
      </div>
      <div class="dashboard-stats">
        <div><span>Store</span><strong>${loop.store?.backend ?? "file"}</strong><small>${loop.store?.lockProvider ?? "file-lease"}</small></div>
        <div><span>Sandbox</span><strong>${loop.sandbox?.runtime ?? "host"}</strong><small>${loop.sandbox?.network ?? "restricted"} / ${loop.sandbox?.credentialScope ?? "loop"}</small></div>
        <div><span>Coordination</span><strong>${loop.coordination?.mode ?? "serial"}</strong><small>${loop.coordination?.nodes?.length ?? 0} executors</small></div>
        <div><span>Cost</span><strong>$${Number(loop.trace?.cost?.estimatedUsd ?? 0).toFixed(4)}</strong><small>${loop.trace?.cost?.totalTokens ?? 0} tokens</small></div>
        <div><span>Source</span><strong>${closure.repositoryProvider ?? "unknown"}</strong><small>${closure.sourceBranch ?? "main"} / ${closure.releaseStrategy ?? "none"}</small></div>
        <div><span>Release</span><strong>${closure.targetVersion ?? "未声明"}</strong><small>${(closure.requiredGates ?? []).join(" / ") || "未声明 gate"}</small></div>
        <div><span>Closure</span><strong>${translateSourceClosureState(closure.closureState ?? "PLANNED")}</strong><small>${artifacts.tag ?? artifacts.commitSha ?? artifacts.branch ?? "等待执行"}</small></div>
        <div><span>Deploy</span><strong>${gateEvidence.deploy?.status ?? "PENDING"}</strong><small>${artifacts.deploymentConnectorId ?? "未绑定连接器"} / ${artifacts.deploymentId ?? "未发布"}</small></div>
        <div><span>Health</span><strong>${gateEvidence["health-ready"]?.status ?? "PENDING"}</strong><small>${artifacts.healthUrl ?? artifacts.readyUrl ?? "等待探测"}</small></div>
      </div>
      <div class="loop-columns">
        <div>
          <h3>Source Closure Workbench</h3>
          <div class="timeline">
            ${(closure.requiredGates ?? []).map((gate) => renderGateEvidence(gate, gateEvidence[gate])).join("") || `<div class="empty">当前 Loop 未声明源码闭环 gate。</div>`}
          </div>
        </div>
        <div>
          <h3>Release Artifacts</h3>
          <div class="timeline">
            ${[
              ["Branch", artifacts.branch],
              ["Commit", artifacts.commitSha],
              ["PR/MR", artifacts.pullRequestUrl ?? artifacts.mergeRequestUrl],
              ["Tag", artifacts.tag],
              ["Deployment", artifacts.deploymentUrl ?? artifacts.deployStatusUrl],
              ["Probe", artifacts.healthUrl ?? artifacts.readyUrl]
            ].filter((row) => row[1]).map(([label, value]) => `
              <div class="timeline-item">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(String(value))}</strong>
                <small>source-to-production evidence</small>
              </div>
            `).join("") || `<div class="empty">等待执行闭环后生成分支、提交、PR/MR、部署和探测证据。</div>`}
          </div>
        </div>
      </div>
      <div class="loop-columns">
        <div>
          <h3>Release Closure Runtime</h3>
          <div class="timeline">
            <div class="timeline-item">
              <span>${escapeHtml(releaseRun.status ?? "PLANNED")}</span>
              <strong>${escapeHtml(releaseRun.provider ?? closure.repositoryProvider ?? "unknown")} / ${escapeHtml(releaseRun.releaseStrategy ?? closure.releaseStrategy ?? "none")}</strong>
              <small>next ${escapeHtml(releaseRun.nextAction ?? "write-source")} / ${(releaseRun.capabilities ?? []).map(escapeHtml).join(", ")}</small>
            </div>
            ${(releaseRun.stages ?? []).map((stage) => `
              <div class="timeline-item">
                <span>${escapeHtml(stage.status ?? "PENDING")}</span>
                <strong>${escapeHtml(stage.label ?? stage.gate)}</strong>
                <small>${escapeHtml((stage.evidence ?? []).at(-1) ?? "waiting")}</small>
              </div>
            `).join("")}
          </div>
          <div class="table-actions">
            <button data-action="load-source-release-run" data-id="${escapeHtml(loop.id)}">刷新 Release Run</button>
          </div>
        </div>
        <div>
          <h3>Source Release Artifacts</h3>
          <div class="timeline">
            ${[
              ["Release Run", releaseRun.id],
              ["Source", releaseRun.sourceRef?.sourceUrl ?? releaseRun.sourceRef?.sourceRoot],
              ["Branch", releaseRun.sourceRef?.releaseBranch ?? artifacts.branch],
              ["Commit", releaseRun.artifacts?.commitSha ?? artifacts.commitSha],
              ["Review", releaseRun.artifacts?.pullRequestUrl ?? releaseRun.artifacts?.mergeRequestUrl ?? artifacts.pullRequestUrl ?? artifacts.mergeRequestUrl],
              ["Deployment", releaseRun.artifacts?.deploymentUrl ?? artifacts.deploymentUrl]
            ].filter((row) => row[1]).map(([label, value]) => `
              <div class="timeline-item">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(String(value))}</strong>
                <small>source-release-closure-runtime</small>
              </div>
            `).join("") || `<div class="empty">等待发布运行记录。</div>`}
          </div>
        </div>
      </div>
      <div class="loop-columns">
        <div>
          <h3>Iterations</h3>
          <div class="timeline">
            ${(loop.iterations ?? []).map((iteration) => `
              <div class="timeline-item">
                <span>${iteration.decision}</span>
                <strong>第 ${iteration.index} 轮</strong>
                <small>${iteration.rationale}${iteration.replayOfIterationId ? ` / replay ${iteration.replayOfIterationId}` : ""}</small>
              </div>
            `).join("") || `<div class="empty">等待 worker 启动。</div>`}
          </div>
        </div>
        <div>
          <h3>Trace</h3>
          <div class="timeline">
            ${(loop.trace?.failureSignatures ?? []).map((failure) => `
              <div class="timeline-item">
                <span>${failure.count}</span>
                <strong>${failure.signature}</strong>
                <small>失败签名</small>
              </div>
            `).join("") || `
              <div class="timeline-item">
                <span>OK</span>
                <strong>${loop.trace?.executorStepCount ?? 0} executor steps</strong>
                <small>worker lease ${loop.workerLease ? "active" : "none"} / watchdog age ${loop.trace?.watchdog?.ageSeconds ?? 0}s</small>
              </div>
            `}
          </div>
        </div>
      </div>
      <div class="loop-columns">
        <div>
          <h3>Context Time Travel Workbench</h3>
          <form class="project-form loop-time-travel-form" data-id="${escapeHtml(loop.id)}">
            <label>
              <span>Checkpoint</span>
              <select name="fromIteration">
                ${(loop.iterations ?? []).map((iteration) => `<option value="${iteration.index}">第 ${iteration.index} 轮 / ${escapeHtml(iteration.decision)}</option>`).join("") || `<option value="1">等待 checkpoint</option>`}
              </select>
            </label>
            <label>
              <span>Context Patch JSON</span>
              <textarea name="contextPatch" rows="4" placeholder='{"priority":"target-loop","humanEdit":"补充验收标准"}'></textarea>
            </label>
            <button class="primary" type="submit" ${(loop.iterations ?? []).length === 0 ? "disabled" : ""}>Replay 并生成 Diff</button>
          </form>
        </div>
        <div>
          <h3>Replay Diff</h3>
          <div class="timeline">
            ${(loop.iterations ?? []).filter((iteration) => iteration.replayOfIterationId || iteration.contextPatch).slice(-3).map((iteration) => `
              <div class="timeline-item">
                <span>REPLAY</span>
                <strong>第 ${iteration.index} 轮</strong>
                <small>${escapeHtml(iteration.replayOfIterationId ?? "context edited")} / ${(Object.keys(iteration.contextPatch ?? {})).map(escapeHtml).join(", ") || "no patch keys"}</small>
              </div>
            `).join("") || `<div class="empty">选择 checkpoint 并提交 context patch 后，这里会显示 replay diff 摘要。</div>`}
          </div>
        </div>
      </div>
      <div class="loop-columns">
        <div>
          <h3>Sandbox Boundary Workbench</h3>
          <div class="timeline">
            <div class="timeline-item">
              <span>${escapeHtml(loop.sandboxEnforcement?.status ?? "PENDING")}</span>
              <strong>${escapeHtml(loop.sandbox?.runtime ?? "host")} boundary</strong>
              <small>${escapeHtml(loop.sandbox?.network ?? "restricted")} / ${escapeHtml(loop.sandbox?.credentialScope ?? "loop")} / ${(loop.sandbox?.deniedPaths ?? []).map(escapeHtml).join(", ")}</small>
            </div>
            <div class="timeline-item">
              <span>Resources</span>
              <strong>${escapeHtml(loop.sandbox?.resourceLimits?.cpu ?? "1")} CPU / ${escapeHtml(String(loop.sandbox?.resourceLimits?.memoryMb ?? 2048))} MiB</strong>
              <small>pids ${escapeHtml(String(loop.sandbox?.resourceLimits?.pids ?? 256))} / read-only root for Docker/K8s</small>
            </div>
          </div>
          <div class="table-actions">
            <button data-action="verify-sandbox-proof" data-id="${escapeHtml(loop.id)}">验证 Sandbox Proof</button>
          </div>
        </div>
        <div>
          <h3>Streaming Trace Workbench</h3>
          <div class="timeline">
            <div class="timeline-item">
              <span>Trace Tree</span>
              <strong>${loop.trace?.executorStepCount ?? 0} executor steps</strong>
              <small>checkpoints ${(loop.iterations ?? []).length} / failures ${(loop.trace?.failureSignatures ?? []).length}</small>
            </div>
            <div class="timeline-item">
              <span>Stream</span>
              <strong>/events</strong>
              <small>timeline, executor-step, checkpoint, cost, failure-group, replay-diff, sandbox-proof</small>
            </div>
          </div>
          <div class="table-actions">
            <button data-action="load-trace-tree" data-id="${escapeHtml(loop.id)}">刷新 Trace Tree</button>
            <button data-action="load-loop-events" data-id="${escapeHtml(loop.id)}">读取 Streaming Events</button>
          </div>
        </div>
      </div>
      <div class="timeline">
        ${(loop.timeline ?? []).slice(-6).map((event) => `
          <div class="timeline-item">
            <span>${event.type}</span>
            <strong>${event.message}</strong>
            <small>${formatDate(event.timestamp)}</small>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderGateEvidence(gate, row) {
  const status = row?.status ?? "PENDING";
  const evidence = row?.evidence ?? [];
  const lastEvidence = evidence.at(-1) ?? "等待执行";
  const rollback = evidence.find((item) => String(item).startsWith("rollbackStatus="));
  return `
    <div class="timeline-item">
      <span>${escapeHtml(status)}</span>
      <strong>${escapeHtml(gate)}</strong>
      <small>${escapeHtml(rollback ?? lastEvidence)}</small>
    </div>
  `;
}

function latestSourceReleaseRun(loopId) {
  return (state.sourceReleaseRuns ?? [])
    .filter((run) => run.loopId === loopId)
    .sort((left, right) => new Date(right.updatedAt ?? right.createdAt ?? 0) - new Date(left.updatedAt ?? left.createdAt ?? 0))[0];
}

function renderHistoryDetailModal(item) {
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="history-detail-title">
        <div class="section-title">
          <div>
            <h2 id="history-detail-title">历史详情：${item.title}</h2>
            <p>完成记录用于追溯机会点来源、方案、代码升级、CI/CD 与验证证据。</p>
          </div>
          <button data-action="close-history-detail">关闭</button>
        </div>
        <div class="detail-grid">
          <div><span>项目</span><strong>${item.projectId}</strong></div>
          <div><span>完成时间</span><strong>${item.completedAt}</strong></div>
          <div><span>结果</span><strong>${item.result}</strong></div>
          <div><span>产物</span><strong>${item.artifact}</strong></div>
          <div><span>关联评测集</span><strong>${(item.datasets ?? []).join("、") || "已归档"}</strong></div>
          <div><span>执行链路</span><strong>${item.pipeline ?? "代码升级与 CI/CD 证据已归档"}</strong></div>
        </div>
        <div class="notice good">${item.evidence}</div>
      </section>
    </div>
  `;
}

function selectedDatasets() {
  return state.evaluationDatasets.filter((dataset) => state.selectedDatasetIds.includes(dataset.id));
}

function opportunityDatasets(opportunity) {
  const ids = new Set(opportunity.datasetIds ?? []);
  return state.evaluationDatasets.filter((dataset) => ids.has(dataset.id));
}

function defaultOpportunityTitle(datasets) {
  if (datasets.some((dataset) => /延迟|Latency|latency/.test(dataset.name))) return "订单助手端到端响应体验优化";
  if (datasets.some((dataset) => /工具/.test(dataset.name))) return "工具失败恢复路径优化";
  return "Agent 运行质量回归优化";
}

function localOpportunityDraft(payload) {
  const datasets = selectedDatasets();
  return {
    id: `draft-${Date.now()}`,
    projectId: payload.projectId,
    title: payload.title,
    target: payload.target,
    datasetIds: [...state.selectedDatasetIds],
    sampleCount: datasets.reduce((sum, dataset) => sum + dataset.sampleCount, 0),
    triggerSource: "评测集组装 / Trace + RAG + Cost",
    createdAt: new Date().toISOString(),
    proposalMarkdown: [
      `# ${payload.title}`,
      "",
      "## 背景",
      "",
      `该机会点由 ${datasets.length} 个评测集共同形成：${datasets.map((dataset) => dataset.name).join("、")}。`,
      "",
      "## 进化目标",
      "",
      `- ${payload.target}`,
      "",
      "## 架构改造建议",
      "",
      "1. 为关键链路增加预算和适应度函数。",
      "2. 调整 RAG、工具调用和路由策略，避免牺牲回答质量换取速度。",
      "3. 将关联评测集写入 Regression Suite，并作为后续 CI 门禁。",
      "",
      "## 验证计划",
      "",
      "- 单元测试覆盖关键策略。",
      "- 冒烟测试覆盖一次完整 Agent 调用。",
      "- 功能闭环测试覆盖评测集回归。",
      "- CI/CD 通过后进入灰度验证。"
    ].join("\n")
  };
}

function opportunityFromDraft(draft) {
  return {
    id: draft.id,
    projectId: draft.projectId,
    title: draft.title,
    triggerSource: draft.triggerSource,
    triggerRules: ["评测集多选形成机会点", "Regression Suite 达到优化阈值"],
    triggeredAt: formatDate(draft.createdAt),
    ip: "10.24.8.31",
    evidence: `关联 ${draft.datasetIds.length} 个评测集，样本数 ${draft.sampleCount}`,
    datasetIds: draft.datasetIds,
    impact: "高",
    confidence: 0.86,
    attribution: "评测回归失败",
    governanceLevel: "方案确认",
    status: "待确认",
    proposalMarkdown: draft.proposalMarkdown,
    reviewId: "",
    deliveryPlanId: ""
  };
}

function historyId(item) {
  return `${item.projectId}:${item.title}:${item.completedAt}`;
}

function table(headers, rows) {
  return `
    <table>
      <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;
}

function datasetStatusPill(status) {
  return statusPill(({
    REGRESSION_READY: "可回归",
    EVALUATED: "已评估",
    NEEDS_LABELING: "待标注",
    INSUFFICIENT_EVIDENCE: "证据不足"
  })[status] ?? status);
}

function severityPill(severity) {
  return statusPill(({ HIGH: "高", MEDIUM: "中", LOW: "低" })[severity] ?? severity);
}

function confidencePill(value) {
  if (value === undefined || value === null || value === "") return `<span class="pill">待计算</span>`;
  const numeric = Number(value);
  const label = Number.isFinite(numeric) ? `${Math.round(numeric * 100)}%` : String(value);
  const cls = numeric >= 0.88 ? "good" : numeric >= 0.72 ? "warn" : "bad";
  return `<span class="pill ${cls}">${label}</span>`;
}

function scorePill(value) {
  const numeric = Number(value ?? 0);
  const cls = numeric >= 85 ? "good" : numeric >= 60 ? "warn" : "bad";
  return `<span class="pill ${cls}">${Math.round(numeric)}</span>`;
}

function statusPill(status) {
  const cls = ({
    健康: "good",
    成功: "good",
    已验证: "good",
    已启用: "good",
    已晋级: "good",
    已部署: "good",
    已打标: "good",
    已推送: "good",
    代码已变更: "good",
    健康通过: "good",
    可回归: "good",
    已评估: "good",
    自动执行: "good",
    优秀: "good",
    良好: "good",
    执行中: "warn",
    正在收集: "warn",
    观察中: "warn",
    待确认: "warn",
    可排期: "warn",
    待验证: "warn",
    待标注: "warn",
    方案确认: "warn",
    人工设计: "warn",
    已回滚: "warn",
    诊断模式: "warn",
    智能沉淀: "good",
    人工导入: "",
    待改进: "warn",
    中: "warn",
    高: "warn",
    高风险: "bad",
    健康失败: "bad",
    失败: "bad",
    接入失败: "bad",
    验证失败: "bad",
    证据不足: "bad",
    低: ""
  })[status] ?? "";
  return `<span class="pill ${cls}">${status}</span>`;
}

function translateImpactPill(impact) {
  return statusPill(impact === "高" ? "待确认" : "可排期").replace(/>.*</, `>${impact}<`);
}

function render() {
  title.textContent = state.active;
  renderNav();
  content.innerHTML = `${renderAuthBar()}${renderPage(state.active)}`;
  bindAuthBar();
  bindFlowHeader();
  bindPageLinks();
  bindProjectRegistration();
  bindEvaluationDatasets();
  bindOpportunityActions();
  bindLoopActions();
  bindHistoryActions();
}

function renderAuthBar() {
  return `
    <section class="auth-bar">
      <div>
        <strong>生产控制面</strong>
        <span>${state.apiToken ? "已配置 API Token，Dashboard 使用真实 EvoPilot API。" : "生产模式需要 API Token 才能读取真实控制面数据。"}</span>
        ${state.authNotice ? `<small>${state.authNotice}</small>` : ""}
      </div>
      <form id="api-token-form">
        <input name="apiToken" type="password" placeholder="EvoPilot API Token" value="${escapeHtml(state.apiToken)}" autocomplete="off" />
        <button type="submit">${state.apiToken ? "更新" : "连接"}</button>
        ${state.apiToken ? `<button type="button" data-action="clear-api-token">清除</button>` : ""}
      </form>
    </section>
  `;
}

function bindAuthBar() {
  const form = content.querySelector("#api-token-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = String(new FormData(form).get("apiToken") ?? "").trim();
    state.apiToken = token;
    if (token) window.localStorage.setItem("evopilot.apiToken", token);
    else window.localStorage.removeItem("evopilot.apiToken");
    state.authNotice = token ? "API Token 已保存到本机浏览器，正在刷新真实数据。" : "API Token 已清空。";
    await refreshData();
    render();
  });
  content.querySelector('[data-action="clear-api-token"]')?.addEventListener("click", async () => {
    state.apiToken = "";
    window.localStorage.removeItem("evopilot.apiToken");
    state.authNotice = "API Token 已清空。";
    await refreshData();
    render();
  });
}

async function refreshData() {
  await Promise.all([
    loadProjects(),
    loadSummary(),
    loadRules(),
    loadEvaluationDatasets(),
    loadCodeUpgrades(),
    loadDeployConnectors(),
    loadLoops(),
    loadPipelines()
  ]);
}

function bindPageLinks() {
  for (const button of content.querySelectorAll("[data-page-link]")) {
    button.addEventListener("click", () => {
      state.active = button.dataset.pageLink;
      render();
    });
  }
}

function bindFlowHeader() {
  for (const button of content.querySelectorAll(".flow-card")) {
    button.addEventListener("click", () => {
      state.active = button.dataset.page;
      render();
    });
  }
}

function bindOpportunityActions() {
  for (const button of content.querySelectorAll("[data-action]")) {
    button.addEventListener("click", async () => {
      const id = button.dataset.id;
      const action = button.dataset.action;
      if (action === "view-proposal") {
        state.reviewingOpportunityId = id;
        state.editingProposalId = "";
        state.proposalNotice = "";
      }
      if (action === "view-opportunity-evidence") {
        state.evidenceDetailId = id;
      }
      if (action === "close-opportunity-evidence") {
        state.evidenceDetailId = "";
      }
      if (action === "close-proposal-review") {
        state.reviewingOpportunityId = "";
        state.editingProposalId = "";
        state.proposalNotice = "";
      }
      if (action === "cancel-proposal-edit") {
        state.editingProposalId = "";
        state.proposalNotice = "";
      }
      if (action === "confirm-proposal") {
        state.reviewingOpportunityId = "";
        state.confirmingOpportunityId = id;
      }
      if (action === "close-confirm-evolution") {
        state.confirmingOpportunityId = "";
      }
      if (action === "start-evolution-now") {
        await confirmOpportunity(id, { scheduled: false });
        state.active = "流水线";
        await loadPipelines();
        await loadSummary();
      }
      if (action === "schedule-evolution") {
        const scheduledAt = content.querySelector("#schedule-at")?.value;
        await confirmOpportunity(id, { scheduled: true, scheduledAt });
        state.active = "流水线";
        await loadPipelines();
        await loadSummary();
      }
      render();
    });
  }
  for (const document of content.querySelectorAll('[data-action="edit-proposal-markdown"]')) {
    document.addEventListener("dblclick", () => {
      state.editingProposalId = document.dataset.id;
      state.proposalNotice = "";
      render();
    });
  }
  const proposalForm = content.querySelector("#proposal-markdown-form");
  if (proposalForm) {
    proposalForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const opportunity = state.opportunities.find((item) => item.id === proposalForm.dataset.id);
      if (!opportunity) return;
      const formData = new FormData(proposalForm);
      opportunity.proposalMarkdown = String(formData.get("proposalMarkdown") ?? "").trim();
      opportunity.status = "方案已修改";
      state.editingProposalId = "";
      state.proposalNotice = "方案已提交修改，确认进化时将以当前 Markdown 方案执行。";
      render();
    });
  }
}

function bindLoopActions() {
  const orchestrationForm = content.querySelector("#loop-orchestration-form");
  if (orchestrationForm) {
    orchestrationForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(orchestrationForm);
      state.authNotice = "";
      try {
        await postJson("/api/v1/loop-orchestration/instantiate", {
          projectId: String(formData.get("projectId") || "evopilot"),
          presetId: String(formData.get("presetId") || "source-release-closure"),
          targetVersion: String(formData.get("targetVersion") || "").trim() || undefined,
          objective: String(formData.get("objective") || "").trim() || undefined,
          deployConnectorId: state.deployConnectors.length === 1 ? state.deployConnectors[0].id : undefined,
          controlPlaneUrl: window.location.origin
        });
        state.authNotice = "已创建闭环 Loop，可在列表中启动、继续、执行闭环或查看证据。";
        await loadLoops();
      } catch (error) {
        state.authNotice = `闭环编排失败：${error.message}`;
      } finally {
        render();
      }
    });
  }
  for (const button of content.querySelectorAll('[data-action="advance-loop-target"]')) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      state.authNotice = "";
      try {
        await postJson("/api/v1/loop-orchestration/advance", {
          targetId: button.dataset.targetId || undefined,
          projectId: state.projects[0]?.id ?? "evopilot",
          deployConnectorId: state.deployConnectors.length === 1 ? state.deployConnectors[0].id : undefined,
          controlPlaneUrl: window.location.origin,
          autoStart: true
        });
        state.authNotice = "已推进 Codex target loop，Loop Runtime 会显示最新轮次、证据和 stop condition。";
        await loadLoops();
        await loadSummary();
      } catch (error) {
        state.authNotice = `Target 推进失败：${error.message}`;
      } finally {
        render();
      }
    });
  }
  for (const button of content.querySelectorAll('[data-action="claim-loop-worker"]')) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      state.authNotice = "";
      try {
        const response = await postJson("/api/v1/loop-workers/claim", {
          workerId: "dashboard-worker",
          leaseSeconds: 120
        });
        state.authNotice = response.data?.claimed
          ? `已 Claim ${response.data.claimed.loopId}，worker lease 已写入。`
          : "当前没有可 Claim 的 Loop。";
        await loadLoops();
      } catch (error) {
        state.authNotice = `Worker claim 失败：${error.message}`;
      } finally {
        render();
      }
    });
  }
  for (const form of content.querySelectorAll(".loop-time-travel-form")) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const id = form.dataset.id;
      const formData = new FormData(form);
      let contextPatch = {};
      const rawPatch = String(formData.get("contextPatch") ?? "").trim();
      if (rawPatch) {
        try {
          contextPatch = JSON.parse(rawPatch);
        } catch {
          state.authNotice = "Context Patch 必须是合法 JSON。";
          render();
          return;
        }
      }
      try {
        const response = await postJson(`/api/v1/loops/${encodeURIComponent(id)}/time-travel/replay`, {
          fromIteration: Number(formData.get("fromIteration") || 1),
          contextPatch,
          evidence: ["dashboard time-travel replay"]
        });
        const changed = response.data?.replayDiff?.executorOutputChanges?.filter((item) => item.changed).length ?? 0;
        state.authNotice = `Time Travel Replay 完成，${changed} 个 executor output 发生变化。`;
        await loadLoops();
      } catch (error) {
        state.authNotice = `Time Travel Replay 失败：${error.message}`;
      } finally {
        render();
      }
    });
  }
  for (const button of content.querySelectorAll('[data-action="verify-sandbox-proof"], [data-action="load-trace-tree"], [data-action="load-loop-events"], [data-action="load-source-release-run"]')) {
    button.addEventListener("click", async () => {
      const id = button.dataset.id;
      const action = button.dataset.action;
      button.disabled = true;
      state.authNotice = "";
      try {
        if (action === "verify-sandbox-proof") {
          const response = await postJson(`/api/v1/loops/${encodeURIComponent(id)}/sandbox-proof/verify`, {});
          const proof = response.data?.proof;
          state.authNotice = `Sandbox Proof ${proof?.status ?? "UNKNOWN"}：${proof?.checks?.length ?? 0} 个边界检查已写入 Loop。`;
        }
        if (action === "load-trace-tree") {
          const response = await apiFetch(`/api/v1/loops/${encodeURIComponent(id)}/trace-tree`);
          if (!response.ok) throw new Error(`Trace Tree 接口状态 ${response.status}`);
          const { data } = await response.json();
          state.authNotice = `Trace Tree 已刷新：${data?.nodes?.length ?? 0} nodes / ${data?.edges?.length ?? 0} edges。`;
        }
        if (action === "load-loop-events") {
          const response = await apiFetch(`/api/v1/loops/${encodeURIComponent(id)}/events`);
          if (!response.ok) throw new Error(`Loop Events 接口状态 ${response.status}`);
          const { data } = await response.json();
          state.authNotice = `Streaming Events 已读取：${Array.isArray(data) ? data.length : 0} 条事件。`;
        }
        if (action === "load-source-release-run") {
          const response = await apiFetch(`/api/v1/loops/${encodeURIComponent(id)}/source-closure/plan`);
          if (!response.ok) throw new Error(`Release Run 接口状态 ${response.status}`);
          const { data } = await response.json();
          state.sourceReleaseRuns = [
            ...(state.sourceReleaseRuns ?? []).filter((run) => run.id !== data?.id),
            data
          ].filter(Boolean);
          state.authNotice = `Release Run 已刷新：${data?.status ?? "UNKNOWN"} / next ${data?.nextAction ?? "unknown"}。`;
        }
        await loadLoops();
      } catch (error) {
        state.authNotice = `Loop Workbench 操作失败：${error.message}`;
      } finally {
        render();
      }
    });
  }
  for (const button of content.querySelectorAll('[data-action="approve-loop"], [data-action="start-loop"], [data-action="resume-loop"], [data-action="watchdog-loop"], [data-action="execute-source-closure"]')) {
    button.addEventListener("click", async () => {
      const id = button.dataset.id;
      const action = button.dataset.action;
      if (!id && action !== "watchdog-loop") return;
      button.disabled = true;
      state.authNotice = "";
      try {
        if (action === "approve-loop") {
          const finalGate = button.dataset.finalGate === "true";
          try {
            await postJson(`/api/v1/loops/${encodeURIComponent(id)}/approve`, {});
          } catch (error) {
            if (!finalGate) throw error;
          }
          await postJson(`/api/v1/loops/${encodeURIComponent(id)}/resume`, finalGate ? { forceDecision: "SUCCEED" } : {});
        }
        if (action === "start-loop") await postJson(`/api/v1/loops/${encodeURIComponent(id)}/start`, {});
        if (action === "resume-loop") await postJson(`/api/v1/loops/${encodeURIComponent(id)}/resume`, {});
        if (action === "watchdog-loop") await postJson("/api/v1/loops/watchdog", {});
        if (action === "execute-source-closure") {
          const loop = state.loops.find((item) => item.id === id);
          const version = loop?.sourceClosure?.targetVersion;
          const deployConnectorId = loop?.sourceClosure?.deploymentConnectorId ?? (state.deployConnectors.length === 1 ? state.deployConnectors[0].id : undefined);
          const result = await postJson(`/api/v1/loops/${encodeURIComponent(id)}/source-closure/execute`, {
            tagName: version ? `v${String(version).replace(/^v/, "")}` : undefined,
            deployConnectorId,
            files: [{
              path: `docs/evopilot-source-closures/${id}.md`,
              content: [
                `# EvoPilot Source Closure: ${id}`,
                "",
                `Objective: ${loop?.objective ?? id}`,
                `Provider: ${loop?.sourceClosure?.repositoryProvider ?? "unknown"}`,
                `Target version: ${version ?? "unspecified"}`,
                `Generated at: ${new Date().toISOString()}`,
                "",
                "This file records Dashboard-triggered source-to-production closure evidence."
              ].join("\n")
            }]
          });
          if (result.data?.sourceReleaseRun) {
            state.sourceReleaseRuns = [
              ...(state.sourceReleaseRuns ?? []).filter((run) => run.id !== result.data.sourceReleaseRun.id),
              result.data.sourceReleaseRun
            ];
            state.authNotice = `源码发布闭环完成：${result.data.sourceReleaseRun.status} / ${result.data.sourceReleaseRun.id}`;
          }
        }
        await loadLoops();
        await loadSummary();
      } catch (error) {
        state.authNotice = `Loop 操作失败：${error.message}`;
      } finally {
        render();
      }
    });
  }
}

function bindEvaluationDatasets() {
  for (const checkbox of content.querySelectorAll(".dataset-checkbox")) {
    checkbox.addEventListener("change", () => {
      const id = checkbox.dataset.id;
      if (checkbox.checked && !state.selectedDatasetIds.includes(id)) state.selectedDatasetIds.push(id);
      if (!checkbox.checked) state.selectedDatasetIds = state.selectedDatasetIds.filter((item) => item !== id);
      render();
    });
  }
  const openComposer = content.querySelector('[data-action="open-opportunity-composer"]');
  if (openComposer) {
    openComposer.addEventListener("click", () => {
      state.showOpportunityComposer = true;
      render();
    });
  }
  for (const button of content.querySelectorAll('[data-action="close-opportunity-composer"]')) {
    button.addEventListener("click", () => {
      state.showOpportunityComposer = false;
      render();
    });
  }
  const form = content.querySelector("#opportunity-composer-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const payload = {
      datasetIds: state.selectedDatasetIds,
      title: String(data.get("title") ?? "").trim(),
      projectId: String(data.get("projectId") ?? "").trim(),
      target: String(data.get("target") ?? "").trim()
    };
    let draft;
    try {
      const response = await postJson("/api/v1/opportunity-drafts", payload);
      draft = response.data;
    } catch {
      draft = localOpportunityDraft(payload);
    }
    state.opportunities.unshift(opportunityFromDraft(draft));
    state.opportunityDraftNotice = "机会点已生成，可在机会点列表中查看并编辑进化方案。";
    state.showOpportunityComposer = false;
    state.active = "机会点";
    render();
  });
}

function bindHistoryActions() {
  for (const button of content.querySelectorAll('[data-action="view-history-detail"]')) {
    button.addEventListener("click", () => {
      state.historyDetailId = button.dataset.id;
      render();
    });
  }
  for (const button of content.querySelectorAll('[data-action="close-history-detail"]')) {
    button.addEventListener("click", () => {
      state.historyDetailId = "";
      render();
    });
  }
}

function bindProjectRegistration() {
  for (const button of content.querySelectorAll('[data-action="open-project-registration"]')) {
    button.addEventListener("click", () => {
      state.projectRegistration = { message: "", status: "" };
      state.showProjectRegistrationModal = true;
      render();
    });
  }
  for (const button of content.querySelectorAll('[data-action="close-project-registration"]')) {
    button.addEventListener("click", () => {
      state.showProjectRegistrationModal = false;
      render();
    });
  }
  const form = content.querySelector("#project-registration-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = projectRegistrationPayload(new FormData(form));
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    state.projectRegistration = { status: "warn", message: "正在验证 Git 仓库连接..." };
    render();
    try {
      const response = await postJson("/api/v1/projects", payload);
      state.projectRegistration = {
        status: "good",
        message: `${response.data.name} 已验证并注册，文件数：${response.data.validation?.fileCount ?? "-"}`
      };
      state.showProjectRegistrationModal = false;
      await loadProjects();
    } catch (error) {
      state.projectRegistration = {
        status: "bad",
        message: `项目注册失败：${error.message}`
      };
      state.showProjectRegistrationModal = true;
    } finally {
      render();
    }
  });
}

function projectRegistrationPayload(formData) {
  const value = (name) => String(formData.get(name) ?? "").trim();
  const repository = {
    provider: value("provider"),
    gitUrl: value("gitUrl") || undefined,
    root: value("root") || undefined,
    defaultBranch: value("defaultBranch") || "main",
    username: value("username") || undefined,
    password: value("password") || undefined,
    token: value("token") || undefined,
    tokenRef: value("tokenRef") || undefined
  };
  return {
    id: value("id"),
    name: value("name"),
    profileId: "domainforge-fabric",
    repository,
    cicd: {
      provider: "jenkins",
      mode: value("cicdMode") || "system-default",
      jenkins: {
        mode: value("cicdMode") || "system-default",
        baseUrl: value("jenkinsBaseUrl") || undefined,
        username: value("jenkinsUsername") || undefined,
        apiToken: value("jenkinsApiToken") || undefined,
        job: value("jenkinsJob") || undefined
      }
    },
    runtime: {
      language: value("runtimeLanguage") || "generic",
      unitCommands: commandList(value("unitCommands")),
      service: value("serviceStartCommand") ? {
        enabled: true,
        startCommand: value("serviceStartCommand"),
        host: "127.0.0.1",
        port: value("servicePort") ? Number(value("servicePort")) : undefined,
        healthPath: value("serviceHealthPath") || "/health",
        readyTimeoutSeconds: 20
      } : undefined,
      smokeCommands: commandList(value("smokeCommands")),
      functionalCommands: commandList(value("functionalCommands"))
    }
  };
}

function commandList(value) {
  return String(value ?? "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function confirmOpportunity(id, options = {}) {
  const opportunity = state.opportunities.find((item) => item.id === id);
  if (!opportunity) return;
  state.operationNotice = "";
  if (opportunity.reviewId && opportunity.deliveryPlanId) {
    try {
      await postJson(`/api/v1/reviews/${encodeURIComponent(opportunity.reviewId)}/decision`, {
        action: "accept",
        actor: "dashboard-user",
        note: options.scheduled ? "Dashboard 确认定时进化" : "Dashboard 确认马上进化"
      });
      const upgrade = await postJson(`/api/v1/deliveries/${encodeURIComponent(opportunity.deliveryPlanId)}/code-upgrade`, {
        connectorId: "default",
        proposalMarkdown: proposalMarkdown(opportunity)
      });
      const codeUpgradeRun = upgrade.data?.codeUpgradeRun;
      if (options.scheduled) {
        await postJson(`/api/v1/deliveries/${encodeURIComponent(opportunity.deliveryPlanId)}/schedule`, {
          executor: "jenkins",
          scheduledAt: toIsoDateTime(options.scheduledAt),
          parameters: { VERSION: "dashboard-scheduled", PROPOSAL_MARKDOWN: proposalMarkdown(opportunity) }
        });
      } else if (codeUpgradeRun?.status === "SUCCEEDED") {
        await postJson(`/api/v1/deliveries/${encodeURIComponent(opportunity.deliveryPlanId)}/execute`, {
          executor: "jenkins",
          parameters: { VERSION: "dashboard-now", PROPOSAL_MARKDOWN: proposalMarkdown(opportunity) }
        });
      }
      state.operationNotice = options.scheduled ? "已确认并保存排期，触发时会先执行代码升级。" : "已确认方案，代码升级正在白盒执行；升级成功后进入 CI/CD。";
    } catch (error) {
      state.operationNotice = `真实接口未完成本次操作：${error.message}。当前保留页面演示状态。`;
    }
  }
  opportunity.status = options.scheduled ? "已排期" : "执行中";
  state.confirmingOpportunityId = "";
  if (!state.pipelines.some((pipeline) => pipeline.opportunityId === id)) {
    state.pipelines.unshift({
      opportunityId: id,
      projectId: opportunity.projectId,
      title: opportunity.title,
      jobName: `${opportunity.projectId}-evolution`,
      buildNumber: options.scheduled ? undefined : 129,
      status: options.scheduled ? "QUEUED" : "RUNNING",
      startedAt: options.scheduled ? undefined : new Date().toISOString(),
      proposalMarkdown: proposalMarkdown(opportunity),
      agentTrace: agentTraceFromOpportunity(opportunity, options.scheduled),
      stages: [
        { name: "根据方案进行代码升级", status: options.scheduled ? "PENDING" : "RUNNING" },
        { name: "单元测试", status: "PENDING" },
        { name: "冒烟测试", status: "PENDING" },
        { name: "功能闭环测试", status: "PENDING" },
        { name: "质量报告", status: "PENDING" }
      ]
    });
  }
}

async function loadSummary() {
  try {
    const response = await apiFetch("/api/v1/summary");
    if (!response.ok) throw new Error(`汇总接口状态 ${response.status}`);
    const { data } = await response.json();
    state.apiStatus = "实时数据";
    state.intelligence = {
      selfLearningDatasetCount: data.selfLearningDatasetCount ?? state.intelligence.selfLearningDatasetCount,
      opportunityInsightCount: data.opportunityInsightCount ?? state.intelligence.opportunityInsightCount,
      opportunityInsightQuality: data.opportunityInsightQuality ?? state.intelligence.opportunityInsightQuality,
      learningRecordCount: data.learningRecordCount ?? state.intelligence.learningRecordCount,
      averageServiceScore: data.averageServiceScore ?? state.intelligence.averageServiceScore,
      sloHealth: data.sloHealth ?? state.intelligence.sloHealth,
      errorBudgetRemaining: data.errorBudgetRemaining ?? state.intelligence.errorBudgetRemaining,
      failedPolicyCount: data.failedPolicyCount ?? state.intelligence.failedPolicyCount,
      supplyChainRiskCount: data.supplyChainRiskCount ?? state.intelligence.supplyChainRiskCount,
      runtimeReadyCount: Array.isArray(data.supplyChainReports)
        ? data.supplyChainReports.filter((report) => report.status === "READY").length
        : state.intelligence.runtimeReadyCount,
      costRiskCount: data.costRiskCount ?? state.intelligence.costRiskCount,
      costHealth: data.costHealth ?? state.intelligence.costHealth,
      releaseReadyCount: data.releaseReadyCount ?? state.intelligence.releaseReadyCount,
      releaseBlockedCount: data.releaseBlockedCount ?? state.intelligence.releaseBlockedCount,
      releaseReadinessScore: data.releaseReadinessScore ?? state.intelligence.releaseReadinessScore,
      releaseEvidenceCount: Array.isArray(data.recentReleaseEvidence) ? data.recentReleaseEvidence.length : state.intelligence.releaseEvidenceCount,
      releaseTargetCount: data.releaseTargetCount ?? state.intelligence.releaseTargetCount,
      releaseDecisionCount: data.releaseDecisionCount ?? state.intelligence.releaseDecisionCount,
      latestReleaseDecisionStatus: data.latestReleaseDecision?.status ?? state.intelligence.latestReleaseDecisionStatus,
      canaryReadyCount: data.canaryReadyCount ?? state.intelligence.canaryReadyCount,
      rolloutBlockedCount: data.rolloutBlockedCount ?? state.intelligence.rolloutBlockedCount,
      evolutionBatchCount: data.evolutionBatchCount ?? state.intelligence.evolutionBatchCount,
      activeEvolutionBatchCount: data.activeEvolutionBatchCount ?? state.intelligence.activeEvolutionBatchCount,
      costOptimizationEvolutionBatchCount: data.costOptimizationEvolutionBatchCount ?? state.intelligence.costOptimizationEvolutionBatchCount,
      costOptimizationReadyCount: data.costOptimizationReadyCount ?? state.intelligence.costOptimizationReadyCount,
      frozenProjectCount: data.frozenProjectCount ?? state.intelligence.frozenProjectCount,
      successfulEvolutionBatchCount: data.successfulEvolutionBatchCount ?? state.intelligence.successfulEvolutionBatchCount,
      failedEvolutionBatchCount: data.failedEvolutionBatchCount ?? state.intelligence.failedEvolutionBatchCount,
      insights: Array.isArray(data.recentOpportunityInsights) ? data.recentOpportunityInsights : state.intelligence.insights
    };
    if (Array.isArray(data.serviceScorecards)) applyServiceScorecards(data.serviceScorecards);
    if (Array.isArray(data.recentRuns) && data.recentRuns.length > 0) {
      state.opportunities = data.recentRuns.flatMap((run) => (run.opportunities ?? []).map((opportunity) => ({
        id: opportunity.id,
        projectId: run.evidenceBundle?.projectId ?? opportunity.projectId ?? "unknown",
        title: translateOpportunityText(opportunity.title),
        triggerSource: describeOpportunitySource(run, opportunity),
        triggerRules: [inferSourceRule(opportunity)],
        triggeredAt: formatDate(firstEvidenceEvent(run, opportunity)?.timestamp ?? run.evidenceBundle?.timeWindow?.to ?? new Date().toISOString()),
        ip: extractEvidenceIp(firstEvidenceEvent(run, opportunity)),
        evidence: firstEvidenceEvent(run, opportunity)?.message ?? "由运行证据触发",
        confidence: opportunity.confidence,
        attribution: translateAttribution(opportunity.failureAttribution),
        governanceLevel: translateAutomationLevel((run.plans ?? []).find((plan) => plan.opportunityId === opportunity.id)?.automationLevel),
        impact: translateImpact(opportunity.impact),
        status: translateReviewStatus((run.reviews ?? [])[0]?.status ?? "USER_CONFIRM_REQUIRED"),
        reviewId: (run.reviews ?? [])[0]?.id,
        deliveryPlanId: (run.deliveryPlans ?? [])[0]?.id,
        proposal: proposalFromRun(opportunity)
      }))).slice(0, 8);
      state.history = data.recentRuns.flatMap((run) => (run.releaseReports ?? []).map((release) => ({
        projectId: release.projectId,
        title: translateOpportunityText((run.opportunities ?? [])[0]?.title ?? "已完成演进"),
        completedAt: formatDate(release.completedAt ?? release.createdAt ?? new Date().toISOString()),
        result: translateReleaseStatus(release.status),
        evidence: release.validationSummary ?? "发布后验证完成",
        artifact: release.version
      }))).slice(0, 10).concat(state.history);
    }
    if (Array.isArray(data.recentCodeUpgrades) && data.recentCodeUpgrades.length > 0) {
      state.codeUpgrades = data.recentCodeUpgrades.map((run) => codeUpgradeViewModel(run));
    }
  } catch {
    state.apiStatus = "示例数据";
  }
}

function applyServiceScorecards(scorecards) {
  state.serviceScorecards = scorecards;
  const byProject = new Map(scorecards.map((scorecard) => [scorecard.projectId, scorecard]));
  state.projects = state.projects.map((project) => {
    const scorecard = byProject.get(project.id);
    if (!scorecard) return project;
    return {
      ...project,
      score: scorecard.score,
      level: scorecard.level,
      recommendedAction: scorecard.recommendedAction
    };
  });
}

function firstEvidenceEvent(run, opportunity) {
  const ids = new Set(opportunity.evidenceEventIds ?? []);
  return (run.evidenceBundle?.events ?? []).find((event) => ids.has(event.id)) ?? (run.evidenceBundle?.events ?? [])[0];
}

function describeOpportunitySource(run, opportunity) {
  const event = firstEvidenceEvent(run, opportunity);
  if (!event) return "接入系统";
  return `接入系统 / ${translateEvidenceSource(event.source)} / ${event.type}`;
}

function extractEvidenceIp(event) {
  const attrs = event?.attributes ?? {};
  return attrs.ip ?? attrs.clientIp ?? attrs.remoteAddress ?? attrs.hostIp ?? "-";
}

async function loadProjects() {
  try {
    const response = await apiFetch("/api/v1/projects");
    if (!response.ok) throw new Error(`项目接口状态 ${response.status}`);
    const { data } = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      state.projects = data.map((project) => ({
        id: project.id,
        name: project.name,
        status: project.validation?.status === "VERIFIED" ? "健康" : "接入失败",
        validation: project.validation?.status === "VERIFIED" ? "已验证" : "验证失败",
        repository: project.repository?.gitUrl ?? project.repository?.root ?? project.repository?.projectId ?? "内置项目画像",
        credentials: project.repository ? (project.repository.credentialsConfigured ? "已配置" : "未配置") : "无需凭据",
        cicd: project.cicd?.mode === "project-override"
          ? `项目独立 Jenkins：${project.cicd.job ?? project.cicd.connectorId ?? "已配置"}`
          : project.cicd?.mode === "system-default"
            ? "系统默认 Jenkins"
            : "未配置 CI/CD",
        lastSignal: project.validation?.message ?? "等待运行证据",
        score: project.score ?? 0,
        level: project.level ?? "待改进",
        recommendedAction: project.recommendedAction ?? "等待运行证据"
      }));
      await loadServiceScorecards();
    }
  } catch {
    // 保留示例项目，便于静态查看控制台。
  }
}

async function loadDeployConnectors() {
  try {
    const response = await apiFetch("/api/v1/connectors/deploy");
    if (!response.ok) throw new Error(`部署连接器接口状态 ${response.status}`);
    const { data } = await response.json();
    state.deployConnectors = Array.isArray(data) ? data : [];
  } catch {
    state.deployConnectors = [];
  }
}

async function loadServiceScorecards() {
  try {
    const response = await apiFetch("/api/v1/service-scorecards");
    if (!response.ok) throw new Error(`项目成熟度接口状态 ${response.status}`);
    const { data } = await response.json();
    if (Array.isArray(data)) applyServiceScorecards(data);
  } catch {
    // 保留示例成熟度。
  }
}

async function postJson(url, body) {
  const response = await apiFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `HTTP ${response.status}`);
  return text ? JSON.parse(text) : {};
}

function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(state.apiToken ? { authorization: `Bearer ${state.apiToken}` } : {})
    }
  });
}

function toIsoDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

async function loadPipelines() {
  try {
    const response = await apiFetch("/api/v1/pipelines");
    if (!response.ok) throw new Error(`流水线接口状态 ${response.status}`);
    const { data } = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      state.pipelines = data.map((pipeline) => ({
        ...pipeline,
        title: pipeline.title ?? pipeline.jobName ?? "已确认进化方案"
      }));
    }
  } catch {
    // 保留示例流水线数据，便于静态查看控制台。
  }
}

async function loadCodeUpgrades() {
  try {
    const response = await apiFetch("/api/v1/code-upgrade-runs");
    if (!response.ok) throw new Error(`代码升级接口状态 ${response.status}`);
    const { data } = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      state.codeUpgrades = await Promise.all(data.map(async (run) => {
        const events = await loadCodeUpgradeEvents(run.id);
        return codeUpgradeViewModel({ ...run, events });
      }));
    }
  } catch {
    // 保留示例代码升级过程，便于静态查看控制台。
  }
}

async function loadCodeUpgradeEvents(id) {
  try {
    const response = await apiFetch(`/api/v1/code-upgrade-runs/${encodeURIComponent(id)}/events`);
    if (!response.ok) throw new Error(`代码升级事件接口状态 ${response.status}`);
    const { data } = await response.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function loadLoops() {
  try {
    const presetsResponse = await apiFetch("/api/v1/loop-orchestration/presets");
    if (presetsResponse.ok) {
      const { data: presetData } = await presetsResponse.json();
      state.loopOrchestrationPresets = Array.isArray(presetData) ? presetData : [];
    }
    const targetsResponse = await apiFetch("/api/v1/loop-orchestration/targets");
    if (targetsResponse.ok) {
      const { data: targetData } = await targetsResponse.json();
      state.loopOrchestrationTargets = Array.isArray(targetData) ? targetData : [];
    }
    const storeResponse = await apiFetch("/api/v1/loop-store");
    if (storeResponse.ok) {
      const { data: storeData } = await storeResponse.json();
      state.loopStore = storeData;
    }
    const traceResponse = await apiFetch("/api/v1/loop-observability");
    if (traceResponse.ok) {
      const { data: traceData } = await traceResponse.json();
      state.loopTraces = Array.isArray(traceData) ? traceData : [];
    }
    const queueResponse = await apiFetch("/api/v1/loop-workers/queue");
    if (queueResponse.ok) {
      const { data: queueData } = await queueResponse.json();
      state.loopWorkerQueue = Array.isArray(queueData) ? queueData : [];
    }
    const releaseRunsResponse = await apiFetch("/api/v1/source-release-runs");
    if (releaseRunsResponse.ok) {
      const { data: releaseRunData } = await releaseRunsResponse.json();
      state.sourceReleaseRuns = Array.isArray(releaseRunData) ? releaseRunData : [];
    }
    const response = await apiFetch("/api/v1/loops");
    if (!response.ok) throw new Error(`Loop 接口状态 ${response.status}`);
    const { data } = await response.json();
    if (Array.isArray(data)) state.loops = data;
  } catch (error) {
    state.loops = [];
    state.loopTraces = [];
    state.loopWorkerQueue = [];
    state.sourceReleaseRuns = [];
    state.loopOrchestrationPresets = [];
    state.loopOrchestrationTargets = [];
    state.authNotice = `Loop 数据读取失败：${error.message}`;
  }
}

async function loadEvaluationDatasets() {
  try {
    const response = await apiFetch("/api/v1/evaluation-datasets");
    if (!response.ok) throw new Error(`评测集接口状态 ${response.status}`);
    const { data } = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      state.evaluationDatasets = data;
      state.selectedDatasetIds = state.selectedDatasetIds.filter((id) => data.some((dataset) => dataset.id === id));
      if (state.selectedDatasetIds.length === 0) state.selectedDatasetIds = data.slice(0, 2).map((dataset) => dataset.id);
    }
  } catch {
    // 保留示例评测集，便于静态查看控制台。
  }
}

async function loadRules() {
  try {
    const response = await apiFetch("/api/v1/rules");
    if (!response.ok) throw new Error(`规则接口状态 ${response.status}`);
    const { data } = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      state.rules = data.map((rule) => ({
        id: rule.id,
        projectId: rule.projectId ?? "全部项目",
        prompt: rule.prompt ?? translateRuleName(rule),
        compiledPath: `rules/${rule.id}.md`,
        status: rule.enabled ? "已启用" : "已停用",
        triggers: rule.description ?? describeRule(rule)
      }));
    }
  } catch {
    // 保留示例规则，便于静态查看控制台。
  }
}

function proposalFromRun(opportunity) {
  return {
    problem: `${translateOpportunityText(opportunity.title)}，需要基于证据判断影响面和边界。`,
    decision: "按软件架构师输出生成 ADR 草案、方案权衡、质量属性验证和演进策略。",
    alternatives: [
      "方案 A：局部修复当前信号，交付快但防退化能力弱。",
      "方案 B：补齐架构适应度函数和门禁，成本更高但闭环更稳。"
    ],
    impact: "提升可维护性和可观测性，同时增加必要的验证成本。",
    validation: "确认后先根据方案进行代码升级，再进入 CI/CD 流水线，执行单元测试、冒烟测试和功能闭环测试。"
  };
}

function renderAgentTrace(codeUpgrade) {
  const trace = codeUpgrade?.agentTrace ?? defaultAgentTrace(codeUpgrade ?? {});
  return `
    <section class="agent-transcript-panel">
      <div class="agent-transcript-header">
        <div>
          <h2>代码升级过程</h2>
          <p>升级执行器按白盒执行流展示：执行说明、命令执行、文件读写、补丁和验证过程都按时间线展开。</p>
        </div>
        <span class="pill ${codeUpgrade?.status === "RUNNING" || codeUpgrade?.status === "QUEUED" ? "warn" : "good"}">白盒执行</span>
      </div>
      ${renderBranchStrategy(codeUpgrade)}
      <div class="execution-transcript">
        ${trace.map((item) => renderTranscriptItem(item)).join("")}
      </div>
    </section>
  `;
}

function renderBranchStrategy(codeUpgrade) {
  if (!codeUpgrade?.branchStrategy && !codeUpgrade?.artifacts) return "";
  const sourceBranch = codeUpgrade.branchStrategy?.sourceBranch ?? "-";
  const upgradeBranch = codeUpgrade.artifacts?.branchName ?? codeUpgrade.branchStrategy?.upgradeBranch ?? "-";
  const mergeRequestUrl = codeUpgrade.artifacts?.pullRequestUrl;
  return `
    <div class="branch-strategy">
      <span><strong>源分支</strong>${escapeHtml(sourceBranch)}</span>
      <span><strong>升级分支</strong>${escapeHtml(upgradeBranch)}</span>
      ${mergeRequestUrl ? `<span><strong>合并请求</strong><a href="${escapeHtml(mergeRequestUrl)}" target="_blank" rel="noreferrer">查看 MR</a></span>` : ""}
    </div>
  `;
}

function renderTranscriptItem(item) {
  const type = item.type ?? inferTranscriptType(item);
  const status = translatePipelineStatus(item.status);
  return `
    <article class="transcript-item ${type} ${pipelineStatusClass(item.status)}">
      <div class="transcript-main">
        <div class="transcript-meta">
          <span class="transcript-caret">${type === "agent" ? "◆" : "›"}</span>
          <strong>${item.role ?? transcriptRole(type)}</strong>
          <span>${status}${item.elapsed ? ` · 已运行 ${item.elapsed}` : ""}</span>
        </div>
        ${item.message ? `<p>${item.message}</p>` : ""}
        ${item.command ? `<div class="transcript-command"><span>⌘</span><code>${item.command}</code></div>` : ""}
        ${item.file ? `<div class="transcript-file"><span>已编辑</span><strong>${item.file}</strong>${item.diffStat ? `<em>${item.diffStat}</em>` : ""}</div>` : ""}
        ${item.outputPreview ? `<pre class="transcript-output">${escapeHtml(item.outputPreview)}</pre>` : ""}
        ${item.raw ? `
          <details class="raw-event">
            <summary>查看原始执行事件</summary>
            <pre>${escapeHtml(JSON.stringify(item.raw, null, 2))}</pre>
          </details>
        ` : ""}
      </div>
    </article>
  `;
}

function inferTranscriptType(item) {
  if (item.command) return "tool";
  if (item.file || item.diffStat) return "file";
  if (/读取|搜索|scan|rg|grep/i.test(item.message ?? "")) return "tool";
  return "agent";
}

function transcriptRole(type) {
  return ({ agent: "升级执行器", tool: "工具执行", file: "文件修改" })[type] ?? "升级执行器";
}

function codeUpgradeViewModel(run) {
  return {
    ...run,
    title: run.title ?? `${run.projectId} 代码升级`,
    agentTrace: Array.isArray(run.events) && run.events.length > 0
      ? run.events.map((event) => ({
        type: transcriptTypeFromEvent(event),
        role: event.phase ?? event.source ?? "升级执行器",
        status: run.status,
        message: event.message,
        command: event.raw?.command,
        file: event.raw?.file,
        diffStat: event.raw?.diffStat,
        elapsed: event.raw?.elapsed,
        outputPreview: event.raw?.outputPreview ?? event.raw?.output,
        raw: event.raw ?? event
      }))
      : defaultAgentTrace(run)
  };
}

function transcriptTypeFromEvent(event) {
  if (event.raw?.command || event.source === "tool") return "tool";
  if (event.raw?.file || /补丁|diff|patch|修改|写入/.test(event.phase ?? "") || /补丁|diff|patch|修改|写入/.test(event.message ?? "")) return "file";
  return "agent";
}

function codeUpgradeFromPipeline(pipeline) {
  if (!pipeline) return undefined;
  return {
    id: pipeline.id,
    projectId: pipeline.projectId,
    status: (pipeline.stages ?? [])[0]?.status ?? pipeline.status,
    agentTrace: pipeline.agentTrace ?? defaultAgentTrace(pipeline)
  };
}

function agentTraceFromOpportunity(opportunity, scheduled) {
  const pendingStatus = scheduled ? "PENDING" : "RUNNING";
  return [
    { type: "agent", role: "升级执行器", status: pendingStatus, message: "我会读取用户确认的 Markdown 方案，先形成代码升级任务清单。", elapsed: "0s" },
    { type: "tool", role: "仓库分析", status: "PENDING", command: `rg -n \"${opportunity.title}\" .`, message: `基于项目 ${opportunity.projectId} 的注册仓库分析影响文件。` },
    { type: "file", role: "代码修改", status: "PENDING", file: "待定位", diffStat: "+0 -0", message: "按方案生成补丁，修改代码与必要测试。" },
    { type: "tool", role: "验证器", status: "PENDING", command: "npm run check", message: "代码升级通过本地验证后，才会进入 CI/CD。" }
  ];
}

function defaultAgentTrace(pipeline) {
  const status = (pipeline.stages ?? [])[0]?.status ?? pipeline.status ?? "PENDING";
  return [
    { type: "agent", role: "升级执行器", status, message: "读取确认后的进化方案，准备代码升级。", elapsed: "1s" },
    { type: "file", role: "代码修改", status: status === "SUCCEEDED" ? "SUCCEEDED" : "PENDING", file: "变更集", diffStat: "+0 -0", message: "执行仓库修改并形成变更集。" },
    { type: "tool", role: "验证器", status: status === "SUCCEEDED" ? "SUCCEEDED" : "PENDING", command: "npm run check", message: "代码升级验证通过后进入 CI/CD。" }
  ];
}

function proposalMarkdown(opportunity) {
  if (opportunity.proposalMarkdown) return opportunity.proposalMarkdown;
  const proposal = opportunity.proposal;
  return [
    `# ${opportunity.title}`,
    "",
    "## 背景",
    "",
    proposal.problem,
    "",
    "## 架构决策",
    "",
    proposal.decision,
    "",
    "## 备选方案与权衡",
    "",
    ...proposal.alternatives.map((item) => `- ${item}`),
    "",
    "## 影响",
    "",
    proposal.impact,
    "",
    "## 验证与交付",
    "",
    proposal.validation,
    "",
    "## 执行顺序",
    "",
    "1. 根据本方案进行代码升级。",
    "2. 提交升级变更后进入 CI/CD。",
    "3. 通过单元测试、冒烟测试、功能闭环测试和质量报告后记录历史。"
  ].join("\n");
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let listItems = [];
  const flushList = () => {
    if (listItems.length === 0) return;
    html.push(`<ul>${listItems.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };
  for (const line of lines) {
    if (line.startsWith("- ")) {
      listItems.push(line.slice(2));
      continue;
    }
    flushList();
    if (line.startsWith("# ")) html.push(`<h1>${inlineMarkdown(line.slice(2))}</h1>`);
    else if (line.startsWith("## ")) html.push(`<h2>${inlineMarkdown(line.slice(3))}</h2>`);
    else if (/^\d+\.\s+/.test(line)) html.push(`<p class="ordered-line">${inlineMarkdown(line)}</p>`);
    else if (line.trim()) html.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  flushList();
  return html.join("");
}

function inlineMarkdown(text) {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function translateRuleName(rule) {
  const labels = {
    "chain-latency-over-3s": "所有链路调用小于 3 秒",
    "performance-latency-signal": "性能延迟信号",
    "product-gap-signal": "产品缺口信号",
    "tool-failure-signal": "工具失败信号"
  };
  return labels[rule.id] ?? rule.name ?? rule.id;
}

function describeRule(rule) {
  if (Array.isArray(rule.anyOf) && rule.anyOf.length > 0) return "满足任一执行条件时触发";
  if (Array.isArray(rule.allOf) && rule.allOf.length > 0) return "满足全部执行条件时触发";
  return "由 EvoPilot 编译为执行规则";
}

function translateOpportunityText(text) {
  const labels = {
    "Performance hotspot requires optimization": "性能热点需要优化",
    "Product capability gap requires evolution": "产品能力缺口需要演进",
    "Tool failure pattern requires recovery design": "工具失败模式需要恢复设计",
    "High severity runtime signal requires source impact analysis": "高严重级别运行信号需要源码影响分析"
  };
  return labels[text] ?? text;
}

function translateImpact(impact) {
  return ({ high: "高", medium: "中", low: "低" })[impact] ?? impact ?? "中";
}

function translateAttribution(attribution) {
  return ({
    "latency-regression": "链路性能退化",
    "tool-recovery": "工具恢复失败",
    "rag-quality": "RAG 质量漂移",
    "eval-regression": "评测回归失败",
    "user-experience": "用户体验下降",
    "observability-error": "可观测错误",
    "security-risk": "安全风险",
    "cost-regression": "成本退化",
    unknown: "未知归因"
  })[attribution] ?? "待归因";
}

function translateAutomationLevel(level) {
  return ({
    "observe-only": "诊断模式",
    "diagnose-only": "诊断模式",
    "proposal-only": "方案确认",
    "auto-pr-allowed": "自动执行",
    "manual-design-required": "人工设计",
    reject: "已拒绝"
  })[level] ?? "方案确认";
}

function translateReviewStatus(status) {
  return ({
    USER_CONFIRM_REQUIRED: "待确认",
    USER_CONFIRMED: "已确认",
    REJECTED: "已拒绝",
    CHANGES_REQUESTED: "要求修改"
  })[status] ?? status;
}

function translateReleaseStatus(status) {
  return ({
    PENDING: "待执行",
    RUNNING: "执行中",
    SUCCEEDED: "成功",
    FAILED: "失败",
    ROLLED_BACK: "已回滚"
  })[status] ?? status;
}

function translateSourceClosureState(status) {
  return ({
    PLANNED: "待执行",
    CODE_CHANGED: "代码已变更",
    PUSHED: "已推送",
    TAGGED: "已打标",
    DEPLOYED: "已部署",
    HEALTH_READY: "健康通过",
    HEALTH_FAILED: "健康失败",
    ROLLED_BACK: "已回滚",
    PROMOTED: "已晋级",
    FAILED: "失败"
  })[status] ?? status;
}

function translateEvidenceSource(source) {
  return ({
    agent: "Agent",
    mcp: "MCP",
    tool: "工具",
    llm: "LLM",
    ci: "CI",
    cd: "CD",
    release: "发布",
    deployment: "部署",
    observability: "可观测性",
    user: "用户",
    manual: "人工"
  })[source] ?? source;
}

function translatePipelineStatus(status) {
  return ({
    QUEUED: "排队中",
    RUNNING: "运行中",
    SUCCEEDED: "成功",
    FAILED: "失败",
    CANCELED: "已取消",
    PENDING: "等待",
    SKIPPED: "跳过",
    UNKNOWN: "未知"
  })[status] ?? status;
}

function inferSourceRule(opportunity) {
  if (opportunity.type === "performance-hotspot") return "所有链路调用小于 3 秒";
  if (opportunity.type === "tool-failure") return "工具连续失败时需要恢复设计";
  if (opportunity.type === "product-gap") return "出现产品能力缺口时创建演进机会";
  return "运行证据达到策略阈值";
}

function pipelineStageNames(pipelines) {
  const names = [];
  for (const pipeline of pipelines) {
    for (const stage of pipeline.stages ?? []) {
      if (!names.includes(stage.name)) names.push(stage.name);
    }
  }
  return names.length > 0 ? names : ["方案装配", "代码生成", "单元测试", "冒烟测试", "功能闭环测试", "质量报告"];
}

function findStage(pipeline, stageName) {
  return (pipeline.stages ?? []).find((stage) => stage.name === stageName);
}

function renderStageCell(stage) {
  if (!stage) return `<div class="stage-result empty-stage"></div>`;
  return `
    <div class="stage-result ${stageStatusClass(stage.status)}">
      <strong>${formatDuration(stage.durationMs)}</strong>
      <span>${translateStageStatus(stage.status)}</span>
    </div>
  `;
}

function stageStatusClass(status) {
  return ({
    SUCCEEDED: "success",
    RUNNING: "running",
    FAILED: "failed",
    SKIPPED: "skipped",
    PENDING: "pending"
  })[status] ?? "pending";
}

function pipelineStatusClass(status) {
  return ({
    SUCCEEDED: "success",
    RUNNING: "running",
    QUEUED: "running",
    FAILED: "failed",
    CANCELED: "failed"
  })[status] ?? "pending";
}

function translateStageStatus(status) {
  return ({
    SUCCEEDED: "通过",
    RUNNING: "执行中",
    FAILED: "失败",
    SKIPPED: "跳过",
    PENDING: "等待"
  })[status] ?? "未知";
}

function formatDuration(ms) {
  if (!Number.isFinite(Number(ms))) return "";
  const value = Number(ms);
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${Math.round(value / 1000)}s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return seconds > 0 ? `${minutes}min ${seconds}s` : `${minutes}min`;
}

function averageStageDuration(pipelines, stageName) {
  const values = pipelines
    .map((pipeline) => findStage(pipeline, stageName)?.durationMs)
    .filter((value) => Number.isFinite(Number(value)))
    .map(Number);
  if (values.length === 0) return "";
  return formatDuration(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function averagePipelineDuration(pipelines) {
  const values = pipelines.map((pipeline) => (pipeline.stages ?? []).reduce((sum, stage) => sum + (Number(stage.durationMs) || 0), 0)).filter((value) => value > 0);
  if (values.length === 0) return "-";
  return formatDuration(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

refreshData().finally(render);
