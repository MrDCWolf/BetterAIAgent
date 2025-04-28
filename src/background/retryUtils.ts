/**
 * Retry an async step with delay/backoff. On terminal failure, invoke onFail.
 */
export async function withRetry<T>(
  action: () => Promise<T>,
  attempts: number,
  delayMs: number,
  onFail: (error: any) => Promise<void>
): Promise<T> {
  let lastError: any;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await action();
    } catch (err) {
      lastError = err;
      console.warn(`Attempt ${i} failed:`, err);
      if (i < attempts) {
        await new Promise(res => setTimeout(res, delayMs * i)); // linear back-off
      }
    }
  }
  // All retries exhausted
  await onFail(lastError);
  throw lastError;
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
import type { PlanStep } from '../common/types';
// You may need to adjust the import path for your LLM client
// import { LLMClient } from '../utils/llmClient';

export async function troubleshootWithLLM(stepInfo: PlanStep, error: any, tabId: number): Promise<void> {
  const html = await capturePageHTML(tabId);
  const screenshot = await captureScreenshot(tabId);
  const truncatedHtml = html.slice(0, 50000);
  const prompt = `
I attempted the step:
  ${JSON.stringify(stepInfo, null, 2)}

But it failed with error: ${error?.message || error}

Here is the full page HTML (truncated):
\u0060\u0060\u0060html\n${truncatedHtml}\n\u0060\u0060\u0060

And here is a screenshot (base64-encoded PNG):
${screenshot}

Please analyze why this failed and suggest:
1. How to adjust the selector or action.
2. Any recovery steps (e.g. scroll, wait, frame switch).
3. A corrected JSON plan step.
`;
  // const response = await LLMClient.call(prompt);
  // For now, just log the prompt and simulate a response
  console.info('LLM troubleshooting prompt:', prompt);
  // console.info('LLM troubleshooting suggestions:', response);
} 