import OpenAI from 'openai';

// Define the expected structure of the plan steps
export interface PlanStep {
  action: 'navigate' | 'type' | 'click' | 'scroll' | 'wait' | 'extract' | 'select' | 'hover' | 'clear' | 'go_back' | 'go_forward' | 'refresh' | 'screenshot'; // Extend as needed
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
- type: { action: "type", target: "<semantic_target>", text: "<text_to_type>", submit?: <true|false>, optional?: true } OR { action: "type", selector: "<css_selector>", text: "<text_to_type>", submit?: <true|false>, optional?: true }
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
- select: { action: "select", target: "<semantic_target>" | selector: "<css_selector>", value: "<option_value>" }
  // Selects an option from a <select> dropdown element.
  // 'value' should be the 'value' attribute of the <option> to select.
- hover: { action: "hover", target: "<semantic_target>" | selector: "<css_selector>" }
  // Simulates hovering the mouse cursor over an element.
  // Useful for triggering menus or tooltips that appear on hover.
- clear: { action: "clear", target: "<semantic_target>" | selector: "<css_selector>" }
  // Clears the value of an input or textarea element.
- go_back: { action: "go_back" }
  // Navigates the browser back to the previous page in history.
- go_forward: { action: "go_forward" }
  // Navigates the browser forward to the next page in history.
- refresh: { action: "refresh" }
  // Reloads the current page.
- screenshot: { action: "screenshot", filename?: "<optional_filename.png>" }
  // Captures a screenshot of the visible portion of the current page.
  // (Currently logs a message, full implementation pending)

Semantic Targets:
- For common interactive elements, use a semantic target name instead of a CSS selector whenever possible. This makes the plan more robust.
- Examples: "search_input", "search_button", "username_field", "password_field", "login_button", "submit_button", "first_result_link", "dismiss_popup_button", "search_results_container".
- Use your best judgment to identify the semantic role of an element.
- If an element is highly specific or doesn't have a clear common role, provide a specific CSS selector using the 'selector' property instead of 'target'.

General Workflow Advice:
- After navigating to a new page, ESPECIALLY a major site like Google, Yahoo, etc., FIRST check for and handle common overlays like sign-in prompts before attempting primary actions. Use steps like { action: "click", target: "dismiss_popup_button", optional: true }. Mark these overlay steps as optional.
- After submitting text using a 'type' action (especially into a search input), the VERY NEXT step should almost always be { action: "wait", target: "search_results_container" } to ensure results are loaded before proceeding.

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

/**
 * Sends a troubleshooting prompt to the LLM and returns suggested fallback steps.
 * 
 * @param apiKey OpenAI API Key.
 * @param prompt The formatted prompt containing error details, HTML, screenshot etc.
 * @returns A promise that resolves to an array of suggested PlanStep objects (up to 3), or empty array if none.
 * @throws Throws an error ONLY if the API call itself fails catastrophically.
 */
export async function getTroubleshootingSuggestion(
  apiKey: string,
  prompt: string
): Promise<PlanStep[]> { // Return an array of PlanSteps
  if (!apiKey) {
    throw new Error('OpenAI API Key is required.');
  }

  const openai = new OpenAI({ 
    apiKey: apiKey,
    dangerouslyAllowBrowser: true 
  });

  console.log('Sending troubleshooting request to OpenAI for fallback candidates...');
  
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", 
      messages: [
        { role: "system", content: "You are a web automation troubleshooting assistant. Analyze the provided error, HTML, and screenshot to suggest potential fixes. Provide up to 3 alternative PlanStep JSON objects, ranked by likelihood of success." },
        { role: "user", content: prompt } // Prompt now asks for JSON array in markdown
      ],
      temperature: 0.5, 
      max_tokens: 600, // Increase slightly for multiple candidates + reasoning
      response_format: { type: "json_object" } 
    });

    const content = completion.choices[0]?.message?.content;
    console.log('Received OpenAI troubleshooting response content:', content);

    if (!content) {
      console.warn('OpenAI troubleshooting response content is empty.');
      return []; // Return empty array
    }

    // Attempt to extract JSON array from ```json ... ``` block
    const jsonMatch = content.match(/```json\n(\[.*?\])\n```/s);
    if (jsonMatch && jsonMatch[1]) {
        try {
            const parsedSteps = JSON.parse(jsonMatch[1]) as PlanStep[];
            if (Array.isArray(parsedSteps)) {
                console.log('Parsed fallback candidates from markdown block:', parsedSteps);
                // Optional: Add validation that elements look like PlanSteps
                return parsedSteps.filter(step => typeof step === 'object' && step !== null && step.action); 
            } else {
                 console.warn('Parsed JSON from markdown block is not an array.');
            }
        } catch (parseError) {
             console.warn('Failed to parse JSON from markdown block:', parseError);
        }
    }
    
    // Fallback: Try parsing the entire content directly
    try {
        const parsedDirect = JSON.parse(content);
        if(Array.isArray(parsedDirect)) {
            console.warn('Parsed fallback candidates directly from response (no markdown block found).')
            return parsedDirect.filter(step => typeof step === 'object' && step !== null && step.action); 
        }
        // Ignore if it parsed but wasn't an array (e.g., the error object)
        console.warn('LLM returned valid JSON, but not in the expected PlanStep array format:', parsedDirect);
        return []; // Treat as no valid suggestions
    } catch (directParseError) {
         console.warn('Could not parse LLM response as JSON (neither markdown block nor direct). Response:', content);
         return []; // Treat as no valid suggestions
    }

  } catch (error) {
    console.error('OpenAI API call failed during troubleshooting:', error);
    // Re-throw API errors
    let errorMessage = 'Unknown OpenAI API error';
    if (error instanceof Error) {
      errorMessage = error.message;
      const openAIError = error as any; 
      if (openAIError.response?.data?.error?.message) {
        errorMessage = openAIError.response.data.error.message;
      }
    } 
    throw new Error(`OpenAI API troubleshooting error: ${errorMessage}`);
  }
} 