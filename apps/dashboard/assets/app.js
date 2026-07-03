const navSections = [
  {
    label: "Source-to-GA",
    items: [
      { id: "工作台", title: "工作台", detail: "当前任务与下一步" },
      { id: "主链路向导", title: "主链路向导", detail: "接入到 GA 的四步流程" },
      { id: "项目接入", title: "项目", detail: "GitHub 与凭据" },
      { id: "Loop 执行", title: "Loop", detail: "当前、待处理、历史" },
      { id: "评估与发布", title: "发布", detail: "GO / NO-GO 与证据" }
    ]
  },
  {
    label: "支撑",
    items: [
      { id: "历史审计", title: "历史", detail: "审计与证据归档" },
      { id: "帮助手册", title: "帮助", detail: "场景教程" }
    ]
  }
];
const navItems = navSections.flatMap((section) => section.items.map((item) => item.id));
const pageAliases = {
  首页: "工作台",
  主链路: "主链路向导",
  向导: "主链路向导",
  项目: "项目接入",
  接入项目: "项目接入",
  证据策略: "发现与目标",
  评测集: "发现与目标",
  机会点: "发现与目标",
  Loop: "Loop 执行",
  发布: "评估与发布",
  流水线: "评估与发布",
  历史记录: "历史审计",
  历史: "历史审计",
  帮助: "帮助手册",
  操作手册: "帮助手册"
};
const requestedPage = new URLSearchParams(window.location.search).get("page");
const initialPage = normalizePage(requestedPage);

const state = {
  active: navItems.includes(initialPage) ? initialPage : "工作台",
  apiStatus: "示例数据",
  apiToken: window.localStorage.getItem("evopilot.apiToken") ?? "",
  authNotice: "",
  isLoading: true,
  operationNotice: "",
  projectRegistration: {
    message: "",
    status: ""
  },
  deployConnectors: [],
  sourceReleaseRuns: [],
  sourceReleaseRepairCandidates: [],
  sourceReleaseDeployFinalizers: [],
  loopAutopilotRuns: [],
  loopOrchestrationPresets: [],
  loopOrchestrationTargets: [],
  loopGraphContracts: {},
  loopWorkspaceView: "overview",
  releaseWorkspaceView: "simple",
  sourceToGaLoopId: "",
  sourceToGaNodeId: "executor",
  sourceToGaRefreshing: false,
  loopTargetRuntime: {
    discoveryCandidates: [],
    findingHandoffs: [],
    adversarialEvaluations: [],
    recurringSchedules: [],
    memoryInbox: [],
    guardrailEvaluations: []
  },
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
  showSourceCredentialModal: false,
  sourceCredentialProjectId: "",
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

function normalizePage(page) {
  return pageAliases[page] ?? page;
}

function setActivePage(page) {
  state.active = normalizePage(page);
}

function renderNav() {
  nav.innerHTML = navSections.map((section) => `
    <div class="nav-section">
      <span class="nav-section-label">${section.label}</span>
      ${section.items.map((item) => `
        <button class="nav-item ${state.active === item.id ? "active" : ""}" data-page="${item.id}">
          <strong>${item.title}</strong>
          <small>${item.detail}</small>
        </button>
      `).join("")}
    </div>
  `).join("");
  for (const button of nav.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      setActivePage(button.dataset.page);
      if (normalizePage(button.dataset.page) === "评估与发布") state.releaseWorkspaceView = "simple";
      if (normalizePage(button.dataset.page) === "Loop 执行") state.loopWorkspaceView = "overview";
      render();
    });
  }
}

function renderPage(page) {
  const normalized = normalizePage(page);
  if (normalized === "工作台") return renderHome();
  if (normalized === "主链路向导") return renderSourceToGaWizard();
  if (normalized === "项目接入") return renderProjects();
  if (normalized === "发现与目标") return renderDiscoveryAndTargets();
  if (normalized === "Loop 执行") return renderLoopExecution();
  if (normalized === "评估与发布") return renderEvaluationAndRelease();
  if (normalized === "历史审计") return renderHistory();
  if (normalized === "帮助手册") return renderGuidedHelpManual();
  return "";
}

function renderHome() {
  return renderSimplifiedHome();
}

function sourceToGaExperienceModel() {
  const latestReleaseRun = [...(state.sourceReleaseRuns ?? [])]
    .sort((left, right) => new Date(right.updatedAt ?? right.createdAt ?? 0) - new Date(left.updatedAt ?? left.createdAt ?? 0))[0];
  const activeLoop = state.loops.find((loop) => ["RUNNING", "WAITING_APPROVAL", "BLOCKED"].includes(loop.status))
    ?? (latestReleaseRun ? state.loops.find((loop) => loop.id === latestReleaseRun.loopId) : undefined)
    ?? state.loops[0];
  const project = state.projects.find((item) => item.id === activeLoop?.projectId || item.id === activeLoop?.sourceClosure?.sourceProjectId)
    ?? state.projects.find((item) => /已验证|健康/.test(`${item.validation}${item.status}`))
    ?? state.projects[0];
  const releaseRun = activeLoop ? latestSourceReleaseRun(activeLoop.id) : latestReleaseRun;
  const closureState = activeLoop?.sourceClosure?.closureState ?? releaseRun?.status ?? "PLANNED";
  const decisionStatus = releaseDecisionLabel(releaseRun, { allowGlobalDecision: !activeLoop });
  const prUrl = releaseRun?.artifacts?.pullRequestUrl
    ?? releaseRun?.sourceClosure?.artifacts?.pullRequestUrl
    ?? activeLoop?.sourceClosure?.artifacts?.pullRequestUrl
    ?? "";
  const mergeCommit = releaseRun?.review?.mergeCommitSha
    ?? releaseRun?.artifacts?.mergeCommitSha
    ?? activeLoop?.sourceClosure?.artifacts?.mergeCommitSha
    ?? "";
  const verified = /已验证|健康/.test(`${project?.validation}${project?.status}`);
  const credentialsReady = /已配置|无需|tokenRef|inline|local-git/.test(String(project?.credentials ?? ""));
  const hasTarget = Boolean(activeLoop || releaseRun || state.loopOrchestrationTargets.length);
  const loopDone = ["PROMOTED", "SUCCEEDED"].includes(String(closureState).toUpperCase()) || ["PROMOTED", "SUCCEEDED"].includes(String(releaseRun?.status).toUpperCase());
  const decisionGo = decisionStatus === "GO" || (loopDone && mergeCommit);
  const currentStep = !verified ? 1 : !hasTarget ? 2 : !loopDone ? 3 : 4;
  const nextAction = !verified
    ? { label: "连接 GitHub 项目", page: "项目接入", detail: "选择 repo，完成验证和写回凭据。" }
    : !credentialsReady
      ? { label: "配置写回凭据", page: "项目接入", detail: "让 EvoPilot 能创建分支和 PR。" }
      : !hasTarget
        ? { label: "生成 GA target", page: "主链路向导", detail: "把当前项目推进到可执行目标。" }
        : !loopDone
          ? { label: "启动 Source-to-GA Loop", page: "Loop 执行", detail: "执行写回、PR 和 release gate。" }
          : { label: "查看发布决策", page: "评估与发布", detail: "确认 GO，并归档本次 GA 证据。" };
  return {
    project,
    activeLoop,
    releaseRun,
    closureState,
    decisionStatus: decisionGo ? "GO" : decisionStatus,
    prUrl,
    mergeCommit,
    verified,
    credentialsReady,
    hasTarget,
    loopDone,
    decisionGo,
    currentStep,
    nextAction
  };
}

function sourceToGaSteps(model) {
  return [
    {
      id: 1,
      title: "项目接入",
      detail: model.verified ? "GitHub 已验证" : "连接 GitHub repo",
      status: model.verified ? "done" : "current",
      page: "项目接入"
    },
    {
      id: 2,
      title: "目标生成",
      detail: model.hasTarget ? "GA target 已就绪" : "生成第一个目标",
      status: model.hasTarget ? "done" : model.verified ? "current" : "pending",
      page: "主链路向导"
    },
    {
      id: 3,
      title: "Loop 执行",
      detail: model.loopDone ? "PR 已写回" : "启动 source loop",
      status: model.loopDone ? "done" : model.hasTarget ? "current" : "pending",
      page: "Loop 执行"
    },
    {
      id: 4,
      title: "发布决策",
      detail: model.decisionGo ? "GO，可归档" : "等待 evidence",
      status: model.decisionGo ? "current done" : model.loopDone ? "current" : "pending",
      page: "评估与发布"
    }
  ];
}

function renderSimplifiedHome() {
  const model = sourceToGaExperienceModel();
  const steps = sourceToGaSteps(model);
  const nextItems = [
    model.nextAction,
    { label: "更新 E2E 帮助手册", page: "帮助手册", detail: "把真实 GitHub demo project 到 GA 的步骤固化为教程。" },
    { label: "打开高级控制台", page: "Loop 执行", detail: "查看 trace、sandbox、replay 和完整 source closure 细节。", advanced: true }
  ];
  return `
    <section class="source-ga-home" aria-label="Source-to-GA 工作台">
      <div class="source-ga-home-copy">
        <span class="eyebrow">当前主任务</span>
        <h2>${escapeHtml(model.project?.name ? `把 ${model.project.name} 推进到 GA Release` : "连接第一个 GitHub 项目")}</h2>
        <p>${escapeHtml(model.decisionGo ? "Source closure 已完成，PR 已合并，release decision 为 GO。下一步只需要归档证据或查看细节。" : model.nextAction.detail)}</p>
        <div class="source-ga-home-actions">
          <button class="primary" data-page-link="${escapeHtml(model.nextAction.page)}">${escapeHtml(model.nextAction.label)}</button>
          ${model.prUrl ? `<a class="button-like" href="${escapeHtml(model.prUrl)}" target="_blank" rel="noreferrer">打开 PR</a>` : `<button data-page-link="项目接入">连接 GitHub</button>`}
          <button data-page-link="帮助手册">查看教程</button>
        </div>
      </div>
      <aside class="source-ga-decision-card">
        <strong>${escapeHtml(model.decisionStatus === "AWAITING_DECISION" ? "等待" : model.decisionStatus)}</strong>
        <span>最近发布结论</span>
      </aside>
    </section>
    <section class="source-ga-stepper" aria-label="Source-to-GA 四步流程">
      ${steps.map((step) => `
        <button class="source-ga-step ${escapeHtml(step.status)}" data-page-link="${escapeHtml(step.page)}">
          <span>${step.id}</span>
          <strong>${escapeHtml(step.title)}</strong>
          <small>${escapeHtml(step.detail)}</small>
        </button>
      `).join("")}
    </section>
    <div class="source-ga-home-grid">
      <section class="card">
        <div class="section-title">
          <div>
            <h2>下一步</h2>
            <p>只保留用户第一次完成 Source-to-GA 必须处理的动作。</p>
          </div>
        </div>
        <div class="source-ga-next-list">
          ${nextItems.map((item, index) => `
            <article class="source-ga-next-item">
              <span>${index + 1}</span>
              <div>
                <strong>${escapeHtml(item.label)}</strong>
                <small>${escapeHtml(item.detail)}</small>
              </div>
              <button data-page-link="${escapeHtml(item.page)}" ${item.advanced ? `data-loop-workspace-view="advanced"` : ""}>进入</button>
            </article>
          `).join("")}
        </div>
      </section>
      <section class="card">
        <div class="section-title">
          <div>
            <h2>当前项目</h2>
            <p>复杂证据默认收起，首页只展示判断需要的字段。</p>
          </div>
          ${statusPill(model.loopDone ? "已晋级" : model.verified ? "健康" : "待验证")}
        </div>
        <table class="compact-facts">
          <tr><td>项目</td><td>${escapeHtml(model.project?.id ?? "未选择")}</td></tr>
          <tr><td>仓库</td><td>${escapeHtml(model.project?.repository ?? "等待 GitHub 连接")}</td></tr>
          <tr><td>Loop</td><td>${escapeHtml(model.activeLoop?.id ?? "尚未启动")}</td></tr>
          <tr><td>Source closure</td><td>${statusPill(model.loopDone ? "已晋级" : model.closureState)}</td></tr>
          <tr><td>PR</td><td>${model.prUrl ? `<a href="${escapeHtml(model.prUrl)}" target="_blank" rel="noreferrer">${escapeHtml(model.prUrl.split("/").slice(-1)[0] ? `#${model.prUrl.split("/").at(-1)}` : "打开 PR")}</a>` : "等待创建"}</td></tr>
          <tr><td>Decision</td><td>${statusPill(model.decisionGo ? "GO" : model.decisionStatus)}</td></tr>
        </table>
      </section>
    </div>
  `;
}

function renderSourceToGaWizard() {
  const model = sourceToGaExperienceModel();
  const steps = sourceToGaSteps(model);
  return `
    <div class="source-ga-wizard-layout">
      <aside class="source-ga-wizard-rail">
        ${steps.map((step) => `
          <button class="source-ga-wizard-step ${escapeHtml(step.status)}" data-page-link="${escapeHtml(step.page)}">
            <span>${step.id}</span>
            <div>
              <strong>${escapeHtml(step.title)}</strong>
              <small>${escapeHtml(step.detail)}</small>
            </div>
          </button>
        `).join("")}
      </aside>
      <section class="card source-ga-wizard-main">
        <div class="section-title">
          <div>
            <span class="eyebrow">第一次 Source-to-GA</span>
            <h2>按四步完成一次 GitHub 项目到 GA Release</h2>
            <p>默认路径压缩为：连接 GitHub -> 生成目标 -> 启动 Loop -> 查看 GO。高级能力只在需要时展开。</p>
          </div>
          <span class="pill ${model.decisionGo ? "good" : "warn"}">${escapeHtml(model.decisionGo ? "GO" : `Step ${model.currentStep}`)}</span>
        </div>
        <div class="source-ga-wizard-summary">
          <div><span>项目</span><strong>${escapeHtml(model.project?.name ?? "等待连接")}</strong><small>${escapeHtml(model.project?.repository ?? "GitHub repo")}</small></div>
          <div><span>Loop</span><strong>${escapeHtml(model.activeLoop?.status ?? "未启动")}</strong><small>${escapeHtml(model.activeLoop?.id ?? "source-to-ga")}</small></div>
          <div><span>发布</span><strong>${escapeHtml(model.decisionStatus)}</strong><small>${escapeHtml(model.mergeCommit || "等待 merge commit")}</small></div>
        </div>
        <div class="source-ga-wizard-form">
          <div><span>1</span><strong>连接 GitHub 项目</strong><small>${escapeHtml(model.verified ? "已完成项目验证和基础接入。" : "选择 repo 并完成验证。")}</small><button data-page-link="项目接入">${model.verified ? "查看项目" : "开始连接"}</button></div>
          <div><span>2</span><strong>确认 GA 目标</strong><small>${escapeHtml(model.hasTarget ? "已有可执行 target 或 source release run。" : "从 discovery 或模板生成目标。")}</small><button data-page-link="发现与目标">生成目标</button></div>
          <div><span>3</span><strong>启动 Loop 写回代码</strong><small>${escapeHtml(model.loopDone ? "Source closure 已 promoted，PR 已合并。" : "执行 branch、file、PR 和 review gate。")}</small><button data-page-link="Loop 执行">${model.loopDone ? "查看 Loop" : "启动 Loop"}</button></div>
          <div><span>4</span><strong>查看发布结论</strong><small>${escapeHtml(model.decisionGo ? "Release decision 为 GO，可以归档。" : "等待 release evidence 形成结论。")}</small><button class="primary" data-page-link="评估与发布">查看发布决策</button></div>
        </div>
      </section>
    </div>
  `;
}

function renderHomeCommandCenter() {
  const runningPipelines = state.pipelines.filter((pipeline) => ["RUNNING", "QUEUED"].includes(pipeline.status)).length;
  const targetCount = state.loopOrchestrationTargets.length;
  const releaseBlocked = Number(state.intelligence.releaseBlockedCount ?? 0);
  const actions = [
    {
      page: "项目接入",
      label: "接入项目",
      title: `${state.projects.length} 个项目`,
      detail: `${state.projects.filter((project) => /已验证|健康/.test(`${project.validation}${project.status}`)).length} 个已验证`
    },
    {
      page: "发现与目标",
      label: "发现目标",
      title: `${state.opportunities.length + state.loopOrchestrationTargets.length} 个候选`,
      detail: `${state.evaluationDatasets.length} 个评测集，${state.loopTargetRuntime.discoveryCandidates.length} 个 discovery`
    },
    {
      page: "Loop 执行",
      label: "进入自动驾驶",
      title: `${targetCount || state.loops.length} 个 Loop target`,
      detail: targetCount ? "Backlog 等待推进" : "创建 source-to-production loop"
    },
    {
      page: "评估与发布",
      label: "查看交付",
      title: `${runningPipelines} 条运行中`,
      detail: releaseBlocked ? `${releaseBlocked} 个发布阻断` : "CI/CD 与 release gate"
    }
  ];
  return `
    <section class="command-center" aria-label="任务工作台">
      <div class="command-copy">
        <span class="eyebrow">Operator home</span>
        <h2>从项目接入到生产发布闭环</h2>
        <p>按真实操作顺序处理接入、证据、机会点、Loop 自动驾驶和发布交付，不需要先理解完整拓扑。</p>
      </div>
      <div class="command-actions">
        ${actions.map((action) => `
          <button class="command-action" data-page="${action.page}">
            <span>${action.label}</span>
            <strong>${action.title}</strong>
            <small>${action.detail}</small>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function renderFlowHeader() {
  const steps = [
    ["项目接入", "Git、凭据、部署边界"],
    ["发现与目标", "证据、机会点、Target Runtime"],
    ["Loop 执行", "编排、worker、trace、replay"],
    ["评估与发布", "CI/CD、guardrail、source closure"],
    ["历史审计", "完成记录与审计证据"]
  ];
  return `
    <section class="flow-header">
      ${steps.map(([name, desc], index) => `
        <button class="flow-card ${normalizePage(state.active) === name ? "active" : ""}" data-page="${name}">
          <span>${index + 1}</span>
          <strong>${name}</strong>
          <small>${desc}</small>
        </button>
      `).join("")}
    </section>
  `;
}

function renderAutopilotCommandCenter() {
  const selectedProject = state.projects.find((project) => /已验证|健康/.test(`${project.validation}${project.status}`)) ?? state.projects[0];
  const nextTarget = state.loopOrchestrationTargets.find((target) => target.status === "RUNNING")
    ?? state.loopOrchestrationTargets.find((target) => target.status === "PENDING")
    ?? state.loopOrchestrationTargets[0];
  const activeLoop = state.loops.find((loop) => ["RUNNING", "WAITING_APPROVAL", "BLOCKED"].includes(loop.status)) ?? state.loops[0];
  const readiness = autopilotReadinessModel(selectedProject, nextTarget);
  return `
    <section class="autopilot-cockpit" aria-label="Loop autopilot command center">
      <div class="autopilot-main">
        <span class="eyebrow">Autopilot cockpit</span>
        <h2>一键自动驾驶从项目到生产发布</h2>
        <p>选择已接入项目和下一个 target，EvoPilot 会按预算、凭据、CI/CD、发布门禁和人工确认边界推进源码闭环。</p>
        <div class="autopilot-route" aria-label="自动驾驶闭环路径">
          ${["Connect", "Discover", "Loop", "Evaluate", "Release"].map((step, index) => `
            <div class="route-node ${readiness[index]?.ready ? "ready" : "blocked"}">
              <span>${index + 1}</span>
              <strong>${step}</strong>
              <small>${escapeHtml(readiness[index]?.label ?? "pending")}</small>
            </div>
          `).join("")}
        </div>
        <div class="autopilot-actions">
          <button class="primary" data-action="autopilot-loop-target" data-target-id="${escapeHtml(nextTarget?.id ?? "")}">启动一键自动驾驶</button>
          <button data-page-link="项目接入">检查接入</button>
          <button data-page-link="评估与发布">查看发布门禁</button>
        </div>
      </div>
      <aside class="autopilot-side">
        <div>
          <span>项目</span>
          <strong>${escapeHtml(selectedProject?.name ?? "等待接入项目")}</strong>
          <small>${escapeHtml(selectedProject?.repository ?? "未注册 Git 源码")} / ${escapeHtml(selectedProject?.credentials ?? "未配置凭据")}</small>
        </div>
        <div>
          <span>Target</span>
          <strong>${escapeHtml(nextTarget?.title ?? "等待 target backlog")}</strong>
          <small>${escapeHtml(nextTarget?.nextAction ?? "运行 Discovery 或手动创建 Loop")}</small>
        </div>
        <div>
          <span>当前 Loop</span>
          <strong>${escapeHtml(activeLoop?.status ?? "未启动")}</strong>
          <small>${escapeHtml(activeLoop?.id ?? "创建闭环 Loop 后进入运行视图")}</small>
        </div>
      </aside>
    </section>
  `;
}

function autopilotReadinessModel(project, target) {
  return [
    { ready: Boolean(project), label: project?.validation ?? "no project" },
    { ready: state.loopTargetRuntime.discoveryCandidates.length > 0 || state.opportunities.length > 0, label: `${state.loopTargetRuntime.discoveryCandidates.length + state.opportunities.length} signals` },
    { ready: Boolean(target || state.loops.length), label: target?.status ?? `${state.loops.length} loops` },
    { ready: state.loopTargetRuntime.guardrailEvaluations.length > 0 || state.sourceReleaseRuns.length > 0, label: `${state.loopTargetRuntime.guardrailEvaluations.length} guardrails` },
    { ready: state.sourceReleaseRuns.some((run) => ["PROMOTED", "SUCCEEDED"].includes(run.status)), label: `${state.sourceReleaseRuns.length} release runs` }
  ];
}

function renderHumanActionInbox() {
  const items = humanActionInboxModel();
  return `
    <section class="action-inbox" aria-label="Human action inbox">
      <div class="section-title">
        <div>
          <h2>人工待办中心</h2>
          <p>把待补凭据、待批准、待修复、待 replay 和待发布动作集中到一个队列，避免用户在多个页面里找下一步。</p>
        </div>
        <span class="pill ${items.length ? "warn" : "good"}">${items.length} 个待办</span>
      </div>
      <div class="inbox-list">
        ${items.slice(0, 6).map((item) => `
          <article class="inbox-item ${item.tone}">
            <div>
              <span>${escapeHtml(item.type)}</span>
              <strong>${escapeHtml(item.title)}</strong>
              <small>${escapeHtml(item.detail)}</small>
            </div>
            <button ${item.action ? `data-action="${escapeHtml(item.action)}"` : `data-page-link="${escapeHtml(item.page)}"`} ${item.id ? `data-id="${escapeHtml(item.id)}"` : ""} ${item.runId ? `data-run-id="${escapeHtml(item.runId)}"` : ""} ${item.finalGate ? `data-final-gate="${escapeHtml(item.finalGate)}"` : ""}>${escapeHtml(item.cta)}</button>
          </article>
        `).join("") || renderEmptyState("暂无人工待办", "当前没有阻塞项。Loop 进入批准、凭据、修复、replay 或发布门禁时会出现在这里。")}
      </div>
    </section>
  `;
}

function humanActionInboxModel() {
  const credentialItems = state.projects
    .filter((project) => project.hasRepository && !/已配置|tokenRef|inline token/.test(String(project.credentials)))
    .map((project) => ({
      type: "凭据",
      title: `${project.name} 缺少源码写回凭据`,
      detail: "GitHub/GitLab 写回前需要 tokenRef 或 inline token 预检通过。",
      cta: "配置凭据",
      action: "open-source-credential-config",
      id: project.id,
      tone: "warn"
    }));
  const approvalItems = state.loops
    .filter((loop) => loop.status === "WAITING_APPROVAL")
    .map((loop) => {
      const finalGate = Number(loop.currentIteration ?? 0) >= Number(loop.stopPolicy?.maxIterations ?? Number.POSITIVE_INFINITY);
      return {
      type: "批准",
      title: loop.objective,
      detail: `${loop.id} 等待人工批准继续或完成。`,
      cta: finalGate ? "批准完成" : "批准并继续",
      action: "approve-loop",
      id: loop.id,
      finalGate: finalGate ? "true" : "false",
      tone: "warn"
    };
    });
  const repairItems = state.sourceReleaseRepairCandidates.map((candidate) => ({
    type: "修复",
    title: `${candidate.loopId} release run 失败`,
    detail: candidate.reason ?? "source release run 需要修复。",
    cta: "修复",
    action: "repair-source-release-candidate",
    runId: candidate.runId,
    tone: "bad"
  }));
  const releaseItems = state.sourceReleaseRuns
    .filter((run) => ["PENDING_REVIEW", "POLICY_BLOCKED", "FAILED", "HEALTH_FAILED"].includes(run.status) || run.review?.status === "PENDING")
    .map((run) => ({
      type: "发布",
      title: `${run.loopId ?? run.id} 等待 release 决策`,
      detail: `${run.status ?? "PLANNED"} / ${run.nextAction ?? "review"}`,
      cta: "查看发布",
      page: "评估与发布",
      tone: run.status === "FAILED" || run.status === "HEALTH_FAILED" ? "bad" : "warn"
    }));
  const inboxItems = (state.loopTargetRuntime.memoryInbox ?? [])
    .filter((item) => ["NEW", "ACCEPTED"].includes(item.status))
    .map((item) => ({
      type: "记忆",
      title: item.title ?? item.id,
      detail: `${item.status} / ${item.targetId ?? item.type ?? "memory"}`,
      cta: "处理",
      page: "发现与目标",
      tone: "neutral"
    }));
  return [...credentialItems, ...approvalItems, ...repairItems, ...releaseItems, ...inboxItems];
}

function renderDiscoveryAndTargets() {
  return `
    ${renderFlowHeader()}
    ${renderHumanActionInbox()}
    <div class="page-brief">
      <div>
        <span class="eyebrow">Discovery and target control</span>
        <h2>从运行证据到可执行 target loop</h2>
        <p>这里把证据策略、评测集、机会点、Target Backlog 和 Target Runtime 放在同一条产品链路里。</p>
      </div>
      <div class="brief-metrics">
        <div><span>Discovery</span><strong>${state.loopTargetRuntime.discoveryCandidates.length}</strong></div>
        <div><span>Inbox</span><strong>${state.loopTargetRuntime.memoryInbox.length}</strong></div>
        <div><span>Targets</span><strong>${state.loopOrchestrationTargets.length}</strong></div>
      </div>
    </div>
    ${renderLoopTargetRuntimePanel()}
    ${renderLoopTargetBacklogPanel()}
    ${renderRules()}
    ${renderEvaluationDatasets()}
    ${renderOpportunities()}
  `;
}

function renderLoopExecution() {
  const loops = state.loops;
  if (state.loopWorkspaceView !== "advanced") return renderSimplifiedLoopExecution(loops);
  const view = loopWorkspaceView();
  const selectedLoop = selectedSourceToGaLoop(loops);
  return `
    ${renderFlowHeader()}
    ${renderLoopWorkspaceHeader(loops, selectedLoop, view)}
    ${view === "detail"
      ? renderLoopDetailWorkspace(selectedLoop)
      : view === "create"
        ? renderLoopCreateWorkspace(loops)
        : renderLoopOverviewWorkspace(loops)}
  `;
}

function renderSimplifiedLoopExecution(loops) {
  const model = sourceToGaExperienceModel();
  const currentLoops = loops.filter((loop) => ["RUNNING", "WAITING_APPROVAL", "BLOCKED"].includes(loop.status));
  const completedLoops = loops.filter((loop) => ["SUCCEEDED", "COMPLETED"].includes(loop.status) || loop.sourceClosure?.closureState === "PROMOTED");
  const failedLoops = loops.filter((loop) => ["FAILED", "CANCELLED"].includes(loop.status) || loop.sourceClosure?.closureState === "FAILED");
  const primaryLoop = model.activeLoop ?? currentLoops[0] ?? completedLoops[0] ?? loops[0];
  return `
    <section class="source-ga-loop-head">
      <div>
        <span class="eyebrow">Loop</span>
        <h2>当前、待处理、历史分开看</h2>
        <p>第一次使用时只需要关注一个主 Loop；trace、replay、sandbox 和 worker 细节进入高级工作区。</p>
      </div>
      <button data-loop-workspace-view="advanced">打开高级工作区</button>
    </section>
    <div class="source-ga-loop-tabs" role="tablist" aria-label="Loop 状态分组">
      <button class="active">当前进行中 ${currentLoops.length || (primaryLoop ? 1 : 0)}</button>
      <button>待处理 ${humanActionInboxModel().length}</button>
      <button>历史完成 ${completedLoops.length}</button>
      <button>失败/修复 ${failedLoops.length + state.sourceReleaseRepairCandidates.length}</button>
    </div>
    <div class="source-ga-loop-grid">
      <section class="card">
        <div class="section-title">
          <div>
            <h2>当前主 Loop</h2>
            <p>${escapeHtml(primaryLoop?.objective ?? "创建第一个 Source-to-GA Loop 后，会在这里显示进度。")}</p>
          </div>
          ${statusPill(model.loopDone ? "已晋级" : primaryLoop?.status ?? "待启动")}
        </div>
        ${primaryLoop ? renderSimplifiedLoopCard(primaryLoop, model) : renderEmptyState("还没有 Loop", "连接 GitHub 项目并生成 GA target 后，启动第一个 Source-to-GA Loop。", "把首次路径保持在一个主任务上。")}
      </section>
      <aside class="card">
        <div class="section-title">
          <div>
            <h2>待办中心</h2>
            <p>只显示会阻塞下一步的动作。</p>
          </div>
          <span class="pill ${humanActionInboxModel().length ? "warn" : "good"}">${humanActionInboxModel().length}</span>
        </div>
        <div class="source-ga-todo-list">
          ${humanActionInboxModel().slice(0, 5).map((item) => `
            <article>
              <div>
                <strong>${escapeHtml(item.title)}</strong>
                <small>${escapeHtml(item.detail)}</small>
              </div>
              <button ${item.action ? `data-action="${escapeHtml(item.action)}"` : `data-page-link="${escapeHtml(item.page)}"`} ${item.id ? `data-id="${escapeHtml(item.id)}"` : ""}>${escapeHtml(item.cta)}</button>
            </article>
          `).join("") || renderEmptyState("无阻塞待办", "凭据、审批、修复和发布门禁都没有等待用户处理。")}
        </div>
      </aside>
    </div>
  `;
}

function renderSimplifiedLoopCard(loop, model) {
  const steps = [
    ["Plan", "目标和边界", Boolean(loop)],
    ["Writeback", "写入 GitHub", model.loopDone || Boolean(model.prUrl)],
    ["Review", model.prUrl ? `PR ${model.prUrl.split("/").at(-1)}` : "等待 PR", model.loopDone],
    ["Release", model.decisionGo ? "Decision GO" : "等待结论", model.decisionGo]
  ];
  return `
    <article class="source-ga-primary-loop">
      <div class="source-ga-primary-loop-meta">
        <div><span>Loop</span><strong>${escapeHtml(loop.id)}</strong></div>
        <div><span>Source closure</span><strong>${escapeHtml(model.closureState)}</strong></div>
        <div><span>PR</span><strong>${model.prUrl ? escapeHtml(`#${model.prUrl.split("/").at(-1)}`) : "等待创建"}</strong></div>
      </div>
      <div class="source-ga-loop-progress">
        ${steps.map(([title, detail, done], index) => `
          <div class="${done ? "done" : index === model.currentStep - 1 ? "current" : ""}">
            <span>${index + 1}</span>
            <strong>${escapeHtml(title)}</strong>
            <small>${escapeHtml(detail)}</small>
          </div>
        `).join("")}
      </div>
      <div class="source-ga-home-actions">
        <button class="primary" data-page-link="${model.decisionGo ? "评估与发布" : "Loop 执行"}">${model.decisionGo ? "查看发布决策" : "继续 Loop"}</button>
        ${model.prUrl ? `<a class="button-like" href="${escapeHtml(model.prUrl)}" target="_blank" rel="noreferrer">打开 PR</a>` : ""}
        <button data-loop-workspace-view="advanced">高级细节</button>
      </div>
    </article>
  `;
}

function loopWorkspaceView() {
  if (state.loopWorkspaceView === "detail" && !selectedSourceToGaLoop(state.loops)) return "overview";
  return ["overview", "detail", "create"].includes(state.loopWorkspaceView) ? state.loopWorkspaceView : "overview";
}

function renderLoopWorkspaceHeader(loops, selectedLoop, view) {
  const blocked = loops.filter((loop) => ["BLOCKED", "WAITING_APPROVAL", "FAILED"].includes(loop.status)).length;
  const releasePending = loops.filter((loop) => loop.sourceClosure?.closureState && loop.sourceClosure.closureState !== "PROMOTED").length;
  const running = loops.filter((loop) => loop.status === "RUNNING").length;
  return `
    <section class="loop-workspace-hero" aria-label="Loop execution workspace">
      <div>
        <span class="eyebrow">Loop workspace</span>
        <h2>Loop 执行工作区</h2>
        <p>总览页只处理队列和调度；进入单个 Loop 后再查看 Source-to-GA 动态链路、trace、sandbox、replay 和 release evidence；创建页只负责新建或调整 graph。</p>
      </div>
      <div class="loop-workspace-metrics">
        <div><span>全部 Loop</span><strong>${loops.length}</strong></div>
        <div><span>运行中</span><strong>${running}</strong></div>
        <div><span>需处理</span><strong>${blocked}</strong></div>
        <div><span>Release 待闭合</span><strong>${releasePending}</strong></div>
      </div>
      <div class="loop-workspace-tabs" role="tablist" aria-label="Loop 工作区视图">
        ${[
          ["overview", "总览", "队列、Target、Worker"],
          ["detail", "Loop 详情", selectedLoop?.id ?? "选择一个 Loop"],
          ["create", "创建 Loop", "Workflow Canvas"]
        ].map(([id, label, detail]) => `
          <button class="${view === id ? "active" : ""}" data-loop-workspace-view="${id}" ${id === "detail" && !selectedLoop ? "disabled" : ""}>
            <strong>${escapeHtml(label)}</strong>
            <span>${escapeHtml(detail)}</span>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function renderLoopOverviewWorkspace(loops) {
  const store = state.loopStore;
  return `
    ${renderAutopilotCommandCenter()}
    <div class="loop-overview-grid">
      ${renderLoopWorkerQueuePanel()}
      ${renderLoopTargetBacklogPanel()}
    </div>
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
      ${renderLoopRunTable(loops)}
    </section>
  `;
}

function renderLoopDetailWorkspace(loop) {
  if (!loop) {
    return `
      <section class="card">
        ${renderEmptyState("请选择一个 Loop", "总览列表中点击“详情”后，会进入单个 Loop 的运行控制台。", "这里不再堆叠所有 Loop 的运行细节。")}
      </section>
    `;
  }
  return `
    ${renderVisualLoopRunCanvas(state.loops)}
    ${renderInteractiveAgentRunConsole([loop])}
    ${renderLoopDetail(loop)}
  `;
}

function renderLoopCreateWorkspace(loops) {
  return `
    <div class="loop-create-grid">
      ${renderLoopOrchestrationPanel()}
      ${renderWorkflowCanvasEditor(loops)}
    </div>
  `;
}

function renderEvaluationAndRelease() {
  if (state.releaseWorkspaceView !== "advanced") return renderSimplifiedRelease();
  return `
    ${renderFlowHeader()}
    ${renderReleaseCockpit()}
    <div class="page-brief">
      <div>
        <span class="eyebrow">Evaluation and release gates</span>
        <h2>把代码升级、CI/CD、评估和源码发布放在同一页</h2>
        <p>发布不是流水线的附属步骤；guardrail、adversarial evaluation、release policy 和 source closure 共同决定是否继续。</p>
      </div>
      <div class="brief-metrics">
        <div><span>Adversarial</span><strong>${state.loopTargetRuntime.adversarialEvaluations.length}</strong></div>
        <div><span>Guardrails</span><strong>${state.loopTargetRuntime.guardrailEvaluations.length}</strong></div>
        <div><span>Release Runs</span><strong>${state.sourceReleaseRuns.length}</strong></div>
      </div>
    </div>
    ${renderReleaseGuardrailPanel()}
    ${renderPipelines({ includeFlowHeader: false })}
    <div class="loop-operations-grid">
      ${renderSourceReleaseRepairQueuePanel()}
      ${renderSourceReleaseDeployFinalizersPanel()}
    </div>
    ${state.loops.slice(0, 2).map(renderLoopDetail).join("")}
  `;
}

function renderSimplifiedRelease() {
  const model = sourceToGaExperienceModel();
  const scenarioRows = [
    ["demo-project-registered", model.verified ? "PASS" : "WAITING", model.project?.validation ?? "等待项目验证"],
    ["demo-source-credentials-ready", model.credentialsReady ? "PASS" : "WAITING", model.project?.credentials ?? "等待写回凭据"],
    ["demo-source-closure-promoted", model.loopDone ? "PASS" : "WAITING", `closure=${model.closureState}`],
    ["demo-pr-merged", model.mergeCommit ? "PASS" : "WAITING", model.mergeCommit || "等待 merge commit"]
  ];
  return `
    <section class="source-ga-release-hero">
      <div>
        <span class="eyebrow">发布决策</span>
        <h2>${escapeHtml(model.decisionGo ? `${model.project?.name ?? "当前项目"} 可以进入 GA Release` : "等待形成 GA Release 结论")}</h2>
        <p>默认只展示结论、关键证据和用户下一步。完整 matrix、policy、repair 和 deploy finalizer 进入高级详情。</p>
        <div class="source-ga-home-actions">
          <button class="primary" data-page-link="帮助手册">归档到 E2E 教程</button>
          ${model.prUrl ? `<a class="button-like" href="${escapeHtml(model.prUrl)}" target="_blank" rel="noreferrer">打开 GitHub PR</a>` : ""}
          <button data-action="show-release-advanced">查看完整 evidence matrix</button>
        </div>
      </div>
      <aside class="source-ga-release-decision ${model.decisionGo ? "go" : ""}">
        <strong>${escapeHtml(model.decisionGo ? "GO" : model.decisionStatus)}</strong>
        <span>${escapeHtml(model.releaseRun?.id ?? "release decision")}</span>
      </aside>
    </section>
    <div class="source-ga-release-grid">
      <section class="card">
        <div class="section-title">
          <div>
            <h2>关键证据</h2>
            <p>用户判断发布结论所需的最小字段。</p>
          </div>
        </div>
        <table class="compact-facts">
          <tr><td>Project</td><td>${escapeHtml(model.project?.id ?? "未选择")}</td></tr>
          <tr><td>Loop</td><td>${escapeHtml(model.activeLoop?.id ?? "尚未启动")}</td></tr>
          <tr><td>Source closure</td><td>${statusPill(model.loopDone ? "已晋级" : model.closureState)}</td></tr>
          <tr><td>Pull request</td><td>${model.prUrl ? `<a href="${escapeHtml(model.prUrl)}" target="_blank" rel="noreferrer">${escapeHtml(model.prUrl)}</a>` : "等待创建"}</td></tr>
          <tr><td>Merge commit</td><td>${escapeHtml(model.mergeCommit || "等待合并")}</td></tr>
        </table>
      </section>
      <section class="card">
        <div class="section-title">
          <div>
            <h2>Release 场景</h2>
            <p>默认只展示主链路四项。</p>
          </div>
        </div>
        <div class="source-ga-scenario-list">
          ${scenarioRows.map(([id, status, detail]) => `
            <article>
              <div>
                <strong>${escapeHtml(id)}</strong>
                <small>${escapeHtml(detail)}</small>
              </div>
              <span class="pill ${status === "PASS" ? "good" : "warn"}">${escapeHtml(status)}</span>
            </article>
          `).join("")}
        </div>
      </section>
      <section class="card source-ga-release-next">
        <div class="section-title">
          <div>
            <h2>用户下一步</h2>
            <p>发布页不再先暴露内部矩阵，先给用户一个动作。</p>
          </div>
        </div>
        <table class="compact-facts">
          <tr><td>推荐动作</td><td>${model.decisionGo ? "把本次真实 GitHub demo project 到 GA Release 的流程加入帮助文档。" : "补齐 release evidence，直到得到 GO / NO-GO。"}</td></tr>
          <tr><td>可选动作</td><td>打开高级详情查看 source gate、trace、policy 和 audit log。</td></tr>
          <tr><td>高级视图</td><td><button data-action="show-release-advanced">打开完整发布工作台</button></td></tr>
        </table>
      </section>
    </div>
  `;
}

function renderVisualLoopRunCanvas(loops) {
  const loop = selectedSourceToGaLoop(loops);
  const model = sourceToGaModel(loop);
  const selectedNode = model.nodes.find((node) => node.id === state.sourceToGaNodeId) ?? model.nodes.find((node) => node.current) ?? model.nodes[0];
  return `
    <section class="source-ga-workbench" aria-label="Source-to-GA ontology map">
      <div class="section-title">
        <div>
          <h2>Source-to-GA 本体链路图</h2>
          <p>同一个动态组件服务所有 Loop Run：选择一个 loopId 后，节点、连线、Inspector 和事件流会根据真实 runtime、trace、source release run 与 release decision 刷新。</p>
        </div>
        <div class="source-ga-actions">
          <span class="pill ${loop?.status === "RUNNING" ? "good source-ga-live" : loop ? "warn" : ""}">${escapeHtml(loop?.status ?? "等待 Loop")}</span>
          <button data-source-ga-refresh="true">刷新动态图</button>
          <button class="primary" data-action="resume-loop" data-id="${escapeHtml(loop?.id ?? "")}" ${loop ? "" : "disabled"}>继续 Loop</button>
        </div>
      </div>
      <div class="source-ga-loop-strip" aria-label="Loop 选择器">
        ${(loops ?? []).slice(0, 6).map((item) => `
          <button class="${item.id === loop?.id ? "active" : ""}" data-source-ga-loop-id="${escapeHtml(item.id)}">
            <strong>${escapeHtml(item.id)}</strong>
            <span>${escapeHtml(item.status ?? "UNKNOWN")}</span>
          </button>
        `).join("") || `<div class="empty">暂无 LoopRun。创建闭环 Loop 后，这里会用同一张动态图展示每个 Loop 的进度。</div>`}
      </div>
      <div class="source-ga-layout">
        <div class="source-ga-map">
          <div class="source-ga-lane lane-input">外部输入层</div>
          <div class="source-ga-lane lane-target">Target 建模层</div>
          <div class="source-ga-lane lane-runtime">Loop 执行层</div>
          <div class="source-ga-lane lane-release">发布闭环层</div>
          <div class="source-ga-lane lane-evidence">证据与决策层</div>
          <svg class="source-ga-links" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <marker id="source-ga-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L0,6 L9,3 z"></path>
              </marker>
            </defs>
            ${model.edges.map((edge) => `
              <path class="${edge.active ? "active" : ""}" d="${escapeHtml(edge.path)}"></path>
            `).join("")}
          </svg>
          ${model.edges.map((edge) => `<span class="source-ga-relation ${escapeHtml(edge.className)}">${escapeHtml(edge.label)}</span>`).join("")}
          ${model.nodes.map((node) => `
            <button class="source-ga-node ${escapeHtml(node.position)} ${escapeHtml(node.tone)} ${node.current ? "current" : ""} ${selectedNode?.id === node.id ? "selected" : ""}"
              data-source-ga-node-id="${escapeHtml(node.id)}"
              aria-label="${escapeHtml(node.title)} ${escapeHtml(node.status)}">
              <span><i></i>${escapeHtml(node.type)}</span>
              <strong>${escapeHtml(node.title)}</strong>
              <small>${escapeHtml(node.detail)}</small>
              <b>${escapeHtml(node.status)}</b>
            </button>
          `).join("")}
        </div>
        <aside class="source-ga-inspector" aria-label="Source-to-GA node inspector">
          ${renderSourceToGaInspector(selectedNode, loop, model)}
        </aside>
      </div>
      <div class="source-ga-footer">
        <div class="source-ga-legend">
          <span><i class="ready"></i>READY / DONE</span>
          <span><i class="running"></i>RUNNING / STREAMING</span>
          <span><i class="blocked"></i>WAITING / BLOCKED</span>
          <span><i class="pending"></i>等待上游证据</span>
        </div>
        <div class="source-ga-events" aria-label="Source-to-GA 实时事件流">
          ${model.events.map((event) => `
            <div class="source-ga-event">
              <span>${escapeHtml(event.time)}</span>
              <strong>${escapeHtml(event.label)}</strong>
              <small>${escapeHtml(event.detail)}</small>
            </div>
          `).join("") || `<div class="empty">暂无事件。启动 Loop 后，这里会追加 executor、worker、gate、release 和 GA evidence 事件。</div>`}
        </div>
      </div>
    </section>
  `;
}

function selectedSourceToGaLoop(loops) {
  const preferred = loops.find((loop) => loop.id === state.sourceToGaLoopId);
  const active = loops.find((loop) => ["RUNNING", "WAITING_APPROVAL", "BLOCKED"].includes(loop.status));
  const loop = preferred ?? active ?? loops[0];
  if (loop && state.sourceToGaLoopId !== loop.id) state.sourceToGaLoopId = loop.id;
  return loop;
}

function sourceToGaModel(loop) {
  const closure = loop?.sourceClosure ?? {};
  const trace = loop?.trace ?? {};
  const target = state.loopOrchestrationTargets.find((item) => item.id === loop?.targetId || item.projectId === loop?.projectId) ?? state.loopOrchestrationTargets[0];
  const project = state.projects.find((item) => item.id === loop?.projectId || item.id === closure.sourceProjectId) ?? state.projects[0];
  const releaseRun = latestSourceReleaseRun(loop?.id);
  const finalizer = sourceReleaseDeployFinalizersForLoop(loop?.id).at(0);
  const graphContract = loop ? state.loopGraphContracts[loop.id] : undefined;
  const releaseStatus = releaseRun?.status ?? closure.closureState ?? "PLANNED";
  const loopStatus = loop?.status ?? "PENDING";
  const currentId = inferSourceToGaCurrentNode(loop, releaseRun, finalizer);
  const nodes = [
    sourceToGaNode("project", "SCM", "GitHub / Git Project", project?.name ?? "等待项目接入", project?.validation ?? project?.status ?? "PENDING", "pos-project", project?.validation === "已验证" || project?.hasRepository ? "ready" : "pending", currentId),
    sourceToGaNode("discovery", "Evidence", "Discovery Candidate", `${state.loopTargetRuntime.discoveryCandidates.length} candidates / ${state.evaluationDatasets.length} datasets`, state.loopTargetRuntime.discoveryCandidates.length ? "READY" : "PENDING", "pos-discovery", state.loopTargetRuntime.discoveryCandidates.length ? "ready" : "pending", currentId),
    sourceToGaNode("target", "Target", "Target Backlog", target?.title ?? loop?.objective ?? "等待 target", target?.status ?? (loop ? "BOUND" : "PENDING"), "pos-target", target?.status === "BLOCKED" ? "blocked" : loop ? "running" : "pending", currentId),
    sourceToGaNode("executor", "Graph", "Executor Graph", loop?.executorGraphId ?? graphContract?.executorGraph?.id ?? "typed executor graph", graphContract?.executorGraph?.validation?.status ?? loopStatus, "pos-executor", sourceToGaTone(loopStatus), currentId),
    sourceToGaNode("worker", "Runtime", "Worker + Sandbox", `${loop?.workerLease?.workerId ?? "等待 claim"} / ${loop?.sandbox?.runtime ?? "sandbox"}`, loop?.workerLease ? "CLAIMED" : (loop ? "UNCLAIMED" : "PENDING"), "pos-worker", loop?.workerLease ? "ready" : loop ? "running" : "pending", currentId),
    sourceToGaNode("humanGate", "Gate", "Human Gate", loopStatus === "WAITING_APPROVAL" ? "等待批准继续或发布" : "按策略触发", loopStatus === "WAITING_APPROVAL" ? "WAITING_APPROVAL" : "CONDITIONAL", "pos-gate", loopStatus === "WAITING_APPROVAL" ? "blocked" : "pending", currentId),
    sourceToGaNode("closure", "Closure", "Source Closure", `${closure.repositoryProvider ?? "scm"} / ${closure.targetVersion ?? "target version pending"}`, releaseStatus, "pos-closure", sourceToGaTone(releaseStatus), currentId),
    sourceToGaNode("deploy", "Deploy", "CI/CD + Deploy", finalizer?.connectorId ?? releaseRun?.deploy?.connectorId ?? "Jenkins / deploy connector", finalizer?.status ?? releaseRun?.deploy?.status ?? "PENDING", "pos-deploy", sourceToGaTone(finalizer?.status ?? releaseRun?.deploy?.status ?? releaseStatus), currentId),
    sourceToGaNode("decision", "Decision", "Release Decision", releaseRun?.policy?.status ?? state.intelligence.latestReleaseDecisionStatus ?? "未判定", releaseDecisionLabel(releaseRun), "pos-decision", releaseDecisionTone(releaseRun), currentId),
    sourceToGaNode("ga", "GA", "GA Release", releaseRun?.review?.mergeCommitSha ?? releaseRun?.id ?? "等待 release evidence", gaStatusLabel(releaseRun), "pos-ga", gaTone(releaseRun), currentId)
  ];
  return {
    nodes,
    edges: sourceToGaEdges(nodes),
    events: sourceToGaEvents(loop, releaseRun, finalizer),
    releaseRun,
    finalizer
  };
}

function sourceToGaNode(id, type, title, detail, status, position, tone, currentId) {
  return {
    id,
    type,
    title,
    detail: String(detail ?? "-"),
    status: String(status ?? "PENDING"),
    position,
    tone,
    current: id === currentId
  };
}

function inferSourceToGaCurrentNode(loop, releaseRun, finalizer) {
  if (!loop) return "project";
  if (["RUNNING"].includes(loop.status)) return "executor";
  if (loop.status === "WAITING_APPROVAL") return "humanGate";
  if (loop.status === "BLOCKED" || loop.status === "FAILED") return "executor";
  if (["RUNNING", "PENDING", "PLANNED"].includes(releaseRun?.status)) return "closure";
  if (finalizer && !["SUCCEEDED", "PROMOTED"].includes(finalizer.status)) return "deploy";
  if (releaseRun && !["PROMOTED", "SUCCEEDED"].includes(releaseRun.status)) return "decision";
  if (["PROMOTED", "SUCCEEDED"].includes(releaseRun?.status)) return "ga";
  return "target";
}

function sourceToGaTone(status) {
  const value = String(status ?? "").toUpperCase();
  if (["READY", "DONE", "OK", "SUCCEEDED", "PROMOTED", "CLAIMED", "LEASED", "VALID"].includes(value)) return "ready";
  if (["RUNNING", "STREAMING", "BOUND"].includes(value)) return "running";
  if (["WAITING_APPROVAL", "BLOCKED", "FAILED", "HEALTH_FAILED", "ROLLED_BACK", "ATTENTION", "POLICY_BLOCKED"].includes(value)) return "blocked";
  return "pending";
}

function releaseDecisionLabel(releaseRun, options = {}) {
  const decision = String(state.intelligence.latestReleaseDecisionStatus ?? "").trim();
  if (options.allowGlobalDecision !== false && decision && decision !== "未判定") return decision;
  if (["FAILED", "HEALTH_FAILED", "ROLLED_BACK", "POLICY_BLOCKED"].includes(releaseRun?.status)) return "NO-GO";
  if (releaseRun) return releaseRun.policy?.status ?? "AWAITING_DECISION";
  return "AWAITING";
}

function releaseDecisionTone(releaseRun) {
  const label = releaseDecisionLabel(releaseRun);
  if (label === "GO") return "ready";
  if (label === "NO-GO") return "blocked";
  return releaseRun ? "running" : "pending";
}

function gaStatusLabel(releaseRun) {
  const decision = releaseDecisionLabel(releaseRun);
  if (decision === "GO" && ["PROMOTED", "SUCCEEDED"].includes(releaseRun?.status)) return "GA_READY";
  if (decision === "NO-GO") return "NO_GO";
  if (releaseRun) return "NOT_YET";
  return "AWAITING";
}

function gaTone(releaseRun) {
  const status = gaStatusLabel(releaseRun);
  if (status === "GA_READY") return "ready";
  if (status === "NO_GO" || ["FAILED", "HEALTH_FAILED", "ROLLED_BACK"].includes(releaseRun?.status)) return "blocked";
  return releaseRun ? "running" : "pending";
}

function sourceToGaEdges(nodes) {
  const activeIndex = Math.max(0, nodes.findIndex((node) => node.current));
  const edgeDefs = [
    ["project", "discovery", "registers", "rel-registers", "M170 86 C205 86 225 86 260 86"],
    ["discovery", "target", "discovers", "rel-discovers", "M405 98 C470 120 500 150 535 190"],
    ["target", "executor", "creates loop", "rel-loop", "M645 235 C705 260 730 292 760 325"],
    ["executor", "worker", "claims", "rel-claims", "M755 360 C660 390 532 392 420 365"],
    ["worker", "humanGate", "gates", "rel-gates", "M420 408 C465 455 500 480 535 503"],
    ["humanGate", "closure", "approves", "rel-approves", "M650 510 C690 510 720 510 760 510"],
    ["closure", "deploy", "deploys", "rel-deploys", "M830 535 C830 560 830 575 830 592"],
    ["deploy", "decision", "reports", "rel-reports", "M760 592 C720 592 690 592 650 592"],
    ["decision", "ga", "decides", "rel-decides", "M535 592 C485 592 445 592 405 592"]
  ];
  return edgeDefs.map(([from, to, label, className, path]) => {
    const toIndex = nodes.findIndex((node) => node.id === to);
    return { from, to, label, className, path, active: toIndex > -1 && toIndex <= activeIndex };
  });
}

function sourceToGaEvents(loop, releaseRun, finalizer) {
  const timeline = (loop?.timeline ?? []).slice(-3).map((event, index) => ({
    time: event.timestamp ? formatDate(event.timestamp) : `T-${3 - index}`,
    label: event.type ?? "loop-event",
    detail: event.message ?? event.decision ?? "Loop runtime event"
  }));
  const synthetic = [
    loop ? { time: "now", label: "selected-loop", detail: `${loop.id} / ${loop.status}` } : undefined,
    releaseRun ? { time: "release", label: "source-release-run", detail: `${releaseRun.id} / ${releaseRun.status}` } : undefined,
    finalizer ? { time: "deploy", label: "deploy-finalizer", detail: `${finalizer.connectorId ?? "connector"} / ${finalizer.status}` } : undefined
  ].filter(Boolean);
  return [...timeline, ...synthetic].slice(-5);
}

function renderSourceToGaInspector(node, loop, model) {
  const releaseRun = model.releaseRun;
  const finalizer = model.finalizer;
  const apiHints = {
    project: ["/api/v1/projects", "/api/v1/deploy-connectors"],
    discovery: ["/api/v1/loop-target-runtime/summary", "/api/v1/evaluation-datasets"],
    target: ["/api/v1/loop-orchestration/targets"],
    executor: [`/api/v1/loops/${loop?.id ?? "{loopId}"}/executor-graph`, `/api/v1/loops/${loop?.id ?? "{loopId}"}/trace-tree`, `/api/v1/loops/${loop?.id ?? "{loopId}"}/events`],
    worker: ["/api/v1/loop-workers/queue", `/api/v1/loops/${loop?.id ?? "{loopId}"}/events`],
    humanGate: [`/api/v1/loops/${loop?.id ?? "{loopId}"}/approve`],
    closure: ["/api/v1/source-release-runs", `/api/v1/loops/${loop?.id ?? "{loopId}"}/source-release`],
    deploy: ["/api/v1/source-release-deploy-finalizers"],
    decision: ["/api/v1/release/decisions", "/api/v1/source-release-runs"],
    ga: ["/api/v1/release/decisions", "/api/v1/source-release-runs", "/api/v1/history"]
  };
  const facts = [
    ["Loop", loop?.id ?? "等待 Loop"],
    ["当前节点", node?.title ?? "-"],
    ["节点状态", node?.status ?? "-"],
    ["下一动作", sourceToGaNextAction(node, loop, releaseRun)],
    ["Release Run", releaseRun?.id ?? "等待 source closure"],
    ["Deploy Finalizer", finalizer?.status ?? "无待恢复 finalizer"]
  ];
  return `
    <div class="source-ga-inspector-head">
      <span class="eyebrow">Node inspector</span>
      <h3>${escapeHtml(node?.title ?? "等待节点")}</h3>
      <p>点击左侧节点会切换这里的状态、关联 API、blocker、artifacts 和可执行动作。</p>
    </div>
    <div class="source-ga-facts">
      ${facts.map(([label, value]) => `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`).join("")}
    </div>
    <div class="source-ga-api-list">
      <strong>关联 API</strong>
      ${(apiHints[node?.id] ?? []).map((api) => `<code>${escapeHtml(api)}</code>`).join("")}
    </div>
    <div class="source-ga-inspector-actions">
      <button data-action="load-loop-events" data-id="${escapeHtml(loop?.id ?? "")}" ${loop ? "" : "disabled"}>刷新事件</button>
      <button data-action="watchdog-loop" data-id="${escapeHtml(loop?.id ?? "")}" ${loop ? "" : "disabled"}>Watchdog</button>
      ${loop?.status === "WAITING_APPROVAL" ? `<button data-action="approve-loop" data-id="${escapeHtml(loop.id)}">批准继续</button>` : `<button data-action="resume-loop" data-id="${escapeHtml(loop?.id ?? "")}" ${loop ? "" : "disabled"}>继续 Loop</button>`}
      <button class="primary" data-action="load-source-release-run" data-id="${escapeHtml(loop?.id ?? "")}" ${loop ? "" : "disabled"}>刷新 Release Run</button>
    </div>
  `;
}

function sourceToGaNextAction(node, loop, releaseRun) {
  if (!loop) return "创建或选择一个 Loop Run";
  if (node?.id === "humanGate" && loop.status === "WAITING_APPROVAL") return "批准继续或结束最终 gate";
  if (node?.id === "closure" && !releaseRun) return "执行 source release closure";
  if (node?.id === "decision" && releaseRun) return "读取 release decision 与 policy blocker";
  if (node?.id === "ga") return ["PROMOTED", "SUCCEEDED"].includes(releaseRun?.status) ? "复盘 GA evidence" : "等待 Release Decision 达到 GO";
  return loop.timeline?.at(-1)?.message ?? loop.status ?? "等待 runtime 事件";
}

function renderWorkflowCanvasEditor(loops) {
  const activeLoop = loops.find((loop) => ["RUNNING", "WAITING_APPROVAL", "BLOCKED"].includes(loop.status)) ?? loops[0];
  const presets = state.loopOrchestrationPresets;
  const defaultProject = state.projects[0]?.id ?? "evopilot";
  const graphNodes = workflowCanvasNodes(activeLoop);
  return `
    <section class="workflow-editor" aria-label="Workflow canvas editor">
      <div class="section-title">
        <div>
          <h2>Workflow Canvas Editor</h2>
          <p>像工作流产品一样编辑 target graph：节点、条件路由、fan-out/fan-in、human gate 和 release gate 会一起进入新建 Loop。</p>
        </div>
        <span class="pill ${activeLoop ? "good" : "warn"}">${escapeHtml(activeLoop?.executorGraphId ?? "new graph")}</span>
      </div>
      <div class="workflow-editor-layout">
        <div class="workflow-node-board">
          ${graphNodes.map((node, index) => `
            <article class="workflow-node ${node.tone}">
              <span>${index + 1}</span>
              <strong>${escapeHtml(node.label)}</strong>
              <small>${escapeHtml(node.detail)}</small>
              <b>${escapeHtml(node.route)}</b>
            </article>
          `).join("")}
        </div>
        <form class="workflow-editor-form" id="workflow-canvas-editor-form">
          <label>
            <span>项目</span>
            <select name="projectId">
              ${state.projects.map((project) => `<option value="${escapeHtml(project.id)}" ${project.id === defaultProject ? "selected" : ""}>${escapeHtml(project.name)} (${escapeHtml(project.id)})</option>`).join("")}
            </select>
          </label>
          <label>
            <span>Graph template</span>
            <select name="presetId">
              ${presets.map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}${preset.ready ? "" : " - 待连接器"}</option>`).join("") || `<option value="source-release-closure">Source to Production Closure</option>`}
            </select>
          </label>
          <label>
            <span>条件路由</span>
            <select name="routingMode">
              <option value="policy-gated">Policy gated</option>
              <option value="fanout-evaluator">Fan-out evaluator</option>
              <option value="human-first">Human gate first</option>
            </select>
          </label>
          <label>
            <span>发布 Gate</span>
            <select name="releaseGate">
              <option value="source-closure">Source closure + health-ready</option>
              <option value="review-only">Review only</option>
              <option value="deploy-and-rollback">Deploy + rollback proof</option>
            </select>
          </label>
          <label class="wide-field">
            <span>目标描述</span>
            <input name="objective" placeholder="让该项目完成一次可审计的源码到生产发布闭环" />
          </label>
          <div class="form-actions">
            <button type="button" data-action="run-discovery-runtime">刷新 Discovery</button>
            <button class="primary" type="submit">从画布创建 Loop</button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function workflowCanvasNodes(loop) {
  const closure = loop?.sourceClosure ?? {};
  return [
    { label: "Target", detail: loop?.objective ?? "用户定义 target loop", route: "start", tone: loop ? "ready" : "pending" },
    { label: "Discovery", detail: `${state.loopTargetRuntime.discoveryCandidates.length} candidates / ${state.evaluationDatasets.length} datasets`, route: "fan-out", tone: state.loopTargetRuntime.discoveryCandidates.length ? "ready" : "pending" },
    { label: "Executor", detail: loop?.executorGraphId ?? "typed executor graph", route: loop?.coordination?.mode ?? "serial", tone: loop?.status === "RUNNING" ? "ready" : "pending" },
    { label: "Evaluator", detail: `${state.loopTargetRuntime.adversarialEvaluations.length} adversarial / ${state.loopTargetRuntime.guardrailEvaluations.length} guardrails`, route: "fan-in", tone: state.loopTargetRuntime.guardrailEvaluations.length ? "ready" : "pending" },
    { label: "Human gate", detail: loop?.status === "WAITING_APPROVAL" ? "等待批准" : "按策略触发", route: "conditional", tone: loop?.status === "WAITING_APPROVAL" ? "blocked" : "pending" },
    { label: "Release", detail: `${closure.repositoryProvider ?? "scm"} / ${closure.closureState ?? "PLANNED"}`, route: "source closure", tone: closure.closureState === "PROMOTED" ? "ready" : "pending" }
  ];
}

function renderInteractiveAgentRunConsole(loops) {
  const loop = loops.find((item) => ["RUNNING", "WAITING_APPROVAL", "BLOCKED"].includes(item.status)) ?? loops[0];
  const events = interactiveConsoleEvents(loop);
  const currentExecutor = loop?.timeline?.at(-1)?.type ?? loop?.iterations?.at(-1)?.decision ?? "waiting";
  const graphContract = loop ? state.loopGraphContracts[loop.id] : undefined;
  const graph = graphContract?.executorGraph;
  const graphCapabilities = graph?.capabilities
    ? Object.entries(graph.capabilities).filter(([, enabled]) => enabled).map(([key]) => key).join(" / ")
    : `${loop?.coordination?.mode ?? "serial"} / ${loop?.coordination?.nodes?.length ?? 0} nodes`;
  return `
    <section class="run-console" aria-label="Interactive agent run console">
      <div class="run-console-head">
        <div>
          <span class="eyebrow">Interactive run console</span>
          <h2>实时 Agent 运行控制台</h2>
          <p>集中展示 streaming events、当前 executor、日志、成本、失败原因和人工动作，比在多个表格里追踪更接近主流 Agent IDE。</p>
        </div>
        <div class="run-console-status">
          <strong>${escapeHtml(loop?.status ?? "NO_LOOP")}</strong>
          <span>${escapeHtml(loop?.id ?? "创建 Loop 后显示实时控制台")}</span>
        </div>
      </div>
      <div class="run-console-grid">
        <div class="console-stream">
          <div class="console-toolbar">
            <strong>${escapeHtml(currentExecutor)}</strong>
            <span>${loop?.trace?.executorStepCount ?? 0} steps / $${Number(loop?.trace?.cost?.estimatedUsd ?? 0).toFixed(4)}</span>
          </div>
          <div class="console-lines">
            ${events.map((event) => `
              <div class="console-line ${event.tone}">
                <span>${escapeHtml(event.time)}</span>
                <strong>${escapeHtml(event.label)}</strong>
                <small>${escapeHtml(event.detail)}</small>
              </div>
            `).join("") || `<div class="empty">暂无 streaming events。启动 Loop 后这里会显示 executor、checkpoint、cost、failure 和 replay diff。</div>`}
          </div>
        </div>
        <aside class="console-side">
          <div>
            <span>当前 executor</span>
            <strong>${escapeHtml(currentExecutor)}</strong>
            <small>${escapeHtml(loop?.coordination?.mode ?? "serial")} / ${loop?.coordination?.nodes?.length ?? 0} nodes</small>
          </div>
          <div>
            <span>Graph validation</span>
            <strong>${escapeHtml(graph?.validation?.status ?? "未读取")}</strong>
            <small>${escapeHtml(graphCapabilities || "点击读取 Streaming Events 后显示 graph contract")}</small>
          </div>
          <div>
            <span>失败签名</span>
            <strong>${loop?.trace?.failureSignatures?.length ?? 0}</strong>
            <small>${escapeHtml(loop?.trace?.failureSignatures?.[0]?.signature ?? "未发现聚合失败")}</small>
          </div>
          <div>
            <span>人工输入</span>
            <strong>${loop?.status === "WAITING_APPROVAL" ? "需要批准" : "无阻塞"}</strong>
            <small>${escapeHtml(loop?.timeline?.at(-1)?.message ?? "等待运行事件")}</small>
          </div>
          <div class="console-actions">
            <button data-action="load-loop-events" data-id="${escapeHtml(loop?.id ?? "")}" ${loop ? "" : "disabled"}>读取 Streaming Events</button>
            <button data-action="watchdog-loop" data-id="${escapeHtml(loop?.id ?? "")}" ${loop ? "" : "disabled"}>Watchdog</button>
            ${loop?.status === "WAITING_APPROVAL" ? `<button class="primary" data-action="approve-loop" data-id="${escapeHtml(loop.id)}" data-final-gate="${Number(loop.currentIteration ?? 0) >= Number(loop.stopPolicy?.maxIterations ?? Number.POSITIVE_INFINITY) ? "true" : "false"}">批准继续</button>` : `<button class="primary" data-action="resume-loop" data-id="${escapeHtml(loop?.id ?? "")}" ${loop ? "" : "disabled"}>继续 Loop</button>`}
          </div>
        </aside>
      </div>
    </section>
  `;
}

function interactiveConsoleEvents(loop) {
  if (!loop) return [];
  const timeline = (loop.timeline ?? []).slice(-6).map((event) => ({
    time: formatDate(event.timestamp),
    label: event.type,
    detail: event.message,
    tone: /fail|error|blocked/i.test(`${event.type}${event.message}`) ? "bad" : "neutral"
  }));
  const iterations = (loop.iterations ?? []).slice(-3).map((iteration) => ({
    time: `iteration ${iteration.index}`,
    label: iteration.decision,
    detail: iteration.rationale,
    tone: iteration.decision === "CONTINUE" ? "good" : "warn"
  }));
  const failures = (loop.trace?.failureSignatures ?? []).slice(0, 2).map((failure) => ({
    time: `${failure.count}x`,
    label: "failure-group",
    detail: failure.signature,
    tone: "bad"
  }));
  return [...timeline, ...iterations, ...failures].slice(-10);
}

function renderReleaseCockpit() {
  const releaseRun = [...(state.sourceReleaseRuns ?? [])]
    .sort((left, right) => new Date(right.updatedAt ?? right.createdAt ?? 0) - new Date(left.updatedAt ?? left.createdAt ?? 0))[0];
  const matchingLoop = releaseRun ? state.loops.find((loop) => loop.id === releaseRun.loopId) : state.loops[0];
  const closure = matchingLoop?.sourceClosure ?? {};
  const gates = [
    ["code-change", "代码变更"],
    ["push", "推送分支"],
    ["review", "PR/MR 审核"],
    ["merge", "合并"],
    ["deploy", "部署"],
    ["health-ready", "健康探测"]
  ];
  return `
    <section class="release-cockpit" aria-label="Release cockpit">
      <div class="release-cockpit-head">
        <div>
          <span class="eyebrow">Release cockpit</span>
          <h2>源码到生产发布检查清单</h2>
          <p>把 CI、评估、PR/MR、merge、deploy、health 和 rollback 合并为一个可决策视图。</p>
        </div>
        <div class="release-cockpit-status">
          <strong>${escapeHtml(releaseRun?.status ?? closure.closureState ?? "PLANNED")}</strong>
          <span>${escapeHtml(releaseRun?.nextAction ?? "等待 source closure")}</span>
        </div>
      </div>
      <div class="release-checklist">
        ${gates.map(([gate, label]) => {
          const evidence = closure.gateEvidence?.[gate];
          const stage = (releaseRun?.stages ?? []).find((item) => item.gate === gate);
          const status = evidence?.status ?? stage?.status ?? "PENDING";
          return `
            <div class="release-check ${String(status).toLowerCase()}">
              <span>${escapeHtml(status)}</span>
              <strong>${label}</strong>
              <small>${escapeHtml((evidence?.evidence ?? stage?.evidence ?? []).at(-1) ?? gate)}</small>
            </div>
          `;
        }).join("")}
      </div>
      <div class="release-cockpit-actions">
        <button data-page-link="Loop 执行">查看运行图</button>
        <button data-action="load-source-release-run" data-id="${escapeHtml(matchingLoop?.id ?? "")}" ${matchingLoop ? "" : "disabled"}>刷新 Release Run</button>
        <button class="primary" data-action="auto-merge-source-release" data-id="${escapeHtml(matchingLoop?.id ?? "")}" ${matchingLoop && (releaseRun?.review?.status === "PENDING" || releaseRun?.review?.status === "APPROVED") ? "" : "disabled"}>安全自动合并</button>
      </div>
    </section>
  `;
}

function renderEvolutionObservabilityMap() {
  const model = evolutionObservabilityModel();
  return `
    <section class="surface observability-map" aria-label="进化观测图">
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
    ${renderGuidedOnboardingPanel()}
    ${renderFieldEvidenceKitPanel()}
    ${renderProjectDetailWorkspace()}
    ${renderConnectorMarketplaceSettings()}
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
      ${table(["项目", "状态", "成熟度", "等级", "仓库注册", "源码凭据", "CI/CD", "验证", "最近信号", "建议动作", "操作"], state.projects.map((project) => [
        `<strong>${project.name}</strong><span class="subtext">${project.id}</span>`,
        statusPill(project.status),
        scorePill(project.score),
        statusPill(project.level),
        project.repository,
        project.credentials,
        project.cicd ?? "系统默认 Jenkins",
        statusPill(project.validation),
        project.lastSignal,
        project.recommendedAction ?? "等待更多证据",
        project.hasRepository ? `<div class="row-actions"><button data-action="open-source-credential-config" data-id="${escapeHtml(project.id)}">配置凭据</button><button data-action="preflight-source-credentials" data-id="${escapeHtml(project.id)}">验证写回凭据</button></div>` : "-"
      ]))}
    </section>
    ${state.showProjectRegistrationModal ? renderProjectRegistrationModal() : ""}
    ${state.showSourceCredentialModal ? renderSourceCredentialModal() : ""}
  `;
}

function renderFieldEvidenceKitPanel() {
  return `
    <section class="field-evidence-kit" aria-label="EvoPilot Field Evidence Kit">
      <div class="section-title">
        <div>
          <span class="eyebrow">Field Evidence Kit</span>
          <h2>GitHub Demo Project 到 GA Release 样例资产</h2>
          <p>这是 EvoPilot 的正式产品样例入口：预填可复现 GitHub 项目，后续 evidence、Target、Loop 和 release decision 仍然走真实控制面 API。</p>
        </div>
        <span class="pill good">Product Kit / Evidence Output 分离</span>
      </div>
      <div class="field-kit-grid">
        ${fieldEvidenceKitItems().map((item) => `
          <article class="field-kit-card">
            <div>
              <span>${escapeHtml(item.kind)}</span>
              <strong>${escapeHtml(item.title)}</strong>
              <small>${escapeHtml(item.detail)}</small>
            </div>
            <button data-action="${escapeHtml(item.action)}">${escapeHtml(item.cta)}</button>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function fieldEvidenceKitItems() {
  return [
    {
      kind: "Product Kit",
      title: "使用示例 GitHub 项目",
      detail: "预填 repo、默认分支、Jenkins 模式和 Node.js 验证命令；提交后调用 /api/v1/projects。",
      cta: "预填接入表单",
      action: "prefill-github-demo-project"
    },
    {
      kind: "Product Kit",
      title: "导入 sample evidence",
      detail: "为已验证项目写入真实 evidence run，随后可运行 Discovery 形成 Target Backlog。",
      cta: "去发现与目标",
      action: "go-sample-evidence"
    },
    {
      kind: "Evidence Output",
      title: "归档运行证据",
      detail: "截图、loopId、release decision、soak report 是每次运行结果，不写死进产品流程。",
      cta: "查看手册",
      action: "go-field-evidence-manual"
    }
  ];
}

function renderProjectDetailWorkspace() {
  const project = state.projects.find((item) => /已验证|健康/.test(`${item.validation}${item.status}`)) ?? state.projects[0];
  const projectLoops = state.loops.filter((loop) => loop.projectId === project?.id || loop.sourceClosure?.sourceProjectId === project?.id);
  const projectTargets = state.loopOrchestrationTargets.filter((target) => target.projectId === project?.id || !target.projectId);
  const projectReleases = state.sourceReleaseRuns.filter((run) => run.projectId === project?.id || run.loopId && projectLoops.some((loop) => loop.id === run.loopId));
  const projectDatasets = state.evaluationDatasets.filter((dataset) => dataset.projectId === project?.id);
  return `
    <section class="project-workspace" aria-label="Project detail workspace">
      <div class="project-workspace-head">
        <div>
          <span class="eyebrow">Project workspace</span>
          <h2>${escapeHtml(project?.name ?? "等待项目接入")}</h2>
          <p>每个项目都有独立的 Overview、Targets、Runs、Credentials、Deployments 和 History，不再只靠全局项目表格查状态。</p>
        </div>
        <div class="project-workspace-status">
          <strong>${escapeHtml(project?.level ?? "待接入")}</strong>
          <span>${escapeHtml(project?.validation ?? "等待验证")} / ${escapeHtml(project?.status ?? "未接入")}</span>
        </div>
      </div>
      <div class="workspace-tabs" role="tablist" aria-label="项目工作区">
        ${["Overview", "Targets", "Runs", "Credentials", "Deployments", "History"].map((tab, index) => `<button class="${index === 0 ? "active" : ""}" type="button">${tab}</button>`).join("")}
      </div>
      <div class="workspace-grid">
        <div class="workspace-panel">
          <span>Overview</span>
          <strong>${escapeHtml(project?.repository ?? "未注册源码")}</strong>
          <small>${escapeHtml(project?.lastSignal ?? "等待运行证据")}</small>
        </div>
        <div class="workspace-panel">
          <span>Targets</span>
          <strong>${projectTargets.length}</strong>
          <small>${escapeHtml(projectTargets[0]?.nextAction ?? "运行 Discovery 后生成 target")}</small>
        </div>
        <div class="workspace-panel">
          <span>Runs</span>
          <strong>${projectLoops.length}</strong>
          <small>${escapeHtml(projectLoops[0]?.status ?? "暂无 LoopRun")}</small>
        </div>
        <div class="workspace-panel">
          <span>Credentials</span>
          <strong>${escapeHtml(project?.credentials ?? "未配置")}</strong>
          <small>${project?.hasRepository ? "可执行源码写回预检" : "内置画像或本地项目"}</small>
        </div>
        <div class="workspace-panel">
          <span>Deployments</span>
          <strong>${projectReleases.length}</strong>
          <small>${escapeHtml(projectReleases[0]?.status ?? "等待发布闭环")}</small>
        </div>
        <div class="workspace-panel">
          <span>Evidence</span>
          <strong>${projectDatasets.length}</strong>
          <small>Eval Dataset / Regression Suite</small>
        </div>
      </div>
      <div class="workspace-actions">
        ${project?.hasRepository ? `<button data-action="open-source-credential-config" data-id="${escapeHtml(project.id)}">配置源码凭据</button>` : ""}
        ${project?.hasRepository ? `<button data-action="preflight-source-credentials" data-id="${escapeHtml(project.id)}">验证写回凭据</button>` : ""}
        <button data-page-link="发现与目标">查看 Targets</button>
        <button class="primary" data-page-link="Loop 执行">进入 Loop 工作区</button>
      </div>
    </section>
  `;
}

function renderConnectorMarketplaceSettings() {
  const connectors = connectorMarketplaceModel();
  return `
    <section class="connector-marketplace" aria-label="Connector marketplace settings">
      <div class="section-title">
        <div>
          <h2>连接器市场与设置</h2>
          <p>把 GitHub、GitLab、Jenkins、ECS、K8s、LLM 和 Sandbox 统一管理，用户不需要在接入表单、发布面板和环境变量之间来回切换。</p>
        </div>
        <span class="pill ${connectors.filter((item) => item.status === "READY").length >= 3 ? "good" : "warn"}">${connectors.filter((item) => item.status === "READY").length}/${connectors.length} ready</span>
      </div>
      <div class="connector-grid">
        ${connectors.map((connector) => `
          <article class="connector-tile ${connector.status.toLowerCase()}">
            <div>
              <span>${escapeHtml(connector.category)}</span>
              <strong>${escapeHtml(connector.name)}</strong>
              <small>${escapeHtml(connector.detail)}</small>
            </div>
            <b>${escapeHtml(connector.status)}</b>
          </article>
        `).join("")}
      </div>
      <div class="connector-runtime-table">
        ${state.deployConnectors.length === 0 ? renderEmptyState("暂无部署连接器", "可通过 API 注册 HTTP webhook、ECS、K8s 或云发布编排入口。", "注册后会出现在 Connector Marketplace 和 release cockpit 中。") : table(["连接器", "类型", "地址/工作目录", "保护", "凭据", "健康路径", "超时"], state.deployConnectors.map((connector) => [
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
      </div>
    </section>
  `;
}

function connectorMarketplaceModel() {
  const remoteProviders = new Set(state.projects.map((project) => project.repositoryMeta?.provider).filter(Boolean));
  const hasGithub = remoteProviders.has("github");
  const hasGitlab = remoteProviders.has("gitlab");
  const hasLocal = remoteProviders.has("local-git") || state.projects.some((project) => /local-git|本地/.test(`${project.credentials}${project.repository}`));
  const hasJenkins = state.projects.some((project) => /Jenkins/.test(project.cicd ?? "")) || state.pipelines.length > 0;
  const hasDeploy = state.deployConnectors.length > 0;
  return [
    { category: "SCM", name: "GitHub", status: hasGithub ? "READY" : "CONFIGURE", detail: hasGithub ? "PR、tokenRef、source closure 可用" : "注册 GitHub 项目后启用 PR 写回" },
    { category: "SCM", name: "GitLab", status: hasGitlab ? "READY" : "CONFIGURE", detail: hasGitlab ? "MR、私有部署、tokenRef 可用" : "注册 GitLab 项目后启用 MR 写回" },
    { category: "SCM", name: "Local Git", status: hasLocal ? "READY" : "CONFIGURE", detail: hasLocal ? "本地目录验证可用" : "适合本机项目或离线调试" },
    { category: "CI/CD", name: "Jenkins", status: hasJenkins ? "READY" : "CONFIGURE", detail: hasJenkins ? "流水线和 artifact 已接入" : "配置系统默认或项目级 Jenkins" },
    { category: "Deploy", name: "ECS / K8s / Webhook", status: hasDeploy ? "READY" : "CONFIGURE", detail: hasDeploy ? `${state.deployConnectors.length} 个 deploy connector` : "发布 gate 需要部署连接器" },
    { category: "Runtime", name: "LLM Route", status: state.apiStatus === "实时数据" ? "READY" : "CONFIGURE", detail: "用于 discovery、evaluator 和 code upgrade" },
    { category: "Runtime", name: "Sandbox", status: state.loops.some((loop) => loop.sandbox?.runtime) ? "READY" : "CONFIGURE", detail: "Docker/K8s 边界、网络、路径、凭据隔离" }
  ];
}

function renderGuidedOnboardingPanel() {
  const verified = state.projects.filter((project) => /已验证|健康/.test(`${project.validation}${project.status}`)).length;
  const withCredentials = state.projects.filter((project) => project.hasRepository && /已配置|tokenRef|inline token/.test(String(project.credentials))).length;
  const deployReady = state.deployConnectors.filter((connector) => connector.tokenConfigured || connector.type).length;
  const steps = [
    {
      title: "选择接入源",
      detail: "GitHub、GitLab 或本地 Git 目录。",
      state: state.projects.length ? `${state.projects.length} 个项目` : "等待注册",
      ready: state.projects.length > 0
    },
    {
      title: "验证源码凭据",
      detail: "写回 tokenRef、默认分支和只读预检。",
      state: `${withCredentials}/${state.projects.filter((project) => project.hasRepository).length} 已配置`,
      ready: withCredentials > 0 || state.projects.every((project) => !project.hasRepository)
    },
    {
      title: "绑定交付链路",
      detail: "Jenkins、部署连接器、health/ready 探测。",
      state: `${deployReady} 个部署连接器`,
      ready: deployReady > 0
    },
    {
      title: "进入 Loop",
      detail: "验证通过后可进入 discovery、target 和 autopilot。",
      state: `${verified} 个验证通过`,
      ready: verified > 0
    }
  ];
  return `
    <section class="onboarding-guide" aria-label="Project onboarding guide">
      <div class="section-title">
        <div>
          <h2>项目接入向导</h2>
          <p>把仓库、凭据、CI/CD 和部署连接器按真实用户接入顺序拆成四步，降低第一次接入成本。</p>
        </div>
        <button class="primary" data-action="open-project-registration">注册项目</button>
      </div>
      <div class="provider-switcher" aria-label="接入方式">
        ${[
          ["GitHub", "远程仓库、PR、tokenRef"],
          ["GitLab", "远程仓库、MR、私有部署"],
          ["Local Git", "本地目录、离线验证、调试闭环"]
        ].map(([provider, detail]) => `
          <div class="provider-card">
            <strong>${provider}</strong>
            <span>${detail}</span>
          </div>
        `).join("")}
      </div>
      <div class="onboarding-steps">
        ${steps.map((step, index) => `
          <div class="onboarding-step ${step.ready ? "ready" : "pending"}">
            <span>${index + 1}</span>
            <strong>${step.title}</strong>
            <small>${step.detail}</small>
            <b>${step.state}</b>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderSourceCredentialModal() {
  const project = sourceCredentialModalProject();
  if (!project) return "";
  const tokenRef = project.repositoryMeta?.tokenRef ?? "";
  const defaultBranch = project.repositoryMeta?.defaultBranch ?? "main";
  const provider = project.repositoryMeta?.provider ?? "unknown";
  const tokenRefResolved = project.repositoryMeta?.tokenRefResolved;
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="source-credential-title">
        <div class="section-title">
          <div>
            <h2 id="source-credential-title">配置源码写回凭据</h2>
            <p>为 GitHub/GitLab 项目绑定写权限凭据，保存后 EvoPilot 会立即执行只读预检并给出 READY/READ_ONLY/BLOCKED。</p>
          </div>
          <button data-action="close-source-credential-config" aria-label="关闭源码写回凭据弹窗">关闭</button>
        </div>
        <span class="pill ${tokenRefResolved === false ? "warn" : project.repositoryMeta?.credentialsConfigured ? "good" : "warn"} modal-status">${escapeHtml(provider)} / ${escapeHtml(project.credentials)}</span>
        ${state.projectRegistration.message ? `<div class="notice ${state.projectRegistration.status}">${state.projectRegistration.message}</div>` : ""}
        <form class="project-form" id="source-credential-form" data-id="${escapeHtml(project.id)}">
          <label>
            <span>项目</span>
            <input value="${escapeHtml(project.name)} (${escapeHtml(project.id)})" disabled />
          </label>
          <label>
            <span>默认分支</span>
            <input name="defaultBranch" value="${escapeHtml(defaultBranch)}" />
          </label>
          <label class="wide-field">
            <span>Token 环境变量（推荐）</span>
            <input name="tokenRef" placeholder="EVOPILOT_GITHUB_TOKEN" value="${escapeHtml(tokenRef)}" autocomplete="off" />
          </label>
          <label>
            <span>用户名（可选）</span>
            <input name="username" autocomplete="username" />
          </label>
          <label>
            <span>Inline Token（可选）</span>
            <input name="token" type="password" autocomplete="off" placeholder="仅在无法使用 tokenRef 时填写" />
          </label>
          <label class="wide-field checkbox-field">
            <input name="clearInlineToken" type="checkbox" value="true" />
            <span>清除已保存的 inline token/password，仅保留 tokenRef</span>
          </label>
          <label class="wide-field checkbox-field">
            <input name="clearTokenRef" type="checkbox" value="true" />
            <span>清除 tokenRef</span>
          </label>
          <div class="form-actions">
            <button data-action="close-source-credential-config" type="button">取消</button>
            <button type="button" data-action="preflight-source-credentials" data-id="${escapeHtml(project.id)}">只验证</button>
            <button class="primary" type="submit">保存并验证</button>
          </div>
        </form>
      </section>
    </div>
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
    ${renderSampleEvidenceImportPanel()}
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

function renderSampleEvidenceImportPanel() {
  const project = fieldEvidenceProject();
  return `
    <section class="field-evidence-kit compact" aria-label="Sample evidence import">
      <div class="section-title">
        <div>
          <span class="eyebrow">Product Kit</span>
          <h2>Sample Evidence 导入</h2>
          <p>为一个已验证项目导入最小真实信号，用于生成 Eval Dataset、机会点和 Target Backlog；这不是静态 mock，运行结果会进入 evidence run。</p>
        </div>
        <span class="pill ${project ? "good" : "warn"}">${project ? escapeHtml(project.name) : "等待已验证项目"}</span>
      </div>
      <div class="table-actions">
        <button class="primary" data-action="import-sample-evidence" ${project ? "" : "disabled"}>导入 sample evidence</button>
        <button data-action="run-discovery-runtime" ${project ? "" : "disabled"}>运行 Discovery</button>
        <button data-page-link="帮助手册">查看 E2E 教程</button>
      </div>
      <div class="field-kit-note">
        <strong>边界：</strong>样例入口是产品能力；导入后产生的 runId、dataset、target、loopId、release decision 和截图是 Evidence Output，可归档但不写死。
      </div>
    </section>
  `;
}

function fieldEvidenceProject() {
  return state.projects.find((project) => /evopilot-github|demo/.test(project.id) && /已验证|健康|VERIFIED/.test(`${project.validation}${project.status}`))
    ?? state.projects.find((project) => /已验证|健康|VERIFIED/.test(`${project.validation}${project.status}`));
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

function renderPipelines(options = {}) {
  const includeFlowHeader = options.includeFlowHeader !== false;
  const confirmed = state.pipelines;
  const codeUpgrades = state.codeUpgrades;
  if (confirmed.length === 0 && codeUpgrades.length === 0) {
    return `
      ${includeFlowHeader ? renderFlowHeader() : ""}
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
    ${includeFlowHeader ? renderFlowHeader() : ""}
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

function renderGuidedHelpManual() {
  const scenarios = helpManualScenarios();
  const totalSteps = scenarios.reduce((sum, scenario) => sum + scenario.steps.length, 0);
  const categories = new Set(scenarios.map((scenario) => scenario.category));
  return `
    <section class="manual-hero" aria-label="EvoPilot guided help manual">
      <div>
        <span class="eyebrow">Guided manual</span>
        <h2>EvoPilot 端到端主链路手册</h2>
        <p>按真实用户任务组织：从 GitHub demo project 接入生产控制面，到 Discovery、Target、Loop、Autopilot、Release Closure、修复和审计复盘。功能页只作为每一步的落点。</p>
      </div>
      <div class="manual-hero-stats">
        <div><strong>${scenarios.length}</strong><span>主链路场景</span></div>
        <div><strong>${totalSteps}</strong><span>截图步骤</span></div>
        <div><strong>${categories.size}</strong><span>任务类型</span></div>
      </div>
    </section>
    <section class="manual-scene-map" aria-label="手册场景目录">
      ${scenarios.map((scenario, index) => `
        <a class="manual-scene-link" href="#manual-${escapeHtml(scenario.id)}">
          <span>${String(index + 1).padStart(2, "0")}</span>
          <strong>${escapeHtml(scenario.title)}</strong>
          <small>${escapeHtml(scenario.category)} / ${escapeHtml(scenario.outcome)}</small>
        </a>
      `).join("")}
    </section>
    ${scenarios.map(renderHelpManualScenario).join("")}
  `;
}

function renderHelpManualScenario(scenario, index) {
  return `
    <section class="manual-scenario" id="manual-${escapeHtml(scenario.id)}" aria-label="${escapeHtml(scenario.title)}">
      <div class="manual-scenario-head">
        <div>
          <span class="eyebrow">${escapeHtml(scenario.category)} / Scenario ${index + 1}</span>
          <h2>${escapeHtml(scenario.title)}</h2>
          <p>${escapeHtml(scenario.goal)}</p>
        </div>
        <button data-page-link="${escapeHtml(scenario.page)}">打开${escapeHtml(scenario.page)}</button>
      </div>
      <div class="manual-scenario-meta">
        <div><span>适用用户</span><strong>${escapeHtml(scenario.persona)}</strong></div>
        <div><span>前置条件</span><strong>${scenario.prerequisites.map(escapeHtml).join(" / ")}</strong></div>
        <div><span>最终结果</span><strong>${escapeHtml(scenario.outcome)}</strong></div>
      </div>
      <div class="manual-step-list">
        ${scenario.steps.map((step, stepIndex) => renderHelpManualStep(step, stepIndex, scenario.page)).join("")}
      </div>
    </section>
  `;
}

function renderHelpManualStep(step, index, page) {
  return `
    <article class="manual-step">
      <div class="manual-step-copy">
        <span class="manual-step-number">步骤 ${index + 1}</span>
        <h3>${escapeHtml(step.title)}</h3>
        <p>${escapeHtml(step.detail)}</p>
        <div class="manual-step-meta">
          <span>入口：${escapeHtml(step.page ?? page)}</span>
          <span>完成标志：${escapeHtml(step.done)}</span>
          <span>常见阻塞：${escapeHtml(step.blocker)}</span>
        </div>
      </div>
      ${renderManualScreenshot(step)}
    </article>
  `;
}

function renderManualScreenshot(step) {
  return `
    <figure class="manual-screenshot" aria-label="截图：${escapeHtml(step.screenTitle)}">
      <figcaption>
        <span>截图</span>
        <strong>${escapeHtml(step.screenTitle)}</strong>
      </figcaption>
      <div class="manual-browser-frame">
        <div class="manual-browser-top">
          <i></i><i></i><i></i>
          <span>${escapeHtml(step.screenPath)}</span>
        </div>
        <div class="manual-screen-body">
          <div class="manual-screen-sidebar">
            ${step.nav.map((item) => `<b class="${item.active ? "active" : ""}">${escapeHtml(item.label)}</b>`).join("")}
          </div>
          <div class="manual-screen-main">
            <span>${escapeHtml(step.screenEyebrow)}</span>
            <strong>${escapeHtml(step.screenTitle)}</strong>
            <small>${escapeHtml(step.screenNote)}</small>
            <div class="manual-screen-grid">
              ${step.panels.map((panel) => `<em>${escapeHtml(panel)}</em>`).join("")}
            </div>
          </div>
        </div>
      </div>
    </figure>
  `;
}

function helpManualScenarios() {
  const navBase = [
    { label: "工作台" },
    { label: "项目接入" },
    { label: "发现与目标" },
    { label: "Loop 执行" },
    { label: "评估与发布" },
    { label: "历史审计" }
  ];
  const navFor = (active) => navBase.map((item) => ({ ...item, active: item.label === active }));
  return [
    {
      id: "github-demo-ga-release",
      category: "新手主线",
      title: "GitHub Demo Project 到 GA Release",
      page: "项目接入",
      persona: "第一次接入 EvoPilot 的发布负责人",
      prerequisites: ["生产控制面 API Token", "GitHub demo 仓库", "GitHub tokenRef", "Jenkins 或 Deploy connector"],
      outcome: "demo project 形成 source-to-production Loop，并留下 GA Release / GO 证据",
      goal: "把一个 GitHub demo project 从零接入 EvoPilot 生产环境，跑出可审计的 target loop、Release Run、artifacts 和 release decision。",
      steps: [
        manualStep("连接生产控制面", "在顶部生产控制面输入 EvoPilot API Token。没有 Token 时 Dashboard 只能使用示例数据，不能读写真正项目、Target 和 Release Run。", "顶部提示已配置 API Token，Dashboard 使用真实 EvoPilot API", "生产控制面", "工作台", "Production control", "API Token 解锁真实控制面数据", navFor("工作台"), ["API Token", "实时数据", "项目", "Release Runs"], "工作台", "API Token 缺失或权限不足"),
        manualStep("注册 GitHub demo project", "进入项目接入，在 Field Evidence Kit 点击预填接入表单，再提交注册。表单只是产品样例入口，提交后仍然调用真实 /api/v1/projects。", "项目列表出现 GitHub demo project，validation 显示已验证或明确阻塞原因", "Field Evidence Kit", "项目接入", "GitHub onboarding", "Product Kit 预填，真实项目注册 API 落库", navFor("项目接入"), ["Field Evidence Kit", "Provider=GitHub", "Git URL", "验证并注册"], "项目接入", "Git URL 不可达、默认分支错误"),
        manualStep("配置 GitHub 写回 tokenRef", "打开源码写回凭据，保存 GitHub tokenRef 或 inline token，并执行只读预检。生产环境优先使用服务器端 tokenRef。", "凭据状态为 READY，或显示 READ_ONLY/BLOCKED 的具体原因", "源码写回凭据", "项目接入", "SCM credentials", "tokenRef、默认分支、只读预检", navFor("项目接入"), ["Token 环境变量", "只验证", "保存并验证", "READY"], "项目接入", "tokenRef 未解析、token 无写权限"),
        manualStep("确认交付连接器 ready", "在连接器市场确认 GitHub、Jenkins、Deploy、LLM Route、Sandbox 至少覆盖本次 demo 发布所需边界。", "SCM、CI/CD、Deploy、Runtime 边界都能看到 READY 或明确 CONFIGURE", "连接器市场与设置", "项目接入", "Connector readiness", "源码、流水线、部署、运行时统一检查", navFor("项目接入"), ["GitHub", "Jenkins", "Deploy", "LLM Route", "Sandbox"], "项目接入", "缺少 Jenkins 或 Deploy connector"),
        manualStep("导入 sample evidence 并运行 Discovery", "进入发现与目标，先导入 Field Evidence Kit 的 sample evidence，再运行 Discovery。sample evidence 会写入真实 evidence run，而不是前端假数据。", "Target Backlog 出现 demo project 的 target，nextAction 可推进", "Sample Evidence 导入", "发现与目标", "Target discovery", "从项目运行信号生成候选目标", navFor("发现与目标"), ["Sample Evidence", "Discovery", "Candidate", "Target Backlog"], "发现与目标", "没有已验证项目或 API Token 权限不足"),
        manualStep("创建 source-to-production Loop", "进入 Loop 执行，用 Workflow Canvas Editor 选择 source-to-production 模板、release gate、stop policy 和 targetVersion。", "Loop Runtime 出现新 Loop，sourceClosure 带 code-change、push、tag、deploy、health-ready gate", "Workflow Canvas Editor", "Loop 执行", "Source-to-production loop", "typed executor graph 和 release gate 入库", navFor("Loop 执行"), ["Graph template", "Release gate", "targetVersion", "创建闭环 Loop"], "Loop 执行", "release gate 或 targetVersion 缺失"),
        manualStep("启动 Autopilot 推进目标", "在 Autopilot cockpit 或 Target Backlog 点击一键自动驾驶。Autopilot 会推进 bounded loop，遇到 human gate 或外部阻塞时停下。", "Autopilot run 写入阶段证据；必要时提示 configure-source-credentials 或等待批准", "Autopilot cockpit", "工作台", "Autopilot run", "Connect、Discover、Loop、Evaluate、Release", navFor("工作台"), ["启动一键自动驾驶", "Human gate", "External blocker", "阶段证据"], "工作台", "凭据、审批、预算或策略门禁阻塞"),
        manualStep("执行 Release Closure", "进入评估与发布，刷新 Release Run，按策略批准 Release、合并 Release 或执行安全自动合并。", "Release Run 晋级到 promoted/succeeded，或留下 policy blocker 和 nextAction", "Release Closure Runtime", "评估与发布", "Release closure", "审批、策略、merge、post-merge deploy", navFor("评估与发布"), ["刷新 Release Run", "批准 Release", "合并 Release", "安全自动合并"], "评估与发布", "policy blocker、健康探测失败、merge 冲突"),
        manualStep("复盘 GA Release 证据", "进入历史审计，打开历史详情，确认 release decision、release artifacts、source release artifacts、audit 和验证证据齐全。", "能够用历史详情说明该 demo project 是否达到 GA Release / GO", "历史详情", "历史审计", "GA evidence", "release decision 与 artifacts 可复盘", navFor("历史审计"), ["Release Decision", "Artifacts", "Audit", "验证证据"], "历史审计", "只有 CI 成功但没有 release decision")
      ]
    },
    {
      id: "signals-to-code-upgrade",
      category: "日常进化",
      title: "已有项目从运行信号到代码升级",
      page: "发现与目标",
      persona: "负责日常演进的项目维护者",
      prerequisites: ["项目已接入", "有 Trace/Eval/生产/人工信号", "代码升级连接器可用"],
      outcome: "运行信号转成机会点、进化方案、code upgrade 和 CI/CD 证据",
      goal: "用户不从注册项目开始，而是从已有项目的运行证据出发，完成一次可评审、可验证的代码升级。",
      steps: [
        manualStep("读取项目运行证据", "进入发现与目标，查看 Discovery Runtime、Eval Dataset、Regression Suite 和运行证据来源。", "能看到触发来源、触发时间、IP、证据摘要或评测集", "运行证据", "发现与目标", "Evidence intake", "Trace、Eval、生产信号进入机会点链路", navFor("发现与目标"), ["触发来源", "触发时间", "IP", "证据摘要"], "发现与目标", "证据不足或样本未标注"),
        manualStep("形成机会点", "勾选相关评测集，点击形成机会点，生成带目标、影响、置信度和归因的候选演进。", "机会点进入待确认或可排期状态", "形成机会点", "发现与目标", "Opportunity draft", "评测集变成可执行机会点", navFor("发现与目标"), ["Eval Dataset", "Regression Suite", "形成机会点", "置信度"], "发现与目标", "评测集和目标不匹配"),
        manualStep("评审 Markdown 方案", "打开查看方案，阅读问题、决策、替代方案、影响和验证契约，必要时编辑 Markdown 方案正文。", "方案被确认，进入交付执行入口", "编辑进化方案", "发现与目标", "Review plan", "Markdown 方案正文和验证契约", navFor("发现与目标"), ["查看方案", "编辑进化方案", "提交方案修改", "确认进化"], "发现与目标", "方案缺少验证命令或范围过大"),
        manualStep("触发代码升级", "确认进化后选择马上开始或保存排期。EvoPilot 会启动 code upgrade run 并记录白盒执行事件。", "代码升级过程出现 execution-transcript 和 changed files", "代码升级过程", "评估与发布", "Code upgrade", "白盒执行、文件变更、验证命令", navFor("评估与发布"), ["根据方案进行代码升级", "白盒执行", "查看原始执行事件", "execution-transcript"], "评估与发布", "allowed paths 或连接器权限不足"),
        manualStep("检查 CI/CD 阶段", "在 CI/CD 阶段视图查看单元测试、冒烟测试、功能闭环测试和质量报告。", "每个阶段有状态、耗时和失败原因", "CI/CD 阶段视图", "评估与发布", "Delivery pipeline", "代码升级进入流水线验证", navFor("评估与发布"), ["单元测试", "冒烟测试", "功能闭环测试", "质量报告"], "评估与发布", "测试失败或 Jenkins Job 配置错误")
      ]
    },
    {
      id: "target-backlog-autopilot",
      category: "自动驾驶",
      title: "Target Backlog 到 Autopilot 自动驾驶",
      page: "发现与目标",
      persona: "持续演进负责人",
      prerequisites: ["Target Backlog 已有目标", "项目凭据和连接器就绪", "允许 human gate 暂停"],
      outcome: "target 被推进到 Loop Runtime，并通过 Autopilot 形成阶段证据",
      goal: "从已经存在的 Target Backlog 出发，用户只处理 nextAction、human gate 和 external blocker，不重复描述上下文。",
      steps: [
        manualStep("筛选下一目标", "进入 Target Loop Backlog，按 Sandbox、Context、Harness、Loop 层查看目标、验收标准、证据和 nextAction。", "能识别下一目标和 stop condition", "Target Loop Backlog", "发现与目标", "Backlog", "按层推进 Codex target loop", navFor("发现与目标"), ["Target", "层", "下一步", "验收"], "发现与目标", "目标缺少验收标准"),
        manualStep("推进下一 Target", "点击推进下一 Target，让 EvoPilot 创建或推进 Codex-backed target loop，保留 acceptance criteria 和上下文。", "Loop Runtime 显示最新轮次、证据和 stop condition", "推进下一 Target", "发现与目标", "Advance target", "创建或推进目标循环", navFor("发现与目标"), ["推进下一 Target", "Loop Runtime", "证据", "stop condition"], "发现与目标", "目标已被其他 worker claim"),
        manualStep("启动一键自动驾驶", "对目标点击自动驾驶，观察返回的 Autopilot run：阶段状态、nextAction、external blocker 和 releaseRun。", "Autopilot 状态写入页面，source release run 同步到发布页", "一键自动驾驶", "发现与目标", "Autopilot", "bounded loop 不绕过 human gate", navFor("发现与目标"), ["自动驾驶", "nextAction", "External blocker", "releaseRun"], "发现与目标", "没有 human gate 授权或缺少源码凭据"),
        manualStep("处理人工待办", "回到工作台人工待办中心，处理待补凭据、待批准、待修复或待发布动作。", "待办队列对应阻塞项被清理或转入下一步", "人工待办中心", "工作台", "Human action", "集中处理 Autopilot 阻塞", navFor("工作台"), ["待补凭据", "待批准", "待修复", "待发布"], "工作台", "审批人不明确或缺少权限")
      ]
    },
    {
      id: "failed-release-repair",
      category: "生产修复",
      title: "失败 Release Run 修复闭环",
      page: "评估与发布",
      persona: "发布负责人或值班运维",
      prerequisites: ["存在 FAILED/HEALTH_FAILED/ROLLED_BACK/stale release run", "修复权限", "部署连接器可用"],
      outcome: "失败发布进入 repair candidate，修复后从队列移除并写回 promoted 或明确失败原因",
      goal: "当 source release 失败时，用户从 repair queue 出发，完成诊断、修复、deploy finalizer 和复验。",
      steps: [
        manualStep("刷新修复队列", "进入评估与发布，刷新 Release Run Auto Repair Workbench，查看 failed/stale release run 的来源、原因和建议。", "修复队列列出候选项和建议动作", "Release Run Auto Repair Workbench", "评估与发布", "Repair queue", "失败发布进入默认修复队列", navFor("评估与发布"), ["FAILED", "HEALTH_FAILED", "原因", "建议"], "评估与发布", "release run 没有进入候选队列"),
        manualStep("执行单项或批量修复", "对具体 release run 点击修复，或使用一键修复队列。EvoPilot 会复用 source-closure path，避免重复副作用。", "修复结果显示成功、失败或跳过数量", "一键修复队列", "评估与发布", "Repair execution", "复用 source-to-production closure", navFor("评估与发布"), ["修复", "一键修复队列", "duplicate guard", "结果"], "评估与发布", "工作区脏、merge 冲突、健康检查失败"),
        manualStep("检查 Deploy Finalizer", "查看 Deploy Finalizer Workbench，确认 post-merge deploy、health-ready、rollback 或 finalizer 状态。", "post-merge deploy 有明确成功、失败或回滚证据", "Deploy Finalizer Workbench", "评估与发布", "Post merge deploy", "部署闭环与健康探测", navFor("评估与发布"), ["Post Merge Deploy", "health-ready", "rollback", "finalizer"], "评估与发布", "部署连接器超时或健康路径错误"),
        manualStep("复盘修复结果", "打开历史审计和 Release Artifacts，确认修复后的 release run 是否 promoted，失败时保留 blocker 证据。", "审计记录能解释失败原因或晋级证据", "历史详情", "历史审计", "Repair audit", "修复闭环可审计", navFor("历史审计"), ["Artifacts", "Audit", "Promoted", "Blocker"], "历史审计", "修复成功但审计证据缺失")
      ]
    },
    {
      id: "runtime-recovery",
      category: "运维恢复",
      title: "长任务中断后的 Worker / Replay / Sandbox / Trace 恢复",
      page: "Loop 执行",
      persona: "Loop 运维和值班工程师",
      prerequisites: ["存在运行中或阻塞 Loop", "可读取 worker queue 和 trace", "允许 replay 或 watchdog"],
      outcome: "卡住的 Loop 被定位到 worker、context、sandbox、trace 或 release gate，并继续或形成人工阻塞",
      goal: "当长任务中断或状态不清时，用 Dashboard 的 runtime workbench 找到当前阻塞点并恢复。",
      steps: [
        manualStep("查看 Source-to-GA 动态链路定位阻塞", "打开 Source-to-GA 本体链路图，选择当前 loopId，用 Git Project、Discovery、Target、Executor Graph、Worker/Sandbox、Human Gate、Source Closure、CI/CD Deploy、Release Decision 和 GA Release 判断卡点。", "能定位当前节点、阻塞类型、关联 API 和下一动作", "Source-to-GA 本体链路图", "Loop 执行", "Dynamic ontology map", "同一张动态图根据所选 Loop Run 实时展示从源码到 GA 的进度", navFor("Loop 执行"), ["Loop 选择器", "当前节点高亮", "Node Inspector", "实时事件流"], "Loop 执行", "状态数据未刷新或 release decision 缺失"),
        manualStep("Claim worker 或执行 Watchdog", "在 Worker Queue Workbench 中 claim 下一 Loop，或触发 Watchdog 检查 expired lease、crash-resume 和 side-effect guard。", "worker lease 更新或 watchdog 给出恢复动作", "Worker Queue Workbench", "Loop 执行", "Worker recovery", "claimable loop 和 lease 过期恢复", navFor("Loop 执行"), ["Claim 下一 Loop", "Watchdog", "Lease", "side-effect guard"], "Loop 执行", "已有 worker 持有有效 lease"),
        manualStep("执行 Context Time Travel Replay", "在 Context Time Travel Workbench 选择 checkpoint，编辑 context JSON 并 Replay 生成 Diff。", "出现 replay diff，Loop 从指定 checkpoint 继续", "Context Time Travel Workbench", "Loop 执行", "Replay", "修改上下文后继续执行", navFor("Loop 执行"), ["Checkpoint", "Replay 并生成 Diff", "contextPatch", "diff"], "Loop 执行", "context JSON 无效或 checkpoint 不存在"),
        manualStep("验证 Sandbox 和 Trace", "用 Sandbox Boundary Workbench 验证 Docker/K8s 边界，用 Streaming Trace Workbench 读取 trace tree 和 events。", "sandbox proof、trace tree、events 都有可读证据", "Sandbox Boundary Workbench", "Loop 执行", "Runtime proof", "沙箱边界、trace tree 和事件流", navFor("Loop 执行"), ["验证 Sandbox Proof", "刷新 Trace Tree", "/events", "failure-group"], "Loop 执行", "沙箱权限不足或事件流断开")
      ]
    },
    {
      id: "evopilot-self-governance",
      category: "自举治理",
      title: "EvoPilot 接入 EvoPilot 的受控自演进",
      page: "项目接入",
      persona: "EvoPilot 管理员",
      prerequisites: ["EvoPilot 仓库路径或远程仓库", "明确允许的改动范围", "独立审批人"],
      outcome: "EvoPilot 作为目标项目被治理，而不是运行中的 controller 直接自改",
      goal: "把当前 EvoPilot 仓库作为被治理项目接入自身控制面，形成受控 self-evolution loop，并明确自举边界。",
      steps: [
        manualStep("注册 EvoPilot 仓库为目标项目", "在项目接入中选择 Local Git 或 GitHub，把 EvoPilot 仓库作为目标项目接入，并配置默认分支和凭据。", "项目工作区显示 EvoPilot 项目和源码凭据状态", "Project workspace", "项目接入", "Self target", "EvoPilot 作为被治理项目接入", navFor("项目接入"), ["Local Git", "GitHub", "默认分支", "Credentials"], "项目接入", "把 controller 运行目录和目标改动范围混淆"),
        manualStep("限定自演进范围", "在方案或 Loop 创建时明确 allowed paths、validation commands、rollback metadata 和人工审批边界。", "Loop 的上下文包含允许路径、验证命令和 rollback 信息", "Workflow Canvas Editor", "Loop 执行", "Governed self-loop", "自演进必须受限并可回滚", navFor("Loop 执行"), ["allowed paths", "validation commands", "rollback", "human gate"], "Loop 执行", "范围过大或没有审批人"),
        manualStep("执行自举 Loop", "启动 source-to-production loop，但在 human gate、release policy 和 safe merge 前必须停下等待审批。", "Loop Runtime 显示 WAITING_APPROVAL 或 release policy 状态", "Loop Runtime", "Loop 执行", "Self-evolution loop", "不绕过治理的自举执行", navFor("Loop 执行"), ["WAITING_APPROVAL", "Release policy", "safe merge", "evidence"], "Loop 执行", "自动合并绕过审批"),
        manualStep("审计自举结果", "在历史审计中确认自举变更的 release decision、artifact、audit 和回滚证据。", "能区分目标项目自演进和控制器进程自修改", "历史详情", "历史审计", "Self audit", "自举 Loop 可审计", navFor("历史审计"), ["release decision", "artifact", "audit", "rollback"], "历史审计", "只看到文件变更，没有 release decision")
      ]
    },
    {
      id: "release-evidence-review",
      category: "审计复盘",
      title: "发布后证据复盘",
      page: "历史审计",
      persona: "审计者、发布负责人或治理负责人",
      prerequisites: ["至少完成一次 Loop 或 Release Run", "可读取历史、artifacts、audit"],
      outcome: "能够判断一次交付是否真正达到 GO / CONDITIONAL-GO / NO-GO，而不是只看健康检查",
      goal: "从历史记录、release artifacts、source release artifacts、audit 和 evaluation evidence 复盘发布是否可信。",
      steps: [
        manualStep("打开历史详情", "在历史记录中查看项目、完成时间、结果、验证证据、产物、关联评测集和流水线。", "可以复盘一次完整演进的证据链", "历史详情", "历史审计", "Audit detail", "完成记录和审计证据", navFor("历史审计"), ["完成时间", "结果", "验证证据", "产物"], "历史审计", "历史记录缺少 artifact"),
        manualStep("对照 release decision", "回到评估与发布，确认 Release Cockpit、Release Closure Runtime 和 release decision 是否给出 GO / CONDITIONAL-GO / NO-GO。", "发布结论来自 release decision，而不是单次 CI 成功", "Release cockpit", "评估与发布", "Release decision", "产品原生发布判断", navFor("评估与发布"), ["GO", "CONDITIONAL-GO", "NO-GO", "release decision"], "评估与发布", "只有健康检查，没有发布判断"),
        manualStep("检查 artifacts 和 audit", "查看 Release Artifacts、Source Release Artifacts、audit、评测集和流水线证据是否能闭合。", "证据能覆盖代码变更、测试、部署、健康探测和审批", "Source Release Artifacts", "评估与发布", "Artifacts", "发布证据闭环", navFor("评估与发布"), ["Release Artifacts", "Source Release Artifacts", "Audit", "评测集"], "评估与发布", "artifact 链路断裂或审批记录缺失"),
        manualStep("回跳补齐缺失证据", "如果发现缺口，从历史审计回到发现与目标、Loop 执行或评估与发布补齐证据或重新执行修复。", "缺失证据进入对应工作台处理", "历史审计回放", "历史审计", "Evidence gap", "从复盘回到执行工作台", navFor("历史审计"), ["发现与目标", "Loop 执行", "评估与发布", "修复"], "历史审计", "无法定位缺失证据归属")
      ]
    }
  ];
}

function manualStep(title, detail, done, screenTitle, screenPath, screenEyebrow, screenNote, nav, panels, page, blocker) {
  return { title, detail, done, screenTitle, screenPath, screenEyebrow, screenNote, nav, panels, page, blocker };
}

function renderLoops() {
  const loops = state.loops;
  const store = state.loopStore;
  return `
    <div class="loop-command-grid">
      ${renderLoopOrchestrationPanel()}
      ${renderLoopTargetBacklogPanel()}
    </div>
    <div class="loop-operations-grid">
      ${renderLoopWorkerQueuePanel()}
      ${renderSourceReleaseRepairQueuePanel()}
      ${renderSourceReleaseDeployFinalizersPanel()}
    </div>
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
      ${renderLoopRunTable(loops)}
    </section>
    ${loops.slice(0, 3).map(renderLoopDetail).join("")}
  `;
}

function renderLoopRunTable(loops) {
  return state.isLoading && loops.length === 0
    ? renderLoadingSkeleton("正在读取 Loop runtime、worker lease 与 release evidence")
    : loops.length === 0
      ? renderEmptyState("暂无 LoopRun", "生产模式请先输入 API Token；命令入口、IM、定时任务或 API 创建后会显示在这里。", "创建闭环 Loop 后会在这里展示 runtime、trace 和源码发布证据。")
      : table(["操作", "Loop", "状态", "轮次", "源码闭环", "执行图", "Sandbox", "Worker", "Trace"], loops.map((loop) => [
          renderLoopActions(loop),
          `<strong>${loop.objective}</strong><span class="subtext">${loop.id}</span>`,
          statusPill(loop.status),
          `${loop.currentIteration}/${loop.stopPolicy?.maxIterations ?? "-"}`,
          renderLoopSourceClosure(loop),
          `${loop.executorGraphId}<span class="subtext">${loop.coordination?.mode ?? "serial"}</span>`,
          `${loop.sandbox?.runtime ?? "host"}<span class="subtext">${loop.sandbox?.network ?? "restricted"} / ${loop.sandbox?.credentialScope ?? "loop"}</span>`,
          loop.workerLease ? `${loop.workerLease.workerId}<span class="subtext">到期 ${formatDate(loop.workerLease.expiresAt)}</span>` : "未持有",
          `${loop.trace?.executorStepCount ?? 0} steps / ${loop.trace?.failedStepCount ?? 0} failed<span class="subtext">${loop.timeline?.at(-1)?.message ?? "等待启动"}</span>`
        ]));
}

function renderLoopTargetRuntimePanel() {
  const runtime = state.loopTargetRuntime;
  const inboxOpen = (runtime.memoryInbox ?? []).filter((item) => ["NEW", "ACCEPTED"].includes(item.status)).length;
  return `
    <section class="card target-runtime-panel">
      <div class="section-title">
        <div>
          <h2>Target Runtime</h2>
          <p>六个 target loop 的通用产品对象：discovery、handoff、evaluator、schedule、memory inbox 和 guardrail。</p>
        </div>
        <span class="pill ${runtime.discoveryCandidates.length ? "good" : "warn"}">${runtime.discoveryCandidates.length} candidates</span>
      </div>
      <div class="backlog-summary">
        <div><span>Discovery</span><strong>${runtime.discoveryCandidates.length}</strong><small>候选 target</small></div>
        <div><span>Handoff</span><strong>${runtime.findingHandoffs.length}</strong><small>隔离 workspace</small></div>
        <div><span>Evaluator</span><strong>${runtime.adversarialEvaluations.length}</strong><small>独立评估</small></div>
        <div><span>Schedules</span><strong>${runtime.recurringSchedules.length}</strong><small>周期 loop</small></div>
        <div><span>Inbox</span><strong>${inboxOpen}</strong><small>待处理记忆</small></div>
        <div><span>Guardrails</span><strong>${runtime.guardrailEvaluations.length}</strong><small>预算判断</small></div>
      </div>
      <div class="table-actions">
        <button class="primary" data-action="run-discovery-runtime">运行 Discovery</button>
        <button data-action="create-recurring-loop-schedule">创建每日 Target Schedule</button>
      </div>
      <div class="target-runtime-lists">
        <div>
          <h3>Discovery candidates</h3>
          ${(runtime.discoveryCandidates ?? []).slice(0, 6).map((item) => `
            <div class="runtime-row">
              <strong>${escapeHtml(item.title ?? item.targetId)}</strong>
              <span>${escapeHtml(item.projectId)} / ${escapeHtml(item.source ?? "manual")} / ${Math.round(Number(item.confidence ?? 0) * 100)}%</span>
            </div>
          `).join("") || renderEmptyState("暂无 discovery candidate", "点击运行 Discovery 后会从项目、trace、evaluation 和生产信号生成候选 target。")}
        </div>
        <div>
          <h3>Memory inbox</h3>
          ${(runtime.memoryInbox ?? []).slice(0, 6).map((item) => `
            <div class="runtime-row">
              <strong>${escapeHtml(item.title ?? item.id)}</strong>
              <span>${escapeHtml(item.status)} / ${escapeHtml(item.targetId ?? item.type ?? "-")}</span>
            </div>
          `).join("") || renderEmptyState("暂无 memory inbox", "Discovery、评估失败和发布经验会进入 inbox，随后可转为 target loop。")}
        </div>
      </div>
    </section>
  `;
}

function renderReleaseGuardrailPanel() {
  const runtime = state.loopTargetRuntime;
  const latestEvaluation = runtime.adversarialEvaluations[0];
  const latestGuardrail = runtime.guardrailEvaluations[0];
  const firstLoop = state.loops[0];
  return `
    <section class="card release-guardrail-panel">
      <div class="section-title">
        <div>
          <h2>评估与发布门禁</h2>
          <p>发布前先看独立 evaluator 和预算判断，避免把 executor 进度误判为产品可发布。</p>
        </div>
        <span class="pill ${latestGuardrail?.status === "BLOCK" || latestEvaluation?.status === "BLOCK" ? "warn" : "good"}">${latestGuardrail?.releaseJudgment ?? latestEvaluation?.status ?? "等待评估"}</span>
      </div>
      <div class="dashboard-stats">
        <div><span>Adversarial</span><strong>${latestEvaluation?.status ?? "-"}</strong><small>${latestEvaluation?.missingEvidence?.[0] ?? "尚未运行"}</small></div>
        <div><span>Guardrail</span><strong>${latestGuardrail?.status ?? "-"}</strong><small>${latestGuardrail?.releaseJudgment ?? "尚未评估"}</small></div>
        <div><span>Release Runs</span><strong>${state.sourceReleaseRuns.length}</strong><small>source closure records</small></div>
        <div><span>Repair Queue</span><strong>${state.sourceReleaseRepairCandidates.length}</strong><small>failed/stale release</small></div>
      </div>
      <div class="table-actions">
        <button data-action="run-adversarial-evaluation" data-id="${escapeHtml(firstLoop?.id ?? "")}" ${firstLoop ? "" : "disabled"}>运行独立评估</button>
        <button class="primary" data-action="evaluate-loop-guardrail" data-id="${escapeHtml(firstLoop?.id ?? "")}" ${firstLoop ? "" : "disabled"}>评估预算门禁</button>
      </div>
    </section>
  `;
}

function renderSourceReleaseRepairQueuePanel() {
  const candidates = state.sourceReleaseRepairCandidates ?? [];
  const latest = candidates.filter((candidate) => candidate.latestForLoop).length;
  const repaired = candidates.filter((candidate) => candidate.repaired).length;
  return `
    <section class="card">
      <div class="section-title">
        <div>
          <h2>Release Run Auto Repair Workbench</h2>
          <p>发现 stale 或 failed source release run，生成可修复队列，并从 Dashboard 触发批量修复闭环。</p>
        </div>
        <span class="pill ${candidates.length ? "warn" : "good"}">${candidates.length} candidates</span>
      </div>
      <div class="dashboard-stats">
        <div><span>Repair Queue</span><strong>${candidates.length}</strong><small>/api/v1/source-release-runs/repair-candidates</small></div>
        <div><span>Latest Failed</span><strong>${latest}</strong><small>当前最新失败</small></div>
        <div><span>Already Repaired</span><strong>${repaired}</strong><small>默认不重复执行</small></div>
        <div><span>Providers</span><strong>${new Set(candidates.map((candidate) => candidate.provider)).size}</strong><small>GitHub / GitLab / local</small></div>
      </div>
      <div class="table-actions">
        <button data-action="refresh-source-release-repair-candidates">刷新修复队列</button>
        <button data-action="repair-source-release-candidates" ${candidates.length ? "" : "disabled"}>一键修复队列</button>
      </div>
      ${state.isLoading && candidates.length === 0 ? renderLoadingSkeleton("正在同步 release repair candidates") : candidates.length === 0 ? renderEmptyState("暂无待修复 Release Run", "失败 run 修复完成后会从默认队列中移除。", "当 source release 进入 FAILED、HEALTH_FAILED 或 ROLLED_BACK 时会自动进入这里。") : table(["操作", "Loop", "状态", "来源", "原因", "建议"], candidates.slice(0, 8).map((candidate) => [
        `<button data-action="repair-source-release-candidate" data-run-id="${escapeHtml(candidate.runId)}">修复</button>`,
        `<strong>${escapeHtml(candidate.loopId)}</strong><span class="subtext">${escapeHtml(candidate.runId)}</span>`,
        statusPill(candidate.status),
        `${escapeHtml(candidate.provider)}<span class="subtext">${candidate.latestForLoop ? "latest failed" : `superseded by ${escapeHtml(candidate.supersededByRunId ?? "newer run")}`}</span>`,
        `<span class="subtext">${escapeHtml(candidate.reason ?? "failed source release run")}</span>`,
        `${escapeHtml(candidate.suggestedAction ?? "repair-source-closure")}<span class="subtext">${Math.floor((candidate.ageSeconds ?? 0) / 60)} min old</span>`
      ]))}
    </section>
  `;
}

function renderSourceReleaseDeployFinalizersPanel() {
  const finalizers = state.sourceReleaseDeployFinalizers ?? [];
  const counts = finalizers.reduce((acc, finalizer) => {
    acc[finalizer.status] = (acc[finalizer.status] ?? 0) + 1;
    return acc;
  }, {});
  return `
    <section class="card">
      <div class="section-title">
        <div>
          <h2>Deploy Finalizer Workbench</h2>
          <p>自部署或 post-merge deploy 期间服务重启后，自动补写 release run 与 loop 终态。</p>
        </div>
        <span class="pill ${counts.PENDING ? "warn" : "good"}">${counts.PENDING ?? 0} pending</span>
      </div>
      <div class="dashboard-stats">
        <div><span>Finalizers</span><strong>${finalizers.length}</strong><small>/api/v1/source-release-deploy-finalizers</small></div>
        <div><span>Succeeded</span><strong>${counts.SUCCEEDED ?? 0}</strong><small>已完成恢复</small></div>
        <div><span>Failed</span><strong>${counts.FAILED ?? 0}</strong><small>需人工处理</small></div>
        <div><span>Pending</span><strong>${counts.PENDING ?? 0}</strong><small>等待 reconcile</small></div>
      </div>
      ${state.isLoading && finalizers.length === 0 ? renderLoadingSkeleton("正在检查 post-merge deploy finalizers") : finalizers.length === 0 ? renderEmptyState("暂无 deploy finalizer", "只有 post-merge deploy 被服务重启打断或完成后才会生成记录。", "正常发布完成时这里保持为空；异常恢复会显示 connector、attempt 和最后证据。") : table(["Loop", "状态", "连接器", "尝试", "最后证据"], finalizers.slice(0, 8).map((finalizer) => [
        `<strong>${escapeHtml(finalizer.loopId)}</strong><span class="subtext">${escapeHtml(finalizer.releaseRunId ?? finalizer.id)}</span>`,
        statusPill(finalizer.status),
        finalizer.deployConnectorId,
        `${finalizer.attempts ?? 0}/${finalizer.maxAttempts ?? 0}`,
        `<span class="subtext">${escapeHtml((finalizer.evidence ?? []).at(-1) ?? finalizer.lastError ?? "等待执行")}</span>`
      ]))}
    </section>
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
      ${state.isLoading && queue.length === 0 ? renderLoadingSkeleton("正在读取 durable worker queue") : queue.length === 0 ? renderEmptyState("暂无 worker queue 数据", "生产模式请先输入 API Token。", "连接后这里会显示 claimable loop、lease 过期状态和 side-effect guard。") : table(["Loop", "状态", "轮次", "Lease", "下一步", "副作用保护"], queue.map((item) => [
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
  const model = loopBacklogModel(targets);
  return `
    <section class="card">
      <div class="section-title">
        <div>
          <h2>Target Loop Backlog</h2>
          <p>按 Sandbox、Context、Harness、Loop 四层持续推进 Codex target loop，记录 next action、stop condition 和独立证据。</p>
        </div>
        <span class="pill ${targets.some((target) => target.status === "RUNNING") ? "good" : "warn"}">${targets.length || 0} 个 Target</span>
      </div>
      <div class="backlog-summary" aria-label="Target backlog 摘要">
        ${model.cards.map((card) => `
          <div>
            <span>${card.label}</span>
            <strong>${card.value}</strong>
            <small>${card.detail}</small>
          </div>
        `).join("")}
      </div>
      <div class="table-actions">
        <button class="primary" data-action="advance-loop-target" data-target-id="">推进下一 Target</button>
        <button data-action="autopilot-loop-target" data-target-id="">一键自动驾驶</button>
      </div>
      ${state.isLoading && targets.length === 0 ? renderLoadingSkeleton("正在加载 target loop backlog") : targets.length === 0 ? renderEmptyState("暂无 target backlog", "生产模式请先输入 API Token。", "接入 GitHub/GitLab 或本地目录项目后，目标会按 Sandbox、Context、Harness、Loop 四层进入这里。") : table(["Target", "层", "状态", "下一步", "验收", "证据", "操作"], targets.map((target) => [
        `<strong>${escapeHtml(target.title)}</strong><span class="subtext">${escapeHtml(target.id)}${target.loopId ? ` / ${escapeHtml(target.loopId)}` : ""}</span>`,
        escapeHtml(target.layer),
        statusPill(target.status),
        escapeHtml(target.nextAction),
        (target.acceptanceCriteria ?? []).map(escapeHtml).join("<br />"),
        [
          ...(target.externalBlocker ? [
            `<strong>外部阻塞：${escapeHtml(target.externalBlocker.type)}</strong>`,
            `恢复动作：${escapeHtml(target.externalBlocker.recovery?.dashboardAction ?? target.externalBlocker.nextAction ?? "-")}`,
            ...(target.externalBlocker.blockers ?? []).map((blocker) => `blocker=${escapeHtml(blocker)}`)
          ] : []),
          ...(target.evidence ?? []).map(escapeHtml)
        ].join("<br />"),
        `<button data-action="advance-loop-target" data-target-id="${escapeHtml(target.id)}">推进</button><button data-action="autopilot-loop-target" data-target-id="${escapeHtml(target.id)}">自动驾驶</button>`
      ]))}
      ${(state.loopAutopilotRuns ?? []).slice(-1).map((run) => `
        ${renderStatusNotice(run.status === "SUCCEEDED" ? "good" : "warn", `Autopilot ${run.status}`, `${escapeHtml(run.target?.id ?? "unknown")} / next ${escapeHtml(run.nextAction ?? "unknown")}<br />${run.externalBlocker ? `外部阻塞：${escapeHtml(run.externalBlocker.type)} / ${escapeHtml(run.externalBlocker.recovery?.dashboardAction ?? run.externalBlocker.nextAction ?? "-")}<br />` : ""}${(run.stages ?? []).map((stage) => `${escapeHtml(stage.id)}=${escapeHtml(stage.status)} (${escapeHtml(stage.detail)})`).join("；")}`)}
      `).join("")}
    </section>
  `;
}

function loopBacklogModel(targets) {
  const byStatus = countBy(targets, (target) => target.status ?? "UNKNOWN");
  const byLayer = countBy(targets, (target) => target.layer ?? "unknown");
  const blocked = targets.filter((target) => target.externalBlocker).length;
  const nextTarget = targets.find((target) => target.status === "RUNNING") ?? targets.find((target) => target.status === "PENDING") ?? targets[0];
  return {
    cards: [
      { label: "待推进", value: byStatus.PENDING ?? 0, detail: "等待 advance/autopilot" },
      { label: "运行中", value: byStatus.RUNNING ?? 0, detail: "正在执行 target loop" },
      { label: "外部阻塞", value: blocked, detail: blocked ? "需要人工恢复动作" : "无阻塞" },
      { label: "下一目标", value: nextTarget?.layer ?? "-", detail: nextTarget?.id ?? "暂无 target" },
      { label: "覆盖层", value: Object.keys(byLayer).length, detail: Object.entries(byLayer).map(([layer, count]) => `${layer}:${count}`).join(" / ") || "无" }
    ]
  };
}

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function normalizeLoopTargetRuntime(value = {}) {
  return {
    discoveryCandidates: Array.isArray(value.discoveryCandidates) ? value.discoveryCandidates : [],
    findingHandoffs: Array.isArray(value.findingHandoffs) ? value.findingHandoffs : [],
    adversarialEvaluations: Array.isArray(value.adversarialEvaluations) ? value.adversarialEvaluations : [],
    recurringSchedules: Array.isArray(value.recurringSchedules) ? value.recurringSchedules : [],
    memoryInbox: Array.isArray(value.memoryInbox) ? value.memoryInbox : [],
    guardrailEvaluations: Array.isArray(value.guardrailEvaluations) ? value.guardrailEvaluations : []
  };
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
  const buttons = [`<button data-loop-detail-id="${encodedId}">详情</button>`];
  if (loop.status === "WAITING_APPROVAL") {
    buttons.push(`<button class="primary" data-action="approve-loop" data-id="${encodedId}" data-final-gate="${finalGate ? "true" : "false"}">${finalGate ? "批准完成" : "批准并继续"}</button>`);
    buttons.push(`<button data-action="resume-loop" data-id="${encodedId}">继续</button>`);
  } else if (loop.status === "PENDING") {
    buttons.push(`<button class="primary" data-action="start-loop" data-id="${encodedId}">启动</button>`);
  } else if (loop.status === "RUNNING" || loop.status === "BLOCKED") {
    buttons.push(`<button class="primary" data-action="resume-loop" data-id="${encodedId}">继续</button>`);
  }
  if (["github", "gitlab"].includes(loop.sourceClosure?.repositoryProvider) && loop.sourceClosure?.closureState !== "PROMOTED") {
    buttons.push(`<button data-action="preflight-source-closure" data-id="${encodedId}">预检闭环</button>`);
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
  const deployFinalizers = sourceReleaseDeployFinalizersForLoop(loop.id);
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
      ${renderReleaseInspector(loop, releaseRun, deployFinalizers)}
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

function renderReleaseInspector(loop, releaseRun, deployFinalizers) {
  const closure = loop.sourceClosure ?? {};
  const artifacts = closure.artifacts ?? {};
  const gateEvidence = closure.gateEvidence ?? {};
  const artifactRows = [
    ["Release Run", releaseRun.id],
    ["Source", releaseRun.sourceRef?.sourceUrl ?? releaseRun.sourceRef?.sourceRoot ?? closure.sourceUrl ?? closure.sourceRoot],
    ["Branch", releaseRun.sourceRef?.releaseBranch ?? artifacts.branch],
    ["Commit", releaseRun.artifacts?.commitSha ?? artifacts.commitSha],
    ["PR/MR", releaseRun.artifacts?.pullRequestUrl ?? releaseRun.artifacts?.mergeRequestUrl ?? artifacts.pullRequestUrl ?? artifacts.mergeRequestUrl],
    ["Tag", releaseRun.artifacts?.tag ?? artifacts.tag],
    ["Review Status", releaseRun.review?.status],
    ["Policy", releaseRun.policy ? `${releaseRun.policy.status}${releaseRun.policy.autoMerge ? " / auto" : ""}` : undefined],
    ["Policy Blocker", releaseRun.policy?.blockers?.join("; ")],
    ["Merge Commit", releaseRun.review?.mergeCommitSha ?? artifacts.mergeCommitSha],
    ["Post Merge Deploy", releaseRun.postMergeDeployment?.status],
    ["Deployment", releaseRun.artifacts?.deploymentUrl ?? artifacts.deploymentUrl ?? artifacts.deployStatusUrl],
    ["Probe", releaseRun.artifacts?.healthUrl ?? artifacts.healthUrl ?? artifacts.readyUrl]
  ].filter((row) => row[1]);
  return `
    <section class="release-inspector" aria-label="Release flow detail inspector">
      <div class="release-inspector-main">
        <div class="section-title compact">
          <div>
            <h3>Release Closure Runtime</h3>
            <p>Source Closure Workbench、Release Artifacts、Source Release Artifacts 和 Post Merge Deploy 统一在这里追踪。</p>
          </div>
          <span class="pill ${releaseRun.status === "SUCCEEDED" || releaseRun.status === "PROMOTED" ? "good" : releaseRun.status === "FAILED" || releaseRun.status === "HEALTH_FAILED" ? "bad" : "warn"}">${escapeHtml(releaseRun.status ?? "PLANNED")}</span>
        </div>
        <div class="release-flow">
          <div class="timeline-item release-runtime-card">
            <span>${escapeHtml(releaseRun.status ?? "PLANNED")}</span>
            <strong>${escapeHtml(releaseRun.provider ?? closure.repositoryProvider ?? "unknown")} / ${escapeHtml(releaseRun.releaseStrategy ?? closure.releaseStrategy ?? "none")}</strong>
            <small>next ${escapeHtml(releaseRun.nextAction ?? "write-source")} / ${(releaseRun.capabilities ?? []).map(escapeHtml).join(", ") || "capability pending"}</small>
          </div>
          ${(closure.requiredGates ?? []).map((gate) => renderGateEvidence(gate, gateEvidence[gate])).join("") || renderEmptyState("当前 Loop 未声明源码闭环 gate", "执行闭环前需要声明 write-source、review、merge、deploy、health-ready 等 gate。")}
          ${(releaseRun.stages ?? []).map((stage) => `
            <div class="timeline-item">
              <span>${escapeHtml(stage.status ?? "PENDING")}</span>
              <strong>${escapeHtml(stage.label ?? stage.gate)}</strong>
              <small>${escapeHtml((stage.evidence ?? []).at(-1) ?? "waiting")}</small>
            </div>
          `).join("")}
        </div>
        <div class="table-actions release-actions">
          <button data-action="load-source-release-run" data-id="${escapeHtml(loop.id)}">刷新 Release Run</button>
          <button data-action="approve-source-release" data-id="${escapeHtml(loop.id)}" ${releaseRun.review?.status === "PENDING" ? "" : "disabled"}>批准 Release</button>
          <button data-action="merge-source-release" data-id="${escapeHtml(loop.id)}" ${releaseRun.review?.status === "APPROVED" ? "" : "disabled"}>合并 Release</button>
          <button data-action="auto-merge-source-release" data-id="${escapeHtml(loop.id)}" ${releaseRun.review?.status === "PENDING" || releaseRun.review?.status === "APPROVED" ? "" : "disabled"}>安全自动合并</button>
          <button data-action="repair-source-release-run" data-id="${escapeHtml(loop.id)}" data-run-id="${escapeHtml(releaseRun.id ?? "")}" ${releaseRun.id && ["FAILED", "HEALTH_FAILED", "ROLLED_BACK"].includes(releaseRun.status) ? "" : "disabled"}>修复 Release Run</button>
        </div>
      </div>
      <aside class="release-inspector-side" aria-label="Release evidence artifacts">
        <h3>Source Release Artifacts</h3>
        <div class="artifact-list">
          ${artifactRows.map(([label, value]) => `
            <div class="artifact-row">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(String(value))}</strong>
              <small>source-release-closure-runtime</small>
            </div>
          `).join("") || renderEmptyState("等待发布运行记录", "执行源码闭环后会生成分支、提交、PR/MR、部署和健康探测证据。")}
        </div>
        <h3>Deploy Finalizers</h3>
        <div class="artifact-list">
          ${deployFinalizers.map((finalizer) => `
            <div class="artifact-row">
              <span>${escapeHtml(finalizer.status ?? "PENDING")}</span>
              <strong>${escapeHtml(finalizer.deployConnectorId ?? "unknown")} / ${escapeHtml(String(finalizer.attempts ?? 0))} attempts</strong>
              <small>${escapeHtml((finalizer.evidence ?? []).at(-1) ?? finalizer.lastError ?? "waiting")}</small>
            </div>
          `).join("") || renderEmptyState("当前 Loop 暂无 deploy finalizer 记录", "Post Merge Deploy 被服务重启打断或完成后才会生成 finalizer。")}
        </div>
      </aside>
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

function sourceReleaseDeployFinalizersForLoop(loopId) {
  return (state.sourceReleaseDeployFinalizers ?? [])
    .filter((finalizer) => finalizer.loopId === loopId)
    .sort((left, right) => new Date(right.updatedAt ?? right.createdAt ?? 0) - new Date(left.updatedAt ?? left.createdAt ?? 0));
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
    <div class="table-shell" tabindex="0" aria-label="可横向滚动的数据表">
      <table>
        <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${row.map((cell, index) => `<td data-label="${escapeHtml(headers[index] ?? "")}"><div class="table-cell">${cell}</div></td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderEmptyState(titleText, detail, meta = "") {
  return `
    <div class="empty-state" role="status">
      <strong>${escapeHtml(titleText)}</strong>
      <span>${escapeHtml(detail)}</span>
      ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
    </div>
  `;
}

function renderStatusNotice(tone, titleText, detail) {
  return `
    <div class="notice ${escapeHtml(tone)}">
      <strong>${escapeHtml(titleText)}</strong>
      <span>${detail}</span>
    </div>
  `;
}

function renderLoadingSkeleton(label) {
  return `
    <div class="skeleton-panel" role="status" aria-live="polite">
      <div>
        <strong>${escapeHtml(label)}</strong>
        <span>正在连接 EvoPilot 控制面</span>
      </div>
      <i></i>
      <i></i>
      <i></i>
    </div>
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
    GO: "good",
    PASS: "good",
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
    "NO-GO": "bad",
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
  bindLoopWorkspace();
  bindPageLinks();
  bindProjectRegistration();
  bindEvaluationDatasets();
  bindOpportunityActions();
  bindLoopActions();
  bindSourceToGaMap();
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
      if (button.dataset.loopWorkspaceView === "advanced") state.loopWorkspaceView = "advanced";
      setActivePage(button.dataset.pageLink);
      render();
    });
  }
  for (const button of content.querySelectorAll('[data-action="go-sample-evidence"]')) {
    button.addEventListener("click", () => {
      setActivePage("发现与目标");
      render();
    });
  }
  for (const button of content.querySelectorAll('[data-action="go-field-evidence-manual"]')) {
    button.addEventListener("click", () => {
      setActivePage("帮助手册");
      render();
    });
  }
  for (const button of content.querySelectorAll('[data-action="show-release-advanced"]')) {
    button.addEventListener("click", () => {
      state.releaseWorkspaceView = "advanced";
      setActivePage("评估与发布");
      render();
    });
  }
  for (const button of content.querySelectorAll('[data-action="prefill-github-demo-project"]')) {
    button.addEventListener("click", () => {
      state.showProjectRegistrationModal = true;
      state.projectRegistration = { status: "good", message: "已预填 Field Evidence Kit 的 GitHub demo project。提交后会调用真实项目注册 API。" };
      render();
      const form = content.querySelector("#project-registration-form");
      if (form) fillProjectRegistrationDemo(form);
    });
  }
}

function bindLoopWorkspace() {
  for (const button of content.querySelectorAll("[data-loop-workspace-view]")) {
    button.addEventListener("click", () => {
      state.loopWorkspaceView = button.dataset.loopWorkspaceView ?? "overview";
      if (state.loopWorkspaceView === "advanced") state.active = "Loop 执行";
      render();
    });
  }
  for (const button of content.querySelectorAll("[data-loop-detail-id]")) {
    button.addEventListener("click", () => {
      state.sourceToGaLoopId = button.dataset.loopDetailId ?? "";
      state.sourceToGaNodeId = "executor";
      state.loopWorkspaceView = "detail";
      render();
    });
  }
}

function bindSourceToGaMap() {
  for (const button of content.querySelectorAll("[data-source-ga-loop-id]")) {
    button.addEventListener("click", () => {
      state.sourceToGaLoopId = button.dataset.sourceGaLoopId ?? "";
      state.sourceToGaNodeId = "executor";
      state.loopWorkspaceView = "detail";
      render();
    });
  }
  for (const button of content.querySelectorAll("[data-source-ga-node-id]")) {
    button.addEventListener("click", () => {
      state.sourceToGaNodeId = button.dataset.sourceGaNodeId ?? "executor";
      render();
    });
  }
  for (const button of content.querySelectorAll("[data-source-ga-refresh]")) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      state.authNotice = "正在刷新 Source-to-GA 动态链路图。";
      await loadLoops();
      render();
    });
  }
}

function bindFlowHeader() {
  for (const button of content.querySelectorAll(".flow-card, .command-action")) {
    button.addEventListener("click", () => {
      setActivePage(button.dataset.page);
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
        setActivePage("流水线");
        await loadPipelines();
        await loadSummary();
      }
      if (action === "schedule-evolution") {
        const scheduledAt = content.querySelector("#schedule-at")?.value;
        await confirmOpportunity(id, { scheduled: true, scheduledAt });
        setActivePage("流水线");
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
  const workflowEditorForm = content.querySelector("#workflow-canvas-editor-form");
  if (workflowEditorForm) {
    workflowEditorForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(workflowEditorForm);
      state.authNotice = "";
      try {
        const routingMode = String(formData.get("routingMode") || "policy-gated");
        const releaseGate = String(formData.get("releaseGate") || "source-closure");
        const objective = String(formData.get("objective") || "").trim()
          || `Dashboard workflow canvas: ${routingMode}, ${releaseGate}`;
        await postJson("/api/v1/loop-orchestration/instantiate", {
          projectId: String(formData.get("projectId") || "evopilot"),
          presetId: String(formData.get("presetId") || "source-release-closure"),
          objective,
          deployConnectorId: state.deployConnectors.length === 1 ? state.deployConnectors[0].id : undefined,
          controlPlaneUrl: window.location.origin,
          context: {
            workflowCanvasEditor: {
              routingMode,
              releaseGate,
              humanGate: routingMode === "human-first",
              visualEditorVersion: "dashboard-workflow-canvas/v1"
            }
          }
        });
        state.authNotice = "已从 Workflow Canvas Editor 创建 Loop，运行控制台会显示最新执行状态。";
        await loadLoops();
      } catch (error) {
        state.authNotice = `Workflow Canvas 创建失败：${error.message}`;
      } finally {
        render();
      }
    });
  }
  for (const button of content.querySelectorAll('[data-action="run-discovery-runtime"]')) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      state.authNotice = "";
      try {
        const response = await postJson("/api/v1/loop-target-runtime/discovery/run", {
          projectId: state.projects[0]?.id
        });
        state.authNotice = `Discovery Runtime 已运行：${response.data?.length ?? 0} 个候选。`;
        await loadLoops();
      } catch (error) {
        state.authNotice = `Discovery Runtime 失败：${error.message}`;
      } finally {
        render();
      }
    });
  }
  for (const button of content.querySelectorAll('[data-action="create-recurring-loop-schedule"]')) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      state.authNotice = "";
      try {
        const response = await postJson("/api/v1/loop-target-runtime/schedules", {
          projectId: state.projects[0]?.id ?? "evopilot",
          targetId: "discovery-skill-runtime",
          cadence: "daily",
          maxBudgetUsd: 3,
          triggerRules: ["new-evidence", "release-window-open", "budget-pass"]
        });
        state.authNotice = `Target Schedule 已创建：${response.data?.id ?? "schedule"} / ${response.data?.nextRunAt ?? "next run pending"}。`;
        await loadLoops();
      } catch (error) {
        state.authNotice = `Target Schedule 创建失败：${error.message}`;
      } finally {
        render();
      }
    });
  }
  for (const button of content.querySelectorAll('[data-action="run-adversarial-evaluation"]')) {
    button.addEventListener("click", async () => {
      const loopId = button.dataset.id;
      if (!loopId) return;
      button.disabled = true;
      state.authNotice = "";
      try {
        const response = await postJson("/api/v1/loop-target-runtime/adversarial-evaluations", {
          loopId,
          targetId: "adversarial-evaluator-agent"
        });
        state.authNotice = `独立评估完成：${response.data?.status ?? "UNKNOWN"}。`;
      } catch (error) {
        const evaluation = error.responseBody?.data;
        state.authNotice = evaluation?.schema === "evopilot-adversarial-evaluation/v1"
          ? `独立评估阻断：${evaluation.status} / ${(evaluation.missingEvidence ?? []).join(", ") || "missing evidence"}。`
          : `独立评估失败：${error.message}`;
      } finally {
        await loadLoops();
        render();
      }
    });
  }
  for (const button of content.querySelectorAll('[data-action="evaluate-loop-guardrail"]')) {
    button.addEventListener("click", async () => {
      const loopId = button.dataset.id;
      if (!loopId) return;
      button.disabled = true;
      state.authNotice = "";
      try {
        const response = await postJson(`/api/v1/loop-target-runtime/guardrails/${encodeURIComponent(loopId)}/evaluate`, {
          maxCostUsd: 5,
          maxTokens: 100000,
          maxDurationSeconds: 86400,
          maxChangedFiles: 20,
          minConfidence: 0.6
        });
        state.authNotice = `预算门禁完成：${response.data?.status ?? "UNKNOWN"} / ${response.data?.releaseJudgment ?? "UNKNOWN"}。`;
      } catch (error) {
        const evaluation = error.responseBody?.data;
        state.authNotice = evaluation?.schema === "evopilot-budget-judgment-guardrail/v1"
          ? `预算门禁阻断：${evaluation.releaseJudgment} / ${(evaluation.blockers ?? []).join(", ") || "policy block"}。`
          : `预算门禁失败：${error.message}`;
      } finally {
        await loadLoops();
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
  for (const button of content.querySelectorAll('[data-action="autopilot-loop-target"]')) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      state.authNotice = "";
      try {
        const response = await postJson("/api/v1/loop-orchestration/autopilot", {
          targetId: button.dataset.targetId || undefined,
          projectId: state.projects[0]?.id ?? "evopilot",
          deployConnectorId: state.deployConnectors.length === 1 ? state.deployConnectors[0].id : undefined,
          controlPlaneUrl: window.location.origin,
          runUntilSourceClosure: true,
          autoMerge: true,
          postMergeDeploy: true
        });
        const run = response.data;
        state.loopAutopilotRuns = [...(state.loopAutopilotRuns ?? []), run].filter(Boolean).slice(-5);
        if (run.releaseRun) {
          state.sourceReleaseRuns = [
            ...(state.sourceReleaseRuns ?? []).filter((item) => item.id !== run.releaseRun.id),
            run.releaseRun
          ];
        }
        state.authNotice = `Autopilot ${run.status}：next ${run.nextAction}，${run.stages?.length ?? 0} 个阶段已写入证据。`;
        await loadLoops();
        await loadSummary();
      } catch (error) {
        const run = error.responseBody?.data?.schema === "evopilot-loop-orchestration-autopilot/v1" ? error.responseBody.data : undefined;
        if (run) {
          state.loopAutopilotRuns = [...(state.loopAutopilotRuns ?? []), run].filter(Boolean).slice(-5);
          if (run.releaseRun) {
            state.sourceReleaseRuns = [
              ...(state.sourceReleaseRuns ?? []).filter((item) => item.id !== run.releaseRun.id),
              run.releaseRun
            ];
          }
          await loadLoops();
        }
        state.authNotice = `Autopilot 执行失败：${error.message}`;
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
  for (const button of content.querySelectorAll('[data-action="refresh-source-release-repair-candidates"], [data-action="repair-source-release-candidates"], [data-action="repair-source-release-candidate"]')) {
    button.addEventListener("click", async () => {
      const action = button.dataset.action;
      button.disabled = true;
      state.authNotice = "";
      try {
        if (action === "refresh-source-release-repair-candidates") {
          const response = await apiFetch("/api/v1/source-release-runs/repair-candidates");
          if (!response.ok) throw new Error(`Release Run 修复队列接口状态 ${response.status}`);
          const { data } = await response.json();
          state.sourceReleaseRepairCandidates = Array.isArray(data) ? data : [];
          state.authNotice = `Release Run 修复队列已刷新：${state.sourceReleaseRepairCandidates.length} 个候选。`;
        } else {
          const runId = button.dataset.runId;
          const response = await postJson("/api/v1/source-release-runs/repair-candidates/repair", {
            runIds: runId ? [runId] : undefined,
            limit: runId ? 1 : 10
          });
          const result = response.data;
          state.authNotice = `Release Run 修复队列完成：${result?.repaired?.length ?? 0} 成功 / ${result?.failed?.length ?? 0} 失败 / ${result?.skipped?.length ?? 0} 跳过。`;
          await loadLoops();
        }
      } catch (error) {
        state.authNotice = `Release Run 修复队列操作失败：${error.message}`;
      } finally {
        render();
      }
    });
  }
  for (const button of content.querySelectorAll('[data-action="verify-sandbox-proof"], [data-action="load-trace-tree"], [data-action="load-loop-events"], [data-action="load-source-release-run"], [data-action="approve-source-release"], [data-action="merge-source-release"], [data-action="auto-merge-source-release"], [data-action="repair-source-release-run"]')) {
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
          const [eventsResponse, graphResponse] = await Promise.all([
            apiFetch(`/api/v1/loops/${encodeURIComponent(id)}/events`),
            apiFetch(`/api/v1/loops/${encodeURIComponent(id)}/executor-graph`)
          ]);
          if (!eventsResponse.ok) throw new Error(`Loop Events 接口状态 ${eventsResponse.status}`);
          const { data } = await eventsResponse.json();
          if (graphResponse.ok) {
            const { data: graphData } = await graphResponse.json();
            state.loopGraphContracts = { ...state.loopGraphContracts, [id]: graphData };
          }
          const graph = state.loopGraphContracts[id]?.executorGraph;
          state.authNotice = `Streaming Events 已读取：${Array.isArray(data) ? data.length : 0} 条事件；Graph ${graph?.validation?.status ?? "UNKNOWN"} / ${graph?.nodes?.length ?? 0} nodes。`;
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
        if (action === "approve-source-release" || action === "merge-source-release" || action === "auto-merge-source-release") {
          const response = await postJson(`/api/v1/loops/${encodeURIComponent(id)}/source-closure/review-decision`, {
            action: action === "approve-source-release" ? "approve" : action === "auto-merge-source-release" ? "auto-merge" : "merge",
            autoMerge: action === "auto-merge-source-release"
          });
          const run = response.data?.sourceReleaseRun;
          if (run) {
            state.sourceReleaseRuns = [
              ...(state.sourceReleaseRuns ?? []).filter((item) => item.id !== run.id),
              run
            ];
          }
          state.authNotice = action === "approve-source-release"
            ? `Release 已批准：${run?.review?.status ?? "UNKNOWN"}。`
            : action === "auto-merge-source-release"
              ? `Release 安全自动合并：${run?.policy?.status ?? "UNKNOWN"} / ${run?.review?.mergeCommitSha ?? "merge commit pending"}。`
              : `Release 已合并：${run?.review?.mergeCommitSha ?? "merge commit pending"}。`;
        }
        if (action === "repair-source-release-run") {
          const loop = state.loops.find((item) => item.id === id);
          const runId = button.dataset.runId;
          const version = loop?.sourceClosure?.targetVersion;
          const deployConnectorId = loop?.sourceClosure?.deploymentConnectorId ?? (state.deployConnectors.length === 1 ? state.deployConnectors[0].id : undefined);
          const response = await postJson(`/api/v1/loops/${encodeURIComponent(id)}/source-release-runs/${encodeURIComponent(runId)}/repair`, {
            deployConnectorId,
            tagName: version ? `v${String(version).replace(/^v/, "")}` : undefined,
            files: [{
              path: `docs/evopilot-source-closures/${id}-repair.md`,
              content: [
                `# EvoPilot Source Release Repair: ${id}`,
                "",
                `Original release run: ${runId}`,
                `Objective: ${loop?.objective ?? id}`,
                `Target version: ${version ?? "unspecified"}`,
                `Generated at: ${new Date().toISOString()}`,
                "",
                "This file records Dashboard-triggered stale release run repair evidence."
              ].join("\n")
            }]
          });
          const run = response.data?.releaseRun;
          if (run) {
            state.sourceReleaseRuns = [
              ...(state.sourceReleaseRuns ?? []).filter((item) => item.id !== run.id),
              run
            ];
          }
          state.authNotice = `Release Run 修复完成：${run?.status ?? "UNKNOWN"} / ${response.data?.action ?? "repair"}。`;
        }
        await loadLoops();
      } catch (error) {
        state.authNotice = `Loop Workbench 操作失败：${error.message}`;
      } finally {
        render();
      }
    });
  }
  for (const button of content.querySelectorAll('[data-action="approve-loop"], [data-action="start-loop"], [data-action="resume-loop"], [data-action="watchdog-loop"], [data-action="preflight-source-closure"], [data-action="execute-source-closure"]')) {
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
        if (action === "preflight-source-closure") {
          const result = await postJson(`/api/v1/loops/${encodeURIComponent(id)}/source-closure/preflight`, {});
          state.authNotice = `源码闭环预检 ${result.data?.status ?? "UNKNOWN"}：${result.data?.nextAction ?? "unknown"}，${result.data?.checks?.length ?? 0} 项检查。`;
        }
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
  for (const button of content.querySelectorAll('[data-action="import-sample-evidence"]')) {
    button.addEventListener("click", async () => {
      const project = fieldEvidenceProject();
      if (!project) return;
      button.disabled = true;
      state.authNotice = "";
      try {
        const response = await postJson("/api/v1/evidence/events", sampleEvidencePayload(project));
        state.authNotice = `Sample evidence 已导入：${response.data?.run?.id ?? "run"} / ${response.data?.ingestedEvents ?? 0} events。`;
        await loadSummary();
        await loadEvaluationDatasets();
        await loadLoops();
      } catch (error) {
        state.authNotice = `Sample evidence 导入失败：${error.message}`;
      } finally {
        render();
      }
    });
  }
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
    setActivePage("机会点");
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
  for (const button of content.querySelectorAll('[data-action="open-source-credential-config"]')) {
    button.addEventListener("click", () => {
      state.projectRegistration = { message: "", status: "" };
      state.sourceCredentialProjectId = button.dataset.id;
      state.showSourceCredentialModal = true;
      render();
    });
  }
  for (const button of content.querySelectorAll('[data-action="close-source-credential-config"]')) {
    button.addEventListener("click", () => {
      state.showSourceCredentialModal = false;
      state.sourceCredentialProjectId = "";
      render();
    });
  }
  for (const button of content.querySelectorAll('[data-action="preflight-source-credentials"]')) {
    button.addEventListener("click", async () => {
      const id = button.dataset.id;
      button.disabled = true;
      state.projectRegistration = { status: "warn", message: `正在验证 ${id} 的源码写回凭据...` };
      render();
      try {
        const result = await postJson(`/api/v1/projects/${encodeURIComponent(id)}/source-credentials/preflight`, {});
        state.projectRegistration = {
          status: "good",
          message: sourceCredentialReadinessMessage(result.data)
        };
      } catch (error) {
        state.projectRegistration = {
          status: "bad",
          message: `源码写回凭据未就绪：${error.message}`
        };
      } finally {
        await loadProjects();
        render();
      }
    });
  }
  const sourceCredentialForm = content.querySelector("#source-credential-form");
  if (sourceCredentialForm) {
    sourceCredentialForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const id = sourceCredentialForm.dataset.id;
      const submit = sourceCredentialForm.querySelector("button[type='submit']");
      submit.disabled = true;
      state.projectRegistration = { status: "warn", message: `正在保存 ${id} 的源码写回凭据并验证...` };
      render();
      try {
        const result = await postJson(`/api/v1/projects/${encodeURIComponent(id)}/source-credentials`, sourceCredentialPayload(new FormData(sourceCredentialForm)));
        state.projectRegistration = {
          status: "good",
          message: sourceCredentialReadinessMessage(result.data?.readiness)
        };
        state.showSourceCredentialModal = false;
        state.sourceCredentialProjectId = "";
      } catch (error) {
        const readiness = error.responseBody?.data?.readiness;
        state.projectRegistration = {
          status: readiness ? "warn" : "bad",
          message: readiness
            ? `凭据已保存但仍未就绪：${sourceCredentialReadinessMessage(readiness)}`
            : `源码写回凭据保存失败：${error.message}`
        };
        state.showSourceCredentialModal = Boolean(readiness);
      } finally {
        await loadProjects();
        render();
      }
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

function sourceCredentialPayload(formData) {
  const value = (name) => String(formData.get(name) ?? "").trim();
  return {
    defaultBranch: value("defaultBranch") || undefined,
    username: value("username") || undefined,
    token: value("token") || undefined,
    tokenRef: value("tokenRef") || undefined,
    clearInlineToken: formData.get("clearInlineToken") === "true",
    clearPassword: formData.get("clearInlineToken") === "true",
    clearTokenRef: formData.get("clearTokenRef") === "true"
  };
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

function fillProjectRegistrationDemo(form) {
  const set = (name, value) => {
    const field = form.elements.namedItem(name);
    if (field) field.value = value;
  };
  set("id", "evopilot-github-demo-node-api");
  set("name", "EvoPilot GitHub Demo Node API");
  set("provider", "github");
  set("gitUrl", "https://github.com/yeliang-wang/evopilot-demo-node-api.git");
  set("root", "");
  set("defaultBranch", "main");
  set("tokenRef", "EVOPILOT_GITHUB_TOKEN");
  set("cicdMode", "system-default");
  set("jenkinsJob", "evopilot-demo-node-api");
  set("runtimeLanguage", "node");
  set("unitCommands", "npm test");
  set("serviceStartCommand", "npm start -- --host 127.0.0.1 --port 49318");
  set("servicePort", "49318");
  set("serviceHealthPath", "/health");
  set("smokeCommands", "npm run smoke");
  set("functionalCommands", "npm run test:e2e");
}

function sampleEvidencePayload(project) {
  const now = new Date().toISOString();
  return {
    projectId: project.id,
    now,
    events: [
      {
        id: `field-kit-latency-${Date.now()}`,
        type: "runtime.latency",
        source: "field-evidence-kit",
        severity: "HIGH",
        message: "Demo checkout API p95 latency exceeds GA release budget.",
        traceId: "field-kit-trace-001",
        module: "checkout-api",
        attributes: { durationMs: 3420, thresholdMs: 3000, route: "/api/checkout", evidenceKind: "product-kit-sample" }
      },
      {
        id: `field-kit-tool-failure-${Date.now()}`,
        type: "tool.failure",
        source: "field-evidence-kit",
        severity: "MEDIUM",
        message: "Release smoke test reports intermittent health-ready failure.",
        traceId: "field-kit-trace-002",
        module: "release-smoke",
        attributes: { failureGroup: "health-ready", retryable: true, evidenceKind: "product-kit-sample" }
      },
      {
        id: `field-kit-release-risk-${Date.now()}`,
        type: "release.risk",
        source: "field-evidence-kit",
        severity: "HIGH",
        message: "GA release requires source closure, deploy evidence, and product-native release decision.",
        traceId: "field-kit-trace-003",
        module: "release-governance",
        attributes: { missingEvidence: "release-decision", targetVersion: "field-kit-ga-demo", evidenceKind: "product-kit-sample" }
      }
    ],
    files: ["src/checkout.ts", "tests/checkout.test.ts", "docs/release-evidence.md"]
  };
}

function sourceCredentialModalProject() {
  return state.projects.find((project) => project.id === state.sourceCredentialProjectId);
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
        credentials: project.repository ? sourceCredentialLabel(project.repository) : "无需凭据",
        repositoryMeta: project.repository,
        hasRepository: Boolean(project.repository),
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
  const parsed = text ? safeJsonParse(text) : {};
  if (!response.ok) {
    const error = new Error(summarizeApiError(parsed, response.status));
    error.responseBody = parsed;
    error.status = response.status;
    throw error;
  }
  return parsed;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text };
  }
}

function summarizeApiError(body, status) {
  if (body?.data?.schema === "evopilot-loop-orchestration-autopilot/v1") return summarizeAutopilotRun(body.data);
  if (body?.data?.schema === "evopilot-source-closure-preflight/v1") return summarizeSourceClosurePreflight(body.data);
  if (body?.data?.schema === "evopilot-source-credential-readiness/v1") return sourceCredentialReadinessMessage(body.data);
  const detail = body?.detail ?? body?.error ?? body?.message;
  return detail ? `${detail}` : `HTTP ${status}`;
}

function summarizeAutopilotRun(run) {
  const failedStage = (run.stages ?? []).find((stage) => stage.status === "FAILED" || stage.status === "BLOCKED");
  if (run.externalBlocker) {
    const blocker = run.externalBlocker.blockers?.[0] ?? run.externalBlocker.type;
    return `Autopilot ${run.status}：${run.externalBlocker.nextAction} / ${run.externalBlocker.recovery?.dashboardAction ?? "外部阻塞"} / ${blocker}`;
  }
  const failedEvidence = failedStage?.evidence?.find((item) => item.startsWith("failedEvidence=") || item.startsWith("error="));
  const releaseState = run.releaseRun?.status ?? run.loop?.sourceClosure?.closureState ?? "UNKNOWN";
  const detail = failedEvidence ? failedEvidence.replace(/^failedEvidence=|^error=/, "") : failedStage?.detail;
  return `Autopilot ${run.status}：${failedStage?.id ?? run.nextAction} / source ${releaseState}${detail ? ` / ${detail}` : ""}`;
}

function summarizeSourceClosurePreflight(preflight) {
  const blocker = preflight.blockers?.[0] ?? "unknown";
  return `Source closure preflight ${preflight.status}：${preflight.nextAction} / ${blocker}`;
}

function sourceCredentialLabel(repository) {
  if (!repository) return "无需凭据";
  const mode = repository.credentialMode ?? (repository.credentialsConfigured ? "configured" : "none");
  if (repository.provider === "local-git") return "local-git 无需 token";
  if (mode === "tokenRef") return repository.tokenRefResolved === false
    ? `tokenRef 未解析：${repository.tokenRef ?? "-"}`
    : `tokenRef 已配置：${repository.tokenRef ?? "-"}`;
  if (mode === "inline-token" || mode === "password") return "已配置写回凭据";
  return "未配置写回凭据";
}

function sourceCredentialReadinessMessage(readiness) {
  const blocker = readiness?.blockers?.[0] ?? "none";
  return `源码写回凭据 ${readiness?.status ?? "UNKNOWN"}：${readiness?.nextAction ?? "unknown"} / ${blocker}`;
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
    const repairCandidatesResponse = await apiFetch("/api/v1/source-release-runs/repair-candidates");
    if (repairCandidatesResponse.ok) {
      const { data: repairCandidateData } = await repairCandidatesResponse.json();
      state.sourceReleaseRepairCandidates = Array.isArray(repairCandidateData) ? repairCandidateData : [];
    }
    const finalizersResponse = await apiFetch("/api/v1/source-release-deploy-finalizers");
    if (finalizersResponse.ok) {
      const { data: finalizerData } = await finalizersResponse.json();
      state.sourceReleaseDeployFinalizers = Array.isArray(finalizerData) ? finalizerData : [];
    }
    const targetRuntimeResponse = await apiFetch("/api/v1/loop-target-runtime/summary");
    if (targetRuntimeResponse.ok) {
      const { data: runtimeData } = await targetRuntimeResponse.json();
      state.loopTargetRuntime = normalizeLoopTargetRuntime(runtimeData);
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
    state.sourceReleaseRepairCandidates = [];
    state.sourceReleaseDeployFinalizers = [];
    state.loopOrchestrationPresets = [];
    state.loopOrchestrationTargets = [];
    state.loopTargetRuntime = normalizeLoopTargetRuntime();
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

render();
refreshData().finally(() => {
  state.isLoading = false;
  render();
});

setInterval(async () => {
  if (normalizePage(state.active) !== "Loop 执行" || state.isLoading || state.sourceToGaRefreshing) return;
  state.sourceToGaRefreshing = true;
  try {
    await loadLoops();
    render();
  } finally {
    state.sourceToGaRefreshing = false;
  }
}, 8000);
