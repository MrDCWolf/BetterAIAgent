import type { HeuristicsMap, FoundElement, RootNode } from '../../common/types';

// Standalone helper for checking element visibility and interactivity
export function isElementVisibleAndInteractiveSource(element: Element | null): element is HTMLElement {
  const logPrefix = '[Better AI Agent - Injection - Visibility]';
  if (!element) {
      // console.debug(`${logPrefix} Element is null.`);
      return false;
  }
  if (!(element instanceof HTMLElement)) { 
      // console.debug(`${logPrefix} Element is not HTMLElement:`, element);
      return false; 
  }
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  
  // Log detailed reasons for invisibility
  if (style.display === 'none') { /*console.debug(`${logPrefix} display is none:`, element);*/ return false; }
  if (style.visibility === 'hidden') { /*console.debug(`${logPrefix} visibility is hidden:`, element);*/ return false; }
  if (style.opacity === '0') { /*console.debug(`${logPrefix} opacity is 0:`, element);*/ return false; }
  if ((element as HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement).disabled) { /*console.debug(`${logPrefix} is disabled:`, element);*/ return false; }
  if ((element as HTMLInputElement | HTMLTextAreaElement).readOnly) { /*console.debug(`${logPrefix} is readOnly:`, element);*/ return false; }
  if (element.offsetParent === null && style.position !== 'fixed') { /*console.debug(`${logPrefix} offsetParent is null:`, element);*/ return false; } // Allow fixed position elements
  if (rect.width <= 0 || rect.height <= 0) { /*console.debug(`${logPrefix} width/height is 0:`, element);*/ return false; }
  
  // console.debug(`${logPrefix} Element IS visible/interactive:`, element);
  return true;
}

// Standalone function to find an element by heuristics
export function findElementByHeuristicsSource(targetType: string, rootNode: RootNode = document, heuristics: HeuristicsMap): FoundElement {
  const logPrefix = '[Better AI Agent - Injection - Heuristics]';
  console.debug(`${logPrefix} Searching for target '${targetType}' in root:`, rootNode);
  const selectors = heuristics[targetType] || [];
  if (!selectors.length) {
      console.warn(`${logPrefix} No heuristics defined for target type: ${targetType}`);
      return null;
  }

  for (const selector of selectors) {
    console.debug(`${logPrefix} Trying selector: '${selector}'`);
    try {
      let checkText = null;
      let actualSelector = selector;
      if (selector.includes(':contains(')) {
        const match = selector.match(/(.*):contains\("(.*?)"\)/i);
        if (match && match.length > 2) {
          actualSelector = match[1] || '*';
          checkText = match[2].toLowerCase();
          console.debug(`${logPrefix}  -> Using actual selector '${actualSelector}' and checking for text '${checkText}'`);
        }
      }
      const elements: NodeListOf<Element> = rootNode.querySelectorAll(actualSelector);
       if (elements.length > 0) {
           console.debug(`${logPrefix}  -> Found ${elements.length} raw element(s) for selector '${actualSelector}'`);
       } else {
            // console.debug(`${logPrefix}  -> Found 0 raw elements for selector '${actualSelector}'`);
            continue; // Skip if no elements found at all
       }
      for (const element of elements) {
        let textMatch = !checkText;
        if (checkText && element.textContent) {
          textMatch = element.textContent.trim().toLowerCase().includes(checkText);
        }
        if (!textMatch) continue; // Skip if text doesn't match

        console.debug(`${logPrefix}  -> Checking visibility for element:`, element);
        const isVisible = isElementVisibleAndInteractiveSource(element);
        console.debug(`${logPrefix}  -> Element visibility result: ${isVisible}`);

        if (isVisible) {
          console.log(`${logPrefix} Found visible element for target '${targetType}' with selector '${selector}':`, element);
          return element;
        }
      }
    } catch (e) { 
         console.warn(`${logPrefix} Error querying selector '${selector}':`, e);
    }
  }
  console.debug(`${logPrefix} Target '${targetType}' not found in current root. Checking shadow DOMs...`);
  const allElements: NodeListOf<Element> = rootNode.querySelectorAll('*');
  for (const element of allElements) {
    if (element.shadowRoot) {
      console.debug(`${logPrefix} Checking shadow root of:`, element);
      const foundInShadow = findElementByHeuristicsSource(targetType, element.shadowRoot as ShadowRoot, heuristics);
      if (foundInShadow) {
           console.log(`${logPrefix} Found target '${targetType}' in shadow root of:`, element);
           return foundInShadow;
      }
    }
  }
   console.debug(`${logPrefix} Target '${targetType}' not found after checking shadow DOMs.`);
  return null;
}

// Standalone function to find an element by selector
export function findElementBySelectorSource(sel: string, rootNode: RootNode = document): FoundElement {
  try {
    const elements: NodeListOf<Element> = rootNode.querySelectorAll(sel);
    for (const el of elements) {
      if (isElementVisibleAndInteractiveSource(el)) return el;
    }
    const all: NodeListOf<Element> = rootNode.querySelectorAll('*');
    for (const el of all) {
      if (el.shadowRoot) {
        const foundInShadow = findElementBySelectorSource(sel, el.shadowRoot as ShadowRoot);
        if (foundInShadow) return foundInShadow;
      }
    }
  } catch (e) { /* ignore */ }
  return null;
} 