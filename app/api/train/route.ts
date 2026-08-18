import { NextRequest, NextResponse } from "next/server";
import { McpClient, McpTool } from "@/lib/mcpClient";

export const runtime = "nodejs";
export const maxDuration = 60;

const MCP_SERVER_URL = "https://learn.microsoft.com/api/mcp";
const MAX_TOOL_ROUNDS = 3;

const SYSTEM_PROMPT = `You are "D365 Trainer", a patient instructor for business users and functional consultants
working in Dynamics 365 Finance & Operations (and related apps such as Project Operations).

RESEARCH RULE — STRICT:
You have tools to search Microsoft Learn. Do ONE search only. Use the results to ground your answer. Do NOT make
multiple searches, fetch multiple pages, or keep searching if the first result is incomplete. If the first search
returns nothing useful, proceed to write your answer with the best information available.

OUTPUT RULE — CRITICAL:
1. Make ONE tool call (search or fetch) to ground your answer in real docs
2. Do NOT call tools again after your first result
3. Write your final answer as plain text with no preamble
4. The very first characters MUST be "## Context"
5. If docs aren't available, say so plainly in the guide
6. Never make up details or guess — use only what you retrieved

VERSION POLICY: Default to latest supported Dynamics 365 Finance & Operations.

SCOPE: Focus on functional business processes and standard capabilities.

TONE: Patient, clear, supportive. One step at a time.

RESPONSE FORMAT — Use markdown with these level-2 headings, in order:

## Context
- What the task is
- Why it is done in Dynamics 365 Finance & Operations
- The business outcome

## Functionality
- What feature/page is used
- What it does
- How it fits into the end-to-end business process

## Step-by-Step Guidance
Numbered steps only. Each step on its own line. For each step: what to do, what appears, why it matters.
If grouping by phases, put the bolded phase label (**Phase Name**) on its own line, then start numbered steps on the next line.
Example format:
**Navigate**
1. First step.
2. Second step.

**Post**
3. Third step.

## Understanding Check
One or two short questions checking the user is following along, and confirming what (if anything) they'd like
covered next.

## Helpful Tips
Only include tips that reflect what you actually found documented. Omit this section entirely if you have nothing
solid to add.

## Microsoft Learn References
List only URLs you actually retrieved via the tools during your research — never invent a URL. For each: a short
label ("Official reference" or "Optional deeper reading") and the exact URL.

Keep the total response focused and scannable — prefer clarity over length.`;

function mcpToolToOpenAiTool(tool: McpTool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description || "",
      parameters: tool.inputSchema || { type: "object", properties: {} },
    },
  };
}

function extractSourcesFromToolResult(resultText: string): string[] {
  const urls = new Set<string>();
  try {
    const parsed = JSON.parse(resultText);
    const list = Array.isArray(parsed) ? parsed : parsed?.results || parsed?.value || [];
    for (const item of Array.isArray(list) ? list : []) {
      if (item?.contentUrl && typeof item.contentUrl === "string") {
        urls.add(item.contentUrl);
      }
    }
  } catch {
    // Not JSON (e.g. a fetched markdown page) — try to pull the source URL loosely if present.
  }
  return Array.from(urls);
}

export async function POST(req: NextRequest) {
  try {
    const { question } = await req.json();

    if (!question || typeof question !== "string" || question.trim().length < 3) {
      return NextResponse.json(
        { error: "Enter a Dynamics 365 Finance & Operations task or question to learn." },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Server is missing OPENROUTER_API_KEY. Set it in your Vercel project's environment variables." },
        { status: 500 }
      );
    }

    const model = process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-sonnet";

    // 1. Connect to the Microsoft Learn MCP server and discover its tools dynamically.
    const mcp = new McpClient(MCP_SERVER_URL);
    const mcpTools = await mcp.listTools();
    if (mcpTools.length === 0) {
      return NextResponse.json(
        { error: "Microsoft Learn MCP server returned no tools. Try again shortly." },
        { status: 502 }
      );
    }
    const openAiTools = mcpTools.map(mcpToolToOpenAiTool);

    // 2. Run the tool-calling loop against OpenRouter ourselves.
    const messages: any[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: question.slice(0, 2000) },
    ];

    const sources = new Set<string>();
    let finalAnswer: string | null = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": process.env.SITE_URL || "https://d365finance.uk",
          "X-Title": "D365 Trainer",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4000,
          temperature: 0.3,
          messages,
          tools: openAiTools,
          tool_choice: "auto",
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return NextResponse.json(
          { error: `OpenRouter request failed (${res.status}): ${errText.slice(0, 400)}` },
          { status: 502 }
        );
      }

      const data = await res.json();
      const choice = data?.choices?.[0];
      const message = choice?.message;

      if (!message) {
        return NextResponse.json({ error: "No response from model." }, { status: 502 });
      }

      const toolCalls = message.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        // No more tool calls — this is the final answer.
        finalAnswer = message.content || "";
        break;
      }

      // Model wants to call one or more tools. Append its message, then execute each
      // tool call against the real MCP server and feed results back.
      messages.push(message);

      for (const call of toolCalls) {
        const toolName = call.function?.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          args = {};
        }

        let resultText: string;
        try {
          resultText = await mcp.callTool(toolName, args);
        } catch (toolErr: any) {
          resultText = `Tool call failed: ${toolErr?.message || "unknown error"}`;
        }

        for (const url of extractSourcesFromToolResult(resultText)) {
          sources.add(url);
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: resultText.slice(0, 8000),
        });
      }
    }

    if (!finalAnswer) {
      return NextResponse.json(
        {
          error:
            "Model kept calling tools without producing a final answer within the round limit. Try a more specific question.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ guide: finalAnswer, sources: Array.from(sources) });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Unexpected error: ${err?.message || "unknown"}` },
      { status: 500 }
    );
  }
}
