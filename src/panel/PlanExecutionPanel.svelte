<script context="module" lang="ts">
  // Import PlanStep and StepResult from the shared common types
  import type { PlanStep, StepResult } from '../common/types';
  // Define DisplayPlanStep locally or ensure PlanStep from common/types includes id/description
  export interface DisplayPlanStep extends PlanStep { // Inherit original PlanStep properties
    id: number;
    description: string;
  }
  // Export the imported types if needed by parent
  export type { PlanStep, StepResult }; 

  // REMOVE local StepResult definition
  /*
  export interface StepResult {
    success: boolean;
    error?: string; // Error message for the original step
    fallback?: {
        suggestionText: string;
        step?: OriginalPlanStep; // The parsed fallback step object
    }
  }
  */
</script>

<script lang="ts">
  import type { Writable } from 'svelte/store';
  // Use the imported types
  import type { DisplayPlanStep, StepResult } from './PlanExecutionPanel.svelte'; 
  import type { PlanStep as OriginalPlanStep } from '../common/types'; // Import original PlanStep for fallback step typing

  // Props: the plan to execute and the results store
  export let plan: DisplayPlanStep[] = []; // Use DisplayPlanStep for the plan prop
  export let resultsStore: Writable<Record<number, StepResult>>; // Accept store as prop
  // --- NEW PROPS ---
  export let isLoading: boolean = false;
  export let nextStepToExecuteId: number | null = null;
  // -----------------

  // Helper to generate a simple description for a fallback step
  function generateFallbackDescription(step: OriginalPlanStep | undefined): string {
      if (!step) return 'No valid fallback step JSON found in suggestion.';
      // Basic description similar to the main one
      switch (step.action) {
          case 'navigate': return `Fallback: Navigate to ${step.url}`;
          case 'type': return `Fallback: Type "${step.text?.substring(0, 20)}${step.text?.length > 20 ? '...' : ''}" into ${step.target || step.selector}`;
          case 'click': return `Fallback: Click on ${step.target || step.selector}`;
          case 'wait': return `Fallback: Wait for ${step.target || step.selector || (step.duration + 'ms')}`;
          case 'scroll': return `Fallback: Scroll ${step.direction || 'element'} ${step.target || step.selector || 'page'}`;
          // Add more cases as needed
          default: return `Fallback Action: ${step.action}`;
      }
  }

</script>

<style>
  .step-item {
    display: flex;
    align-items: flex-start; /* Align icon with top of text */
    padding: 0.5rem 0.25rem; /* Adjust padding */
    border-bottom: 1px solid #eee;
    gap: 0.5rem; /* Space between icon and text */
  }
  .step-item:last-child {
      border-bottom: none;
  }
  .icon {
    width: 1.25rem; /* ~20px */
    height: 1.25rem;
    flex-shrink: 0; /* Prevent icon shrinking */
     margin-top: 0.125rem; /* Align icon slightly better with text */
  }
  .description-container {
    flex: 1; /* Take remaining space */
    min-width: 0; /* Prevent text overflow issues */
  }
  .description {
     word-wrap: break-word;
  }
  .error-message {
      margin-top: 0.25rem;
      font-size: 0.8em;
      color: #c00; /* Match error color */
       word-wrap: break-word;
  }
  .fallback-container {
      margin-left: 2.25rem; /* Indent fallback section (icon width + gap) */
      margin-top: 0.5rem;
      padding: 0.5rem;
      background-color: #f0f0f0; /* Light grey background */
      border-left: 3px solid #ffc107; /* Amber border */
      font-size: 0.9em;
  }
  .fallback-suggestion {
      font-style: italic;
      margin-bottom: 0.5rem;
      white-space: pre-wrap; /* Preserve whitespace in suggestion */
      word-wrap: break-word;
  }
  .fallback-step {
      font-family: monospace;
      word-wrap: break-word;
      white-space: pre-wrap; /* Show JSON nicely if needed */
      color: #333; /* Darker text for code */
      background-color: #e9e9e9; /* Slightly different background */
      padding: 0.2em 0.4em;
      border-radius: 3px;
      display: inline-block; /* Make it inline */
      margin-top: 0.2em;
  }
  .fallback-status {
      font-weight: bold;
      margin-left: 0.5em;
  }
  .fallback-success {
       color: #28a745; /* Green */
  }
  .fallback-failure {
       color: #dc3545; /* Red */
  }
  .fallback-error {
      font-size: 0.9em;
      color: #dc3545; /* Red */
      margin-left: 1em;
      display: block;
  }
  /* REMOVED: Fallback styles (can add back later) */
  /* .fallback { ... } */
  /* .success-text { ... } */
  /* .error-text { ... } */
</style>

<ul class="execution-list" style="margin-top: 1em; padding-left: 0; list-style: none;">
  {#each plan as step (step.id)}
    <li class="step-item">
      <!-- Status Icon: Read directly from resultsStore prop -->
      <div class="icon">
          {#if $resultsStore[step.id]?.success}
             <span title="Success">✅</span> 
          {:else if $resultsStore[step.id]} 
             <span title="Failed">❌</span>
          {:else if isLoading && step.id === nextStepToExecuteId}
             <span class="animate-spin" title="Running">⏳</span> <!-- Simple spinner -->
          {:else}
             <span class="text-gray-400" title="Pending">⚪</span> 
          {/if}
      </div>
      
      <!-- Step description container -->
      <div class="description-container">
          <div class="description">{step.description}</div>
          
          <!-- Show error message for INITIAL failure -->
          {#if $resultsStore[step.id] && !$resultsStore[step.id].success && !$resultsStore[step.id]?.fallback?.success}
               <div class="error-message">Error: {$resultsStore[step.id].error}</div>
          {/if}

          <!-- Show Fallback if available -->
          {#if $resultsStore[step.id]?.fallback}
              {@const fallback = $resultsStore[step.id]?.fallback}
              <div class="fallback-container">
                   {#if fallback.suggestionText}
                     <div class="fallback-suggestion">💡 Suggestion: {fallback.suggestionText}</div>
                   {/if}
                  <div class="fallback-step">
                      {#if fallback.step}
                           {generateFallbackDescription(fallback.step)}
                           {#if fallback.success}
                               <span class="fallback-status fallback-success">(Succeeded)</span>
                           {:else}
                               <span class="fallback-status fallback-failure">(Failed)</span>
                               {#if fallback.error}
                                   <span class="fallback-error">Error: {fallback.error}</span>
                               {/if}
                           {/if}
                      {:else}
                          (Could not parse fallback step details from suggestion)
                      {/if}
                  </div>
              </div>
          {/if}
      </div>
    </li>
  {/each}
</ul> 