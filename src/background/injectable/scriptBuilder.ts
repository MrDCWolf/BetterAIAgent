import type { HeuristicsMap, FoundElement, RootNode } from '../../common/types';

// --- Core Logic Functions (Now self-contained with helpers defined inside) ---
// These functions will be passed DIRECTLY to chrome.scripting.executeScript

export function actionCoreLogic(actionType: string, identifier: string, isSemantic: boolean, text: string | null | undefined, heuristics: HeuristicsMap): { success: boolean; error?: string } {
  
  // --- Define Helpers INSIDE actionCoreLogic ---
  function _isElementVisibleAndInteractive(element: Element | null): element is HTMLElement {
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

  function _findElementBySelector(sel: string, rootNode: RootNode = document): FoundElement {
    try {
      const elements: NodeListOf<Element> = rootNode.querySelectorAll(sel);
      for (const el of elements) {
        if (_isElementVisibleAndInteractive(el)) return el;
      }
      const all: NodeListOf<Element> = rootNode.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) {
          const foundInShadow = _findElementBySelector(sel, el.shadowRoot as ShadowRoot);
          if (foundInShadow) return foundInShadow;
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function _findElementByHeuristics(targetType: string, rootNode: RootNode = document, heuristics: HeuristicsMap): FoundElement {
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
          const isVisible = _isElementVisibleAndInteractive(element); // Use inlined helper
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
        const foundInShadow = _findElementByHeuristics(targetType, element.shadowRoot as ShadowRoot, heuristics); // Recursive call
        if (foundInShadow) {
             console.log(`${logPrefix} Found target '${targetType}' in shadow root of:`, element);
             return foundInShadow;
        }
      }
    }
     console.debug(`${logPrefix} Target '${targetType}' not found after checking shadow DOMs.`);
    return null;
  }
  // --- End Helper Definitions ---

  // Find element using locally defined helpers
  let element = isSemantic ? _findElementByHeuristics(identifier, document, heuristics) : _findElementBySelector(identifier, document);
  
  if (!element) return { success: false, error: 'Element not found in this frame' };
  
  if (!_isElementVisibleAndInteractive(element)) { 
    return { success: false, error: 'Element found but not visible or interactive in this frame' };
  }

  try {
    if (actionType === 'type') {
      if (typeof text !== 'string') return { success: false, error: 'Text is required for type action' };
      
      const inputElement = element as HTMLInputElement | HTMLTextAreaElement;
      console.log('[ACTION CORE] Attempting focus...', inputElement);
      inputElement.focus();
      console.log('[ACTION CORE] Focus done. Attempting value clear...');
      inputElement.value = ''; // Clear existing value first
      console.log('[ACTION CORE] Value cleared. Dispatching input/change for clear...');
      element.dispatchEvent(new Event('input', { bubbles: true })); 
      element.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[ACTION CORE] Clear events dispatched. Starting character loop...');

      for (const char of text) {
        console.log(`[ACTION CORE] Typing char: ${char}`);
        inputElement.value += char;
        console.log('[ACTION CORE] Dispatching input event...');
        element.dispatchEvent(new Event('input', { bubbles: true })); 
        console.log('[ACTION CORE] Input event dispatched.');
      }
      console.log('[ACTION CORE] Char loop done. Dispatching final change event...');
      element.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[ACTION CORE] Final change dispatched. Simulating Enter key...');
      
      // Simulate Enter key press
      const enterKeyEvent = new KeyboardEvent('keydown', { 
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true, 
          cancelable: true 
      });
      element.dispatchEvent(enterKeyEvent);
      console.log('[ACTION CORE] Enter key dispatched. Attempting blur...');

      inputElement.blur();
      console.log('[ACTION CORE] Blur done. Type action success.');

    } else if (actionType === 'click') {
      console.log('[ACTION CORE] Attempting click...', element);
      element.click();
      console.log('[ACTION CORE] Click done. Click action success.');
    }
    return { success: true };
  } catch (e) {
    console.error('[ACTION CORE] Error during action:', e, 'Element:', element);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function scrollCoreLogic(step: any, heuristics: HeuristicsMap): { success: boolean; error?: string } {

  // --- Define Helpers INSIDE scrollCoreLogic ---
  function _isElementVisibleAndInteractive(element: Element | null): element is HTMLElement {
    if (!element || !(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return !(style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || 
             (element as any).disabled || (element as any).readOnly || 
             (element.offsetParent === null && style.position !== 'fixed') || 
             rect.width <= 0 || rect.height <= 0);
  }

  function _findElementBySelector(sel: string, rootNode: RootNode = document): FoundElement {
    try {
      const elements: NodeListOf<Element> = rootNode.querySelectorAll(sel);
      for (const el of elements) { if (_isElementVisibleAndInteractive(el)) return el; }
      const all: NodeListOf<Element> = rootNode.querySelectorAll('*');
      for (const el of all) { if (el.shadowRoot) { const f = _findElementBySelector(sel, el.shadowRoot as ShadowRoot); if (f) return f; } }
    } catch (e) {} return null;
  }

  function _findElementByHeuristics(targetType: string, rootNode: RootNode = document, heuristics: HeuristicsMap): FoundElement {
    const selectors = heuristics[targetType] || []; if (!selectors.length) return null;
    for (const selector of selectors) {
        try {
            let checkText = null; let actualSelector = selector;
            if (selector.includes(':contains(')) { const m = selector.match(/(.*):contains\("(.*?)"\)/i); if (m && m.length > 2) { actualSelector = m[1] || '*'; checkText = m[2].toLowerCase(); } }
            const elements: NodeListOf<Element> = rootNode.querySelectorAll(actualSelector); if (elements.length === 0) continue;
            for (const element of elements) {
                let textMatch = !checkText; if (checkText && element.textContent) { textMatch = element.textContent.trim().toLowerCase().includes(checkText); } if (!textMatch) continue;
                if (_isElementVisibleAndInteractive(element)) return element;
            }
        } catch (e) {}
    }
    const allElements: NodeListOf<Element> = rootNode.querySelectorAll('*');
    for (const element of allElements) { if (element.shadowRoot) { const f = _findElementByHeuristics(targetType, element.shadowRoot as ShadowRoot, heuristics); if (f) return f; } }
    return null;
  }
  // --- End Helper Definitions ---

  let elementToScroll: HTMLElement | Window = window;
  const id = step.target || step.selector;
  const isSem = !!step.target;
  if (id) {
    let maybeElement = isSem ? _findElementByHeuristics(id, document, heuristics) : _findElementBySelector(id, document);
    if (maybeElement) {
      if (_isElementVisibleAndInteractive(maybeElement)) {
         elementToScroll = maybeElement;
      } else {
         console.warn('[SCROLL CORE] Found element but not interactive, scrolling window instead.', maybeElement);
      }
    } else {
        console.debug('[SCROLL CORE] Target element not found in this frame, scrolling window.');
        return { success: true }; 
    }
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
    console.error('[SCROLL CORE] Error during scroll:', e, 'Element:', elementToScroll);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function extractCoreLogic(identifier: string, isSemantic: boolean, attribute: string | null | undefined, heuristics: HeuristicsMap): { success: boolean; data?: string | null; error?: string } {

  // --- Define Helpers INSIDE extractCoreLogic ---
  function _isElementVisibleAndInteractive(element: Element | null): element is HTMLElement {
    if (!element || !(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return !(style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || 
             (element as any).disabled || (element as any).readOnly || 
             (element.offsetParent === null && style.position !== 'fixed') || 
             rect.width <= 0 || rect.height <= 0);
  }

  function _findElementBySelector(sel: string, rootNode: RootNode = document): FoundElement {
    try {
      const elements: NodeListOf<Element> = rootNode.querySelectorAll(sel);
      for (const el of elements) { if (_isElementVisibleAndInteractive(el)) return el; }
      const all: NodeListOf<Element> = rootNode.querySelectorAll('*');
      for (const el of all) { if (el.shadowRoot) { const f = _findElementBySelector(sel, el.shadowRoot as ShadowRoot); if (f) return f; } }
    } catch (e) {} return null;
  }

  function _findElementByHeuristics(targetType: string, rootNode: RootNode = document, heuristics: HeuristicsMap): FoundElement {
    const selectors = heuristics[targetType] || []; if (!selectors.length) return null;
    for (const selector of selectors) {
        try {
            let checkText = null; let actualSelector = selector;
            if (selector.includes(':contains(')) { const m = selector.match(/(.*):contains\("(.*?)"\)/i); if (m && m.length > 2) { actualSelector = m[1] || '*'; checkText = m[2].toLowerCase(); } }
            const elements: NodeListOf<Element> = rootNode.querySelectorAll(actualSelector); if (elements.length === 0) continue;
            for (const element of elements) {
                let textMatch = !checkText; if (checkText && element.textContent) { textMatch = element.textContent.trim().toLowerCase().includes(checkText); } if (!textMatch) continue;
                if (_isElementVisibleAndInteractive(element)) return element;
            }
        } catch (e) {}
    }
    const allElements: NodeListOf<Element> = rootNode.querySelectorAll('*');
    for (const element of allElements) { if (element.shadowRoot) { const f = _findElementByHeuristics(targetType, element.shadowRoot as ShadowRoot, heuristics); if (f) return f; } }
    return null;
  }
  // --- End Helper Definitions ---

  let element = isSemantic ? _findElementByHeuristics(identifier, document, heuristics) : _findElementBySelector(identifier, document);
  
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
    console.log('[EXTRACT CORE] Extraction success:', extractedData);
    return { success: true, data: extractedData };
  } catch (e) {
    console.error('[EXTRACT CORE] Error during extraction:', e, 'Element:', element);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Function specifically for waiting for an element (can be run in main frame)
export function waitForElementLogic(selectors: string[], timeout: number): Promise<{ found: boolean; error?: string }> {
    return new Promise((resolve) => {
        const check = () => {
            for (const selector of selectors) {
                try { 
                    const el = document.querySelector(selector);
                    if (el) { 
                        console.log('[WAIT CORE] Element found (existence check only):', el);
                        return el; 
                    }
                    const all = document.querySelectorAll('*');
                    for (const host of all) {
                        if (host.shadowRoot) {
                            const shadowEl = host.shadowRoot.querySelector(selector);
                            if (shadowEl) { 
                                console.log('[WAIT CORE] Element found in shadow DOM (existence check only):', shadowEl);
                                return shadowEl; 
                            }
                        }
                    }
                } catch (e) { console.warn('[WAIT CORE] Error during querySelector', selector, e); }
            }
            return null;
        };
        if (check()) { console.log('[WAIT CORE] Element found immediately.'); return resolve({ found: true }); }
        const observer = new MutationObserver(() => { if (check()) { console.log('[WAIT CORE] Element found after mutation.'); observer.disconnect(); resolve({ found: true }); } });
        observer.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true });
        setTimeout(() => {
            if (check()) { console.log('[WAIT CORE] Element found just before timeout.'); resolve({ found: true });
            } else { console.warn('[WAIT CORE] Timeout waiting for element existence.'); observer.disconnect(); resolve({ found: false, error: 'Timeout waiting for element existence' }); }
        }, timeout);
    });
} 