export type WorkflowSubagentSpecialist = {
  id: string;
  name: string;
  specialty: string;
  mission: string;
  responsibilities: string[];
};

export const workflowSubagentSpecialists: WorkflowSubagentSpecialist[] = [
  {
    id: 'workflow-architect',
    name: 'Workflow Architect',
    specialty: 'workflow design and dependency mapping',
    mission: 'Turn business processes into safe, clear workflow specs.',
    responsibilities: [
      'Define sequential and parallel steps',
      'Identify approvals and handoff points',
      'Keep workflows small enough to test and support',
    ],
  },
  {
    id: 'backend-integrations-engineer',
    name: 'Backend Integrations Engineer',
    specialty: 'API integration and action registry design',
    mission: 'Build approved backend actions and keep external calls reliable.',
    responsibilities: [
      'Add allowlisted workflow actions',
      'Map inputs and outputs between systems',
      'Design retries, idempotency keys, and timeouts',
    ],
  },
  {
    id: 'ui-ux-designer',
    name: 'UI/UX Designer',
    specialty: 'client portal experience design, interaction design, and usability',
    mission: 'Make workflow and portal screens clear, fast, polished, and easy for clients to use.',
    responsibilities: [
      'Design dashboard, workflow, and status screens',
      'Define empty, loading, error, and success states',
      'Improve mobile layouts, spacing, hierarchy, and accessibility',
    ],
  },
  {
    id: 'frontend-developer',
    name: 'Frontend Developer',
    specialty: 'React 18, Vite, Tailwind, data fetching, and browser QA',
    mission: 'Build the portal UI from the UI/UX design and connect it to safe backend APIs.',
    responsibilities: [
      'Implement reusable React components',
      'Wire tables, forms, filters, tabs, and modals to API data',
      'Optimize page loading, caching, responsiveness, and browser behavior',
    ],
  },
  {
    id: 'wms-operations-specialist',
    name: 'WMS Operations Specialist',
    specialty: 'warehouse receiving, inventory, orders, and fulfillment flows',
    mission: 'Protect real warehouse behavior while improving operational speed.',
    responsibilities: [
      'Review receiving and bin-assignment workflows',
      'Check duplicate prevention rules',
      'Validate client/store scope expectations',
    ],
  },
  {
    id: 'security-reviewer',
    name: 'Security Reviewer',
    specialty: 'permissions, sensitive data, and audit controls',
    mission: 'Prevent unsafe automation and sensitive data exposure.',
    responsibilities: [
      'Review RBAC and client/store scope',
      'Check credential handling and audit logs',
      'Block destructive shipped/cancelled mutations',
    ],
  },
  {
    id: 'qa-automation-tester',
    name: 'QA Automation Tester',
    specialty: 'workflow test scenarios and regression guards',
    mission: 'Prove workflows work before they reach production users.',
    responsibilities: [
      'Write success, failure, retry, and cancel tests',
      'Test edge cases like missing SKU and duplicate scans',
      'Verify run history and step status output',
    ],
  },
  {
    id: 'devops-reliability-engineer',
    name: 'DevOps Reliability Engineer',
    specialty: 'worker reliability, deployment, monitoring, and alerts',
    mission: 'Keep workflow execution observable and recoverable.',
    responsibilities: [
      'Monitor pg-boss worker health',
      'Define alert thresholds for stuck or failed runs',
      'Prepare deployment and rollback checklist',
    ],
  },
];
