// MaiCang (麦仓) video generation task plugin.
//
// v1.0.1 — billing fixes:
//   * extractUsageOnComplete now returns the real token count from the poll
//     body's usage object (completion_tokens, total_tokens fallback), so the
//     host reconciles the final bill with actual consumption instead of
//     keeping the submit-time estimate.
//   * normalizeResolution falls back to 720p (the official Seedance default,
//     matching the doubao plugin) so unspecified resolutions bill on the 720p
//     tier rather than 1080p.
//
// Adapts the MaiCang (麦仓) video generation relay service (base URL
// configurable, default https://ai.tiptotip.cn) into the new-api task-plugin
// runtime. MaiCang is an OpenAI-compatible gateway that exposes a unified
// /v1/video/generations endpoint for tipdance-family video models (an async
// Seedance-style video generation dialect). The wire format is:
//
//   POST {base}/v1/video/generations            -> submit, returns {"id","task_id","status":"pending",...}
//   GET  {base}/v1/video/generations/{task_id}  -> poll,   returns {"id","task_id","status","data":[{"url"}]}
//
// Auth: Authorization: Bearer {API Key} (MaiCang-issued key). The plugin
// registers native gateway routes namespaced under /maicang and the host
// openai_video / openai_responses protocol bindings so the same service can be
// reached through the standard new-api OpenAI surfaces. Supported tipdance
// models are priced on a 480p/720p/1080p resolution tier using the official
// Seedance token formula (seconds × width × height × 24 / 1024).
//
// The upstream request body is a flat shape (no multimodal `content` array):
// {model, prompt, images:[{url}], resolution, duration, generate_audio}.
// `images` is an array of reference image objects — a single image is treated
// as the first frame, two images specify first+last frame (the upstream decides
// framing from the array length). All image inputs are normalized to {url:"…"}
// objects regardless of how the client supplied them (strings, {image_url:{url}},
// {url}, or content-array image_url items).
//
// Cross-plugin requestBody contract: decodeRequest produces a canonical
// shape so buildSubmitRequest (which may run after a channel re-pin) reads
// fields uniformly:
//   {model, prompt, images:[string], metadata:{resolution, duration, ratio?,
//    generate_audio?, content?}}
// duration lives in metadata.duration (never top-level seconds).
//
// Gateway-facing names: this plugin declares the concrete tipdance-* upstream
// names. Virtual wux-dance-* names (wux-dance-2-0, wux-dance-2-5, ...) are NOT
// declared here — expose them via channel model_mapping on a type-59
// task-plugin channel. ResolveTaskModelAlias pins this plugin from the alias;
// relay ModelMappedHelper resolves it into ctx.upstreamModel for build.

export const meta = {
  apiVersion: 1,
  key: "maicang",
  name: "MaiCang Video",
  icon: "text:MC",
  description: {
    en: "MaiCang (麦仓) video generation — text and image input via /v1/video/generations (tipdance models)",
    zh: "麦仓视频生成（文本/图片输入），走 /v1/video/generations（tipdance 系列）",
  },
  version: "1.0.1",
  author: { name: "QuantumNous" },
  // Gateway-facing model names are the concrete tipdance-* upstream names.
  // Virtual wux-dance-* names (wux-dance-2-0, wux-dance-2-5, ...) are NOT
  // declared here; they are exposed via channel model_mapping — a type-59
  // task-plugin channel maps each wux-dance-* to its tipdance-* target, and
  // ResolveTaskModelAlias pins this plugin from the alias before distribution.
  // buildSubmitRequest reads the resolved upstream name from ctx.upstreamModel.
  models: [
    "tipdance-2-5-pro",
    "tipdance-2-0-mini",
    "tipdance-2-0-pro",
    "tipdance-2-0-fast",
    "tipdance-2-5-pro-inel",
    "tipdance-2-0-pro-intl",
    "tipdance-2-0-mini-intl",
    "tipdance-2-0-fast-intl",
  ],
  // Owns channel type 101 (maicang). A type-101 channel auto-binds to this
  // plugin via GetByChannelType; a type-59 (TaskPlugin) channel can bind by
  // task_plugin_key. Virtual wux-dance-* names are served through a type-59
  // channel's model_mapping (alias resolution), not declared in meta.models.
  channelTypes: [101],
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
        en: "Output video resolution tier; token estimate scales with pixel count. 4k is supported by the 2-0 (pro) tier; fast/mini tiers cap at 480p/720p.",
        zh: "输出视频分辨率档位；token 预估随像素数变化。4k 仅 2-0（pro）档支持；fast/mini 档上限 480p/720p。",
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
  // max-pixel dimensions. tipdance 底层是 seedance，定价完全参考 doubao
  // seedance 价格表：videoInputRatio 按 model 档（2-5/2-0-pro/fast/mini）+
  // resolution（含 4k）+ 参考视频输入(v2v) 算折扣 ratio，billing_ratios
  // 返回 {video_input_ratio} 或 null（ratio=1 时）。
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
    { method: "POST", path: "/maicang/v1/video/generations", type: "submit", decode: "createTask", render: "taskCreated" },
    { method: "GET", path: "/maicang/v1/video/generations/:task_id", type: "query", render: "taskStatus" },
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
// to 720p — the official Seedance default resolution (and the doubao plugin's
// fallback), so unspecified requests bill on the 720p tier.
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
  return "720p";
}

// Normalize a duration value to a positive number of seconds (default 5).
function normalizeSeconds(value) {
  var n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.min(n, 3600);
}

// Resolve the content array carried by a request body (openai_video/openai_responses
// surfaces may carry image_url items inside content or metadata.content).
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

// Extract a URL string from a single image-shaped value (string | {url} |
// {image_url} | {image_url:{url}}).
function imageUrlOf(img) {
  if (typeof img === "string") return trimmed(img);
  if (img && typeof img === "object" && !Array.isArray(img)) {
    var url = trimmed(img.url);
    if (url) return url;
    var iu = img.image_url;
    if (iu && typeof iu === "object") return trimmed(iu.url);
    if (typeof iu === "string") return trimmed(iu);
  }
  return "";
}

// Collect image URL strings from every input shape a request may carry:
// top-level images[], single image/input_reference, or content[].image_url.
function requestImages(req) {
  var images = [];
  if (Array.isArray(req && req.images)) {
    for (var i = 0; i < req.images.length; i++) {
      var url = imageUrlOf(req.images[i]);
      if (url && images.indexOf(url) < 0) images.push(url);
    }
  }
  var ref = trimmed(req && (req.input_reference || req.image));
  if (ref && images.indexOf(ref) < 0) images.push(ref);
  var content = requestContent(req);
  for (var j = 0; j < content.length; j++) {
    var item = content[j];
    if (!item || typeof item !== "object") continue;
    if (item.type === "image_url" || Object.prototype.hasOwnProperty.call(item, "image_url")) {
      var url2 = imageUrlOf(item);
      if (url2 && images.indexOf(url2) < 0) images.push(url2);
    }
  }
  return images;
}

// Turn a list of image URL strings into the upstream {url:"…"} object array the
// 麦仓 API expects, de-duplicating by URL.
function toImageObjects(urls) {
  var out = [];
  if (!Array.isArray(urls)) return out;
  for (var i = 0; i < urls.length; i++) {
    var url = typeof urls[i] === "string" ? trimmed(urls[i]) : imageUrlOf(urls[i]);
    if (url && !out.some(function (o) { return o.url === url; })) out.push({ url: url });
  }
  return out;
}

// Parse an OpenAI Responses `input` (string or multimodal array) into a
// {prompt, images} pair, mirroring the stelloria/pgy-seedance convention.
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
          var url = imageUrlOf(part);
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

// The poll body is stored on task.data. It may be wrapped one level deep
// (task.data.data being a task-shaped object); unwrap when that is the case,
// otherwise return task.data directly. 麦仓's poll body uses `data:[{url}]` for
// the video URL array, so the array branch is never mistaken for a wrap.
function storedBody(ctxOrTask) {
  var d = (ctxOrTask && ctxOrTask.data) || {};
  if (d.data && typeof d.data === "object" && !Array.isArray(d.data) && d.data.task_id) return d.data;
  return d;
}

// Read the generated video URL from a poll body. 麦仓 returns data:[{url}]; a
// top-level url/video_url is accepted as a permissive fallback.
function videoUrlFromBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  var arr = Array.isArray(body.data) ? body.data : [];
  for (var i = 0; i < arr.length; i++) {
    var url = imageUrlOf(arr[i]);
    if (url) return url;
  }
  return trimmed(body.url || body.video_url);
}

function responsesVideoText(ctx) {
  var artifact = ctx && ctx.artifacts && ctx.artifacts.video;
  var url = trimmed(artifact && artifact.url);
  if (!url) throw new Error("video artifact is unavailable");
  var escaped = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return '<video controls src="' + escaped + '"></video>';
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
    if (body.images !== undefined && !Array.isArray(body.images)) throw new Error("images must be an array");
    var images = toImageObjects(body.images);
    var requestBody = { model: model, prompt: prompt };
    if (images.length) requestBody.images = images;
    if (body.resolution !== undefined) requestBody.resolution = normalizeResolution(body.resolution);
    if (body.duration !== undefined) requestBody.duration = normalizeSeconds(body.duration);
    if (body.generate_audio !== undefined) requestBody.generate_audio = !!body.generate_audio;
    return { kind: "submit", model: model, action: images.length ? "image_to_video" : "text_to_video", requestBody: requestBody };
  },
  taskCreated: function (ctx, task) {
    var data = task.data && typeof task.data === "object" && !Array.isArray(task.data) ? task.data : {};
    var out = Object.assign({}, data, { id: task.task_id, task_id: task.task_id });
    if (out.status === undefined) out.status = "pending";
    return out;
  },
  taskStatus: function (ctx, task) {
    var data = task.data && typeof task.data === "object" && !Array.isArray(task.data) ? task.data : {};
    var statusMap = {
      pending: "pending",
      queued: "pending",
      processing: "processing",
      in_progress: "processing",
      running: "processing",
      completed: "completed",
      succeeded: "completed",
      success: "completed",
      failed: "failed",
      cancelled: "failed",
      expired: "failed",
    };
    var status = statusMap[String(data.status || "").toLowerCase()] || "processing";
    var out = Object.assign({}, data, { id: task.task_id, task_id: task.task_id, status: status });
    if (data.error && data.error.message) out.error = { code: data.error.code || "task_failed", message: data.error.message };
    return out;
  },
  error: function (ctx, error) {
    return { error: { code: error.code, message: error.message } };
  },
};

// ---- Driver hooks -----------------------------------------------------------

// Build the upstream POST /v1/video/generations request. The body is the flat
// 麦仓 shape. The model sent upstream honors the channel model_mapping
// (ctx.upstreamModel) first, then the client-facing model (ctx.model), then the
// request body model — so a default channel (no mapping) sends the gateway
// tipdance-* name upstream verbatim.
export function buildSubmitRequest(ctx) {
  var req = ctx.requestBody || {};
  var model = ctx.upstreamModel || ctx.model || req.model || "";
  var metadata = req.metadata || {};
  var body = { model: model };
  var prompt = trimmed(req.prompt);
  if (prompt) body.prompt = prompt;
  var images = toImageObjects(requestImages(req));
  if (images.length) body.images = images;
  // Forward optional fields only when the client supplied them, so the upstream
  // keeps its own defaults when nothing was requested.
  var resolutionRaw = req.resolution !== undefined ? req.resolution : metadata.resolution !== undefined ? metadata.resolution : req.size;
  if (resolutionRaw !== undefined) body.resolution = normalizeResolution(resolutionRaw);
  var durationRaw = req.duration !== undefined ? req.duration : req.seconds !== undefined ? req.seconds : metadata.duration;
  if (durationRaw !== undefined) body.duration = normalizeSeconds(durationRaw);
  if (req.generate_audio !== undefined) body.generate_audio = !!req.generate_audio;
  else if (metadata.generate_audio !== undefined) body.generate_audio = !!metadata.generate_audio;
  return {
    url: ctx.baseUrl + "/v1/video/generations",
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
    body: body,
    action: images.length ? "image_to_video" : "text_to_video",
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
// tipdance 底层是 seedance，各档对应 doubao-seedance：2-5→2-5, 2-0-pro→2-0,
// 2-0-fast→2-0-fast, 2-0-mini→2-0-mini. video-to-video (参考视频输入) 享更低单价。
function videoInputRatio(model, resolution, content) {
  var video = hasVideo(content);
  var res = trimmed(resolution).toLowerCase();
  var m = trimmed(model).toLowerCase();
  if (m.indexOf("tipdance-2-5") === 0) {
    if (res === "1080p") return video ? 7.0 / 10.7 : 11.7 / 10.7;
    return video ? 42 / 70 : 1;
  }
  if (m.indexOf("tipdance-2-0-pro") === 0) {
    if (res === "1080p") return video ? 31 / 46 : 51 / 46;
    if (res === "4k") return video ? 16 / 46 : 26 / 46;
    return video ? 28 / 46 : 1;
  }
  if (m.indexOf("tipdance-2-0-fast") === 0) return video ? 22 / 37 : 1;
  if (m.indexOf("tipdance-2-0-mini") === 0) return video ? 14 / 23 : 1;
  return 1;
}

export function extractUsage(ctx) {
  var req = ctx.requestBody || {};
  var metadata = req.metadata || {};
  var content = requestContent(req);
  if (ctx.usagePurpose === "billing_ratios") {
    // tipdance 底层是 seedance，定价完全参考 doubao seedance 价格表。
    var ratio = videoInputRatio(ctx.upstreamModel || ctx.model || req.model, metadata.resolution, content);
    return ratio === 1 ? null : { video_input_ratio: ratio };
  }
  var durationRaw = req.duration !== undefined ? req.duration : req.seconds !== undefined ? req.seconds : metadata.duration;
  var seconds = normalizeSeconds(durationRaw);
  var resolutionRaw = req.resolution !== undefined ? req.resolution : metadata.resolution !== undefined ? metadata.resolution : req.size;
  var resolution = normalizeResolution(resolutionRaw);
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

export function parseTaskResult(ctx, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid task result");
  var status = String(body.status || "").toLowerCase();
  if (status === "pending" || status === "queued") return { status: "QUEUED", progress: "10%" };
  if (status === "processing" || status === "in_progress" || status === "running")
    return { status: "IN_PROGRESS", progress: "50%" };
  if (status === "completed" || status === "succeeded" || status === "success") {
    var result = { status: "SUCCESS", progress: "100%" };
    var url = videoUrlFromBody(body);
    if (url) result.url = url;
    return result;
  }
  if (status === "failed" || status === "cancelled" || status === "expired") {
    var reason = body.error && body.error.message ? body.error.message : body.reason || status;
    return { status: "FAILURE", progress: "100%", reason: reason };
  }
  // Unrecognized status strings are UNKNOWN per the polling contract — the host
  // counts them as consecutive poll failures (do NOT fall back to IN_PROGRESS).
  return { status: "UNKNOWN" };
}

export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  var body = storedBody(task);
  if (videoUrlFromBody(body)) return [{ key: "video", type: "video" }];
  return [];
}

// The video URL is a public CDN link in the poll body's data array; fetch it
// without upstream credentials (credentialless), like the stelloria relay.
export function buildContentRequest(ctx) {
  var body = storedBody(ctx);
  var url = videoUrlFromBody(body);
  if (!url) throw new Error("artifact_not_found");
  return { url: url, method: (ctx.clientRequest && ctx.clientRequest.method) || "GET", credentialless: true };
}

// 麦仓 poll responses carry a usage object (usage.completion_tokens with a
// usage.total_tokens fallback). Return the real token count so the host settles
// the final bill on actual consumption (multi-refund/less-pay reconciliation
// against the submit-time estimate) instead of keeping the estimate.
export function extractUsageOnComplete(task, taskResult, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  var status = String(body.status || "").toLowerCase();
  if (status !== "completed" && status !== "succeeded" && status !== "success") return {};
  var usage = body.usage && typeof body.usage === "object" && !Array.isArray(body.usage) ? body.usage : {};
  var tokens = Number(usage.completion_tokens);
  if (!Number.isFinite(tokens) || tokens <= 0) tokens = Number(usage.total_tokens);
  if (Number.isFinite(tokens) && tokens > 0) return { tokens: tokens };
  return {};
}

// ---- Host protocols ---------------------------------------------------------

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
        var ref = trimmed([req.image, req.input_reference][i]);
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
        metadata: { vendor: "maicang" },
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
