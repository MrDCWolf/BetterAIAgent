import type { ExecutionPlan, PlanStep, StepResult } from '../common/types';
import type { FoundElement, HeuristicsMap, RootNode } from '../common/types';
import { heuristicsMap } from './injectable/heuristics';
import { 
    actionCoreLogic, 
    scrollCoreLogic, 
    extractCoreLogic, 
    waitForElementLogic
} from './injectable/scriptBuilder';
import { withRetry, troubleshootWithLLM, FallbackError } from './retryUtils';

const MAX_STEP_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Local type for formatted steps sent to the panel
interface FormattedStep extends PlanStep { // Inherits original PlanStep properties
    id: number;
    description: string;
}

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
         // Use a shorter timeout for optional waits, otherwise use specified or default
         const timeoutMs = step.optional ? 2000 : (step.timeout as number | undefined) || 10000;
         console.log(`Executing wait for ${step.target || step.selector} (Optional: ${!!step.optional}, Timeout: ${timeoutMs}ms)`);
         await waitForElement(tabId, step, timeoutMs);
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
        return extractedValue;
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

// --- Main Plan Executor ---

// Helper to generate description (can be expanded)
function generateStepDescription(step: PlanStep): string {
    switch (step.action) {
        case 'navigate': return `Navigate to ${step.url}`;
        case 'type': return `Type "${step.text?.substring(0, 20)}${step.text?.length > 20 ? '...' : ''}" into ${step.target || step.selector}` + (step.submit ? ' and submit' : '');
        case 'click': return `Click on ${step.target || step.selector}`;
        case 'wait': return `Wait for ${step.target || step.selector || (step.duration + 'ms')}`;
        case 'scroll': return `Scroll ${step.direction || 'element into view'} ${step.target || step.selector || 'page'}`;
        case 'extract': return `Extract ${step.attribute || 'text'} from ${step.target || step.selector}`;
        case 'go_back': return `Navigate back`;
        case 'go_forward': return `Navigate forward`;
        case 'refresh': return `Refresh page`;
        case 'screenshot': return `Take screenshot${step.filename ? ' (' + step.filename + ')' : ''}`;
        // Add cases for select, hover, clear if implemented
        default: return `Perform action: ${(step as any).action}`;
    }
}

// --- Helper function to execute a single step (original or fallback) ---
async function executeSingleAction(step: PlanStep, tabId: number): Promise<{ tabId: number; data?: any }> {
    let currentTabId = tabId;
    let extractedData: any = undefined;
    // TODO: Consider how to handle extracted data from fallbacks if needed

    console.log(`Attempting action: ${step.action} for target/selector: ${step.target || step.selector || step.url || step.duration || 'N/A'}`);

    switch (step.action) {
        case 'navigate': await handleNavigate(currentTabId, step); break;
        case 'type': await handleType(currentTabId, step); break;
        case 'click': currentTabId = await handleClick(currentTabId, step); break; // Updates activeTabId
        case 'wait': await handleWait(currentTabId, step); break;
        case 'scroll': await handleScroll(currentTabId, step); break;
        case 'extract': 
             extractedData = await handleExtract(currentTabId, step); // Assuming handleExtract returns data
             break; 
        case 'go_back': await handleGoBack(currentTabId, step); break;
        case 'go_forward': await handleGoForward(currentTabId, step); break;
        case 'refresh': await handleRefresh(currentTabId, step); break;
        case 'screenshot': await handleScreenshot(currentTabId, step); break;
        default: console.warn(`Unsupported action type in fallback execution: ${(step as any).action}`);
                 throw new Error(`Unsupported fallback action: ${step.action}`);
    }
    return { tabId: currentTabId, data: extractedData };
}

export async function executePlanSteps(currentTabId: number, plan: ExecutionPlan, requestId: string) {
    console.log(`Starting execution for tab ${currentTabId}, plan:`, plan, `ReqID: ${requestId}`);
    let activeTabId = currentTabId;

    // 1. Format plan for display (add id, description)
    const formattedPlan: FormattedStep[] = plan.steps.map((step, index) => ({
        ...step, // Keep original step properties
        id: index, // Use index as unique ID for this execution
        description: generateStepDescription(step)
    }));
    console.log("Formatted plan:", formattedPlan);

    // 2. Send formatted plan back to panel
    console.log("[Executor] Sending planReceived message...");
    chrome.runtime.sendMessage({ 
        type: "planReceived", 
        requestId: requestId, 
        formattedPlan: formattedPlan 
    });

    let overallSuccess = true;
    let finalErrorMessage: string | undefined = undefined;
    let stepResultPayload: StepResult = { success: false }; // Initialize StepResult payload

    // 3. Execute steps sequentially
    for (const step of formattedPlan) {
        console.log(`Executing step ${step.id + 1}/${formattedPlan.length} on tab ${activeTabId}:`, step);
        const attempts = step.retryCount ?? MAX_STEP_RETRIES;
        const delayMs = step.retryDelayMs ?? RETRY_DELAY_MS;

        stepResultPayload = { success: false }; // Reset for current step
        let attemptFallback = false;

        try {
            // --- Initial Attempt with Retry --- 
            const initialResult = await withRetry(
                () => executeSingleAction(step, activeTabId),
                attempts,
                delayMs,
                !!step.optional, // Pass the optional status
                async (err) => troubleshootWithLLM(step, err, activeTabId, requestId) 
            );
            activeTabId = initialResult.tabId; // Update activeTabId if changed
            stepResultPayload.success = true;
            console.log(`Step ${step.id + 1} completed successfully on initial try (with retry).`);

        } catch (error) {
            // --- Handle Failures --- 
            const originalError = error instanceof FallbackError ? error.originalError : error;
            const originalErrorMessage = originalError instanceof Error ? originalError.message : String(originalError);
            
            // 1) Send initial failure message BEFORE attempting fallbacks
            console.log(`[Executor] Sending initial failure message for step ${step.id}...`);
            stepResultPayload = { success: false, error: originalErrorMessage }; // Base payload for initial failure
            chrome.runtime.sendMessage({
                type: "planStepResult",
                requestId: requestId,
                isFinal: false, 
                stepId: step.id,
                result: stepResultPayload 
            });
            
            // Check if we should attempt fallbacks
            if (error instanceof FallbackError && error.candidates && error.candidates.length > 0) {
                console.warn(`Step ${step.id + 1} failed initial attempts, trying ${error.candidates.length} fallback candidate(s)...`);
                let fallbackSucceeded = false;
                let lastFallbackResult: StepResult['fallback'] | undefined = undefined;

                // 2) Iterate through candidates
                for (const candidate of error.candidates) {
                    console.log(` -> Trying fallback candidate:`, candidate);
                    try {
                        const candidateToRun = { ...step, ...candidate }; 
                        const fallbackExecResult = await executeSingleAction(candidateToRun, activeTabId);
                        activeTabId = fallbackExecResult.tabId; 
                        
                        console.log(`   -> Fallback candidate succeeded!`);
                        fallbackSucceeded = true;
                        lastFallbackResult = { step: candidate, success: true };
                        break; // Stop trying fallbacks on first success

                    } catch (fallbackAttemptError) {
                        console.warn(`   -> Fallback candidate failed:`, fallbackAttemptError);
                        lastFallbackResult = { 
                            step: candidate, 
                            success: false, 
                            error: fallbackAttemptError instanceof Error ? fallbackAttemptError.message : String(fallbackAttemptError)
                        };
                        // Continue to the next candidate
                    }
                }

                // Update final step result payload after trying fallbacks
                stepResultPayload.success = fallbackSucceeded;
                stepResultPayload.fallback = lastFallbackResult; // Record the last fallback attempted
                if (fallbackSucceeded) {
                    stepResultPayload.error = undefined; // Clear original error if fallback worked
                } else {
                    // Keep original error message if all fallbacks failed
                    console.error(`Step ${step.id + 1} failed after trying all ${error.candidates.length} fallback candidates.`);
                    finalErrorMessage = stepResultPayload.error || 'Step failed after all fallbacks';
                    overallSuccess = false; 
                }

            } else {
                // --- Hard Failure (Not FallbackError or no candidates) ---
                console.error(`Step ${step.id + 1} failed with non-recoverable error or no fallback provided:`, originalError);
                // stepResultPayload already set to initial failure
                finalErrorMessage = stepResultPayload.error;
                overallSuccess = false;
            }
        }

        // --- Send FINAL Step Result (after initial attempt + potential fallbacks) --- 
        console.log(`[Executor] Sending FINAL planStepResult message for step ${step.id}...`, stepResultPayload);
        // Ensure the payload includes fallback details if attempted
        chrome.runtime.sendMessage({
            type: "planStepResult",
            requestId: requestId,
            isFinal: false, 
            stepId: step.id,
            result: stepResultPayload 
        });
        
        // --- Stop Execution on Failure (unless optional) --- 
        if (!stepResultPayload.success) {
            if (step.optional) {
                console.log(`Optional step ${step.id + 1} failed, but proceeding anyway.`);
            } else {
                console.log("Stopping plan execution due to step failure.");
                break; 
            }
        }

        // Small delay between steps unless it was the last one
        if (step.id < formattedPlan.length - 1) {
             await new Promise(resolve => setTimeout(resolve, 500)); 
        }
    }

    // 4. Send final overall status message
     console.log("[Executor] Sending FINAL planStepResult message...");
     chrome.runtime.sendMessage({
        type: "planStepResult",
        requestId: requestId,
        isFinal: true, // Mark this as the final message for this request
        stepId: formattedPlan.length - 1, // Associate with last step or use -1?
        result: { 
            success: overallSuccess, 
            error: finalErrorMessage 
            // No fallback info for overall status
        }
    });
} 