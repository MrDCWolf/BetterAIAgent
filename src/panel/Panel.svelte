<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';
  import { getPlanFromInstructions } from '../utils/llm'; // Import the new function

  console.log('--- Panel.svelte script executing ---'); // Log script execution

  let apiKey = '';
  let statusMessage = '';
  let instructions = ''; // State for instruction input
  let planJson = '';     // State for the plan result
  let isLoading = false;  // State to show loading indicator
  let planError = ''; // Separate state for plan errors

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

  // Function to handle instruction submission
  async function handleSubmitInstructions() {
    planJson = '';    // Clear previous plan
    planError = '';   // Clear previous error
    statusMessage = ''; // Clear API key status

    if (!apiKey) {
      planError = 'Please enter your OpenAI API Key first.';
      return;
    }
    if (!instructions.trim()) {
      planError = 'Please enter instructions.';
      return;
    }

    isLoading = true;
    console.log('Submitting instructions:', instructions);

    try {
      // Call the actual API function
      const plan = await getPlanFromInstructions(apiKey, instructions);
      planJson = JSON.stringify(plan, null, 2);
      console.log('Received plan:', planJson);

    } catch (error) {
      console.error('Error getting plan:', error);
      // Display the specific error message from the catch block in llm.ts
      planError = (error instanceof Error) ? error.message : 'An unknown error occurred.';
      planJson = ''; // Ensure no old plan is shown on error
    } finally {
      isLoading = false;
    }
  }

  console.log('--- Panel.svelte script finished initial execution ---'); // Log end of script
</script>

<main>
  <h1>AI Agent</h1>

  <div class="form-group">
    <label for="instructions">Instructions:</label>
    <textarea 
      id="instructions" 
      bind:value={instructions}
      rows="4"
      placeholder="Enter web automation steps in plain English (e.g., Go to google.com, search for cats, click the images tab)"
      disabled={isLoading}
    ></textarea>
  </div>

  <button on:click={handleSubmitInstructions} disabled={isLoading}>
    {isLoading ? 'Generating Plan...' : 'Generate Plan'}
  </button>

  {#if isLoading}
    <p>Loading plan...</p> <!-- Show loading indicator -->
  {/if}

  {#if planError}
    <div class="error-output">
      <h2>Error:</h2>
      <pre>{planError}</pre>
    </div>
  {/if}

  {#if planJson}
    <div class="plan-output">
      <h2>Execution Plan:</h2>
      <pre>{planJson}</pre>
    </div>
  {/if}

  <hr />

  <h2>Settings</h2>
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
      <p class="status {statusMessage.startsWith('Error') ? 'error' : ''}">{statusMessage}</p>
    {/if}
  </div>

  <!-- More settings can be added here -->
</main>

<style>
  main {
    font-family: sans-serif;
    padding: 1em;
    display: flex;
    flex-direction: column;
    gap: 1em; /* Add space between elements */
  }
  .form-group {
    margin-bottom: 0; /* Remove bottom margin, use gap instead */
  }
  label {
    display: block;
    margin-bottom: 0.5em;
    font-weight: bold;
  }
  input[type="password"],
  textarea {
    width: 100%;
    padding: 0.5em;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-sizing: border-box;
    font-family: inherit; /* Inherit font */
  }
  textarea {
    resize: vertical; /* Allow vertical resize */
  }
  button {
    padding: 0.8em 1.5em;
    background-color: #6A5ACD;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1em;
    align-self: flex-start; /* Align button to the start */
  }
  button:disabled {
    background-color: #ccc;
    cursor: not-allowed;
  }
  .plan-output {
    margin-top: 1em;
    background-color: #f8f8f8;
    padding: 1em;
    border: 1px solid #eee;
    border-radius: 4px;
  }
  pre {
    white-space: pre-wrap; /* Wrap long lines */
    word-wrap: break-word; /* Break words if needed */
    font-family: monospace;
  }
  hr {
    border: none;
    border-top: 1px solid #eee;
    margin: 1.5em 0;
  }
  .status {
    margin-top: 0.5em;
    font-size: 0.9em;
    color: #555;
  }
  .status.error {
     color: #c00; /* Make errors red */
  }
  .error-output {
    margin-top: 1em;
    background-color: #fdd;
    border: 1px solid #c00;
    color: #c00;
    padding: 1em;
    border-radius: 4px;
  }
  .error-output pre {
    color: #c00;
    font-family: monospace;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
</style> 