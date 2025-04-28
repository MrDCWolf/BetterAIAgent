import type { HeuristicsMap } from '../../common/types';

export const heuristicsMap: HeuristicsMap = {
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