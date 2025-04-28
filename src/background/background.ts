import type { ExecutionPlan, PlanStep } from '../utils/llm'; // Import types

console.log('Background service worker started.');

// --- Injectable Helper Functions ---
// NOTE: These functions are stringified and injected into the target page,
// so they cannot rely on any variables or functions outside their own scope
// or the standard browser environment.

// Type for elements found by heuristics (can be null)
type FoundElement = HTMLElement | null;

// Type guard for checking visibility
function isElementVisibleAndInteractive(element: Element | null): element is HTMLElement {
  if (!element || !(element instanceof HTMLElement)) return false; // Ensure it's an HTMLElement
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' &&
         style.visibility !== 'hidden' &&
         style.opacity !== '0' &&
         !(element as HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement).disabled && // Type assertion for disabled/readOnly
         !(element as HTMLInputElement | HTMLTextAreaElement).readOnly &&
         element.offsetParent !== null &&
         rect.width > 0 && rect.height > 0;
}

// Type for the root node (Document or ShadowRoot)
type RootNode = Document | ShadowRoot;

// Type for the heuristics map
type HeuristicsMap = { [key: string]: string[] };

function findElementByHeuristics(targetType: string, rootNode: RootNode = document): FoundElement {
  const heuristics: HeuristicsMap = {
    search_input: [
      'input[role="searchbox"]', 'textarea[role="searchbox"]',
      'form[role="search"] input[type="text"]', 'form[role="search"] input:not([type="hidden"])',
      'input[type="search"]', 'textarea[type="search"]',
      'input#q', 'input[name="q"]',
      'input#query', 'input[name="query"]',
      'input#search', 'input[name="search"]',
      'input#keywords', 'input[name="keywords"]',
      'input[aria-label*="search" i]', 'input[placeholder*="search" i]', 'input[title*="search" i]',
      'textarea[aria-label*="search" i]', 'textarea[placeholder*="search" i]', 'textarea[title*="search" i]'
    ],
    search_button: [
      'button[type="submit"][aria-label*="search" i]', 'input[type="submit"][aria-label*="search" i]',
      'button[aria-label*="search" i]',
      'button[title*="search" i]',
      'input[type="submit"]',
      'button[type="submit"]',
      'button[role="button"][aria-label*="search" i]',
      'input[name="btnK"]', 'input[name="btnG"]',
    ],
    first_result_link: [
        '#search h3 > a',
        '#results .result__a',
        'ol#b_results > li.b_algo h2 > a',
        '#web a.d-ib',
        '#results ol li h3 a',
        'div.results ol li h3 a',
        'li.first .algo-sr h3 a',
        'div.dd.algo.first h3 a'
    ],
    search_results_container: [
        '#search',                    // Google (common ID)
        '#results',                   // DuckDuckGo (common ID)
        '#b_content',               // Bing (main content area)
        'main[role="main"]',          // General semantic main content
        'div#web',                    // Older search engine patterns
        'div.results',                // Common class names
        'div.serp__results'           // Common class names
    ],
    accept_cookies_button: [
        'button:contains("Accept")', 'button:contains("Agree")', 'button:contains("Allow")', 'button:contains("Got it")', // Need :contains equivalent or JS filter
        'button[aria-label*="accept" i]', 'button[aria-label*="agree" i]',
        'button[id*="consent-accept"]' , 'button[class*="consent-accept"]',
        'button[id*="cookie-accept"]' , 'button[class*="cookie-accept"]',
        '[role="button"]:contains("Accept")' // Need :contains equivalent
    ],
     dismiss_popup_button: [
        'button[aria-label*="close" i]', 'button[aria-label*="dismiss" i]',
        'div[aria-label*="close" i][role="button"]', // Sometimes it's a div
        'button:contains("Close")', 'button:contains("Dismiss")', 'button:contains("No thanks")', 'button:contains("Maybe later")', // Need :contains equivalent
        '[class*="popup-close"]' , '[id*="popup-close"]',
        '[class*="overlay-close"]' , '[id*="overlay-close"]'
    ]
  };

  const selectors = heuristics[targetType] || [];
  if (!selectors.length) {
      console.warn(`No heuristics defined for target type: ${targetType}`);
      return null;
  }

  // Function to check visibility, defined inside to be included in injection
  function _isElementVisibleAndInteractive(element: Element | null): element is HTMLElement {
     if (!element || !(element instanceof HTMLElement)) return false;
     const style = window.getComputedStyle(element);
     const rect = element.getBoundingClientRect();
     return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            !(element as HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement).disabled &&
            !(element as HTMLInputElement | HTMLTextAreaElement).readOnly &&
            element.offsetParent !== null &&
            rect.width > 0 && rect.height > 0;
  }

  for (const selector of selectors) {
    try {
      let checkText = null;
      let actualSelector = selector;
      // Basic check for our conceptual ":contains()"
      if (selector.includes(':contains(')) {
          const match = selector.match(/(.*):contains\("(.*?)"\)/i);
          if (match && match.length > 2) {
              actualSelector = match[1] || '*'; // Tag part or default to any
              checkText = match[2].toLowerCase(); // Text to check (lowercase)
          }
      }

      const elements: NodeListOf<Element> = rootNode.querySelectorAll(actualSelector);
      for (const element of elements) {
        let textMatch = !checkText; // If no text check needed, it's a match
        if (checkText && element.textContent) {
            textMatch = element.textContent.trim().toLowerCase().includes(checkText);
        }

        if (textMatch && _isElementVisibleAndInteractive(element)) { // Use type guard
          console.log(`findElementByHeuristics: Found '${targetType}' via selector '${selector}' (Text: ${checkText || 'N/A'}) in root`, rootNode);
          return element;
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }

  const allElements: NodeListOf<Element> = rootNode.querySelectorAll('*');
  for (const element of allElements) {
    if (element.shadowRoot) {
      const foundInShadow: FoundElement = findElementByHeuristics(targetType, element.shadowRoot); // Recurse with ShadowRoot
      if (foundInShadow) {
        console.log(`findElementByHeuristics: Found '${targetType}' within Shadow DOM of`, element);
        return foundInShadow;
      }
    }
  }

  return null;
}

// --- NEW Injectable Quick Find Function ---
// Checks for element existence once without polling
function findElementQuickly(identifier: string, isSemantic: boolean): FoundElement {
  // === Start: Helper functions defined inside for injection ===
  type FoundElement = HTMLElement | null;
  type RootNode = Document | ShadowRoot;
  type HeuristicsMap = { [key: string]: string[] };

  function _isElementVisibleAndInteractive(element: Element | null): element is HTMLElement {
    if (!element || !(element instanceof HTMLElement)) return false; 
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           !(element as HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement).disabled &&
           !(element as HTMLInputElement | HTMLTextAreaElement).readOnly &&
           element.offsetParent !== null &&
           rect.width > 0 && rect.height > 0;
  }

  function _findElementByHeuristics(targetType: string, rootNode: RootNode = document): FoundElement {
    const heuristics: HeuristicsMap = {
      search_input: [ 'input[role="searchbox"]', 'textarea[role="searchbox"]', 'form[role="search"] input[type="text"]', 'form[role="search"] input:not([type="hidden"])', 'input[type="search"]', 'textarea[type="search"]', 'input#q', 'input[name="q"]', 'input#query', 'input[name="query"]', 'input#search', 'input[name="search"]', 'input#keywords', 'input[name="keywords"]', 'input[aria-label*="search" i]', 'input[placeholder*="search" i]', 'input[title*="search" i]', 'textarea[aria-label*="search" i]', 'textarea[placeholder*="search" i]', 'textarea[title*="search" i]' ],
      search_button: [ 'button[type="submit"][aria-label*="search" i]', 'input[type="submit"][aria-label*="search" i]', 'button[aria-label*="search" i]', 'button[title*="search" i]', 'input[type="submit"]', 'button[type="submit"]', 'button[role="button"][aria-label*="search" i]', 'input[name="btnK"]', 'input[name="btnG"]' ],
      first_result_link: [ '#search h3 > a', '#results .result__a', 'ol#b_results > li.b_algo h2 > a', '#web a.d-ib', '#results ol li h3 a', 'div.results ol li h3 a', 'li.first .algo-sr h3 a', 'div.dd.algo.first h3 a' ],
      search_results_container: [
          '#search',                    // Google (common ID)
          '#results',                   // DuckDuckGo (common ID)
          '#b_content',               // Bing (main content area)
          'main[role="main"]',          // General semantic main content
          'div#web',                    // Older search engine patterns
          'div.results',                // Common class names
          'div.serp__results'           // Common class names
      ],
      accept_cookies_button: [
          'button:contains("Accept")', 'button:contains("Agree")', 'button:contains("Allow")', 'button:contains("Got it")', // Need :contains equivalent or JS filter
          'button[aria-label*="accept" i]', 'button[aria-label*="agree" i]',
          'button[id*="consent-accept"]' , 'button[class*="consent-accept"]',
          'button[id*="cookie-accept"]' , 'button[class*="cookie-accept"]',
          '[role="button"]:contains("Accept")' // Need :contains equivalent
      ],
       dismiss_popup_button: [
          'button[aria-label*="close" i]', 'button[aria-label*="dismiss" i]',
          'div[aria-label*="close" i][role="button"]', // Sometimes it's a div
          'button:contains("Close")', 'button:contains("Dismiss")', 'button:contains("No thanks")', 'button:contains("Maybe later")', // Need :contains equivalent
          '[class*="popup-close"]' , '[id*="popup-close"]',
          '[class*="overlay-close"]' , '[id*="overlay-close"]'
      ]
    };
    const selectors = heuristics[targetType] || [];
    if (!selectors.length) { console.warn(`No heuristics for target: ${targetType}`); return null; }

    for (const selector of selectors) {
      try {
        let checkText = null;
        let actualSelector = selector;
        // Basic check for our conceptual ":contains()"
        if (selector.includes(':contains(')) {
            const match = selector.match(/(.*):contains\("(.*?)"\)/i);
            if (match && match.length > 2) {
                actualSelector = match[1] || '*'; // Tag part or default to any
                checkText = match[2].toLowerCase(); // Text to check (lowercase)
            }
        }

        const elements: NodeListOf<Element> = rootNode.querySelectorAll(actualSelector);
        for (const element of elements) {
          let textMatch = !checkText; // If no text check needed, it's a match
          if (checkText && element.textContent) {
              textMatch = element.textContent.trim().toLowerCase().includes(checkText);
          }

          if (textMatch && _isElementVisibleAndInteractive(element)) { // Use type guard
            console.log(`_findElementByHeuristics: Found '${targetType}' via selector '${selector}' (Text: ${checkText || 'N/A'}) in root`, rootNode);
            return element;
          }
        }
      } catch (e) {
        // Ignore errors
      }
    }
    const allElements: NodeListOf<Element> = rootNode.querySelectorAll('*');
    for (const element of allElements) {
      if (element.shadowRoot) {
        const foundInShadow: FoundElement = _findElementByHeuristics(targetType, element.shadowRoot);
        if (foundInShadow) return foundInShadow;
      }
    }
    return null;
  }

  function _findElementBySelector(sel: string, rootNode: RootNode = document): FoundElement {
    try {
      const elements: NodeListOf<Element> = rootNode.querySelectorAll(sel);
      for (const el of elements) {
        if (_isElementVisibleAndInteractive(el)) return el;
      }
      const all: NodeListOf<Element> = rootNode.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) {
          const foundInShadow = _findElementBySelector(sel, el.shadowRoot);
          if (foundInShadow) return foundInShadow;
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  // === End: Helper functions ===

  // --- Main logic for findElementQuickly ---
  try {
    if (isSemantic) {
      return _findElementByHeuristics(identifier, document);
    } else {
      return _findElementBySelector(identifier, document);
    }
  } catch (e) {
    console.error(`Error during findElementQuickly: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// --- NEW Injectable Action Function ---
// This function is injected to find an element and perform an action (type/click)
function performActionInPage(actionType: 'type' | 'click', identifier: string, isSemantic: boolean, text?: string): { success: boolean; error?: string } {
  // === Start: Helper functions defined inside for injection ===
  type FoundElement = HTMLElement | null;
  type RootNode = Document | ShadowRoot;
  type HeuristicsMap = { [key: string]: string[] };

  function _isElementVisibleAndInteractive(element: Element | null): element is HTMLElement {
    if (!element || !(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           !(element as HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement).disabled &&
           !(element as HTMLInputElement | HTMLTextAreaElement).readOnly &&
           element.offsetParent !== null &&
           rect.width > 0 && rect.height > 0;
  }

  function _findElementByHeuristics(targetType: string, rootNode: RootNode = document): FoundElement {
    const heuristics: HeuristicsMap = {
      search_input: [ 'input[role="searchbox"]', 'textarea[role="searchbox"]', 'form[role="search"] input[type="text"]', 'form[role="search"] input:not([type="hidden"])', 'input[type="search"]', 'textarea[type="search"]', 'input#q', 'input[name="q"]', 'input#query', 'input[name="query"]', 'input#search', 'input[name="search"]', 'input#keywords', 'input[name="keywords"]', 'input[aria-label*="search" i]', 'input[placeholder*="search" i]', 'input[title*="search" i]', 'textarea[aria-label*="search" i]', 'textarea[placeholder*="search" i]', 'textarea[title*="search" i]' ],
      search_button: [ 'button[type="submit"][aria-label*="search" i]', 'input[type="submit"][aria-label*="search" i]', 'button[aria-label*="search" i]', 'button[title*="search" i]', 'input[type="submit"]', 'button[type="submit"]', 'button[role="button"][aria-label*="search" i]', 'input[name="btnK"]', 'input[name="btnG"]' ],
      first_result_link: [ '#search h3 > a', '#results .result__a', 'ol#b_results > li.b_algo h2 > a', '#web a.d-ib', '#results ol li h3 a', 'div.results ol li h3 a', 'li.first .algo-sr h3 a', 'div.dd.algo.first h3 a' ],
      search_results_container: [
          '#search',                    // Google (common ID)
          '#results',                   // DuckDuckGo (common ID)
          '#b_content',               // Bing (main content area)
          'main[role="main"]',          // General semantic main content
          'div#web',                    // Older search engine patterns
          'div.results',                // Common class names
          'div.serp__results'           // Common class names
      ],
      accept_cookies_button: [
          'button:contains("Accept")', 'button:contains("Agree")', 'button:contains("Allow")', 'button:contains("Got it")', // Need :contains equivalent or JS filter
          'button[aria-label*="accept" i]', 'button[aria-label*="agree" i]',
          'button[id*="consent-accept"]' , 'button[class*="consent-accept"]',
          'button[id*="cookie-accept"]' , 'button[class*="cookie-accept"]',
          '[role="button"]:contains("Accept")' // Need :contains equivalent
      ],
       dismiss_popup_button: [
          'button[aria-label*="close" i]', 'button[aria-label*="dismiss" i]',
          'div[aria-label*="close" i][role="button"]', // Sometimes it's a div
          'button:contains("Close")', 'button:contains("Dismiss")', 'button:contains("No thanks")', 'button:contains("Maybe later")', // Need :contains equivalent
          '[class*="popup-close"]' , '[id*="popup-close"]',
          '[class*="overlay-close"]' , '[id*="overlay-close"]'
      ]
    };
    const selectors = heuristics[targetType] || [];
    if (!selectors.length) { console.warn(`No heuristics for target: ${targetType}`); return null; }

    for (const selector of selectors) {
      try {
        let checkText = null;
        let actualSelector = selector;
        // Basic check for our conceptual ":contains()"
        if (selector.includes(':contains(')) {
            const match = selector.match(/(.*):contains\("(.*?)"\)/i);
            if (match && match.length > 2) {
                actualSelector = match[1] || '*'; // Tag part or default to any
                checkText = match[2].toLowerCase(); // Text to check (lowercase)
            }
        }

        const elements: NodeListOf<Element> = rootNode.querySelectorAll(actualSelector);
        for (const element of elements) {
          let textMatch = !checkText; // If no text check needed, it's a match
          if (checkText && element.textContent) {
              textMatch = element.textContent.trim().toLowerCase().includes(checkText);
          }

          if (textMatch && _isElementVisibleAndInteractive(element)) { // Use type guard
            console.log(`_findElementByHeuristics: Found '${targetType}' via selector '${selector}' (Text: ${checkText || 'N/A'}) in root`, rootNode);
            return element;
          }
        }
      } catch (e) {
        // Ignore errors
      }
    }
    const allElements: NodeListOf<Element> = rootNode.querySelectorAll('*');
    for (const element of allElements) {
      if (element.shadowRoot) {
        const foundInShadow: FoundElement = _findElementByHeuristics(targetType, element.shadowRoot);
        if (foundInShadow) return foundInShadow;
      }
    }
    return null;
  }

  // Helper to find element by selector, including Shadow DOM search
  function _findElementBySelector(sel: string, rootNode: RootNode = document): FoundElement {
    try {
      const elements: NodeListOf<Element> = rootNode.querySelectorAll(sel);
      for (const el of elements) {
        if (_isElementVisibleAndInteractive(el)) return el;
      }
      const all: NodeListOf<Element> = rootNode.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) {
          const foundInShadow = _findElementBySelector(sel, el.shadowRoot);
          if (foundInShadow) return foundInShadow;
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  // === End: Helper functions ===

  // --- Main logic for performActionInPage ---
  let element: HTMLElement | null = null;
  const findStart = Date.now();
  try {
    if (isSemantic) {
      console.log(`Finding semantic target '${identifier}'...`);
      element = _findElementByHeuristics(identifier, document);
    } else {
      console.log(`Finding selector '${identifier}'...`);
      element = _findElementBySelector(identifier, document);
    }
  } catch (e) {
      const errorMsg = (e instanceof Error) ? e.message : String(e);
      console.error(`Error during element search: ${errorMsg}`);
      return { success: false, error: `Error during element search: ${errorMsg}` };
  }
  console.log(`Element search took ${Date.now() - findStart}ms.`);

  if (!element) {
    const errorMsg = `Element not found for ${isSemantic ? 'target' : 'selector'}: ${identifier}`;
    console.error(errorMsg);
    return { success: false, error: errorMsg };
  }

  console.log(`Element found for ${identifier}. Performing action: ${actionType}`);

  // Perform the requested action
  try {
    if (actionType === 'type') {
      if (typeof text !== 'string') {
        return { success: false, error: 'Text is required for type action' };
      }
      const inputElement = element as HTMLInputElement | HTMLTextAreaElement;
      inputElement.focus();
      inputElement.value = text;
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));
      inputElement.blur();
      console.log(`Typed "${text}" into element.`);
    } else if (actionType === 'click') {
      element.click();
      console.log(`Clicked element.`);
    } else {
       return { success: false, error: `Unknown action type: ${actionType}` };
    }
    return { success: true };

  } catch (e) {
    console.error(`Error performing action ${actionType}:`, e);
    const errorMsg = (e instanceof Error) ? e.message : 'Unknown error during action';
    return { success: false, error: `Error performing ${actionType}: ${errorMsg}` };
  }
}

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

const MAX_STEP_RETRIES = 3; // Max attempts per step
const RETRY_DELAY_MS = 1000; // Delay between retries

// --- Helper for Optional Popup Dismissal ---
async function attemptDismissPopups(tabId: number) {
    console.log(`Quickly checking for optional popups/banners on tab ${tabId}...`);
    const popupTargets = ["accept_cookies_button", "dismiss_popup_button"];
    let dismissedSomething = false;

    for (const target of popupTargets) {
        try {
            // Use findElementQuickly to check if the element exists right now
            const findArgs: [string, boolean] = [target, true];
            const findResults = await chrome.scripting.executeScript<typeof findArgs, FoundElement | null>({ 
                target: { tabId: tabId, allFrames: true },
                func: findElementQuickly, 
                args: findArgs
             });

            // Check if *any* frame found the element
            const found = findResults.some(r => !!r.result);

            if (found) {
                console.log(`Found optional popup target "${target}". Attempting click...`);
                type ClickArgs = [actionType: 'click', identifier: string, isSemantic: boolean];
                const clickArgs: ClickArgs = ['click', target, true];
                 const clickResults = await chrome.scripting.executeScript<ClickArgs, { success: boolean; error?: string }>({ 
                     target: { tabId: tabId, allFrames: true },
                     func: performActionInPage,
                     args: clickArgs
                 });
                 const success = clickResults.some(r => r.result?.success);
                 if (success) {
                     console.log(`Successfully clicked optional popup target "${target}".`);
                     dismissedSomething = true;
                     await new Promise(resolve => setTimeout(resolve, 500)); // Short delay after dismissal
                 } else {
                     console.warn(`Click attempt failed for optional popup target "${target}".`);
                 }
            } else {
                // Element not found quickly, just log and continue
                 console.log(`Optional popup target "${target}" not found during quick check.`);
            }
        } catch (error) {
            console.error(`Error during optional popup dismissal check for "${target}":`, error);
        }
    }
    if (dismissedSomething) {
        console.log("Finished attempting popup dismissal.");
    } else {
         console.log("No optional popups found or dismissed.");
    }
}

// ** MODIFIED executePlanSteps **
async function executePlanSteps(currentTabId: number, plan: ExecutionPlan) {
  console.log(`Starting execution for tab ${currentTabId}, plan:`, plan);
  let activeTabId = currentTabId; // Use a mutable variable for the active tab

  for (const [index, step] of plan.steps.entries()) {
    console.log(`Executing step ${index + 1}/${plan.steps.length} on tab ${activeTabId}:`, step);
    
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < MAX_STEP_RETRIES) {
      attempt++;
      try {
        // Add a shorter base delay *before* each attempt (can be adjusted/removed)
        // The main delays/waits should be within the handlers or from 'wait' steps
        if (attempt > 1) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            console.log(`Retrying step (Attempt ${attempt}/${MAX_STEP_RETRIES})...`);
        }
        // Longer delay only *between* different steps (moved from here)
        // await new Promise(resolve => setTimeout(resolve, 1000)); 

        switch (step.action) {
          case 'navigate':
            await handleNavigate(activeTabId, step);
            await attemptDismissPopups(activeTabId);
            // Navigation resets context, assume subsequent actions are on this tab unless click changes it
            break;
          case 'type':
            await handleType(activeTabId, step);
            break;
          case 'click':
            // handleClick might change the active tab
            activeTabId = await handleClick(activeTabId, step);
            console.log(`Click action complete. Subsequent steps target tab: ${activeTabId}`);
            break;
          case 'wait':
            await handleWait(activeTabId, step);
            break;
          case 'scroll':
            console.warn('Scroll action not yet implemented.');
            break;
          case 'extract':
            console.warn('Extract action not yet implemented.');
            break;
          default:
            console.warn(`Unsupported action type: ${step.action}`);
            // Optionally throw error for unsupported actions
            // throw new Error(`Unsupported action type: ${step.action}`);
        }
        
        console.log(`Step ${index + 1} completed successfully.`);
        lastError = null;
        break; 

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`Attempt ${attempt}/${MAX_STEP_RETRIES} failed for step ${index + 1}:`, step, lastError.message);
        if (attempt >= MAX_STEP_RETRIES) {
           console.error(`Max retries reached for step ${index + 1}. Aborting plan.`);
           throw new Error(`Failed on step ${index + 1}: ${JSON.stringify(step)}. Error: ${lastError.message}`);
        }
        // Wait before retrying (already handled by delay at start of loop)
      }
    }
    if (lastError) { // If loop finished due to errors
        throw lastError; // Rethrow the last encountered error after retries
    }
    // Add a small delay between distinct steps for smoother execution
    await new Promise(resolve => setTimeout(resolve, 500)); 
  }
  console.log(`Plan execution complete. Final active tab was ${activeTabId}.`);
}

// --- Action Handlers --- 

// ** MODIFIED waitForElement **
// No longer needs optional handling internally, as optional checks are done elsewhere
async function waitForElement(tabId: number, step: PlanStep, timeout = 15000): Promise<void> {
    const identifier = step.target || step.selector;
    const isSemantic = !!step.target;
    // REMOVED optional check here - handled by caller if needed
    console.log(`Waiting for ${isSemantic ? 'target' : 'selector'} "${identifier}" in tab ${tabId} (timeout: ${timeout}ms)...`);
    const started = Date.now();

    while (Date.now() - started < timeout) {
        try {
            let found = false;
            if (isSemantic && step.target) { 
                const results = await chrome.scripting.executeScript<[string], FoundElement | null>({
                    target: { tabId: tabId, allFrames: true },
                    func: findElementByHeuristics,
                    args: [step.target],
                });
                found = results.some(frameResult => !!frameResult.result);
             } else if (step.selector) { 
                 const results = await chrome.scripting.executeScript<[string], boolean>({
                   target: { tabId: tabId, allFrames: true },
                   func: (sel: string): boolean => {
                       function _isElementVisible(element: Element | null): element is HTMLElement {
                           if (!element || !(element instanceof HTMLElement)) return false;
                           const style = window.getComputedStyle(element);
                           const rect = element.getBoundingClientRect();
                           return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' &&
                                  !(element as HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement).disabled &&
                                  !(element as HTMLInputElement | HTMLTextAreaElement).readOnly &&
                                  element.offsetParent !== null && rect.width > 0 && rect.height > 0;
                       }
                       function checkNode(root: RootNode): boolean {
                           try {
                               const elements: NodeListOf<Element> = root.querySelectorAll(sel);
                               for (const el of elements) {
                                   if (_isElementVisible(el)) return true;
                               }
                               const all: NodeListOf<Element> = root.querySelectorAll('*');
                               for (const el of all) {
                                   if (el.shadowRoot) {
                                       if (checkNode(el.shadowRoot)) return true;
                                   }
                               }
                           } catch(e) { /* ignore */ }
                           return false;
                       }
                       return checkNode(document);
                   },
                   args: [step.selector]
                 });
                 found = results.some(frameResult => frameResult.result === true);
             }

             if (found) {
                 console.log(`${isSemantic ? 'Target' : 'Selector'} "${identifier}" found.`);
                 return; // Found - void return signifies success
             }
        } catch (e) {
            const errorMsg = (e instanceof Error) ? e.message : String(e);
            console.debug(`Polling for "${identifier}" encountered temporary error: ${errorMsg}`);
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    // Timeout - always throw error now, optional handled by caller
    throw new Error(`Timeout waiting for ${isSemantic ? 'target' : 'selector'}: ${identifier}`); 
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

// ** MODIFIED handleType **
async function handleType(tabId: number, step: PlanStep) {
    if (!step.selector && !step.target) {
        throw new Error('Type step requires a valid target or selector.');
    }
    if (typeof step.text !== 'string') {
        throw new Error('Type step requires a string value for text.');
    }

    if (step.optional) {
        // For optional steps, use findElementQuickly first
        const findArgs: [string, boolean] = [step.target || step.selector!, !!step.target];
        const findResults = await chrome.scripting.executeScript<typeof findArgs, FoundElement | null>({
            target: { tabId: tabId, allFrames: true },
            func: findElementQuickly,
            args: findArgs
        });
         if (!findResults.some(r => !!r.result)) {
             console.log(`Skipping optional type action for element "${step.target || step.selector}" which was not found quickly.`);
             return;
         }
    }

    // Now wait (will throw if required and not found)
    await waitForElement(tabId, step);
    
    // If we reach here, the element is guaranteed to be ready (or was optional and found quickly)
    const identifier = step.target || step.selector!;
    const isSemantic = !!step.target;
    console.log(`Attempting to type "${step.text}" into ${isSemantic ? 'target' : 'selector'} "${identifier}" in tab ${tabId}`);

    // Define the arguments tuple type matching performActionInPage's parameters for 'type'
    type TypeArgs = [actionType: 'type', identifier: string, isSemantic: boolean, text: string];

    const results = await chrome.scripting.executeScript<TypeArgs, { success: boolean; error?: string }>({
        target: { tabId: tabId, allFrames: true },
        func: performActionInPage, // Inject the combined action function
        args: ['type', identifier, isSemantic, step.text!], // Pass necessary arguments, assert text is not null
    });

    // Find the first successful result across frames
    const successResult = results.find(r => r.result?.success);
    if (!successResult) {
        // If no success, find the first error message to report
        const errorResult = results.find(r => r.result?.error);
        throw new Error(`Failed to execute type action in any frame: ${errorResult?.result?.error || 'Unknown script error or element not found'}`);
    }
    console.log(`Type action successful in at least one frame.`);
}

// ** MODIFIED handleClick **
async function handleClick(tabId: number, step: PlanStep): Promise<number> {
    if (!step.selector && !step.target) {
        throw new Error('Click step requires a valid target or selector.');
    }

    if (step.optional) {
        // For optional steps, use findElementQuickly first
        const findArgs: [string, boolean] = [step.target || step.selector!, !!step.target];
        const findResults = await chrome.scripting.executeScript<typeof findArgs, FoundElement | null>({
            target: { tabId: tabId, allFrames: true },
            func: findElementQuickly,
            args: findArgs
        });
         if (!findResults.some(r => !!r.result)) {
             console.log(`Skipping optional click action for element "${step.target || step.selector}" which was not found quickly.`);
             return tabId; // Return original tab ID
         }
    }

    // Now wait (will throw if required and not found)
    await waitForElement(tabId, step);

    // If we reach here, the element is guaranteed to be ready
    const identifier = step.target || step.selector!;
    const isSemantic = !!step.target;
    console.log(`Attempting to click ${isSemantic ? 'target' : 'selector'} "${identifier}" in tab ${tabId}`);

    // --- New Tab Detection Logic --- 
    let newTabId: number | null = null;
    const newTabListener = (newTab: chrome.tabs.Tab) => {
        // Check if the new tab was opened by our target tab
        if (newTab.openerTabId === tabId) {
            console.log(`Detected new tab opened by target tab: ID=${newTab.id}, URL=${newTab.pendingUrl || newTab.url}`);
            newTabId = newTab.id ?? null;
            // Optional: remove listener immediately? Or wait until after click script?
        }
    };
    chrome.tabs.onCreated.addListener(newTabListener);
    // -----------------------------

    type ClickArgs = [actionType: 'click', identifier: string, isSemantic: boolean];
    let scriptError: Error | null = null;
    try {
        const results = await chrome.scripting.executeScript<ClickArgs, { success: boolean; error?: string }>({
            target: { tabId: tabId, allFrames: true },
            func: performActionInPage,
            args: ['click', identifier, isSemantic], // Pass necessary arguments (no text for click)
        });
        const successResult = results.find(r => r.result?.success);
        if (!successResult) {
            const errorResult = results.find(r => r.result?.error);
            scriptError = new Error(`Failed to execute click action in any frame: ${errorResult?.result?.error || 'Unknown script error or element not found'}`);
        }
    } catch (execError) {
        scriptError = execError instanceof Error ? execError : new Error(String(execError));
    } finally {
         // Remove listener AFTER the action attempt
         chrome.tabs.onCreated.removeListener(newTabListener);
    }

    if (scriptError) {
        throw scriptError; // Rethrow error if script execution failed
    }

    // Give a brief moment for the new tab to potentially finish opening/navigating
    if (newTabId !== null) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Adjust delay as needed
        await attemptDismissPopups(newTabId);
        console.log(`Switching active tab context to newly opened tab: ${newTabId}`);
        return newTabId; // Return the new tab ID
    }

    console.log(`Click action successful in at least one frame. No new tab detected or associated.`);
    return tabId; // Return original tab ID if no new tab was detected/associated
}

async function handleWait(tabId: number, step: PlanStep) {
    if (step.selector || step.target) {
         if (step.optional) {
            // Optional wait: Use findElementQuickly. If found, we're done. If not, continue without error.
            const findArgs: [string, boolean] = [step.target || step.selector!, !!step.target];
            const findResults = await chrome.scripting.executeScript<typeof findArgs, FoundElement | null>({ 
                target: { tabId: tabId, allFrames: true }, func: findElementQuickly, args: findArgs
             });
            if (findResults.some(r => !!r.result)) {
                console.log(`Optional wait target/selector "${step.target || step.selector}" found quickly.`);
                return;
            }
             console.log(`Optional wait target/selector "${step.target || step.selector}" not found quickly, skipping wait.`);
             return; // Don't proceed to waitForElement for optional wait if not found quickly
        }

        // Required wait: Use the standard waitForElement (will throw on timeout)
        await waitForElement(tabId, step, step.timeout as number | undefined || 10000);
    } else if (step.duration && typeof step.duration === 'number') {
        // Fallback to fixed duration wait
        console.warn(`Performing fixed duration wait (${step.duration}ms) - prefer selector/target-based waits.`);
        await new Promise(resolve => setTimeout(resolve, step.duration));
    } else {
        throw new Error('Wait step requires a valid target, selector, or a numeric duration.');
    }
}
