import type { HeuristicsMap, FoundElement, RootNode } from '../../common/types';

// --- Core Logic Functions (to be injected) ---
// These functions now assume helpers (isElementVisibleAndInteractiveSource, 
// findElementByHeuristicsSource, findElementBySelectorSource) are globally available (e.g., on window)

declare global {
    // Declare the helper functions expected in the global scope
    function isElementVisibleAndInteractiveSource(element: Element | null): element is HTMLElement;
    function findElementByHeuristicsSource(targetType: string, rootNode: RootNode, heuristics: HeuristicsMap): FoundElement;
    function findElementBySelectorSource(sel: string, rootNode: RootNode): FoundElement;
}

export function findElementCoreLogic(identifier: string, isSemantic: boolean, heuristics: HeuristicsMap): FoundElement {
  // Calls global helpers directly
  return isSemantic ? findElementByHeuristicsSource(identifier, document, heuristics) : findElementBySelectorSource(identifier, document);
}

export function actionCoreLogic(actionType: string, identifier: string, isSemantic: boolean, text: string | null | undefined, heuristics: HeuristicsMap): { success: boolean; error?: string } {
  if (actionType !== 'type' && actionType !== 'click') {
    return { success: false, error: `Invalid action type: ${actionType}` };
  }
  // Calls global helpers directly
  let element = isSemantic ? findElementByHeuristicsSource(identifier, document, heuristics) : findElementBySelectorSource(identifier, document);
  if (!element) return { success: false, error: 'Element not found in this frame' };
  try {
    if (actionType === 'type') {
      if (typeof text !== 'string') return { success: false, error: 'Text is required for type action' };
      (element as HTMLInputElement | HTMLTextAreaElement).focus();
      (element as HTMLInputElement | HTMLTextAreaElement).value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      (element as HTMLInputElement | HTMLTextAreaElement).blur();
    } else if (actionType === 'click') {
      element.click();
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function scrollCoreLogic(step: any, heuristics: HeuristicsMap): { success: boolean; error?: string } {
  let elementToScroll: HTMLElement | Window = window;
  const id = step.target || step.selector;
  const isSem = !!step.target;
  if (id) {
     // Calls global helpers directly
    let maybeElement = isSem ? findElementByHeuristicsSource(id, document, heuristics) : findElementBySelectorSource(id, document);
    if (maybeElement) elementToScroll = maybeElement;
    else return { success: true }; // Not found in this frame
  }
  try {
    const direction = step.direction;
    const pixels = step.pixels;
    if (elementToScroll instanceof HTMLElement) {
      if (direction === 'top') elementToScroll.scrollTop = 0;
      else if (direction === 'bottom') elementToScroll.scrollTop = elementToScroll.scrollHeight;
      else if (direction === 'up') elementToScroll.scrollTop -= (pixels || elementToScroll.clientHeight * 0.8);
      else if (direction === 'down') elementToScroll.scrollTop += (pixels || elementToScroll.clientHeight * 0.8);
      else { elementToScroll.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    } else { // elementToScroll is Window
      if (direction === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
      else if (direction === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      else if (direction === 'up') window.scrollBy({ top: -(pixels || window.innerHeight * 0.8), behavior: 'smooth' });
      else if (direction === 'down') window.scrollBy({ top: (pixels || window.innerHeight * 0.8), behavior: 'smooth' });
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function extractCoreLogic(identifier: string, isSemantic: boolean, attribute: string | null | undefined, heuristics: HeuristicsMap): { success: boolean; data?: string | null; error?: string } {
   // Calls global helpers directly
  let element = isSemantic ? findElementByHeuristicsSource(identifier, document, heuristics) : findElementBySelectorSource(identifier, document);
  if (!element) return { success: false, error: 'Element not found in this frame' };
  try {
    let extractedData: string | null = null;
    if (attribute) {
      extractedData = element.getAttribute(attribute);
    } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      extractedData = element.value;
    } else {
      extractedData = element.textContent ? element.textContent.trim() : null;
    }
    return { success: true, data: extractedData };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
} 