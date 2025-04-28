<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';

  console.log('--- Panel.svelte script executing ---'); // Log script execution

  let apiKey = '';
  let statusMessage = '';

  // Define the async function separately
  async function loadApiKey() {
    console.log('--- Panel.svelte loadApiKey CALLED (within onMount) ---');
    try {
      console.log('Attempting to load API key from storage...');
      const result = await chrome.storage.local.get('openai_api_key');
      console.log('Storage get result:', result);

      if (result && result.openai_api_key) {
        apiKey = result.openai_api_key;
        console.log('API Key loaded. Assigned value:', apiKey);
        apiKey = apiKey; // Reassign to trigger potential updates if needed
      } else {
        console.log('No API Key found in storage result.');
      }
    } catch (error) {
      console.error('Error loading API key:', error);
      statusMessage = 'Error loading API key.';
    }
  }

  // Call the async function from onMount
  onMount(() => {
    console.log('--- Panel.svelte onMount CALLED ---'); 
    loadApiKey(); // Call the separate async function
  });

  // Test if afterUpdate runs
  afterUpdate(() => {
    console.log('--- Panel.svelte afterUpdate CALLED ---');
  });

  // Save API key to storage when input changes
  async function handleInput() {
    console.log('--- Panel.svelte handleInput CALLED ---'); // Log input handler
    try {
      await chrome.storage.local.set({ 'openai_api_key': apiKey });
      console.log('API Key saved to storage.');
      statusMessage = 'API Key saved.';
      // Clear message after a delay
      setTimeout(() => statusMessage = '', 2000);
    } catch (error) {
      console.error('Error saving API key:', error);
      statusMessage = 'Error saving API key.';
    }
  }

  console.log('--- Panel.svelte script finished initial execution ---'); // Log end of script
</script>

<main>
  <h1>AI Agent Settings</h1>
  
  <div class="form-group">
    <label for="apiKey">OpenAI API Key:</label>
    <input 
      type="password" 
      id="apiKey" 
      bind:value={apiKey} 
      on:input={handleInput} 
      placeholder="Enter your OpenAI API Key"
    />
    {#if statusMessage}
      <p class="status">{statusMessage}</p>
    {/if}
  </div>

  <!-- More settings can be added here -->
</main>

<style>
  main {
    font-family: sans-serif;
    padding: 1em;
  }
  .form-group {
    margin-bottom: 1em;
  }
  label {
    display: block;
    margin-bottom: 0.5em;
    font-weight: bold;
  }
  input[type="password"] {
    width: 100%;
    padding: 0.5em;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-sizing: border-box; /* Include padding in width */
  }
  .status {
    margin-top: 0.5em;
    font-size: 0.9em;
    color: #555;
  }
</style> 