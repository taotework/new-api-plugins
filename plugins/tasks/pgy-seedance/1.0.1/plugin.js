// Pugongying (PGY) Seedance 2.0 video generation task plugin.
//
// 1.0.1 billing fixes:
//   * Unspecified resolution now bills the official 720p default tier
//     (previously 1080p, overcharging requests that rely on the documented
//     default). extractUsageOnComplete still overlays real tokens/resolution.
//   * "4k" is now recognized in the submit estimate and the completion hook
//     (the tier tables already priced 4k; the recognition lists missed it).
//   * Unspecified duration/seconds/frames now bills the official 5s default
//     (previously 15s, a 3x overestimate that stuck on duration-based tiered
//     expressions because the completion hook reports tokens, not duration).
//
// Adapts the PGY Seedance REST relay service (base URL configurable, default
// https://seedance.pgysd.com) into the new-api task-plugin runtime. PGY is a
// relay/proxy for China Mobile Cloud's (移动云) Doubao Seedance 2.0 video
// generation API. The wire format is the Seedance/Ark content-array dialect:
//
//   POST {base}/api/v3/contents/generations/tasks        -> submit, returns {"id":"cgt-xxx"}
//   GET  {base}/api/v3/contents/generations/tasks/{id}   -> poll,   returns the task object
//
// Auth: Authorization: Bearer {API Key} (PGY-issued key, validated against
// the Mobile Cloud gateway). The plugin registers native gateway routes
// namespaced under /pgy and the host openai_video / openai_responses protocol
// bindings so the same service can be reached through the standard new-api
// OpenAI surfaces.
//
// t2v service_tier restriction: the Mobile Cloud platform rejects any request
// body that carries a `service_tier` key in pure text-to-video (t2v) mode — the
// key must be absent, not empty. This plugin only writes service_tier into the
// upstream body when the client supplies a non-empty value; for t2v the client
// should omit it and the field stays absent.

export const meta = {
  apiVersion: 1,
  key: "pgy-seedance",
  name: "PGY Seedance",
  icon: "text:PG",
  description: {
    en: "Pugongying (PGY) Seedance 2.0 video generation relay — text, image, video, and audio input via /api/v3/contents/generations/tasks",
    zh: "蒲公英 Seedance 2.0 视频生成中转（文生/图生/视频生/音频参考），走 /api/v3/contents/generations/tasks",
  },
  version: "1.0.1",
  author: { name: "QuantumNous" },
  // Gateway-facing model name is "pgy-seedance-2.0". Virtual wux-dance-* names
  // are NOT declared here — expose them via channel model_mapping on a type-59
  // task-plugin channel (ResolveTaskModelAlias pins this plugin from the
  // alias). The upstream PGY API always receives "doubao-seedance-2.0"
  // (UPSTREAM_MODEL) unless the channel model_mapping overrides via
  // ctx.upstreamModel.
  models: ["pgy-seedance-2.0"],
  // Owns channel type 103 (pgy-seedance). A type-103 channel auto-binds via
  // GetByChannelType; a type-61 (TaskPlugin) channel can still bind by
  // task_plugin_key.
  channelTypes: [103],
  fetchMode: "per_task",
  usageSchema: {
    tokens: {
      type: "number",
      unit: "token",
      description: {
        en: "Upstream billing tokens (estimated at submit, actual on completion).",
        zh: "上游计费 token（提交时预估，完成后按实际值）。",
      },
    },
    resolution: {
      enum: ["480p", "720p", "1080p", "4k"],
      description: {
        en: "Output video resolution; Seedance token unit price varies by resolution tier.",
        zh: "输出视频分辨率；Seedance token 单价随分辨率档位变化。",
      },
    },
    video_input: {
      enum: ["none", "video"],
      description: {
        en: "Whether the request includes reference video input; Seedance 2.0 prices video-to-video tokens at a lower unit rate.",
        zh: "请求是否包含参考视频输入；Seedance 2.0 对视频生视频 token 按更低单价计费。",
      },
    },
  },
  // Official Seedance formula tokens = (input + output seconds) × W × H × 24 / 1024,
  // 16:9 max-pixel sizes, cross-checked against the Seedance price examples.
  usageExamples: [
    { label: "480p · 5s", facts: { tokens: 48038, resolution: "480p", video_input: "none" } },
    { label: "720p · 5s", facts: { tokens: 108000, resolution: "720p", video_input: "none" } },
    { label: "720p · 5s (视频输入)", facts: { tokens: 108000, resolution: "720p", video_input: "video" } },
    { label: "1080p · 5s", facts: { tokens: 243000, resolution: "1080p", video_input: "none" } },
    { label: "1080p · 5s (视频输入)", facts: { tokens: 243000, resolution: "1080p", video_input: "video" } },
    { label: "4k · 5s", facts: { tokens: 972000, resolution: "4k", video_input: "none" } },
    { label: "4k · 5s (视频输入)", facts: { tokens: 972000, resolution: "4k", video_input: "video" } },
    { label: "720p · 10s", facts: { tokens: 216000, resolution: "720p", video_input: "none" } },
  ],
  routes: [
    { method: "POST", path: "/pgy/api/v3/contents/generations/tasks", type: "submit", decode: "createTask", render: "taskCreated" },
    { method: "GET", path: "/pgy/api/v3/contents/generations/tasks/:task_id", type: "query", render: "taskStatus" },
  ],
  protocols: [{ name: "openai_responses", supports: ["stream", "sync", "background"] }, "openai_video"],
};

// ---- Shared helpers ---------------------------------------------------------

// The upstream PGY API accepts the dotted Seedance 2.0 alias as the `model`
// field in the request body. This is always what gets sent upstream regardless
// of the gateway-facing model name (pgy-seedance-2.0), unless the channel's
// model_mapping explicitly overrides it via ctx.upstreamModel.
const UPSTREAM_MODEL = "doubao-seedance-2.0";

function trimmed(value) {
  return String(value || "").trim();
}

function normalizeResolution(value) {
  const raw = trimmed(value).toLowerCase();
  if (["480p", "720p", "1080p", "4k"].includes(raw)) return raw;
  const parts = raw.replace("*", "x").split("x");
  if (parts.length !== 2) return "720p";
  const max = Math.max(Number(parts[0]), Number(parts[1]));
  if (max >= 3840) return "4k";
  if (max >= 1920) return "1080p";
  if (max >= 1280) return "720p";
  return "480p";
}

function hasVideo(content) {
  return Array.isArray(content) && content.some((item) => item && (item.type === "video_url" || Object.prototype.hasOwnProperty.call(item, "video_url")));
}

// Max-pixel 16:9 dimensions per resolution tier. Used when ratio is absent or
// adaptive so the submit-time estimate overestimates rather than underestimates.
// Official Seedance formula: tokens = seconds × width × height × 24 / 1024.
function resolutionMaxPixels(resolution) {
  if (resolution === "480p") return [854, 480];
  if (resolution === "1080p") return [1920, 1080];
  if (resolution === "4k") return [3840, 2160];
  return [1280, 720];
}

function estimateTokens(seconds, resolution) {
  const dims = resolutionMaxPixels(resolution);
  return (seconds * dims[0] * dims[1] * 24) / 1024;
}

// Billing ratio for video-to-video vs no-video-input, mirroring the official
// Doubao Seedance 2.0 price table (doubao-seedance-2-0-260128). The no-video
// 1080p ratio (>1) corrects the max-pixel estimate up to the official 1080p
// unit price; video-to-video uses a lower ratio reflecting the cheaper per-token
// unit rate for video input. This plugin only serves doubao-seedance-2.0
// upstream, so the discount always applies regardless of the gateway model.
function videoInputRatio(resolution, content) {
  const video = hasVideo(content);
  const res = trimmed(resolution).toLowerCase();
  if (res === "1080p") return video ? 31 / 46 : 51 / 46;
  if (res === "4k") return video ? 16 / 46 : 26 / 46;
  return video ? 28 / 46 : 1;
}

function responsesInput(req) {
  const texts = [],
    images = [];
  const input = req.input;
  if (typeof input === "string") texts.push(input);
  else if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === "string") {
        texts.push(item);
        continue;
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const content = item.content === undefined ? [item] : Array.isArray(item.content) ? item.content : [item.content];
      for (const part of content) {
        if (typeof part === "string") {
          texts.push(part);
          continue;
        }
        if (!part || typeof part !== "object" || Array.isArray(part)) continue;
        if (["input_text", "text"].includes(part.type) && typeof part.text === "string") texts.push(part.text);
        if (["input_image", "image_url"].includes(part.type)) {
          let image = part.image_url;
          if (image && typeof image === "object") image = image.url;
          if (trimmed(image)) images.push(trimmed(image));
        }
      }
    }
  }
  return {
    prompt: texts
      .filter(function (text) {
        return trimmed(text);
      })
      .join("\n"),
    images: images,
  };
}

function responsesVideoText(ctx) {
  const artifact = ctx && ctx.artifacts && ctx.artifacts.video;
  const url = trimmed(artifact && artifact.url);
  if (!url) throw new Error("video artifact is unavailable");
  const escaped = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return '<video controls src="' + escaped + '"></video>';
}

// ---- Native surface (backing the declared routes) ---------------------------

export const native = {
  createTask: function (ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    const body = ctx.body.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("request body must be an object");
    const model = trimmed(body.model);
    if (!model) throw new Error("model is required");
    if (body.content !== undefined && !Array.isArray(body.content)) throw new Error("content must be an array");
    const content = Array.isArray(body.content) ? body.content : [];
    const texts = [];
    let hasReference = false;
    for (const item of content) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      if (item.type === "text" && typeof item.text === "string") texts.push(item.text);
      else hasReference = true;
    }
    if (!texts.length && !hasReference) throw new Error("content is required");
    const requestBody = {
      model: model,
      prompt: texts
        .filter(function (text) {
          return trimmed(text);
        })
        .join("\n"),
      metadata: body,
    };
    const seconds = Number(body.duration);
    if (Number.isFinite(seconds) && seconds > 0) requestBody.seconds = seconds;
    const intent = { kind: "submit", model: model, action: hasReference ? "image_to_video" : "text_to_video", requestBody: requestBody };
    return intent;
  },
  taskCreated: function (ctx, task) {
    const data = task.data && typeof task.data === "object" && !Array.isArray(task.data) ? task.data : {};
    return Object.assign({}, data, { id: task.task_id });
  },
  taskStatus: function (ctx, task) {
    if (task.data && typeof task.data === "object" && !Array.isArray(task.data)) return Object.assign({}, task.data, { id: task.task_id });
    const statusMap = { NOT_START: "queued", SUBMITTED: "queued", QUEUED: "queued", IN_PROGRESS: "running", SUCCESS: "succeeded", FAILURE: "failed" };
    const output = { id: task.task_id, status: statusMap[task.status] || "queued" };
    if (task.fail_reason) output.error = { message: task.fail_reason };
    return output;
  },
  error: function (ctx, error) {
    return { error: { code: error.code, message: error.message } };
  },
};

// ---- Driver hooks -----------------------------------------------------------

export function buildSubmitRequest(ctx) {
  const req = ctx.requestBody;
  const metadata = req.metadata || {};
  const body = Object.assign({ model: req.model || "", content: [] }, metadata);
  const imageContent = [];
  const images = Array.isArray(req.images) ? req.images : [];
  for (const url of images) imageContent.push({ type: "image_url", image_url: { url: url } });
  const metadataContent = Array.isArray(body.content) ? body.content : [];
  body.content = imageContent.concat(metadataContent).filter((item) => item && item.type !== "text");
  const hasReference = body.content.length > 0;
  if (trimmed(req.prompt) || !hasReference) body.content.push({ type: "text", text: req.prompt || "" });
  const durationRaw = req.seconds !== undefined ? req.seconds : req.duration !== undefined ? req.duration : metadata.duration;
  const seconds = Number(durationRaw);
  if (Number.isFinite(seconds) && seconds > 0) body.duration = seconds;
  body.model = ctx.upstreamModel || UPSTREAM_MODEL;
  // t2v service_tier restriction: the Mobile Cloud platform rejects any
  // request body that carries a service_tier key in pure text-to-video mode.
  // Only forward the field when the client supplied a non-empty value; drop
  // null / empty-string so the key stays absent (not "must be empty") upstream.
  if (body.serviceTier === null || body.serviceTier === undefined || trimmed(body.serviceTier) === "") {
    delete body.serviceTier;
  }
  return {
    url: ctx.baseUrl + "/api/v3/contents/generations/tasks",
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
    body: body,
    action: hasReference ? "image_to_video" : "text_to_video",
    rewriteModel: body.model,
  };
}

export function parseSubmitResponse(ctx, resp) {
  if (!resp.body || !resp.body.id) throw new Error("task_id is empty");
  return { taskId: resp.body.id, taskData: resp.body };
}

export function extractUsage(ctx) {
  const req = ctx.requestBody || {};
  const metadata = req.metadata || {};
  if (ctx.usagePurpose === "billing_ratios") {
    const ratio = videoInputRatio(metadata.resolution, metadata.content);
    return ratio === 1 ? null : { video_input_ratio: ratio };
  }
  let seconds = Number(req.seconds || req.duration || metadata.duration || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    const frames = Number(metadata.frames);
    // Official Seedance default duration is 5s when the request omits it.
    seconds = Number.isFinite(frames) && frames > 0 ? Math.floor(frames / 24) : 5;
  }
  if (seconds <= 0) seconds = 5;
  seconds = Math.min(seconds, 3600);
  const rawResolution = metadata.resolution || req.size;
  const raw = trimmed(rawResolution).toLowerCase();
  const recognized = ["480p", "720p", "1080p", "4k"].includes(raw) || raw.replace("*", "x").split("x").length === 2;
  // Unspecified resolution bills the official 720p default tier.
  const resolution = recognized ? normalizeResolution(rawResolution) : "720p";
  return {
    tokens: estimateTokens(seconds, resolution),
    resolution: resolution,
    video_input: hasVideo(metadata.content) ? "video" : "none",
  };
}

export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl + "/api/v3/contents/generations/tasks/" + ctx.taskId,
    method: "GET",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + ctx.apiKey },
  };
}

export function parseTaskResult(ctx, body) {
  if (body.status === "pending" || body.status === "queued") return { status: "QUEUED", progress: "10%" };
  if (body.status === "processing" || body.status === "running") return { status: "IN_PROGRESS", progress: "50%" };
  if (body.status === "succeeded") {
    const result = { status: "SUCCESS", progress: "100%", url: body.content && body.content.video_url ? body.content.video_url : "" };
    const usage = body.usage || {};
    const completionTokens = Number(usage.completion_tokens || 0);
    const totalTokens = Number(usage.total_tokens || 0);
    if (Number.isFinite(completionTokens) && completionTokens > 0) result.completionTokens = completionTokens;
    if (Number.isFinite(totalTokens) && totalTokens > 0) result.totalTokens = totalTokens;
    return result;
  }
  if (body.status === "failed" || body.status === "expired" || body.status === "cancelled") {
    const reason = body.error && body.error.message ? body.error.message : body.status;
    return { status: "FAILURE", progress: "100%", reason: reason };
  }
  return { status: "IN_PROGRESS", progress: "30%" };
}

function artifactData(ctx) {
  const data = (ctx && ctx.data) || {};
  if (data.data && typeof data.data === "object" && data.data.task_id && Object.prototype.hasOwnProperty.call(data.data, "data")) return data.data.data || {};
  return data;
}

export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  const content = artifactData(task).content || {};
  const artifacts = [];
  if (trimmed(content.video_url)) artifacts.push({ key: "video", type: "video" });
  if (trimmed(content.last_frame_url)) artifacts.push({ key: "last_frame", type: "image", mimeType: "image/png" });
  return artifacts;
}

export function buildContentRequest(ctx) {
  const content = artifactData(ctx).content || {};
  const urls = { video: content.video_url, last_frame: content.last_frame_url };
  const url = trimmed(urls[ctx.artifactKey]);
  if (!url) throw new Error("artifact_not_found");
  return { url: url, method: ctx.clientRequest.method, credentialless: true };
}

export function extractUsageOnComplete(task, taskResult, body) {
  if (!body || body.status !== "succeeded") return {};
  const facts = {};
  const usage = body.usage || {};
  let tokens = Number(usage.completion_tokens);
  if (!Number.isFinite(tokens) || tokens <= 0) tokens = Number(usage.total_tokens);
  if (Number.isFinite(tokens) && tokens > 0) facts.tokens = tokens;
  const content = body.content || {};
  const resolution = trimmed(content.resolution || body.resolution).toLowerCase();
  if (["480p", "720p", "1080p", "4k"].includes(resolution)) facts.resolution = resolution;
  return facts;
}

// ---- Host protocols ---------------------------------------------------------

export const protocols = {
  openai_responses: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const req = ctx.body.value;
      if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
      const model = trimmed(req.model);
      if (!model) throw new Error("model is required");
      if (req.input !== undefined && typeof req.input !== "string" && !Array.isArray(req.input)) throw new Error("input must be a string or array");
      if (req.images !== undefined && !Array.isArray(req.images)) throw new Error("images must be an array");
      if (req.metadata !== undefined && (!req.metadata || typeof req.metadata !== "object" || Array.isArray(req.metadata)))
        throw new Error("metadata must be an object");
      const input = responsesInput(req);
      const prompt = input.prompt || trimmed(req.prompt);
      const images = [];
      for (const image of [req.image, req.input_reference].concat(req.images || [], input.images)) {
        if (trimmed(image) && !images.includes(trimmed(image))) images.push(trimmed(image));
      }
      if (!prompt && images.length === 0) throw new Error("input is required");
      const metadata = Object.assign({}, req.metadata || {});
      if (Object.prototype.hasOwnProperty.call(req, "resolution")) metadata.resolution = req.resolution;
      else if (req.size && !metadata.resolution) metadata.resolution = normalizeResolution(req.size);
      if (Object.prototype.hasOwnProperty.call(req, "seconds")) metadata.duration = req.seconds;
      else if (Object.prototype.hasOwnProperty.call(req, "duration")) metadata.duration = req.duration;
      const requestBody = { model: model, prompt: prompt };
      if (images.length) requestBody.images = images;
      if (Object.keys(metadata).length) requestBody.metadata = metadata;
      const intent = { kind: "submit", model: model, action: images.length ? "image_to_video" : "text_to_video", requestBody: requestBody };
      return intent;
    },
    renderEvents: function (ctx, task, previousState) {
      const status = String(task.status || "UNKNOWN").toUpperCase();
      const value = Number(String(task.progress || "").replace("%", ""));
      const progress = Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
      const state = { status: status, progress: progress };
      if (status === "SUCCESS") {
        const text = responsesVideoText(ctx);
        const events = previousState && previousState.status === status ? [] : [{ type: "output", data: text }];
        return { events: events, state: state, done: true };
      }
      if (status === "FAILURE")
        return { events: [{ type: "error", code: "task_failed", message: task.fail_reason || "task failed" }], state: state, done: true };
      if (previousState && previousState.status === status && previousState.progress === progress) return { events: [], state: state, done: false };
      const event = { type: "progress", message: status.toLowerCase() };
      if (progress !== null) event.progress = progress;
      return { events: [event], state: state, done: false };
    },
    renderFinal: function (ctx, _task) {
      return {
        output: [
          {
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: responsesVideoText(ctx), annotations: [], logprobs: [] }],
          },
        ],
        metadata: { vendor: "pgy-seedance" },
      };
    },
  },
};

const legacyRenderers = {
  openai_video: function (task) {
    const data = task.data || {};
    const statusMap = { NOT_START: "queued", SUBMITTED: "queued", QUEUED: "queued", IN_PROGRESS: "in_progress", SUCCESS: "completed", FAILURE: "failed" };
    const output = {
      id: task.task_id,
      object: "video",
      model: task.properties ? task.properties.origin_model_name || "" : "",
      status: statusMap[task.status] || "unknown",
      progress: Number(String(task.progress || "0").replace("%", "")),
      created_at: task.created_at,
      completed_at: task.updated_at,
    };
    if (data.status === "failed") output.error = { message: data.error ? data.error.message || "" : "", code: data.error ? data.error.code || "" : "" };
    return output;
  },
};

protocols.openai_video = {
  decodeRequest: function (ctx) {
    if (!ctx.body || (ctx.body.kind !== "json" && ctx.body.kind !== "multipart")) throw new Error("JSON or multipart body required");
    if (ctx.body.kind === "json") {
      if (!ctx.body.value || Array.isArray(ctx.body.value)) throw new Error("JSON object required");
      const req = ctx.body.value;
      const metadata = Object.assign({}, req.metadata || {});
      if (Object.prototype.hasOwnProperty.call(req, "resolution")) metadata.resolution = req.resolution;
      else if (req.size && !metadata.resolution) metadata.resolution = normalizeResolution(req.size);
      const seconds = req.seconds === undefined ? req.duration : req.seconds;
      if (seconds !== undefined && (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0 || Number(seconds) > 3600))
        throw new Error("seconds must be between 1 and 3600");
      if (seconds !== undefined) metadata.duration = Number(seconds);
      const prompt = trimmed(req.prompt);
      const images = [];
      const ref = trimmed(req.input_reference || req.image);
      if (ref) images.push(ref);
      if (Array.isArray(req.images)) {
        for (const img of req.images) {
          if (typeof img === "string" && trimmed(img) && !images.includes(trimmed(img))) images.push(trimmed(img));
        }
      }
      if (!prompt && images.length === 0) throw new Error("input is required");
      const requestBody = { model: ctx.model, prompt: prompt };
      if (images.length) requestBody.images = images;
      if (Object.keys(metadata).length) requestBody.metadata = metadata;
      return {
        kind: "submit",
        model: ctx.model,
        action: images.length ? "image_to_video" : "text_to_video",
        requestBody: requestBody,
      };
    }
    const first = function (name) {
      const values = (ctx.body.fields || {})[name] || [];
      if (values.length > 1) throw new Error(name + " must be provided once");
      return values[0];
    };
    const req = {};
    const fields = ctx.body.fields || {};
    for (const name of Object.keys(fields)) {
      req[name] = first(name);
    }
    if (req.metadata !== undefined) {
      let parsed;
      try {
        parsed = JSON.parse(req.metadata);
      } catch (e) {
        throw new Error("metadata must be a JSON object string");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("metadata must be a JSON object string");
      req.metadata = parsed;
    }
    if ((ctx.body.files || []).length) throw new Error("PGY Seedance requires image and video references to be URLs inside metadata.content");
    const metadata = Object.assign({}, req.metadata || {});
    if (Object.prototype.hasOwnProperty.call(req, "resolution")) metadata.resolution = req.resolution;
    else if (req.size && !metadata.resolution) metadata.resolution = normalizeResolution(req.size);
    const seconds = req.seconds === undefined ? req.duration : req.seconds;
    if (seconds !== undefined && (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0 || Number(seconds) > 3600))
      throw new Error("seconds must be between 1 and 3600");
    if (seconds !== undefined) metadata.duration = Number(seconds);
    const prompt = trimmed(req.prompt);
    const images = [];
    const ref = trimmed(req.input_reference || req.image);
    if (ref) images.push(ref);
    if (Array.isArray(req.images)) {
      for (const img of req.images) {
        if (typeof img === "string" && trimmed(img) && !images.includes(trimmed(img))) images.push(trimmed(img));
      }
    }
    if (!prompt && images.length === 0) throw new Error("input is required");
    const requestBody = { model: ctx.model, prompt: prompt };
    if (images.length) requestBody.images = images;
    if (Object.keys(metadata).length) requestBody.metadata = metadata;
    return {
      kind: "submit",
      model: ctx.model,
      action: images.length ? "image_to_video" : "text_to_video",
      requestBody: requestBody,
    };
  },
  render: function (ctx, task) {
    return legacyRenderers.openai_video(task);
  },
};
