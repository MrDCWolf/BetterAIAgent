import type { ExecutionPlan, PlanStep } from '../utils/llm'; // Import types

console.log('Background service worker started.');

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message, 'from sender:', sender);
  
  // Determine the target tab ID
  const senderTabId = sender.tab?.id;

  (async () => { // Use an async IIFE to handle async tab query
    let targetTabId: number | undefined = senderTabId;

    // If message didn't come from a content script (sender.tab is undefined),
    // assume we target the currently active tab.
    if (!targetTabId && (message.type === 'executePlan')) { // Only query if needed for executePlan
      console.log('Message likely from panel, querying active tab...');
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id) {
        targetTabId = activeTab.id;
        console.log('Targeting active tab:', targetTabId);
      } else {
        console.error('Could not determine active tab ID.');
        return; // Cannot proceed without a tab ID
      }
    }

    // Now handle messages using the determined targetTabId
    if (message.type === 'openSidePanel') {
      if (targetTabId) { // Might be redundant if openSidePanel only comes from content script, but safer
        openSidePanelForTab(targetTabId);
      }
    } else if (message.type === 'executePlan') {
      if (targetTabId && message.plan) {
        executePlanSteps(targetTabId, message.plan as ExecutionPlan)
          .then(() => {
            console.log('Plan execution finished successfully for tab:', targetTabId);
            sendResponse({ success: true }); // Send success response
          })
          .catch(error => {
            console.error('Plan execution failed for tab:', targetTabId, error);
            sendResponse({ success: false, error: error.message }); // Send error response
          });
      } else {
        console.error('executePlan missing targetTabId or plan after query.', message);
        sendResponse({ success: false, error: 'Missing targetTabId or plan.' }); // Send error response
      }
    } else {
        // Optional: handle other message types or send default response
        // sendResponse({ success: false, error: 'Unknown message type' });
    }
  })(); // Immediately invoke the async function

  // Return true: Indicates we WILL call sendResponse asynchronously
  return true; 
});

// Optional: Keep the service worker alive briefly after startup
// This might help ensure listeners are ready immediately.
// Be cautious with this, excessive use can impact performance.
// setTimeout(() => {
//   console.log("Service worker heartbeat.");
// }, 25 * 1000);

// --- Side Panel Opener --- 
function openSidePanelForTab(tabId: number) {
  console.log(`Opening side panel for tab ${tabId}`);
  chrome.sidePanel.open({ tabId: tabId }).then(() => {
    console.log(`Side panel opened successfully for tab ${tabId}.`);
  }).catch(error => {
    console.error(`Error opening side panel for tab ${tabId}:`, error);
  });
}

// --- Plan Executor --- 
async function executePlanSteps(tabId: number, plan: ExecutionPlan) {
  console.log(`Starting execution for tab ${tabId}, plan:`, plan);

  for (const step of plan.steps) {
    console.log(`Executing step:`, step);
    try {
      // Basic delay between steps
      await new Promise(resolve => setTimeout(resolve, 1000)); 

      switch (step.action) {
        case 'navigate':
          await handleNavigate(tabId, step);
          break;
        case 'type':
          await handleType(tabId, step);
          break;
        case 'click':
          await handleClick(tabId, step);
          break;
        case 'scroll':
          // TODO: Implement handleScroll
          console.warn('Scroll action not yet implemented.');
          break;
        case 'wait':
          // TODO: Implement handleWait
          console.warn('Wait action not yet implemented.');
          break;
        case 'extract':
           // TODO: Implement handleExtract
          console.warn('Extract action not yet implemented.');
          break;
        default:
          console.warn(`Unsupported action type: ${step.action}`);
      }
      console.log(`Step completed successfully.`);

    } catch (error) {
      console.error(`Error executing step:`, step, error);
      // Optional: Send error status back to panel
      // chrome.runtime.sendMessage({ type: 'executionError', step: step, error: error.message });
      
      // Handle unknown error type
      const errorMessage = (error instanceof Error) ? error.message : 'An unknown error occurred during step execution.';
      throw new Error(`Failed on step: ${JSON.stringify(step)}. Error: ${errorMessage}`); 
    }
  }
  console.log(`Plan execution complete for tab ${tabId}.`);
  // Optional: Send completion status back to panel
  // chrome.runtime.sendMessage({ type: 'executionComplete' });
}

// --- Action Handlers --- 

// Helper function to wait for an element
async function waitForElement(tabId: number, selector: string, timeout = 5000): Promise<void> {
  console.log(`Waiting for selector "${selector}" in tab ${tabId}...`);
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: (sel) => !!document.querySelector(sel),
        args: [selector]
      });
      if (results[0]?.result === true) {
        console.log(`Element "${selector}" found.`);
        return; // Element found
      }
    } catch (e) { 
      // Ignore errors during polling (e.g., if tab is navigating)
      const errorMsg = (e instanceof Error) ? e.message : String(e);
      console.debug(`Polling for "${selector}" encountered temporary error: ${errorMsg}`);
    }
    await new Promise(resolve => setTimeout(resolve, 250)); // Wait before polling again
  }
  throw new Error(`Timeout waiting for element with selector: ${selector}`);
}

async function handleNavigate(tabId: number, step: PlanStep) {
  if (!step.url || typeof step.url !== 'string') {
    throw new Error('Navigate step requires a valid string url.');
  }
  console.log(`Navigating tab ${tabId} to ${step.url}`);
  await chrome.tabs.update(tabId, { url: step.url });
  
  // Wait for the tab to likely finish loading (readyState complete)
  // Note: This is still imperfect, might need more robust checks later
  await new Promise<void>(resolve => {
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        console.log(`Tab ${tabId} navigation complete.`);
        // Add a small extra delay just in case JS is still running
        setTimeout(resolve, 500);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Set a timeout safeguard in case 'complete' event doesn't fire
    setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        console.warn(`Navigation complete listener timed out for tab ${tabId}, proceeding anyway.`);
        resolve(); 
    }, 10000); // 10 second timeout
  });
}

async function handleType(tabId: number, step: PlanStep) {
  if (!step.selector || typeof step.selector !== 'string') {
    throw new Error('Type step requires a valid string selector.');
  }
  if (typeof step.text !== 'string') { // Allow empty string, check type
    throw new Error('Type step requires a string value for text.');
  }
  
  // Wait for the element to exist first
  await waitForElement(tabId, step.selector);
  
  console.log(`Typing "${step.text}" into "${step.selector}" in tab ${tabId}`);
  
  const results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: (selector, text) => {
      try {
        const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
        if (!element) {
          throw new Error(`Element not found for selector: ${selector}`);
        }
        element.focus(); 
        element.value = text; 
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.blur(); 
        return { success: true }; // Indicate success
      } catch (e) {
        console.error('Error in injected type script:', e);
        // Handle unknown error type
        const msg = (e instanceof Error) ? e.message : 'Unknown error in type script';
        return { success: false, error: msg }; 
      }
    },
    args: [step.selector, step.text]
  });

  // Check the result from the injected script
  if (results[0]?.result?.success !== true) {
    throw new Error(`Failed to execute type script in tab: ${results[0]?.result?.error || 'Unknown script error'}`);
  }
}

async function handleClick(tabId: number, step: PlanStep) {
  if (!step.selector || typeof step.selector !== 'string') {
    throw new Error('Click step requires a valid string selector.');
  }

  // Wait for the element to exist first
  await waitForElement(tabId, step.selector);

  console.log(`Clicking "${step.selector}" in tab ${tabId}`);

  const results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: (selector) => {
      try {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) {
          throw new Error(`Element not found for selector: ${selector}`);
        }
        // Element exists, attempt click
        element.click();
        return { success: true }; // Indicate success
      } catch (e) {
        console.error('Error in injected click script:', e);
        // Handle unknown error type
        const msg = (e instanceof Error) ? e.message : 'Unknown error in click script';
        return { success: false, error: msg };
      }
    },
    args: [step.selector]
  });

  // Check the result from the injected script
  if (results[0]?.result?.success !== true) {
    throw new Error(`Failed to execute click script in tab: ${results[0]?.result?.error || 'Unknown script error'}`);
  }
}
