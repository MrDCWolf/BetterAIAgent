import type { HeuristicsMap } from '../../common/types';

export const heuristicsMap: HeuristicsMap = {
  // Most robust, widely applicable selectors for search boxes (Google and others)
  search_input: [
    // ChatGPT Input
    '#prompt-textarea', 
    // Google homepage and similar modern search UIs
    'textarea.gLFyf', // Google's main search box
    'textarea[role="combobox"]', // Google's role
    'textarea[name="q"]',
    'textarea[title="Search"]',
    'textarea[aria-label="Search"]',
    'textarea#APjFqb',
    // Generic semantic/ARIA selectors
    'input[role="searchbox"]', 'textarea[role="searchbox"]',
    'form[role="search"] input[type="text"]', 'form[role="search"] input:not([type="hidden"])',
    'input[type="search"]', 'textarea[type="search"]',
    // Fallbacks for legacy and other engines
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
    // Try results container ID first
    '#rcnt a:has(h3.LC20lb)', 
    '#rcnt a:has(h3)', 
    // Fallback to #search container
    '#search a:has(h3.LC20lb)', 
    '#search a:has(h3)',
    // Other engines/fallbacks
    '#results .result__a', // DDG
    'ol#b_results > li.b_algo h2 > a', // Bing
    // Keep remaining, potentially less reliable fallbacks for now
    '#web a.d-ib',
    '#results ol li h3 a',
    'div.results ol li h3 a',
    'li.first .algo-sr h3 a',
    'div.dd.algo.first h3 a'
  ],
  search_results_container: [
    // ChatGPT response area
    'div[data-message-author-role="assistant"]',
    '#search',                    // Google (common ID)
    '#results',                   // DuckDuckGo (common ID)
    '#b_content',                 // Bing (main content area)
    'main[role="main"]',        // General semantic main content
    'div#web',                    // Older search engine patterns
    'div.results',                // Common class names
    'div.serp__results'           // Common class names
  ],
  dismiss_popup_button: [
    'button[aria-label*="close" i]', 'button[aria-label*="dismiss" i]',
    'div[aria-label*="close" i][role="button"]',
    'button:contains("Close")', 'button:contains("Dismiss")', 'button:contains("No thanks")', 'button:contains("Maybe later")',
    '[class*="popup-close"]' , '[id*="popup-close"]',
    '[class*="overlay-close"]' , '[id*="overlay-close"]'
  ]
};

export type { HeuristicsMap }; 