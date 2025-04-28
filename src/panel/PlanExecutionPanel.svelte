<script context="module" lang="ts">
  // Types for plan steps and execution results
  // Moved interfaces here as they are exported
  export interface PlanStep {
    id: number;
    description: string;
  }
  export interface StepResult {
    success: boolean;
    error?: string; // Add error message field
    // fallback?: PlanStep; // Keep commented out for now
    // fallbackSuccess?: boolean;
  }
</script>

<script lang="ts">
  import type { Writable } from 'svelte/store';
  // Import the types defined above
  import type { PlanStep, StepResult } from './PlanExecutionPanel.svelte';

  // Props: the plan to execute and the results store
  export let plan: PlanStep[] = [];
  export let resultsStore: Writable<Record<number, StepResult>>; // Accept store as prop
  // --- NEW PROPS ---
  export let isLoading: boolean = false;
  export let nextStepToExecuteId: number | null = null;
  // -----------------

  // REMOVED: Internal results store
  // REMOVED: updateStepResult function
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
  /* REMOVED: Fallback styles (can add back later) */
  /* .fallback { ... } */
  /* .success-text { ... } */
  /* .error-text { ... } */
</style>

<ul class="execution-list" style="margin-top: 1em; padding-left: 2em;">
  {#each plan as step (step.id)}
    <li class="step-item" style="padding: 0.3rem 0; display: list-item;">
      <!-- Status Icon: Read directly from resultsStore prop -->
      {#if $resultsStore[step.id]?.success}
         <span class="icon-placeholder text-green-600" title="Success">✅</span> 
      {:else if $resultsStore[step.id]} 
         <span class="icon-placeholder text-red-600" title="Failed">❌</span>
      {:else if isLoading && step.id === nextStepToExecuteId}
         <span class="icon-placeholder animate-spin" title="Running">⏳</span> <!-- Simple spinner -->
      {:else}
         <span class="icon-placeholder text-gray-400" title="Pending">⚪</span> 
      {/if}
      
      <!-- Step description and error (inline with icon) -->
      <span class="description" style="margin-left: 0.5em;">{step.description}</span>
      <!-- Show error message if step failed -->
      {#if $resultsStore[step.id] && !$resultsStore[step.id].success && $resultsStore[step.id].error}
           <span class="error-message" style="margin-left: 0.5em; display: block;">Error: {$resultsStore[step.id].error}</span>
      {/if}
      <!-- REMOVED: Fallback display for now -->
    </li>
  {/each}
</ul> 