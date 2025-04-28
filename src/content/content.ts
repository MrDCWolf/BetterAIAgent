console.log('Content script loaded.');

// Create the floating button
const button = document.createElement('button');
button.textContent = 'AI'; // Or an icon later
button.style.position = 'fixed';
button.style.bottom = '20px';
button.style.right = '20px';
button.style.zIndex = '9999';
button.style.backgroundColor = '#6A5ACD'; // Example color: SlateBlue
button.style.color = 'white';
button.style.border = 'none';
button.style.borderRadius = '50%';
button.style.width = '50px';
button.style.height = '50px';
button.style.fontSize = '18px';
button.style.cursor = 'pointer';
button.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';

// Add click listener to send message to background script
button.addEventListener('click', () => {
  console.log('Floating button clicked, sending message to open side panel.');
  chrome.runtime.sendMessage({ type: "openSidePanel" }).catch(error => {
    // Handle potential errors, e.g., if the background script isn't ready
    console.error("Error sending openSidePanel message:", error);
    // Might occur if the extension is reloaded and the content script is stale
    if (error.message.includes('Receiving end does not exist')) {
        console.warn("Extension context may have been invalidated. Please reload the page.");
    }
  });
});

// Append the button to the body
document.body.appendChild(button);

console.log('Floating AI button injected.');
