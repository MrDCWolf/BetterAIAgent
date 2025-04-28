import OpenAI from 'openai';

// Define the expected structure of the plan steps
export interface PlanStep {
  action: 'navigate' | 'type' | 'click' | 'scroll' | 'wait' | 'extract'; // Extend as needed
  [key: string]: any; // Allow other properties like url, selector, text, etc.
}

// Define the structure of the full plan
export interface ExecutionPlan {
  goal: string;
  steps: PlanStep[];
}

const SYSTEM_PROMPT = `
You are an expert web automation assistant. Given a natural language instruction, 
create a precise JSON plan consisting of a sequence of steps to accomplish the goal.

Supported actions are:
- navigate: { action: "navigate", url: "<full_url>" }
- type: { action: "type", target: "<semantic_target>", text: "<text_to_type>", optional?: true } OR { action: "type", selector: "<css_selector>", text: "<text_to_type>", optional?: true }
- click: { action: "click", target: "<semantic_target>", optional?: true } OR { action: "click", selector: "<css_selector>", optional?: true }
- scroll: { action: "scroll", direction?: "<up|down|top|bottom>", selector?: "<css_selector>" | target?: "<semantic_target>", pixels?: <number> }
  // Scrolls the window or a specific element.
  // Use direction+pixels for relative scrolls (e.g., { direction: "down", pixels: 500 }).
  // Use direction without pixels for edges (e.g., { direction: "bottom" }).
  // Use selector/target to scroll that specific element into view OR scroll within it.
- wait: { action: "wait", target: "<semantic_target>", timeout?: <milliseconds>, optional?: true } OR { action: "wait", selector: "<css_selector>", timeout?: <milliseconds>, optional?: true } OR { action: "wait", duration: <milliseconds> }
- extract: { action: "extract", target: "<semantic_target>" | selector: "<css_selector>", attribute?: "<attribute_name>" }
  // Extracts text content or a specific attribute value from an element.
  // Defaults to text content if 'attribute' is omitted.
  // Example: { action: "extract", target: "product_price", attribute: "data-price" }
  // The extracted data will be logged by the extension for now.

Semantic Targets:
- For common interactive elements, use a semantic target name instead of a CSS selector whenever possible. This makes the plan more robust.
- Examples: "search_input", "search_button", "username_field", "password_field", "login_button", "submit_button", "first_result_link", "dismiss_popup_button", "search_results_container".
- Use your best judgment to identify the semantic role of an element.
- If an element is highly specific or doesn't have a clear common role, provide a specific CSS selector using the 'selector' property instead of 'target'.

General Workflow Advice:
- After navigating to a new page, ESPECIALLY a major site like Google, Yahoo, etc., FIRST check for and handle common overlays like sign-in prompts before attempting primary actions. Use steps like { action: "click", target: "dismiss_popup_button", optional: true }. Mark these overlay steps as optional.
- After performing a search action (e.g., clicking target: "search_button"), the VERY NEXT step should almost always be { action: "wait", target: "search_results_container" } to ensure results are loaded before proceeding.

Rules for Selectors (when used):
- Selectors MUST be specific and likely to be unique. Prefer IDs, specific attribute values (like [name="q"], [aria-label="Search"], [title="Search"]), or specific class combinations.
- For wait actions, STRONGLY PREFER waiting for a semantic target (like "search_results_container") or a specific selector that indicates the next action can proceed (e.g., wait for the search results container selector before trying to click a result). Only use duration-based waits as a last resort if no suitable selector is available.

Rules for Waits:
- STRONGLY prefer waiting for a semantic target (like "search_results_container") or a specific selector. Use duration waits only as a last resort.
- Use target: "search_results_container" specifically after submitting a search.

Rules:
- Keep the plan concise and focused on the goal.
- Only output the JSON plan, nothing else.
- The final output must be a single JSON object conforming to the ExecutionPlan interface:
  { "goal": "user goal", "steps": [ { "action": ... }, ... ] }
`;

/**
 * Generates an execution plan from natural language instructions using OpenAI.
 * 
 * @param apiKey OpenAI API Key.
 * @param instructions User's natural language instructions.
 * @returns A promise that resolves to the parsed ExecutionPlan object.
 * @throws Throws an error if the API call fails or the response is not valid JSON.
 */
export async function getPlanFromInstructions(
  apiKey: string,
  instructions: string
): Promise<ExecutionPlan> {
  if (!apiKey) {
    throw new Error('OpenAI API Key is required.');
  }

  const openai = new OpenAI({ 
    apiKey: apiKey,
    dangerouslyAllowBrowser: true // Required for client-side usage
  });

  console.log('Sending request to OpenAI...');
  
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Using the specified model (check exact identifier if needed)
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: instructions }
      ],
      temperature: 0.2, // Lower temperature for more deterministic plan generation
      response_format: { type: "json_object" } // Request JSON output
    });

    const content = completion.choices[0]?.message?.content;
    console.log('Received OpenAI response content:', content);

    if (!content) {
      throw new Error('OpenAI response content is empty.');
    }

    // Parse the JSON response
    const plan: ExecutionPlan = JSON.parse(content);

    // Basic validation (can be expanded with Zod later)
    if (!plan || typeof plan !== 'object' || !plan.goal || !Array.isArray(plan.steps)) {
        throw new Error('Invalid plan structure received from OpenAI.');
    }

    console.log('Parsed plan:', plan);
    return plan;

  } catch (error) {
    console.error('OpenAI API call failed:', error);
    
    let errorMessage = 'Unknown OpenAI API error';
    if (error instanceof Error) {
      errorMessage = error.message;
      // Check for specific OpenAI API error structure if available (example)
      // The actual structure might differ, check openai-node docs or actual errors
      const openAIError = error as any; // Use type assertion cautiously or define specific type
      if (openAIError.response?.data?.error?.message) {
        errorMessage = openAIError.response.data.error.message;
        console.error('OpenAI Error Details:', openAIError.response.data.error);
      } else if (openAIError.response?.data) {
        console.error('OpenAI Response Data:', openAIError.response.data);
      }
    }
    
    throw new Error(`OpenAI API error: ${errorMessage}`);
  }
} 