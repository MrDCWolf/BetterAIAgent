import type { ExecutionPlan, PlanStep } from '../utils/llm';
import type { FoundElement, HeuristicsMap, RootNode } from '../common/types';
import { heuristicsMap } from './injectable/heuristics';
import { 
    actionCoreLogic, 
    scrollCoreLogic, 
    extractCoreLogic, 
    waitForElementLogic
} from './injectable/scriptBuilder';
import { withRetry, troubleshootWithLLM } from './retryUtils';

const MAX_STEP_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// --- Helper for Optional Popup Dismissal ---
// NOTE: This still uses the old pattern - needs refactor or removal if popups aren't needed.
// For now, commenting out the body as it relies on the removed defineHelpersAndRunCoreLogic
export async function attemptDismissPopups(tabId: number) {
    console.log(`Quickly checking for optional popups/banners on tab ${tabId}... (Currently Disabled due to CSP refactor)`);
    /*
    const popupTargets = ["dismiss_popup_button"];
    let dismissedSomething = false;

    // --- Needs refactor to use direct function injection ---
    // Example for find:
    // const findArgs = [target, true, heuristicsMap]; 
    // const findResults = await chrome.scripting.executeScript<{success: boolean, error?: string}, any[]>({...
    //     func: findElementByHeuristics, // Assuming findElementByHeuristics is exported & self-contained
    //     args: findArgs
    // });
    // Example for click:
    // const clickArgs = ['click', target, true, null, heuristicsMap];
    // const clickResults = await chrome.scripting.executeScript<{success: boolean, error?: string}, any[]>({...
    //    func: actionCoreLogic, 
    //    args: clickArgs
    // });
    // ... rest of logic ...
    */
}

export async function waitForElement(tabId: number, step: PlanStep, timeout = 15000): Promise<void> {
    const identifier = step.target || step.selector;
    const isSemantic = !!step.target;
    console.log(`Waiting for ${isSemantic ? 'target' : 'selector'} "${identifier}" in tab ${tabId} (timeout: ${timeout}ms)...`);
    
    // Prepare selectors to try (from heuristics or direct selector)
    let selectors: string[] = [];
    if (isSemantic) {
        selectors = heuristicsMap[identifier] || [];
    } else if (identifier) {
        selectors = [identifier];
    }
    if (selectors.length === 0) {
        throw new Error(`No selectors found for ${isSemantic ? 'target' : 'selector'}: ${identifier}`);
    }

    // Inject the self-contained waitForElementLogic function
    const results: chrome.scripting.InjectionResult<{ found: boolean; error?: string }>[] = 
      await chrome.scripting.executeScript<
        [string[], number], // Argument types
        Promise<{ found: boolean; error?: string }> // Return type FROM the function
    >({
        target: { tabId, allFrames: false }, // Wait should happen in the main frame
        func: waitForElementLogic, // Pass the function reference
        args: [selectors, timeout]
    });

    // Check results (executeScript returns an array of InjectionResult)
    // We now await the promise returned by waitForElementLogic inside the result
    const resultObj = results?.[0]?.result;
    if (!resultObj) {
        // Handle cases where the script injection itself failed
        console.error("waitForElement script injection failed or returned no result", results?.[0]);
        throw new Error(`waitForElement script injection failed for ${step.target || step.selector}`);
    }

    // No need to await here - executeScript handles the promise resolution
    if (!resultObj.found) {
         const errorMsg = resultObj.error || `Timeout waiting for ${step.target || step.selector}`;
        throw new Error(errorMsg);
    }
    console.log(`${step.target ? 'Target' : 'Selector'} "${identifier}" found.`);
}

export async function handleNavigate(tabId: number, step: PlanStep) {
    if (!step.url || typeof step.url !== 'string') {
        throw new Error('Navigate step requires a valid string url.');
    }
    console.log(`Navigating tab ${tabId} to ${step.url}`);
    await chrome.tabs.update(tabId, { url: step.url });
    await new Promise<void>(resolve => {
        const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                console.log(`Tab ${tabId} navigation complete.`);
                setTimeout(resolve, 500);
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            console.warn(`Navigation complete listener timed out for tab ${tabId}, proceeding anyway.`);
            resolve();
        }, 10000);
    });
}

export async function handleType(tabId: number, step: PlanStep) {
    if (!step.selector && !step.target) {
        throw new Error('Type step requires a valid target or selector.');
    }
    if (typeof step.text !== 'string') {
        throw new Error('Type step requires a string value for text.');
    }

    const identifier = step.target || step.selector;
    const isSemantic = !!step.target;
    // Ensure args match the function signature EXACTLY
    const argsForCoreLogic: [string, string, boolean, string | null | undefined, HeuristicsMap] = 
        ['type', identifier, isSemantic, step.text, heuristicsMap];

    const results: chrome.scripting.InjectionResult<{ success: boolean; error?: string }>[] = 
      await chrome.scripting.executeScript<
        typeof argsForCoreLogic, // Use tuple type for args
        { success: boolean; error?: string } // Return type
    >({
        target: { tabId, allFrames: true }, // Try in all frames
        func: actionCoreLogic,           // Pass function reference
        args: argsForCoreLogic           // Pass data arguments
    });

    const successResult = results.find(r => r.result?.success);
    if (!successResult) {
        const errorResult = results.find(r => r.result?.error);
        // Refine error message if possible
        let errorMsg = 'Unknown script error or element not found';
        if (errorResult?.result?.error) {
            errorMsg = errorResult.result.error;
        } else if (results.every(r => r.result?.error === 'Element not found in this frame')) {
             errorMsg = 'Element not found in any frame';
        } else if (results.every(r => r.result?.error === 'Element found but not visible or interactive in this frame')) {
             errorMsg = 'Element found but not visible or interactive in any frame';
        }
        throw new Error(`Failed to execute type action: ${errorMsg}`);
    }
    console.log(`Type action successful in at least one frame.`);
}

export async function handleClick(tabId: number, step: PlanStep): Promise<number> {
     if (!step.selector && !step.target) {
        throw new Error('Click step requires a valid target or selector.');
    }

    await waitForElement(tabId, step); // Keep wait before click

    const identifier = step.target || step.selector;
    const isSemantic = !!step.target;
    // Ensure args match the function signature EXACTLY
    const argsForCoreLogic: [string, string, boolean, string | null | undefined, HeuristicsMap] = 
        ['click', identifier, isSemantic, null, heuristicsMap];

    let newTabId: number | null = null;
    const newTabListener = (newTab: chrome.tabs.Tab) => {
        if (newTab.openerTabId === tabId) {
            console.log(`Detected new tab opened by target tab: ID=${newTab.id}, URL=${newTab.pendingUrl || newTab.url}`);
            newTabId = newTab.id ?? null;
        }
    };
    chrome.tabs.onCreated.addListener(newTabListener);

    let scriptError: Error | null = null;
    try {
        const results: chrome.scripting.InjectionResult<{ success: boolean; error?: string }>[] = 
          await chrome.scripting.executeScript<
             typeof argsForCoreLogic, // Use tuple type for args
             { success: boolean; error?: string } // Return type
        >({
            target: { tabId, allFrames: true }, // Try in all frames
            func: actionCoreLogic,           // Pass function reference
            args: argsForCoreLogic           // Pass data arguments
        });

        const successResult = results.find(r => r.result?.success);
        if (!successResult) {
            const errorResult = results.find(r => r.result?.error);
            // Refine error message
             let errorMsg = 'Unknown script error or element not found';
             if (errorResult?.result?.error) {
                 errorMsg = errorResult.result.error;
             } else if (results.every(r => r.result?.error === 'Element not found in this frame')) {
                 errorMsg = 'Element not found in any frame';
             } else if (results.every(r => r.result?.error === 'Element found but not visible or interactive in this frame')) {
                 errorMsg = 'Element found but not visible or interactive in any frame';
             }
            scriptError = new Error(`Failed to execute click action: ${errorMsg}`);
        }
    } catch (execError) {
        scriptError = execError instanceof Error ? execError : new Error(String(execError));
    } finally {
        chrome.tabs.onCreated.removeListener(newTabListener);
    }

    if (scriptError) {
        throw scriptError;
    }

    if (newTabId !== null) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for tab to potentially load
        // await attemptDismissPopups(newTabId); // Disabled
        console.log(`Switching active tab context to newly opened tab: ${newTabId}`);
        return newTabId;
    }

    console.log(`Click action successful in at least one frame. No new tab detected or associated.`);
    return tabId;
}

export async function handleWait(tabId: number, step: PlanStep) {
    if (step.selector || step.target) {
         await waitForElement(tabId, step, (step.timeout as number | undefined) || 10000);
    } else if (step.duration && typeof step.duration === 'number') {
        console.warn(`Performing fixed duration wait (${step.duration}ms) - prefer selector/target-based waits.`);
        await new Promise(resolve => setTimeout(resolve, step.duration));
    } else {
        throw new Error('Wait step requires a valid target, selector, or a numeric duration.');
    }
}

export async function handleScroll(tabId: number, step: PlanStep) {
    console.log(`Executing scroll step:`, step);

    // Ensure args match the function signature EXACTLY
    const argsForCoreLogic: [any, HeuristicsMap] = [step, heuristicsMap];

    const results: chrome.scripting.InjectionResult<{ success: boolean; error?: string }>[] = 
      await chrome.scripting.executeScript<
        typeof argsForCoreLogic, // Use tuple type for args
        { success: boolean; error?: string } // Return type
    >({
        target: { tabId, allFrames: true }, // Try scroll in all frames
        func: scrollCoreLogic,            // Pass function reference
        args: argsForCoreLogic            // Pass data arguments
    });

    // Scroll is allowed to fail in some frames if element not present
    // Check if *any* frame succeeded OR if all frames reported "not found" (which we treat as ok for scroll)
    const success = results.some(r => r.result?.success);
    
    if (!success) {
        // If no frame reported success, check for specific errors
        const errorResult = results.find(r => !r.result?.success && r.result?.error);
         if (errorResult) {
            throw new Error(`Scroll action failed: ${errorResult.result?.error || 'Unknown script error'}`);
        }
        // If no success and no specific error, maybe something else went wrong?
        console.warn("Scroll action did not succeed in any frame, but no specific error reported.")
    }
    
    console.log("Scroll action completed (or target not found in specific frames).");
}

export async function handleExtract(tabId: number, step: PlanStep) {
    console.log(`Executing extract step:`, step);
    const identifier = step.target || step.selector;
    if (!identifier) {
        throw new Error('Extract step requires a valid target or selector.');
    }
    const isSemantic = !!step.target;
    const attribute = step.attribute as string | undefined;

    await waitForElement(tabId, step); // Wait for element first

    // Ensure args match the function signature EXACTLY
    const argsForCoreLogic: [string, boolean, string | null | undefined, HeuristicsMap] = 
        [identifier, isSemantic, attribute, heuristicsMap];

    const results: chrome.scripting.InjectionResult<{ success: boolean; data?: string | null; error?: string }>[] = 
      await chrome.scripting.executeScript<
        typeof argsForCoreLogic, // Use tuple type for args
        { success: boolean; data?: string | null; error?: string } // Return type
    >({
        target: { tabId, allFrames: true }, // Try extract in all frames
        func: extractCoreLogic,          // Pass function reference
        args: argsForCoreLogic           // Pass data arguments
    });

    const successResult = results.find(r => r.result?.success);
    if (successResult && successResult.result) {
        const extractedValue = successResult.result.data;
        console.log(`Extraction successful. Value:`, extractedValue);
    } else {
        const errorResult = results.find(r => r.result?.error && r.result.error !== 'Element not found in this frame');
        const errorMessage = errorResult?.result?.error || 'Element not found in any frame or extraction failed';
        throw new Error(`Extraction failed: ${errorMessage}`);
    }
}

export async function handleGoBack(tabId: number, step: PlanStep) {
    console.log(`Executing go_back step for tab ${tabId}`);
    await chrome.tabs.goBack(tabId);
    // Optional: Add a small delay or wait for tab update if needed
    await new Promise(resolve => setTimeout(resolve, 500)); 
}

export async function handleGoForward(tabId: number, step: PlanStep) {
    console.log(`Executing go_forward step for tab ${tabId}`);
    await chrome.tabs.goForward(tabId);
    // Optional: Add a small delay or wait for tab update if needed
    await new Promise(resolve => setTimeout(resolve, 500)); 
}

export async function handleRefresh(tabId: number, step: PlanStep) {
    console.log(`Executing refresh step for tab ${tabId}`);
    await chrome.tabs.reload(tabId);
    // Optional: Add a small delay or wait for tab update if needed
    await new Promise(resolve => setTimeout(resolve, 500)); 
}

export async function handleScreenshot(tabId: number, step: PlanStep) {
    const filename = step.filename || `screenshot-${Date.now()}.png`;
    console.log(`Executing screenshot step for tab ${tabId}. Filename: ${filename}`);
    // TODO: Implement actual screenshot capture using chrome.tabs.captureVisibleTab
    // For now, just log a message.
    console.warn(`Screenshot functionality not fully implemented yet. Would save as ${filename}`);
}

export async function executePlanSteps(currentTabId: number, plan: ExecutionPlan) {
    console.log(`Starting execution for tab ${currentTabId}, plan:`, plan);
    let activeTabId = currentTabId;
    for (const [index, step] of plan.steps.entries()) {
        console.log(`Executing step ${index + 1}/${plan.steps.length} on tab ${activeTabId}:`, step);
        const attempts = step.retryCount ?? MAX_STEP_RETRIES; // Use constant
        const delayMs = step.retryDelayMs ?? RETRY_DELAY_MS; // Use constant
        await withRetry(
            async () => {
                switch (step.action) {
                    case 'navigate':
                        await handleNavigate(activeTabId, step);
                        // await attemptDismissPopups(activeTabId); // Still disabled
                        break;
                    case 'type':
                        await handleType(activeTabId, step);
                        break;
                    case 'click':
                        activeTabId = await handleClick(activeTabId, step); // Updates activeTabId
                        console.log(`Click action complete. Subsequent steps target tab: ${activeTabId}`);
                        break;
                    case 'wait':
                        await handleWait(activeTabId, step);
                        break;
                    case 'scroll':
                        await handleScroll(activeTabId, step);
                        break;
                    case 'extract':
                        await handleExtract(activeTabId, step);
                        break;
                    case 'go_back':
                        await handleGoBack(activeTabId, step);
                        break;
                    case 'go_forward':
                        await handleGoForward(activeTabId, step);
                        break;
                    case 'refresh':
                        await handleRefresh(activeTabId, step);
                        break;
                    case 'screenshot':
                        await handleScreenshot(activeTabId, step);
                        break;
                     // MISSING CASES for select, hover, clear - should be added if needed
                     /*
                    case 'select':
                        await handleSelect(activeTabId, step); 
                        break;
                    case 'hover':
                        await handleHover(activeTabId, step);
                        break;
                    case 'clear':
                        await handleClear(activeTabId, step);
                        break; 
                    */
                    default:
                         // Use type assertion for safety if step has unknown actions
                        console.warn(`Unsupported action type: ${(step as any).action}`);
                }
                console.log(`Step ${index + 1} completed successfully.`);
            },
            attempts,
            delayMs,
            async (err) => troubleshootWithLLM(step, err, activeTabId)
        );
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between steps
    }
    console.log(`Plan execution complete. Final active tab was ${activeTabId}.`);
} 