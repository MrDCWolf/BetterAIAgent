import type { ExecutionPlan } from '../utils/llm';
import { executePlanSteps, attemptDismissPopups } from './planExecutor';

console.log('Background service worker started.');

function openSidePanelForTab(tabId: number) {
  console.log(`Opening side panel for tab ${tabId}`);
  chrome.sidePanel.open({ tabId: tabId }).then(() => {
    console.log(`Side panel opened successfully for tab ${tabId}.`);
  }).catch(error => {
    console.error(`Error opening side panel for tab ${tabId}:`, error);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message, 'from sender:', sender);
  const senderTabId = sender.tab?.id;
  (async () => {
    let targetTabId: number | undefined = senderTabId;
    if (!targetTabId && (message.type === 'executePlan')) {
      console.log('Message likely from panel, querying active tab...');
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id) {
        targetTabId = activeTab.id;
        console.log('Targeting active tab:', targetTabId);
      } else {
        const errorMsg = 'Could not determine active tab ID. Ensure a tab is active in the current window.';
        console.error(errorMsg);
        sendResponse({ success: false, error: errorMsg });
        return;
      }
    }
    if (message.type === 'openSidePanel') {
      if (targetTabId) {
        openSidePanelForTab(targetTabId);
      }
    } else if (message.type === 'executePlan') {
      if (targetTabId && message.plan) {
        executePlanSteps(targetTabId, message.plan as ExecutionPlan)
          .then(() => {
            console.log('Plan execution finished successfully for tab:', targetTabId);
            sendResponse({ success: true });
          })
          .catch(error => {
            console.error('Plan execution failed for tab', targetTabId, error);
            sendResponse({ success: false, error: error.message });
          });
      } else {
        console.error('executePlan missing targetTabId or plan after query.', message);
        sendResponse({ success: false, error: 'Missing targetTabId or plan.' });
      }
    }
  })();
  return true;
}); 