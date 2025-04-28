# Better AI Agent: Project Plan

## Vision
Build a robust, extensible browser automation agent powered by LLMs, capable of performing common and advanced web actions, and easily testable with modern frameworks.

---

## Phases & Milestones

### Phase 1: Project Setup & Core Actions
- Initialize project structure
- Implement basic actions: navigate, type, click, wait

### Phase 2: Refactoring & Modularity
- Refactor background logic into smaller, testable modules
- Improve maintainability and code organization

### Phase 3: Advanced Actions
- Add scroll and extract actions
- Support for semantic and selector-based targeting

### Phase 4: Robustness & Error Handling
- Add retries, error handling, and logging
- Ensure actions are reliable across frames and edge cases

### Phase 5: Common Web Actions
- Add select, hover, clear, go_back, go_forward, refresh, screenshot
- Update LLM prompt and PlanStep interface
- Implement handler logic for new actions

### Phase 6: Test Harness & CI
- Integrate Jest for unit/integration tests
- Integrate Playwright for E2E tests
- Add sample tests and verify harnesses
- Tag as `test-harness-installed`

### Phase 7: Expansion & Automation
- Expand test coverage for all actions
- Add CI/CD workflows for automated testing
- Plan for further feature expansion (file upload, drag-and-drop, etc.)

---

## Current Focus
- All core and common actions implemented
- Test harnesses installed and verified
- Ready for test-driven development and further feature expansion

---

## Next Steps
- Expand test coverage (unit, integration, E2E)
- Implement additional advanced actions
- Integrate with CI/CD
- Gather feedback and iterate 