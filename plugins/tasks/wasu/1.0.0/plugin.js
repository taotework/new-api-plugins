// Wasu (华数) Seedance 2.0 video generation plugin.
//
// Upstream wire format (https://token.wasu.cn):
//   POST {base}/v1/video/generations            -> submit, returns {id, task_id, object, model, status:"queued", progress:0, created_at}
//   GET  {base}/v1/video/generations/{task_id}   -> poll,   returns {code, message, data:{task_id, status, progress, result_url, fail_reason, data:{...}}}
//
// Request shape: two-layer (Volcengine/Doubao) — prompt at top level, reference
// material in metadata.content[] (image_url/video_url/audio_url items with role),
// and generation params flat inside metadata (resolution/ratio MUST go via
// metadata; top-level resolution/ratio are ignored). duration sits at top level
// (per the curl examples). prompt is auto-appended as a text item to content by
// the upstream, so we never inject a text item ourselves.
//
// Poll response: {code, message, data:{task_id, status(NOT_START/QUEUED/
// IN_PROGRESS/SUCCESS/FAILURE), progress, result_url, fail_reason,
// data:{content:{video_url}, usage:{completion_tokens, total_tokens}, ...}}}.

export const meta = {
  apiVersion: 1,
  key: "wasu",
  name: "Wasu Video",
  icon: "text:WS",
  description: {
    en: "Wasu (华数) Seedance 2.0 video generation — text, image, first/last frame, and reference input via /v1/video/generations",
    zh: "华数 Seedance 2.0 视频生成（文生/图生/首尾帧/参考素材），走 /v1/video/generations",
  },
  version: "1.0.0",
  author: { name: "QuantumNous" },
  // Owns channel type 104 (wasu). A type-104 channel auto-binds to this plugin
  // via GetByChannelType; a type-59 (TaskPlugin) channel can bind by
  // task_plugin_key.
  channelTypes: [104],
  models: [
    "doubao-seedance-2.0",
    "doubao-seedance-2.0-fast",
    "doubao-seedance-2.0-mini",
  ],
  fetchMode: "per_task",
  usageSchema: {
    tokens: {
      type: "number",
      unit: "token",
      description: {
        en: "Estimated billing tokens (Seedance formula: seconds × width × height × 24 / 1024).",
        zh: "预估计费 token（Seedance 公式：秒 × 宽 × 高 × 24 / 1024）。",
      },
    },
    duration: {
      type: "number",
      unit: "second",
      description: {
        en: "Output video duration in seconds (e.g. 5 or 10).",
        zh: "输出视频时长（秒），如 5 或 10。",
      },
    },
    resolution: {
      enum: ["480p", "720p", "1080p", "4k"],
      description: {
        en: "Output video resolution tier. 4k is supported by the 2.0 standard tier; fast/mini tiers cap at 480p/720p.",
        zh: "输出视频分辨率档位。4k 仅 2.0 标准版支持；fast/mini 档上限 480p/720p。",
      },
    },
    video_input: {
      enum: ["none", "video"],
      description: {
        en: "Whether the request includes reference video input.",
        zh: "请求是否包含参考视频输入。",
      },
    },
  },
  // Official Seedance formula tokens = seconds × W × H × 24 / 1024, 16:9
  // max-pixel dimensions. 华数底层是 seedance，定价完全参考 doubao seedance
  // 价格表：videoInputRatio 按 model 档（2-5/2-0/fast/mini）+ resolution（含 4k）
  // + 参考视频输入(v2v) 算折扣 ratio，billing_ratios 返回 {video_input_ratio}
  // 或 null（ratio=1 时）。
  usageExamples: [
    { label: "480p · 5s", facts: { tokens: 48038, duration: 5, resolution: "480p", video_input: "none" } },
    { label: "720p · 5s", facts: { tokens: 108000, duration: 5, resolution: "720p", video_input: "none" } },
    { label: "1080p · 5s", facts: { tokens: 243000, duration: 5, resolution: "1080p", video_input: "none" } },
    { label: "4k · 5s", facts: { tokens: 972000, duration: 5, resolution: "4k", video_input: "none" } },
    { label: "4k · 5s (视频输入)", facts: { tokens: 972000, duration: 5, resolution: "4k", video_input: "video" } },
    { label: "720p · 10s", facts: { tokens: 216000, duration: 10, resolution: "720p", video_input: "none" } },
    { label: "1080p · 10s", facts: { tokens: 486000, duration: 10, resolution: "1080p", video_input: "none" } },
    { label: "1080p · 5s (视频输入)", facts: { tokens: 243000, duration: 5, resolution: "1080p", video_input: "video" } },
  ],
  routes: [
    { method: "POST", path: "/wasu/v1/video/generations", type: "submit", decode: "createTask", render: "taskCreated" },
    { method: "GET", path: "/wasu/v1/video/generations/:task_id", type: "query", render: "taskStatus" },
  ],
  protocols: [{ name: "openai_responses", supports: ["stream", "sync", "background"] }, "openai_video"],
};

// ---- Shared helpers ---------------------------------------------------------

function trimmed(value) {
  return String(value || "").trim();
}

// 16:9 max-pixel dimensions per resolution tier (for the token estimate).
function resolutionMaxPixels(resolution) {
  if (resolution === "480p") return [854, 480];
  if (resolution === "1080p") return [1920, 1080];
  if (resolution === "4k") return [3840, 2160];
  return [1280, 720];
}

function estimateTokens(seconds, resolution) {
  var dims = resolutionMaxPixels(resolution);
  return (seconds * dims[0] * dims[1] * 24) / 1024;
}

// Normalize any resolution input to a supported tier; unknown inputs fall back
// to 1080p (the common default for doubao-seedance video models).
function normalizeResolution(value) {
  var raw = trimmed(value).toLowerCase();
  if (raw === "480p" || raw === "720p" || raw === "1080p" || raw === "4k") return raw;
  var parts = raw.replace("*", "x").split("x");
  if (parts.length === 2) {
    var max = Math.max(Number(parts[0]), Number(parts[1]));
    if (max >= 3840) return "4k";
    if (max >= 1920) return "1080p";
    if (max >= 1280) return "720p";
    return "480p";
  }
  return "1080p";
}

// Normalize duration: accept int seconds or -1 (smart duration bills as the
// minimum 5s); default 5; cap at 3600.
function normalizeSeconds(value) {
  var n = Number(value);
  if (!Number.isFinite(n)) return 5;
  if (n < 0) return 5; // -1 smart duration bills as the minimum
  return Math.min(Math.floor(n), 3600);
}

// Extract a URL string from a single media-shaped value (string | {url} |
// {image_url} | {image_url:{url}} | {video_url} | {video_url:{url}}).
function mediaUrlOf(item) {
  if (typeof item === "string") return trimmed(item);
  if (item && typeof item === "object" && !Array.isArray(item)) {
    var url = trimmed(item.url);
    if (url) return url;
    var iu = item.image_url;
    if (iu && typeof iu === "object") return trimmed(iu.url);
    if (typeof iu === "string") return trimmed(iu);
    var vu = item.video_url;
    if (vu && typeof vu === "object") return trimmed(vu.url);
    if (typeof vu === "string") return trimmed(vu);
  }
  return "";
}

// Resolve the content array carried by a request body (openai_video/
// openai_responses surfaces carry it inside metadata.content; a top-level
// content is also accepted).
function requestContent(req) {
  if (req && Array.isArray(req.content)) return req.content;
  var metadata = (req && req.metadata) || {};
  if (Array.isArray(metadata.content)) return metadata.content;
  return [];
}

// Whether the content array carries a video_url item (video-to-video reference
// input). Mirrors doubao/stelloria/pgy-seedance for consistent v2v billing.
function hasVideo(content) {
  if (!Array.isArray(content)) return false;
  for (var i = 0; i < content.length; i++) {
    var item = content[i];
    if (!item || typeof item !== "object") continue;
    if (item.type === "video_url" || Object.prototype.hasOwnProperty.call(item, "video_url")) return true;
  }
  return false;
}

// The poll body is stored on task.data. Wasu's poll body is {code, message,
// data:{...}}; we return the outer object and let callers drill into .data.
function storedBody(ctxOrTask) {
  var d = (ctxOrTask && ctxOrTask.data) || {};
  return d;
}

// Read the generated video URL from a Wasu poll body. Wasu returns
// data.result_url (a signed temporary URL); the upstream raw
// data.data.content.video_url is a permissive fallback.
function resultUrlFromBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  var data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
  if (data.result_url) return trimmed(data.result_url);
  var upstream = data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : {};
  var content = upstream.content && typeof upstream.content === "object" && !Array.isArray(upstream.content) ? upstream.content : {};
  return trimmed(content.video_url);
}

// ---- Native surface (backing the declared routes) ---------------------------

export const native = {
  createTask: function (ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    var body = ctx.body.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("request body must be an object");
    var model = trimmed(body.model);
    if (!model) throw new Error("model is required");
    var prompt = trimmed(body.prompt);
    if (!prompt) throw new Error("prompt is required");
    var metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
    var content = Array.isArray(metadata.content) ? metadata.content : [];
    var hasReference = content.some(function (item) { return item && item.type !== "text"; });
    return {
      kind: "submit",
      model: model,
      action: hasReference ? "image_to_video" : "text_to_video",
      requestBody: { model: model, prompt: prompt, metadata: metadata },
    };
  },
  taskCreated: function (ctx, task) {
    var data = task.data && typeof task.data === "object" && !Array.isArray(task.data) ? task.data : {};
    var out = Object.assign({}, data, { id: task.task_id, task_id: task.task_id });
    if (out.status === undefined) out.status = "queued";
    return out;
  },
  taskStatus: function (ctx, task) {
    var body = task.data && typeof task.data === "object" && !Array.isArray(task.data) ? task.data : {};
    var data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
    var statusMap = {
      NOT_START: "queued",
      QUEUED: "queued",
      IN_PROGRESS: "processing",
      SUCCESS: "completed",
      FAILURE: "failed",
    };
    var status = statusMap[data.status] || "processing";
    var out = Object.assign({}, data, { id: task.task_id, task_id: task.task_id, status: status });
    if (data.result_url) out.result_url = data.result_url;
    if (data.fail_reason) out.error = { code: "task_failed", message: data.fail_reason };
    return out;
  },
  error: function (ctx, error) {
    return { error: { code: error.code, message: error.message } };
  },
};

// ---- Driver hooks -----------------------------------------------------------

// Build the upstream POST /v1/video/generations request. The body uses Wasu's
// two-layer shape: prompt at top level, duration at top level, reference
// material in metadata.content (image_url/video_url/audio_url items with role),
// and generation params flat inside metadata (resolution/ratio MUST go via
// metadata). The model sent upstream honors ctx.upstreamModel first (channel
// model_mapping), then the client-facing model.
export function buildSubmitRequest(ctx) {
  var req = ctx.requestBody || {};
  var model = ctx.upstreamModel || ctx.model || req.model || "";
  var metadata = Object.assign({}, req.metadata || {});
  // Merge images[] into metadata.content as image_url items, preserving any
  // client-supplied content items (with their roles) and dropping text items
  // (prompt is auto-appended as text by the upstream).
  var imageContent = [];
  var images = Array.isArray(req.images) ? req.images : [];
  for (var i = 0; i < images.length; i++) {
    var url = mediaUrlOf(images[i]);
    if (url) imageContent.push({ type: "image_url", image_url: { url: url } });
  }
  var metadataContent = Array.isArray(metadata.content) ? metadata.content : [];
  metadata.content = imageContent.concat(metadataContent).filter(function (item) {
    return item && item.type !== "text";
  });
  var hasReference = metadata.content.length > 0;
  // resolution: metadata.resolution or req.resolution or req.size, normalized.
  var resolutionRaw = metadata.resolution !== undefined ? metadata.resolution : req.resolution !== undefined ? req.resolution : req.size;
  if (resolutionRaw !== undefined) metadata.resolution = normalizeResolution(resolutionRaw);
  // duration: top-level (Wasu curl examples show duration at top level).
  var durationRaw = req.duration !== undefined ? req.duration : req.seconds !== undefined ? req.seconds : metadata.duration;
  var body = { model: model, prompt: trimmed(req.prompt) || "" };
  if (durationRaw !== undefined) body.duration = normalizeSeconds(durationRaw);
  body.metadata = metadata;
  return {
    url: ctx.baseUrl + "/v1/video/generations",
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
    body: body,
    action: hasReference ? "image_to_video" : "text_to_video",
    rewriteModel: body.model,
  };
}

// The submit response carries the task id as `task_id` (with `id` as a
// permissive fallback, since the example shows both fields).
export function parseSubmitResponse(ctx, resp) {
  if (!resp.body) throw new Error("upstream returned no body");
  var taskId = trimmed(resp.body.task_id) || trimmed(resp.body.id);
  if (!taskId) throw new Error("task_id is empty");
  return { taskId: taskId, taskData: resp.body };
}

// Per-model billing ratio mirroring the official Doubao Seedance price table.
// 华数底层是 seedance，模型名 doubao-seedance-2.0/fast/mini 对应 doubao 各档。
// video-to-video (参考视频输入) 享更低单价。模型名分隔符统一（. _ → -）以便
// "doubao-seedance-2.0" 与 "doubao-seedance-2-0-260128" 都能匹配。
function videoInputRatio(model, resolution, content) {
  var video = hasVideo(content);
  var res = trimmed(resolution).toLowerCase();
  var m = trimmed(model).toLowerCase().replace(/[._]/g, "-");
  if (m.indexOf("doubao-seedance-2-5") === 0) {
    if (res === "1080p") return video ? 7.0 / 10.7 : 11.7 / 10.7;
    return video ? 42 / 70 : 1;
  }
  if (m.indexOf("doubao-seedance-2-0-fast") === 0) return video ? 22 / 37 : 1;
  if (m.indexOf("doubao-seedance-2-0-mini") === 0) return video ? 14 / 23 : 1;
  if (m.indexOf("doubao-seedance-2-0") === 0) {
    if (res === "1080p") return video ? 31 / 46 : 51 / 46;
    if (res === "4k") return video ? 16 / 46 : 26 / 46;
    return video ? 28 / 46 : 1;
  }
  return 1;
}

export function extractUsage(ctx) {
  var req = ctx.requestBody || {};
  var metadata = req.metadata || {};
  var content = requestContent(req);
  if (ctx.usagePurpose === "billing_ratios") {
    // 华数底层是 seedance，定价完全参考 doubao seedance 价格表。
    var ratio = videoInputRatio(ctx.upstreamModel || ctx.model || req.model, metadata.resolution, content);
    return ratio === 1 ? null : { video_input_ratio: ratio };
  }
  var seconds = normalizeSeconds(req.duration !== undefined ? req.duration : metadata.duration);
  var resolution = normalizeResolution(metadata.resolution !== undefined ? metadata.resolution : req.size);
  var video = hasVideo(content);
  return {
    tokens: estimateTokens(seconds, resolution),
    duration: seconds,
    resolution: resolution,
    video_input: video ? "video" : "none",
  };
}

// Poll the upstream GET /v1/video/generations/{task_id}.
export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl + "/v1/video/generations/" + ctx.taskId,
    method: "GET",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + ctx.apiKey },
  };
}

// Parse the Wasu poll response: {code, message, data:{status, progress,
// result_url, fail_reason, data:{content:{video_url}, usage:{...}}}}.
export function parseTaskResult(ctx, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid task result");
  var data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
  var status = data.status;
  if (status === "NOT_START" || status === "QUEUED") return { status: "QUEUED", progress: data.progress || "0%" };
  if (status === "IN_PROGRESS") return { status: "IN_PROGRESS", progress: data.progress || "50%" };
  if (status === "SUCCESS") {
    var result = { status: "SUCCESS", progress: "100%", url: data.result_url || "" };
    var upstream = data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : {};
    var usage = upstream.usage || {};
    var completionTokens = Number(usage.completion_tokens || 0);
    var totalTokens = Number(usage.total_tokens || 0);
    if (Number.isFinite(completionTokens) && completionTokens > 0) result.completionTokens = completionTokens;
    if (Number.isFinite(totalTokens) && totalTokens > 0) result.totalTokens = totalTokens;
    return result;
  }
  if (status === "FAILURE") {
    var reason = data.fail_reason || "failed";
    return { status: "FAILURE", progress: "100%", reason: reason };
  }
  // Unrecognized status strings are UNKNOWN per the polling contract — the host
  // counts them as consecutive poll failures (do NOT fall back to IN_PROGRESS).
  return { status: "UNKNOWN" };
}

export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  var body = storedBody(task);
  if (resultUrlFromBody(body)) return [{ key: "video", type: "video" }];
  return [];
}

// The video URL is a signed temporary CDN link in the poll body's
// data.result_url; fetch it without upstream credentials (credentialless).
export function buildContentRequest(ctx) {
  var body = storedBody(ctx);
  var url = resultUrlFromBody(body);
  if (!url) throw new Error("artifact_not_found");
  return { url: url, method: (ctx.clientRequest && ctx.clientRequest.method) || "GET", credentialless: true };
}

// Wasu poll responses carry actual usage tokens in data.data.usage; overlay the
// real bill on completion when present, otherwise keep the submit estimate.
export function extractUsageOnComplete(task, taskResult, body) {
  var d = body && body.data && typeof body.data === "object" ? body.data : {};
  var upstream = d.data && typeof d.data === "object" ? d.data : {};
  var usage = upstream.usage || {};
  var completionTokens = Number(usage.completion_tokens || 0);
  if (Number.isFinite(completionTokens) && completionTokens > 0) {
    return { tokens: completionTokens };
  }
  return {};
}

// ---- Host protocols ---------------------------------------------------------

// Collect image URL strings from every input shape a request may carry:
// top-level images[], single image/input_reference, or content[].image_url.
function requestImages(req) {
  var images = [];
  if (Array.isArray(req && req.images)) {
    for (var i = 0; i < req.images.length; i++) {
      var url = mediaUrlOf(req.images[i]);
      if (url && images.indexOf(url) < 0) images.push(url);
    }
  }
  var ref = mediaUrlOf(req && (req.input_reference || req.image));
  if (ref && images.indexOf(ref) < 0) images.push(ref);
  var content = requestContent(req);
  for (var i = 0; i < content.length; i++) {
    var item = content[i];
    if (!item || typeof item !== "object") continue;
    if (item.type === "image_url" || Object.prototype.hasOwnProperty.call(item, "image_url")) {
      var iu = mediaUrlOf(item);
      if (iu && images.indexOf(iu) < 0) images.push(iu);
    }
  }
  return images;
}

// Parse an OpenAI Responses `input` (string or multimodal array) into a
// {prompt, images} pair, mirroring the maicang/stelloria convention.
function responsesInput(req) {
  var texts = [];
  var images = [];
  var input = req.input;
  if (typeof input === "string") {
    texts.push(input);
  } else if (Array.isArray(input)) {
    for (var i = 0; i < input.length; i++) {
      var item = input[i];
      if (typeof item === "string") {
        texts.push(item);
        continue;
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      var content = item.content === undefined ? [item] : Array.isArray(item.content) ? item.content : [item.content];
      for (var j = 0; j < content.length; j++) {
        var part = content[j];
        if (typeof part === "string") {
          texts.push(part);
          continue;
        }
        if (!part || typeof part !== "object" || Array.isArray(part)) continue;
        if ((part.type === "input_text" || part.type === "text") && typeof part.text === "string") texts.push(part.text);
        if (part.type === "input_image" || part.type === "image_url") {
          var url = mediaUrlOf(part);
          if (url) images.push(url);
        }
      }
    }
  }
  return {
    prompt: texts.filter(function (t) { return trimmed(t); }).join("\n"),
    images: images,
  };
}

function responsesVideoText(ctx) {
  var artifact = ctx && ctx.artifacts && ctx.artifacts.video;
  var url = trimmed(artifact && artifact.url);
  if (!url) throw new Error("video artifact is unavailable");
  var escaped = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return '<video controls src="' + escaped + '"></video>';
}

export const protocols = {
  openai_responses: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      var req = ctx.body.value;
      if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
      var model = trimmed(req.model);
      if (!model) throw new Error("model is required");
      if (req.input !== undefined && typeof req.input !== "string" && !Array.isArray(req.input))
        throw new Error("input must be a string or array");
      if (req.images !== undefined && !Array.isArray(req.images)) throw new Error("images must be an array");
      if (req.metadata !== undefined && (!req.metadata || typeof req.metadata !== "object" || Array.isArray(req.metadata)))
        throw new Error("metadata must be an object");
      var input = responsesInput(req);
      var prompt = input.prompt || trimmed(req.prompt);
      var images = input.images.slice();
      for (var i = 0; i < [req.image, req.input_reference].length; i++) {
        var ref = mediaUrlOf([req.image, req.input_reference][i]);
        if (ref && images.indexOf(ref) < 0) images.push(ref);
      }
      if (!prompt && images.length === 0) throw new Error("input is required");
      var metadata = Object.assign({}, req.metadata || {});
      if (Object.prototype.hasOwnProperty.call(req, "resolution")) metadata.resolution = req.resolution;
      if (Object.prototype.hasOwnProperty.call(req, "duration")) metadata.duration = req.duration;
      else if (Object.prototype.hasOwnProperty.call(req, "seconds")) metadata.duration = req.seconds;
      if (req.size && !metadata.resolution) metadata.resolution = normalizeResolution(req.size);
      if (Object.prototype.hasOwnProperty.call(req, "generate_audio")) metadata.generate_audio = req.generate_audio;
      var requestBody = { model: model, prompt: prompt };
      if (images.length) requestBody.images = images;
      if (Object.keys(metadata).length) requestBody.metadata = metadata;
      return {
        kind: "submit",
        model: model,
        action: images.length ? "image_to_video" : "text_to_video",
        requestBody: requestBody,
      };
    },
    renderEvents: function (ctx, task, previousState) {
      var status = String(task.status || "UNKNOWN").toUpperCase();
      var value = Number(String(task.progress || "").replace("%", ""));
      var progress = Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
      var state = { status: status, progress: progress };
      if (status === "SUCCESS") {
        var text = responsesVideoText(ctx);
        var events = previousState && previousState.status === status ? [] : [{ type: "output", data: text }];
        return { events: events, state: state, done: true };
      }
      if (status === "FAILURE")
        return {
          events: [{ type: "error", code: "task_failed", message: task.fail_reason || "task failed" }],
          state: state,
          done: true,
        };
      if (previousState && previousState.status === status && previousState.progress === progress)
        return { events: [], state: state, done: false };
      var event = { type: "progress", message: status.toLowerCase() };
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
        metadata: { vendor: "wasu" },
      };
    },
  },
};

protocols.openai_video = {
  decodeRequest: function (ctx) {
    if (!ctx.body || (ctx.body.kind !== "json" && ctx.body.kind !== "multipart"))
      throw new Error("JSON or multipart body required");
    var req;
    var fileFields = {};
    if (ctx.body.kind === "json") {
      if (!ctx.body.value || Array.isArray(ctx.body.value)) throw new Error("JSON object required");
      req = Object.assign({}, ctx.body.value);
    } else {
      var first = function (name) {
        var values = (ctx.body.fields || {})[name] || [];
        if (values.length > 1) throw new Error(name + " must be provided once");
        return values[0];
      };
      req = {};
      var fields = ctx.body.fields || {};
      for (var fname in fields) {
        if (Object.prototype.hasOwnProperty.call(fields, fname)) req[fname] = first(fname);
      }
      for (var fi = 0; fi < (ctx.body.files || []).length; fi++) {
        var f = ctx.body.files[fi];
        if (f.field !== "input_reference") throw new Error("unexpected file field: " + f.field);
        if (fileFields[f.field]) throw new Error("input_reference must be provided once");
        fileFields[f.field] = f;
      }
      if (req.metadata !== undefined) {
        var parsed;
        try {
          parsed = JSON.parse(req.metadata);
        } catch (e) {
          throw new Error("metadata must be a JSON object string");
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("metadata must be a JSON object string");
        req.metadata = parsed;
      }
      if (req.duration !== undefined) req.duration = Number(req.duration);
      else if (req.seconds !== undefined) req.duration = Number(req.seconds);
    }
    var model = ctx.upstreamModel || ctx.model || req.model;
    if (!model) throw new Error("model is required");
    if (req.metadata !== undefined && (!req.metadata || typeof req.metadata !== "object" || Array.isArray(req.metadata)))
      throw new Error("metadata must be an object");
    var prompt = trimmed(req.prompt);
    var images = [];
    if (Object.keys(fileFields).length) {
      // A multipart file upload becomes a data-URL image object upstream; the
      // host replaces the __fileRef placeholder with the file content.
      images.push({ __fileRef: "request_file:input_reference", encoding: "dataUrl", maxBytes: 20971520 });
    } else {
      images = requestImages(req);
    }
    if (!prompt && images.length === 0) throw new Error("input is required");
    var metadata = Object.assign({}, req.metadata || {});
    if (Object.prototype.hasOwnProperty.call(req, "resolution")) metadata.resolution = req.resolution;
    if (Object.prototype.hasOwnProperty.call(req, "duration")) metadata.duration = req.duration;
    if (req.size && !metadata.resolution) metadata.resolution = normalizeResolution(req.size);
    if (Object.prototype.hasOwnProperty.call(req, "generate_audio")) metadata.generate_audio = req.generate_audio;
    var requestBody = { model: ctx.model, prompt: prompt };
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
    var statusMap = {
      NOT_START: "queued",
      SUBMITTED: "queued",
      QUEUED: "queued",
      IN_PROGRESS: "in_progress",
      SUCCESS: "completed",
      FAILURE: "failed",
    };
    var output = {
      id: task.task_id,
      object: "video",
      model: task.properties ? task.properties.origin_model_name || "" : "",
      status: statusMap[task.status] || "unknown",
      progress: Number(String(task.progress || "0").replace("%", "")),
      created_at: task.created_at,
      completed_at: task.updated_at,
    };
    if (task.status === "FAILURE") {
      var data = (task && task.data) || {};
      output.error = {
        code: (data && data.error && data.error.code) || "video_generation_failed",
        message: (data && data.error && data.error.message) || "The video generation task failed.",
      };
    }
    return output;
  },
};
