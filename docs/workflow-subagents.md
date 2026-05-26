# Workflow Subagent Specialists

This portal does not require external AI API keys for workflow orchestration. Use these named specialists as the team roles for planning, reviewing, testing, and operating workflow automation.

| Subagent | Specialty | Main job |
| --- | --- | --- |
| Workflow Architect | Workflow design and dependency mapping | Converts business processes into safe workflow specs. |
| Backend Integrations Engineer | API integration and action registry design | Builds approved backend actions with retries, timeouts, and idempotency. |
| UI/UX Designer | Client portal experience design, interaction design, and usability | Designs polished dashboard, workflow, loading, empty, error, and mobile states. |
| Frontend Developer | React 18, Vite, Tailwind, data fetching, and browser QA | Builds reusable portal components and connects them to safe backend APIs. |
| WMS Operations Specialist | Receiving, inventory, orders, and fulfillment | Validates warehouse-safe behavior and duplicate prevention. |
| Security Reviewer | Permissions, sensitive data, and audit controls | Reviews RBAC, scope checks, credentials, and destructive-action protections. |
| QA Automation Tester | Workflow test scenarios and regression guards | Tests success, failure, retry, cancel, and edge cases. |
| DevOps Reliability Engineer | Worker reliability, deployment, monitoring, and alerts | Monitors worker health and prepares production rollout/rollback. |

Recommended MVP team:

- Workflow Architect
- Backend Integrations Engineer
- UI/UX Designer
- Frontend Developer
- Security Reviewer
- QA Automation Tester

Add the WMS Operations Specialist before warehouse workflows touch receiving or inventory, and add the DevOps Reliability Engineer before production workflow jobs run continuously.
