// Shared types for background scripts and injectables
export type FoundElement = HTMLElement | null;
export type RootNode = Document | ShadowRoot;

// HeuristicsMap type (the actual heuristics object will be in heuristics.ts)
export type HeuristicsMap = { [key: string]: string[] };

// Re-export ExecutionPlan and PlanStep from ../utils/llm for convenience
// Add new actions here
export type { ExecutionPlan } from '../utils/llm';
export interface PlanStep {
  action: 'navigate' | 'type' | 'click' | 'scroll' | 'wait' | 'extract' | 
          'select' | 'hover' | 'clear' | 'go_back' | 'go_forward' | 'refresh' | 'screenshot'; 
  [key: string]: any; 
}

// Shared type for step execution results, including fallback info
export interface StepResult {
    success: boolean;
    error?: string; // Error message for the original step or last fallback attempt
    fallback?: { // Information about the fallback attempt
        suggestionText?: string; // Raw suggestion text (might be added later)
        step: PlanStep;         // The fallback step object that was attempted
        success: boolean;       // Did this specific fallback step succeed?
        error?: string;         // Error message if this fallback step failed
    }
} 