import './/Panel.svelte'; // Side effect import for CSS
import Panel from './Panel.svelte';
import type { SvelteComponent } from 'svelte';

console.log('Panel main.ts loaded');

let app: SvelteComponent | null = null;

// Wait for the DOM to be fully loaded before mounting
document.addEventListener('DOMContentLoaded', () => {
  console.log('Panel DOMContentLoaded fired - attempting to mount Svelte Panel.');
  const target = document.getElementById('app');
  
  if (target) {
    target.innerHTML = ''; // Clear placeholder
    
    try {
      app = new Panel({
        target: target,
        props: {} // Pass initial props here if needed
      });
      console.log('Svelte Panel component mounted successfully.');
    } catch (error) {
      console.error('Error mounting Svelte Panel component:', error);
      target.innerHTML = '<h1>Error mounting Svelte Panel! Check console.</h1>';
    }
  } else {
    console.error('Could not find #app element in sidepanel.html on DOMContentLoaded.');
  }
});

console.log('Panel main.ts finished initial execution.');

// export default app; 