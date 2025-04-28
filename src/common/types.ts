// Shared types for background scripts and injectables

export type FoundElement = HTMLElement | null;
export type RootNode = Document | ShadowRoot;

// HeuristicsMap type (the actual heuristics object will be in heuristics.ts)
export type HeuristicsMap = { [key: string]: string[] };

// Re-export ExecutionPlan and PlanStep from ../utils/llm for convenience
export type { ExecutionPlan, PlanStep } from '../utils/llm'; 