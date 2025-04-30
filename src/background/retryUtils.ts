/**
 * Retry an async step with delay/backoff. On terminal failure, invoke onFail.
 * If onFail returns fallback candidates, throw a FallbackError.
 */
import type { PlanStep } from '../common/types';
import { getTroubleshootingSuggestion } from '../utils/llm';
import { heuristicsMap } from './injectable/heuristics';

// Define a custom error type to hold fallback candidates
export class FallbackError extends Error {
  candidates: PlanStep[];
  originalError: any;

  constructor(message: string, candidates: PlanStep[], originalError: any) {
    super(message);
    this.name = 'FallbackError';
    this.candidates = candidates;
    this.originalError = originalError;
  }
}

export async function withRetry<T>(
  action: () => Promise<T>,
  attempts: number,
  delayMs: number,
  isOptional: boolean,
  onFail: (error: any) => Promise<PlanStep[]>
): Promise<T> {
  let lastError: any;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await action();
    } catch (err) {
      lastError = err;
      console.warn(`Attempt ${i}/${attempts} failed:`, err);
      if (i < attempts) {
        await new Promise(res => setTimeout(res, delayMs * i)); // linear back-off
      }
    }
  }
  // All retries exhausted
  console.log("All retries failed.");
  
  // --- Check if step was optional BEFORE calling onFail ---
  if (isOptional) {
      console.log("Step was optional, throwing original error without fallback.");
      throw lastError; 
  }
  // --------------------------------------------------------

  // If not optional, proceed with fallback attempt
  console.log("Calling onFail handler to get fallback candidates...");
  const fallbackCandidates = await onFail(lastError);

  if (fallbackCandidates && fallbackCandidates.length > 0) {
      console.log(`onFail returned ${fallbackCandidates.length} fallback candidate(s). Throwing FallbackError.`, fallbackCandidates);
      // Throw custom error containing candidates
      throw new FallbackError('Step failed, but fallback candidates available.', fallbackCandidates, lastError);
  } else {
      console.log("onFail returned no candidates. Throwing original error.");
      throw lastError;
  }
}

/**
 * Capture the full page HTML from the given tab.
 */
export async function capturePageHTML(tabId: number): Promise<string> {
  const [{ result }] = await chrome.scripting.executeScript<[], string | undefined>({
    target: { tabId, allFrames: false },
    func: () => document.documentElement.outerHTML
  });
  return typeof result === 'string' ? result : '';
}

/**
 * Capture a screenshot (base64 PNG) of the given tab.
 */
export async function captureScreenshot(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  const windowId = tab.windowId;
  return new Promise((resolve) => {
    chrome.tabs.captureVisibleTab(windowId, { format: 'png', quality: 80 }, (dataUrl) => {
      resolve(typeof dataUrl === 'string' ? dataUrl : '');
    });
  });
}

/**
 * On terminal failure, capture HTML and screenshot, then call the LLM for troubleshooting.
 */
// Define a type for the message we send back to the panel
interface TroubleshootResultMessage {
    type: "stepTroubleshootResult";
    requestId: string;
    stepId: number;
    suggestionText: string; // Always include the raw text
    fallbackStep?: PlanStep; // Include parsed step if successful
}

// Update signature to return Promise<PlanStep[]>
export async function troubleshootWithLLM(
    stepInfo: PlanStep & { id: number }, 
    error: any, 
    tabId: number, 
    requestId: string 
): Promise<PlanStep[]> { // Return PlanStep[]
  try {
    const storage = await chrome.storage.local.get(['openai_api_key']);
    const apiKey = storage.openai_api_key;
    if (!apiKey) {
      console.error('OpenAI API Key not found in storage (key: openai_api_key). Cannot troubleshoot with LLM.');
      return []; // Return empty array
    }

    console.log("Initiating troubleshooting captures...");
    // Capture HTML and Screenshot concurrently
    const htmlPromise = capturePageHTML(tabId);
    const screenshotPromise = captureScreenshot(tabId);
    const [html, screenshot] = await Promise.all([htmlPromise, screenshotPromise]);
    console.log(`Captures complete. HTML length: ${html.length}, Screenshot available: ${!!screenshot}`);

    // Truncate HTML more aggressively (10k) since we add screenshot
    const truncatedHtml = html.slice(0, 10000);
    const prompt = `
The following web automation step failed:
Action: ${stepInfo.action}
Target/Selector: ${stepInfo.target || stepInfo.selector || 'N/A'}
Other Params: ${JSON.stringify(Object.fromEntries(Object.entries(stepInfo).filter(([k]) => !['action', 'target', 'selector', 'id', 'description'].includes(k))))}

Error: ${error?.message || error}

Here is the relevant page HTML (truncated to 10,000 chars):
\u0060\u0060\u0060html
${truncatedHtml}
\u0060\u0060\u0060

Here is a screenshot of the page (base64 PNG data URL):
${screenshot}

Please analyze the HTML, screenshot, and the failed step to determine potential fixes.
Return up to 3 alternative PlanStep JSON objects, ranked by likelihood of success, that could replace the failed step. 
IMPORTANT: Output these alternatives as a JSON array within a single markdown code block like \u0060\u0060\u0060json\n[\n  {...}, \n  {...}, \n  {...} \n]\n\u0060\u0060\u0060. Ensure the output inside the block is ONLY the valid JSON array.
`;

    console.info('Sending troubleshooting prompt to LLM for fallback candidates...');
    // Expect PlanStep[] now
    const fallbackCandidates = await getTroubleshootingSuggestion(apiKey, prompt);
    console.info('LLM fallback candidates received:', fallbackCandidates);

    if (!fallbackCandidates || fallbackCandidates.length === 0) {
        console.log("LLM did not provide any fallback candidates.");
        return [];
    }

    // --- Filter candidates based on existence --- 
    console.log("Filtering candidates based on selector existence...");
    const viableCandidates: PlanStep[] = [];
    for (const candidate of fallbackCandidates) {
        // Only check existence if candidate has a selector or target with known heuristics
        let selectorToCheck: string | null = null;
        if (candidate.selector) {
            selectorToCheck = candidate.selector;
        } else if (candidate.target && heuristicsMap[candidate.target]) {
            // Use first heuristic selector for existence check if target is known
            selectorToCheck = heuristicsMap[candidate.target][0]; 
        } else if (candidate.target) {
             console.log(` -> Candidate target "${candidate.target}" has no defined heuristics. Cannot check existence. Keeping.`);
             viableCandidates.push(candidate); // Keep if target has no heuristics defined
             continue;
        }
        
        if (selectorToCheck) {
            try {
                 console.log(`Checking existence for selector: "${selectorToCheck}" derived from candidate target/selector "${candidate.target || candidate.selector}" in tab ${tabId}`);
                 const results: chrome.scripting.InjectionResult<{exists: boolean; count: number}>[] = 
                   await chrome.scripting.executeScript<
                     [string], 
                     { exists: boolean; count: number } 
                 >({
                     target: { tabId, allFrames: true },
                     func: checkSelectorExistence,
                     args: [selectorToCheck]
                 });

                 const existsInAnyFrame = results.some(r => r.result?.exists);
                 if (existsInAnyFrame) {
                     console.log(` -> Selector exists. Keeping candidate.`);
                     viableCandidates.push(candidate);
                 } else {
                      console.log(` -> Selector does not exist in any frame. Discarding candidate.`);
                 }
            } catch(scriptError) {
                 console.error(`Error executing existence check script for selector "${selectorToCheck}":`, scriptError);
                 // Discard candidate on script error
            }
        } else {
             console.log("Candidate has no selector/target to check (e.g., navigate, wait duration), keeping it.", candidate);
             viableCandidates.push(candidate);
        }
    }
    console.log("Viable candidates after existence check:", viableCandidates);
    return viableCandidates;

  } catch (troubleshootError) {
      console.error("Error during troubleshootWithLLM execution:", troubleshootError);
      return [];
  }
}

// --- Injectable function to check selector existence --- 
export function checkSelectorExistence(selector: string): { exists: boolean; count: number } {
    try {
        const elements = document.querySelectorAll(selector);
        return { exists: elements.length > 0, count: elements.length };
    } catch (e) {
        console.warn(`Error checking selector existence for "${selector}":`, e);
        return { exists: false, count: 0 };
    }
} 