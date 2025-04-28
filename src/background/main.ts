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
  
  // --- Handle executePlan --- 
  if (message.type === 'executePlan') {
    const requestId = message.requestId; // Get request ID
    if (!requestId) {
        console.error('executePlan message missing requestId');
        // Send response directly for missing ID, as we can't track status
        sendResponse({ success: false, error: 'Missing requestId in executePlan message.' });
        return false; // No async response needed
    }

    (async () => {
      let targetTabId: number | undefined = senderTabId;
      // If message is from panel (no tab id), find active tab
      if (!targetTabId) {
        console.log('Message likely from panel, querying active tab...');
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab?.id) {
          targetTabId = activeTab.id;
          console.log('Targeting active tab:', targetTabId);
        } else {
          const errorMsg = 'Could not determine active tab ID. Ensure a tab is active in the current window.';
          console.error(errorMsg);
          // Send final error status back via message (using requestId)
          chrome.runtime.sendMessage({ 
              type: "planStepResult", 
              requestId: requestId,
              isFinal: true,
              stepId: -1, // Indicate overall failure
              result: { success: false, error: errorMsg } 
          });
          return; 
        }
      }

      // Check we have everything needed
      if (targetTabId && message.plan) {
        // Execute the plan, passing the requestId
        executePlanSteps(targetTabId, message.plan as ExecutionPlan, requestId)
          .then(() => {
             // Overall success message is now sent via planStepResult with isFinal=true
             console.log('[Main] Plan execution promise resolved successfully for tab:', targetTabId);
          })
          .catch(error => {
            // Overall failure message is now sent via planStepResult with isFinal=true
            console.error('[Main] Plan execution promise rejected for tab', targetTabId, error);
          });
      } else {
        console.error('executePlan missing targetTabId or plan after query.', message);
         // Send final error status back via message
         chrome.runtime.sendMessage({ 
            type: "planStepResult", 
            requestId: requestId,
            isFinal: true,
            stepId: -1, 
            result: { success: false, error: 'Missing targetTabId or plan data.' } 
        });
      }
    })();
    // Indicate that sendResponse will NOT be called synchronously here
    // Status updates are sent via separate messages. Return undefined or void.
    return; // Important: No 'true' here, response handled via messages
  }
  // --- Handle openSidePanel --- 
  else if (message.type === 'openSidePanel') {
       // This part remains the same
       let tabToOpenIn = senderTabId;
       (async () => {
            if (!tabToOpenIn) {
                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                tabToOpenIn = activeTab?.id;
            }
            if (tabToOpenIn) {
                openSidePanelForTab(tabToOpenIn);
            }
       })();
       // No response needed
       return;
  }
  // --- Other message types --- 
  else {
    console.log("Received unhandled message type:", message.type);
    // Optional: sendResponse({ success: false, error: 'Unknown message type' });
    return false;
  }
}); 