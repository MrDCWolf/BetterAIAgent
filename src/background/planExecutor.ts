import type { ExecutionPlan, PlanStep } from '../utils/llm';
import type { FoundElement, HeuristicsMap, RootNode } from '../common/types';
import { heuristicsMap } from './injectable/heuristics';
import { 
    isElementVisibleAndInteractiveSource, 
    findElementByHeuristicsSource, 
    findElementBySelectorSource 
} from './injectable/pageUtils';
import { 
    findElementCoreLogic, 
    actionCoreLogic, 
    scrollCoreLogic, 
    extractCoreLogic 
} from './injectable/scriptBuilder';

const MAX_STEP_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// --- Helper to define functions and run core logic in the target page context ---
function defineHelpersAndRunCoreLogic(helpersSource: { [key: string]: string }, coreLogicSource: string, argsForCoreLogic: any[]) {
    console.log('[Better AI Agent - Injection] Defining helpers...');
    for (const key in helpersSource) {
        try {
            (window as any)[key] = new Function(`return ${helpersSource[key]}`)();
             console.log(`[Better AI Agent - Injection] Helper defined: ${key}`);
        } catch (e) {
            console.error(`[Better AI Agent - Injection] Error defining helper ${key}:`, e);
            throw e; 
        }
    }
    
    console.log('[Better AI Agent - Injection] Defining core logic...');
    let coreFunc;
    try {
         coreFunc = new Function(`return ${coreLogicSource}`)();
         console.log('[Better AI Agent - Injection] Core logic defined.');
    } catch(e) {
        console.error(`[Better AI Agent - Injection] Error defining core logic:`, e);
        throw e;
    }

    console.log('[Better AI Agent - Injection] Executing core logic with args:', argsForCoreLogic);
    try {
        const result = coreFunc(...argsForCoreLogic);
        console.log('[Better AI Agent - Injection] Core logic result:', result);
        return result;
    } catch (e) {
         console.error('[Better AI Agent - Injection] Error executing core logic:', e);
         throw e;
    }
}

// --- Helper for Optional Popup Dismissal ---
export async function attemptDismissPopups(tabId: number) {
    console.log(`Quickly checking for optional popups/banners on tab ${tabId}...`);
    const popupTargets = ["dismiss_popup_button"];
    let dismissedSomething = false;

    // Prepare helper source code once
    const helpersSource = {
        isElementVisibleAndInteractiveSource: isElementVisibleAndInteractiveSource.toString(),
        findElementByHeuristicsSource: findElementByHeuristicsSource.toString(),
        findElementBySelectorSource: findElementBySelectorSource.toString()
    };

    for (const target of popupTargets) {
        try {
            // Find Element Call
            const findResults = await chrome.scripting.executeScript<
                [ { [key: string]: string }, string, any[] ], 
                FoundElement
            >({
                target: { tabId, allFrames: true },
                func: defineHelpersAndRunCoreLogic,
                args: [
                    helpersSource,
                    findElementCoreLogic.toString(),
                    [target, true, heuristicsMap]
                ]
            });

            const found = findResults.some(r => !!r.result);
            if (found) {
                console.log(`Found optional popup target "${target}". Attempting click...`);
                // Action Call
                const clickResults = await chrome.scripting.executeScript<
                     [ { [key: string]: string }, string, any[] ],
                     { success: boolean; error?: string }
                >({
                    target: { tabId, allFrames: true },
                    func: defineHelpersAndRunCoreLogic,
                    args: [
                        helpersSource,
                        actionCoreLogic.toString(),
                        ['click', target, true, null, heuristicsMap]
                    ]
                });

                const success = clickResults.some(r => r.result?.success);
                if (success) {
                    console.log(`Successfully clicked optional popup target "${target}".`);
                    dismissedSomething = true;
                    await new Promise(resolve => setTimeout(resolve, 500));
                } else {
                    console.warn(`Click attempt failed for optional popup target "${target}".`);
                }
            } else {
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

export async function waitForElement(tabId: number, step: PlanStep, timeout = 15000): Promise<void> {
    const identifier = step.target || step.selector;
    const isSemantic = !!step.target;
    console.log(`Waiting for ${isSemantic ? 'target' : 'selector'} "${identifier}" in tab ${tabId} (timeout: ${timeout}ms)...`);
    const started = Date.now();

    const helpersSource = {
        isElementVisibleAndInteractiveSource: isElementVisibleAndInteractiveSource.toString(),
        findElementByHeuristicsSource: findElementByHeuristicsSource.toString(),
        findElementBySelectorSource: findElementBySelectorSource.toString()
    };

    while (Date.now() - started < timeout) {
        try {
             const results = await chrome.scripting.executeScript<
                [ { [key: string]: string }, string, any[] ],
                FoundElement
            >({
                target: { tabId, allFrames: true },
                func: defineHelpersAndRunCoreLogic,
                args: [
                    helpersSource,
                    findElementCoreLogic.toString(),
                    [identifier, isSemantic, heuristicsMap]
                ]
            });
            const found = results.some(frameResult => !!frameResult.result);
            if (found) {
                console.log(`${isSemantic ? 'Target' : 'Selector'} "${identifier}" found.`);
                return;
            }
        } catch (e) {
            const errorMsg = (e instanceof Error) ? e.message : String(e);
            console.debug(`Polling for "${identifier}" encountered temporary error: ${errorMsg}`);
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Timeout waiting for ${isSemantic ? 'target' : 'selector'}: ${identifier}`);
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
    const helpersSource = {
        isElementVisibleAndInteractiveSource: isElementVisibleAndInteractiveSource.toString(),
        findElementByHeuristicsSource: findElementByHeuristicsSource.toString(),
        findElementBySelectorSource: findElementBySelectorSource.toString()
    };
    if (step.optional) {
        const findResults = await chrome.scripting.executeScript<
            [ { [key: string]: string }, string, any[] ],
            FoundElement
        >({
             target: { tabId, allFrames: true },
             func: defineHelpersAndRunCoreLogic,
             args: [
                 helpersSource, 
                 findElementCoreLogic.toString(),
                 [step.target || step.selector, !!step.target, heuristicsMap]
             ]
         });
        if (!findResults.some(r => !!r.result)) {
            console.log(`Skipping optional type action for element "${step.target || step.selector}" which was not found quickly.`);
            return;
        }
    }
    await waitForElement(tabId, step);
    const identifier = step.target || step.selector;
    const isSemantic = !!step.target;
    const results = await chrome.scripting.executeScript<
        [ { [key: string]: string }, string, any[] ],
        { success: boolean; error?: string }
    >({
        target: { tabId, allFrames: true },
        func: defineHelpersAndRunCoreLogic,
        args: [
            helpersSource,
            actionCoreLogic.toString(),
            ['type', identifier, isSemantic, step.text, heuristicsMap]
        ]
    });
    const successResult = results.find(r => r.result?.success);
    if (!successResult) {
        const errorResult = results.find(r => r.result?.error);
        throw new Error(`Failed to execute type action in any frame: ${errorResult?.result?.error || 'Unknown script error or element not found'}`);
    }
    console.log(`Type action successful in at least one frame.`);
}

export async function handleClick(tabId: number, step: PlanStep): Promise<number> {
    if (!step.selector && !step.target) {
        throw new Error('Click step requires a valid target or selector.');
    }
    const helpersSource = {
        isElementVisibleAndInteractiveSource: isElementVisibleAndInteractiveSource.toString(),
        findElementByHeuristicsSource: findElementByHeuristicsSource.toString(),
        findElementBySelectorSource: findElementBySelectorSource.toString()
    };
    if (step.optional) {
        const findResults = await chrome.scripting.executeScript<
            [ { [key: string]: string }, string, any[] ],
            FoundElement
        >({
            target: { tabId, allFrames: true },
            func: defineHelpersAndRunCoreLogic,
            args: [
                helpersSource, 
                findElementCoreLogic.toString(),
                [step.target || step.selector, !!step.target, heuristicsMap]
            ]
        });
        if (!findResults.some(r => !!r.result)) {
            console.log(`Skipping optional click action for element "${step.target || step.selector}" which was not found quickly.`);
            return tabId;
        }
    }
    await waitForElement(tabId, step);
    const identifier = step.target || step.selector;
    const isSemantic = !!step.target;
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
        const results = await chrome.scripting.executeScript<
            [ { [key: string]: string }, string, any[] ],
            { success: boolean; error?: string }
        >({
            target: { tabId, allFrames: true },
            func: defineHelpersAndRunCoreLogic,
            args: [
                helpersSource,
                actionCoreLogic.toString(),
                ['click', identifier, isSemantic, null, heuristicsMap]
            ]
        });
        const successResult = results.find(r => r.result?.success);
        if (!successResult) {
            const errorResult = results.find(r => r.result?.error);
            scriptError = new Error(`Failed to execute click action in any frame: ${errorResult?.result?.error || 'Unknown script error or element not found'}`);
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
        await new Promise(resolve => setTimeout(resolve, 1000));
        await attemptDismissPopups(newTabId);
        console.log(`Switching active tab context to newly opened tab: ${newTabId}`);
        return newTabId;
    }
    console.log(`Click action successful in at least one frame. No new tab detected or associated.`);
    return tabId;
}

export async function handleWait(tabId: number, step: PlanStep) {
    if (step.selector || step.target) {
        if (step.optional) {
            const helpersSource = {
                isElementVisibleAndInteractiveSource: isElementVisibleAndInteractiveSource.toString(),
                findElementByHeuristicsSource: findElementByHeuristicsSource.toString(),
                findElementBySelectorSource: findElementBySelectorSource.toString()
            };
            const findResults = await chrome.scripting.executeScript<
                [ { [key: string]: string }, string, any[] ],
                FoundElement
            >({
                target: { tabId, allFrames: true },
                func: defineHelpersAndRunCoreLogic,
                args: [
                    helpersSource,
                    findElementCoreLogic.toString(),
                    [step.target || step.selector, !!step.target, heuristicsMap]
                ]
            });
            if (findResults.some(r => !!r.result)) {
                console.log(`Optional wait target/selector "${step.target || step.selector}" found quickly.`);
                return;
            }
            console.log(`Optional wait target/selector "${step.target || step.selector}" not found quickly, skipping wait.`);
            return;
        }
        await waitForElement(tabId, step, step.timeout as number | undefined || 10000);
    } else if (step.duration && typeof step.duration === 'number') {
        console.warn(`Performing fixed duration wait (${step.duration}ms) - prefer selector/target-based waits.`);
        await new Promise(resolve => setTimeout(resolve, step.duration));
    } else {
        throw new Error('Wait step requires a valid target, selector, or a numeric duration.');
    }
}

export async function handleScroll(tabId: number, step: PlanStep) {
    console.log(`Executing scroll step:`, step);
    const identifier = step.target || step.selector;
    const isSemantic = !!step.target;
    let targetElementExists = false;
    const helpersSource = {
        isElementVisibleAndInteractiveSource: isElementVisibleAndInteractiveSource.toString(),
        findElementByHeuristicsSource: findElementByHeuristicsSource.toString(),
        findElementBySelectorSource: findElementBySelectorSource.toString()
    };
    if (identifier) {
        const findResults = await chrome.scripting.executeScript<
            [ { [key: string]: string }, string, any[] ],
            FoundElement
        >({
            target: { tabId, allFrames: true },
            func: defineHelpersAndRunCoreLogic,
            args: [
                helpersSource,
                findElementCoreLogic.toString(),
                [identifier, isSemantic, heuristicsMap]
            ]
        });
        targetElementExists = findResults.some(r => !!r.result);
        if (!targetElementExists) {
            console.warn(`Scroll target "${identifier}" not found quickly. Will scroll window instead.`);
        }
    }
    const results = await chrome.scripting.executeScript<
        [ { [key: string]: string }, string, any[] ],
        { success: boolean; error?: string }
    >({
        target: { tabId, allFrames: true },
        func: defineHelpersAndRunCoreLogic,
        args: [
            helpersSource,
            scrollCoreLogic.toString(),
            [step, heuristicsMap]
        ]
    });
    const errorResult = results.find(r => !r.result?.success && r.result?.error);
    if (errorResult) {
        throw new Error(`Scroll action failed: ${errorResult.result?.error || 'Unknown script error'}`);
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
    const helpersSource = {
        isElementVisibleAndInteractiveSource: isElementVisibleAndInteractiveSource.toString(),
        findElementByHeuristicsSource: findElementByHeuristicsSource.toString(),
        findElementBySelectorSource: findElementBySelectorSource.toString()
    };
    await waitForElement(tabId, step);
    const results = await chrome.scripting.executeScript<
        [ { [key: string]: string }, string, any[] ],
        { success: boolean; data?: string | null; error?: string }
    >({
        target: { tabId, allFrames: true },
        func: defineHelpersAndRunCoreLogic,
        args: [
            helpersSource,
            extractCoreLogic.toString(),
            [identifier, isSemantic, attribute, heuristicsMap]
        ]
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

export async function executePlanSteps(currentTabId: number, plan: ExecutionPlan) {
    console.log(`Starting execution for tab ${currentTabId}, plan:`, plan);
    let activeTabId = currentTabId;
    for (const [index, step] of plan.steps.entries()) {
        console.log(`Executing step ${index + 1}/${plan.steps.length} on tab ${activeTabId}:`, step);
        let attempt = 0;
        let lastError: Error | null = null;
        while (attempt < MAX_STEP_RETRIES) {
            attempt++;
            try {
                if (attempt > 1) {
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                    console.log(`Retrying step (Attempt ${attempt}/${MAX_STEP_RETRIES})...`);
                }
                switch (step.action) {
                    case 'navigate':
                        await handleNavigate(activeTabId, step);
                        await attemptDismissPopups(activeTabId);
                        break;
                    case 'type':
                        await handleType(activeTabId, step);
                        break;
                    case 'click':
                        activeTabId = await handleClick(activeTabId, step);
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
                    default:
                        console.warn(`Unsupported action type: ${step.action}`);
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
            }
        }
        if (lastError) {
            throw lastError;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    console.log(`Plan execution complete. Final active tab was ${activeTabId}.`);
} 