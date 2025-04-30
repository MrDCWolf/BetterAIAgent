<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';
  import { writable, derived } from 'svelte/store'; // Import writable and derived stores
  import { getPlanFromInstructions } from '../utils/llm'; // Import the new function
  import PlanExecutionPanel from './PlanExecutionPanel.svelte'; // IMPORT the new component and types
  // Explicitly import types if PlanExecutionPanel.svelte exports them
  import type { PlanStep as DisplayPlanStep, StepResult } from './PlanExecutionPanel.svelte'; 
  // Re-import original PlanStep for fallbackStep typing
  import type { PlanStep } from '../utils/llm'; 

  console.log('--- Panel.svelte script executing ---'); // Log script execution

  let apiKey = '';
  let statusMessage = '';
  let instructions = ''; // State for instruction input
  let isLoading = false;  // State to show loading indicator
  let planError = ''; // Separate state for plan errors

  // --- NEW State for Plan Display ---
  let planForDisplay: DisplayPlanStep[] = [];
  // REMOVED: updateStepResultFn 
  let currentRequestId: string | null = null;
  // --- NEW: Store for results, managed by parent ---
  const resultsStore = writable<Record<number, StepResult>>({});
  // --- NEW: Track the next step to execute ---
  let nextStepToExecuteId: number | null = null; 
  // --- NEW: State for current view ---
  let currentView: 'main' | 'settings' = 'main';
  // -------------------------------------------------

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

    // Message listener
    const messageListener = (message: any, sender: any, sendResponse: any) => {
      console.log("Panel received message:", message);
      // Check if message is relevant to the current execution request
      if (!currentRequestId || message.requestId !== currentRequestId) {
         // Allow troubleshoot results even if the main execution stopped due to failure
         if (message.type !== 'stepTroubleshootResult' && (message.type === 'planReceived' || message.type === 'planStepResult')) {
             console.log("Ignoring message for different/no request ID.");
             return;
         }
      }

      if (message.type === 'planReceived' && message.formattedPlan) {
        console.log("Received formatted plan for display:", message.formattedPlan);
        planForDisplay = message.formattedPlan;
        resultsStore.set({}); // Clear previous results when new plan arrives
        planError = ''; 
      } else if (message.type === 'planStepResult' && message.stepId !== undefined && message.result) {
         console.log(`Received step result for step ${message.stepId}:`, message.result);
         // Update the store with the result, preserving any existing fallback info
         resultsStore.update(rs => ({
           ...rs,
           [message.stepId]: { 
             ...(rs[message.stepId] || {}), // Keep existing data (like fallback)
             ...message.result // Overwrite success/error status
           }
         }));
         
         if (message.isFinal) {
             console.log("Received final step result.");
             isLoading = false;
             currentRequestId = null; 
             if (!message.result.success && message.result.error) {
                 planError = `Execution failed: ${message.result.error}`;
             } else if (message.result.success) {
                 // Optional: Show overall success message?
             }
         }
      } else if (message.type === 'stepTroubleshootResult' && message.stepId !== undefined) {
          console.log(`Received troubleshoot result for step ${message.stepId}:`, message);
          // Update the store, adding the fallback information
          resultsStore.update(rs => ({
              ...rs,
              [message.stepId]: {
                  ...(rs[message.stepId] || { success: false }), // Ensure base result exists (it must have failed)
                  fallback: {
                      suggestionText: message.suggestionText,
                      step: message.fallbackStep // This might be undefined if parsing failed
                  }
              }
          }));
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    // Cleanup listener on component destroy
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      console.log("Panel message listener removed.");
    };
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
    // Clear previous state
    planError = '';   
    planForDisplay = []; 
    resultsStore.set({}); // Clear results store
    if (!apiKey) {
      planError = 'Please enter your OpenAI API Key first.';
      return;
    }
    if (!instructions.trim()) {
      planError = 'Please enter instructions.';
      return;
    }

    isLoading = true;
    currentRequestId = `req-${Date.now()}-${Math.random()}`; 
    console.log(`Submitting instructions with requestId: ${currentRequestId}, text:`, instructions);

    try {
      // 1. Get plan structure from LLM
      const planStructure = await getPlanFromInstructions(apiKey, instructions);
      console.log('Received plan structure:', planStructure);
      
      // 2. Send plan to background for execution and formatting
      console.log('Sending plan to background script for execution...');
      chrome.runtime.sendMessage({
         type: "executePlan", 
         plan: planStructure, 
         requestId: currentRequestId // Include request ID
       });
      // Note: We no longer await a direct response here.
      // We wait for 'planReceived' and 'planStepResult' messages via the listener.

    } catch (error) {
      console.error('Error getting plan structure or sending executePlan message:', error);
      planError = (error instanceof Error) ? error.message : 'An unknown error occurred during plan generation.';
      isLoading = false;
      currentRequestId = null; // Reset request ID on initial error
    } 
  }

  // --- NEW: Reactive calculation for the next step ID ---
  $: {
    if (isLoading && planForDisplay.length > 0) {
      // Get IDs of steps with results
      const executedStepIds = Object.keys($resultsStore).map(Number);
      // Find the highest ID that has a result
      const maxExecutedId = executedStepIds.length > 0 ? Math.max(...executedStepIds) : -1;
      
      // Find the first step in the plan *after* the last executed one
      const nextStep = planForDisplay.find(step => step.id > maxExecutedId);
      
      nextStepToExecuteId = nextStep ? nextStep.id : null; // If no next step, plan is likely finishing/finished

      // If the last executed step failed, nothing is "next"
      if (maxExecutedId !== -1 && $resultsStore[maxExecutedId] && !$resultsStore[maxExecutedId].success) {
         nextStepToExecuteId = null;
      }

    } else {
      nextStepToExecuteId = null; // Not loading or no plan, so nothing is next
    }
    console.log("Derived nextStepToExecuteId:", nextStepToExecuteId); // Debug log
  }
  // ------------------------------------------------------

  console.log('--- Panel.svelte script finished initial execution ---'); // Log end of script
</script>

<main>
  <!-- Settings Button (always visible for now, could be positioned differently) -->
  <div style="position: absolute; top: 10px; right: 10px;">
    {#if currentView === 'main'}
      <button on:click={() => currentView = 'settings'} title="Settings">⚙️</button>
    {:else}
      <button on:click={() => currentView = 'main'} title="Back to Main">⬅️</button>
    {/if}
  </div>

  {#if currentView === 'main'}
    <!-- Main View Content -->
    <h1>AI Agent</h1>

    <div class="form-group">
      <label for="instructions">Instructions:</label>
      <textarea 
        id="instructions" 
        bind:value={instructions}
        rows="4"
        placeholder="Enter web automation steps..."
        disabled={isLoading}
      ></textarea>
    </div>

    <button on:click={handleSubmitInstructions} disabled={isLoading}>
      {isLoading ? 'Executing...' : 'Generate & Execute Plan'} 
    </button>

    {#if isLoading && planForDisplay.length === 0}
      <p>Generating plan...</p> 
    {/if}

    <!-- Render the Plan Execution Panel, pass the store, isLoading, and nextStepId -->
    {#if planForDisplay.length > 0}
      <PlanExecutionPanel 
        plan={planForDisplay} 
        {resultsStore} 
        {isLoading} 
        {nextStepToExecuteId}
      />
    {/if}
    
    <!-- Display overall errors -->
    {#if planError}
      <div class="error-output">
        <h2>Error:</h2>
        <pre>{planError}</pre>
      </div>
    {/if}
  {/if}

  {#if currentView === 'settings'}
    <!-- Settings View Content -->
    <h1>Settings</h1>
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
  {/if}
</main>

<style global>
/* Import Tailwind base styles */
@tailwind base;
@tailwind components;
@tailwind utilities;
/* Your existing styles or overrides */
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
  /* REMOVED: .plan-output style (handled by component) */
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
  .status.success {
     color: green; /* Add success styling */
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