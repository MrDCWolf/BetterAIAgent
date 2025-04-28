console.log('Background service worker started.');

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message, 'from sender:', sender);

  // Check if the message is to open the side panel
  if (message.type === 'openSidePanel') {
    // Check if the sender has a tab ID (should always be the case for content scripts)
    if (sender.tab?.id) {
      const tabId = sender.tab.id;
      console.log(`Opening side panel for tab ${tabId}`);
      
      // Open the side panel for the specific tab
      chrome.sidePanel.open({ tabId: tabId }).then(() => {
        console.log(`Side panel opened successfully for tab ${tabId}.`);
      }).catch(error => {
        console.error(`Error opening side panel for tab ${tabId}:`, error);
      });
      
      // Optional: Send a response back to the content script if needed
      // sendResponse({ status: "Side panel opening requested" });
    } else {
      console.warn('Received openSidePanel message without sender tab ID.');
    }
  }

  // Return true to indicate you might send a response asynchronously
  // (Not strictly necessary here since we don't send a response, but good practice)
  // return true; 
});

// Optional: Keep the service worker alive briefly after startup
// This might help ensure listeners are ready immediately.
// Be cautious with this, excessive use can impact performance.
// setTimeout(() => {
//   console.log("Service worker heartbeat.");
// }, 25 * 1000);
