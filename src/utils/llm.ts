import OpenAI from 'openai';

// Define the expected structure of the plan steps
interface PlanStep {
  action: 'navigate' | 'type' | 'click' | 'scroll' | 'wait' | 'extract'; // Extend as needed
  [key: string]: any; // Allow other properties like url, selector, text, etc.
}

// Define the structure of the full plan
interface ExecutionPlan {
  goal: string;
  steps: PlanStep[];
}

const SYSTEM_PROMPT = `
You are an expert web automation assistant. Given a natural language instruction, 
create a precise JSON plan consisting of a sequence of steps to accomplish the goal.

Supported actions are:
- navigate: { action: "navigate", url: "<full_url>" }
- type: { action: "type", selector: "<css_selector>", text: "<text_to_type>" }
- click: { action: "click", selector: "<css_selector>" }
- scroll: { action: "scroll", direction: "<up|down|bottom|top>", amount?: <pixels> }
- wait: { action: "wait", duration: <milliseconds> | selector: "<css_selector>" }
- extract: { action: "extract", selector: "<css_selector>", name: "<variable_name>" } // For extracting text content

Rules:
- Use CSS selectors to identify elements.
- Ensure URLs are complete (e.g., include https://).
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