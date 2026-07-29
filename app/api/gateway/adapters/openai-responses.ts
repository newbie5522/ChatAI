import { OPENAI_BASE_URL } from "@/app/constant";

import {
  GatewayAdapterContext,
  copyResponseHeaders,
  normalizeBaseUrl,
} from "./types";

function textFromResponse(json: any) {
  if (typeof json?.output_text === "string") return json.output_text;
  if (!Array.isArray(json?.output)) return "";

  return json.output
    .flatMap((item: any) => item?.content ?? [])
    .map((content: any) => content?.text ?? content?.output_text ?? "")
    .filter(Boolean)
    .join("\n");
}

function textFromContent(content: any) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text ?? "";
      if (part?.text) return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function toResponsesPayload(bodyText: string | undefined, model: string) {
  const parsed = bodyText ? JSON.parse(bodyText) : {};
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const input =
    messages.length > 0
      ? messages.map((message: any) => ({
          role: message.role === "system" ? "developer" : message.role,
          content: textFromContent(message.content),
        }))
      : textFromContent(parsed.prompt) || "";

  return {
    model,
    input,
    stream: false,
    temperature: parsed.temperature,
    top_p: parsed.top_p,
    max_output_tokens:
      parsed.max_output_tokens ??
      parsed.max_completion_tokens ??
      parsed.max_tokens,
  };
}

function chatCompletionJson(model: string, content: string) {
  return {
    id: `newbiechat-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
  };
}

function chatCompletionStream(model: string, content: string) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            id: `newbiechat-${Date.now()}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content },
                finish_reason: null,
              },
            ],
          })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          })}\n\n`,
        ),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function callOpenAIResponses(ctx: GatewayAdapterContext) {
  const baseUrl = normalizeBaseUrl(ctx.credential.baseUrl, OPENAI_BASE_URL);
  const parsed = ctx.bodyText ? JSON.parse(ctx.bodyText) : {};
  const shouldStream = parsed.stream === true;
  const payload = toResponsesPayload(ctx.bodyText, ctx.model.model);

  const res = await fetch(`${baseUrl}/v1/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.credential.apiKey}`,
      ...(ctx.credential.orgId
        ? { "OpenAI-Organization": ctx.credential.orgId }
        : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: copyResponseHeaders(res),
    });
  }

  const json = await res.json();
  const content = textFromResponse(json);
  if (shouldStream) {
    return chatCompletionStream(ctx.model.model, content);
  }

  return Response.json(chatCompletionJson(ctx.model.model, content), {
    status: 200,
  });
}
