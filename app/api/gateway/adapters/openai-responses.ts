import { OPENAI_BASE_URL } from "@/app/constant";

import {
  GatewayAdapterContext,
  gatewayJsonError,
  normalizeBaseUrl,
} from "./types";

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function textFromResponse(value: unknown) {
  const body = objectValue(value);
  if (typeof body?.output_text === "string") return body.output_text;
  const outputValue = body?.output;
  const output = Array.isArray(outputValue) ? outputValue : [];
  return output
    .flatMap((itemValue) => {
      const item = objectValue(itemValue);
      const contentValue = item?.content;
      return Array.isArray(contentValue) ? contentValue : [];
    })
    .map((contentValue) => {
      const content = objectValue(contentValue);
      if (typeof content?.text === "string") return content.text;
      return typeof content?.output_text === "string"
        ? content.output_text
        : "";
    })
    .filter(Boolean)
    .join("\n");
}

function textFromContent(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((partValue) => {
      if (typeof partValue === "string") return partValue;
      const part = objectValue(partValue);
      return typeof part?.text === "string" ? part.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function responsesContent(content: unknown, role: string) {
  if (!Array.isArray(content)) return textFromContent(content);

  return content
    .map((partValue) => {
      if (typeof partValue === "string") {
        return {
          type: role === "assistant" ? "output_text" : "input_text",
          text: partValue,
        };
      }
      const part = objectValue(partValue);
      const imageUrl = objectValue(part?.image_url);
      if (part?.type === "image_url" && typeof imageUrl?.url === "string") {
        return { type: "input_image", image_url: imageUrl.url };
      }
      const text = typeof part?.text === "string" ? part.text : "";
      return text
        ? {
            type: role === "assistant" ? "output_text" : "input_text",
            text,
          }
        : undefined;
    })
    .filter(Boolean);
}

function parseRequestBody(bodyText?: string) {
  if (!bodyText) return {};
  const value: unknown = JSON.parse(bodyText);
  return objectValue(value) ?? {};
}

function toResponsesPayload(
  parsed: Record<string, unknown>,
  model: string,
  shouldStream: boolean,
) {
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const input =
    messages.length > 0
      ? messages.map((messageValue) => {
          const message = objectValue(messageValue) ?? {};
          const role = typeof message.role === "string" ? message.role : "user";
          return {
            role: role === "system" ? "developer" : role,
            content: responsesContent(message.content, role),
          };
        })
      : textFromContent(parsed.prompt) || "";

  const payload: Record<string, unknown> = {
    model,
    input,
    stream: shouldStream,
    max_output_tokens:
      parsed.max_output_tokens ??
      parsed.max_completion_tokens ??
      parsed.max_tokens,
  };
  const supportsSamplingParams = !model.startsWith("gpt-5");
  if (
    supportsSamplingParams &&
    typeof parsed.temperature === "number" &&
    Number.isFinite(parsed.temperature)
  ) {
    payload.temperature = parsed.temperature;
  }
  if (
    supportsSamplingParams &&
    typeof parsed.top_p === "number" &&
    Number.isFinite(parsed.top_p)
  ) {
    payload.top_p = parsed.top_p;
  }
  return payload;
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
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

function streamChunk(model: string, content: string, finished = false) {
  return JSON.stringify({
    id: `newbiechat-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: finished ? {} : { content },
        finish_reason: finished ? "stop" : null,
      },
    ],
  });
}

function transformedResponsesStream(res: Response, model: string) {
  if (!res.body) return gatewayJsonError(502, "OpenAI stream had no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let completed = false;
  const maxEventBuffer = 256 * 1024;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (!completed) {
          const chunk = await reader.read();
          if (chunk.done) {
            buffer += decoder.decode();
            throw new Error("OpenAI Responses stream ended before completion");
          }

          buffer += decoder.decode(chunk.value, { stream: true });
          if (buffer.length > maxEventBuffer) {
            throw new Error("OpenAI Responses stream event was too large");
          }
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop() ?? "";
          const output: string[] = [];

          for (const event of events) {
            const data = event
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (!data || data === "[DONE]") continue;

            const value: unknown = JSON.parse(data);
            const payload = objectValue(value);
            const type = typeof payload?.type === "string" ? payload.type : "";
            if (type === "response.output_text.delta") {
              const delta =
                typeof payload?.delta === "string" ? payload.delta : "";
              if (delta) output.push(`data: ${streamChunk(model, delta)}\n\n`);
            } else if (type === "response.output_text.done") {
              continue;
            } else if (type === "response.completed") {
              completed = true;
              output.push(`data: ${streamChunk(model, "", true)}\n\n`);
              output.push("data: [DONE]\n\n");
            } else if (type === "error") {
              throw new Error("OpenAI Responses stream failed");
            }
          }

          if (output.length > 0) {
            controller.enqueue(encoder.encode(output.join("")));
            if (completed) {
              await reader.cancel();
              controller.close();
            }
            return;
          }
        }
      } catch (error) {
        try {
          await reader.cancel();
        } catch {
          // The upstream may already be closed.
        }
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
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
  let parsed: Record<string, unknown>;
  try {
    parsed = parseRequestBody(ctx.bodyText);
  } catch {
    return gatewayJsonError(400, "invalid JSON request body");
  }
  const shouldStream = parsed.stream === true;
  const payload = toResponsesPayload(parsed, ctx.model.model, shouldStream);

  const res = await fetch(`${baseUrl}/v1/responses`, {
    method: "POST",
    headers: {
      Accept: shouldStream ? "text/event-stream" : "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.credential.apiKey}`,
      ...(ctx.credential.orgId
        ? { "OpenAI-Organization": ctx.credential.orgId }
        : {}),
    },
    body: JSON.stringify(payload),
    signal: ctx.signal,
  });

  if (!res.ok) {
    return gatewayJsonError(res.status, "OpenAI request failed");
  }

  if (shouldStream) return transformedResponsesStream(res, ctx.model.model);

  const value: unknown = await res.json();
  return Response.json(
    chatCompletionJson(ctx.model.model, textFromResponse(value)),
    { status: 200 },
  );
}
