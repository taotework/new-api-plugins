// Stelloria (Xingtong) video generation task plugin.
//
// Adapts the Stelloria AI video generation service (https://stelloria.link) into
// the new-api task-plugin runtime. Stelloria speaks an OpenAI-shaped HTTP API
// (JSON bodies, Bearer auth) but exposes the Seedance-style multimodal `content`
// array wire format at (upstream URLs, against the channel base URL):
//
//   POST {base}/v1/videos/generations   -> submit, returns {task_id, status, model}
//   GET  {base}/v1/tasks/{task_id}      -> poll,   returns {status, result:{video_url, ...}}
//
// The plugin registers both native gateway routes below (namespaced under
// /stelloria to stay clear of the host-reserved /v1/tasks namespace) and the
// host openai_video / openai_responses protocol bindings so the same service can
// be reached through the standard new-api OpenAI surfaces. Supported models are
// priced identically on a 720p/1080p resolution tier using the official Seedance
// token formula (seconds x width x height x 24 / 1024).

export const meta = {
  apiVersion: 1,
  key: "stelloria",
  name: "Stelloria",
  icon: "text:ST",
  description: {
    en: "Stelloria (Xingtong) video generation — text, image, first/last frame, and reference input via /v1/videos/generations",
    zh: "星瞳 Stelloria AI 视频生成（文本/图片/首尾帧/参考素材），走 /v1/videos/generations",
  },
  version: "1.0.2",
  author: { name: "QuantumNous" },
  models: ["seedance-2.0", "Wonder-Pro", "doubao-seedance-2.0"],
  // Owns channel type 102 (stelloria). A type-102 channel auto-binds via
  // GetByChannelType; a type-59 (TaskPlugin) channel can bind by
  // task_plugin_key. Virtual wux-dance-* names (if used) are exposed via a
  // type-59 channel's model_mapping, not declared in meta.models.
  channelTypes: [102],
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
    duration: {
      type: "number",
      unit: "second",
      description: {
        en: "Output video duration in seconds (5 or 10).",
        zh: "输出视频时长（秒），5 或 10。",
      },
    },
    resolution: {
      enum: ["720p", "1080p", "4k"],
      description: {
        en: "Output video resolution tier; 720p, 1080p, and 4k are supported.",
        zh: "输出视频分辨率档位；支持 720p、1080p 和 4k。",
      },
    },
    video_input: {
      enum: ["none", "video"],
      description: {
        en: "Whether the request includes reference video input; doubao-seedance-2.0 prices video-to-video tokens at a lower unit rate.",
        zh: "请求是否包含参考视频输入；doubao-seedance-2.0 对视频生视频 token 按更低单价计费。",
      },
    },
  },
  // Official Seedance formula: tokens = seconds x width x height x 24 / 1024,
  // 16:9 max-pixel dimensions. All supported models share the same price.
  usageExamples: [
    { label: "720p · 5s", facts: { tokens: 108000, duration: 5, resolution: "720p", video_input: "none" } },
    { label: "720p · 10s", facts: { tokens: 216000, duration: 10, resolution: "720p", video_input: "none" } },
    { label: "1080p · 5s", facts: { tokens: 243000, duration: 5, resolution: "1080p", video_input: "none" } },
    { label: "4k · 5s", facts: { tokens: 972000, duration: 5, resolution: "4k", video_input: "none" } },
    { label: "4k · 5s (视频输入)", facts: { tokens: 972000, duration: 5, resolution: "4k", video_input: "video" } },
    { label: "1080p · 10s", facts: { tokens: 486000, duration: 10, resolution: "1080p", video_input: "none" } },
    { label: "720p · 5s (视频输入)", facts: { tokens: 108000, duration: 5, resolution: "720p", video_input: "video" } },
    { label: "1080p · 5s (视频输入)", facts: { tokens: 243000, duration: 5, resolution: "1080p", video_input: "video" } },
  ],
  routes: [
    { method: "POST", path: "/stelloria/v1/videos/generations", type: "submit", decode: "createTask", render: "taskCreated" },
    { method: "GET", path: "/stelloria/v1/tasks/:task_id", type: "query", render: "taskStatus" },
  ],
  protocols: [{ name: "openai_responses", supports: ["stream", "sync", "background"] }, "openai_video"],
};

var RESOLUTIONS = ["720p", "1080p", "4k"];

function trimmed(value) {
  return String(value || "").trim();
}

// 16:9 max-pixel dimensions per supported resolution tier (for token estimate).
function resolutionMaxPixels(resolution) {
  if (resolution === "4k") return [3840, 2160];
  return resolution === "1080p" ? [1920, 1080] : [1280, 720];
}

function estimateTokens(seconds, resolution) {
  var dims = resolutionMaxPixels(resolution);
  return (seconds * dims[0] * dims[1] * 24) / 1024;
}

// Resolve the content array carried by a request body. The native route stores
// it at req.content; the openai_video / openai_responses surfaces carry it at
// req.metadata.content (Doubao-style).
function requestContent(req) {
  if (req && Array.isArray(req.content)) return req.content;
  var metadata = (req && req.metadata) || {};
  if (Array.isArray(metadata.content)) return metadata.content;
  return [];
}

function hasVideo(content) {
  if (!Array.isArray(content)) return false;
  for (var i = 0; i < content.length; i++) {
    var item = content[i];
    if (!item || typeof item !== "object") continue;
    if (item.type === "video_url" || Object.prototype.hasOwnProperty.call(item, "video_url")) return true;
  }
  return false;
}

// Per-model billing ratio for video-to-video vs no-video-input, mirroring the
// official Doubao Seedance 2.0 price table (doubao-seedance-2-0-260128). Only
// doubao-seedance-2.0 carries the discount; other Stelloria models bill at the
// plain token estimate (ratio 1). The no-video 1080p ratio (>1) corrects the
// max-pixel estimate up to the official 1080p unit price.
function videoInputRatio(model, resolution, content) {
  var video = hasVideo(content);
  var res = trimmed(resolution).toLowerCase();
  if (model === "doubao-seedance-2.0") {
    if (res === "1080p") return video ? 31 / 46 : 51 / 46;
    if (res === "4k") return video ? 16 / 46 : 26 / 46;
    return video ? 28 / 46 : 1;
  }
  return 1;
}

// Normalize any resolution input to one of the supported tiers; unknown inputs
// fall back to 720p.
function normalizeResolution(value) {
  var raw = trimmed(value).toLowerCase();
  if (raw === "4k") return "4k";
  if (raw === "1080p") return "1080p";
  if (raw === "720p") return "720p";
  var parts = raw.replace("*", "x").split("x");
  if (parts.length === 2) {
    var max = Math.max(Number(parts[0]), Number(parts[1]));
    if (max >= 3840) return "4k";
    return max >= 1280 ? "1080p" : "720p";
  }
  return "720p";
}

// Normalize duration to 5 or 10 seconds (default 5).
function normalizeDuration(value) {
  var n = Number(value);
  return n === 10 ? 10 : 5;
}

// Parse a completion duration that may carry a unit suffix ("10s" -> 10).
function parseDuration(value) {
  var n = Number(String(value || "").replace(/\s*s$/i, ""));
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

// Wonder-Pro (Wonder Animation) speaks a different dialect than Seedance on
// the same /v1/videos/generations endpoint: it ignores the multimodal `content`
// array and requires a top-level PascalCase `Prompt` field, else the upstream
// Ark backend rejects with "Input.Prompt is required". Other fields
// (duration/resolution/aspect_ratio/image_url) stay lowercase. Detect by prefix.
function isWonderModel(model) {
  return trimmed(model).toLowerCase().indexOf("wonder") === 0;
}

function normalizeAspectRatio(value) {
  var raw = trimmed(value).toLowerCase().replace(/\s+/g, "");
  if (raw === "9:16" || raw === "16:9" || raw === "1:1") return raw;
  if (raw === "portrait" || raw === "vertical") return "9:16";
  if (raw === "square") return "1:1";
  return "16:9";
}

// Extract the prompt text from a request body: prefers the top-level `prompt`,
// falls back to joining text items inside a `content` array (native route).
function extractPromptText(req) {
  var direct = trimmed(req && req.prompt);
  if (direct) return direct;
  var content = requestContent(req);
  var parts = [];
  for (var i = 0; i < content.length; i++) {
    var item = content[i];
    if (!item || typeof item !== "object") continue;
    if ((item.type === "text" || trimmed(item.role) === "text") && typeof item.text === "string") {
      if (trimmed(item.text)) parts.push(trimmed(item.text));
    }
  }
  return parts.join("\n");
}

// Collect image URLs carried by a request body (top-level images/input_reference
// or image_url items inside content). Used for Wonder image-to-video.
function requestImages(req) {
  var images = [];
  if (Array.isArray(req && req.images)) {
    for (var i = 0; i < req.images.length; i++) {
      var img = req.images[i];
      if (typeof img === "string" && trimmed(img)) images.push(trimmed(img));
    }
  }
  var ref = trimmed(req && (req.input_reference || req.image));
  if (ref && images.indexOf(ref) < 0) images.push(ref);
  var content = requestContent(req);
  for (var j = 0; j < content.length; j++) {
    var item = content[j];
    if (!item || typeof item !== "object") continue;
    if (item.type === "image_url" || Object.prototype.hasOwnProperty.call(item, "image_url")) {
      var u = item.image_url;
      var url = u && typeof u === "object" ? u.url : u;
      if (trimmed(url) && images.indexOf(trimmed(url)) < 0) images.push(trimmed(url));
    }
  }
  return images;
}

// Inspect a `content` array and derive the generation action from its material.
function actionFromContent(content) {
  if (!Array.isArray(content)) return "text_to_video";
  var hasReferenceVideo = false;
  var hasReferenceAudio = false;
  var hasFirstFrame = false;
  var hasLastFrame = false;
  var hasImage = false;
  for (var i = 0; i < content.length; i++) {
    var item = content[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    var role = trimmed(item.role);
    if (item.type === "video_url" || role === "reference_video") {
      hasReferenceVideo = true;
      continue;
    }
    if (item.type === "audio_url" || role === "reference_audio") {
      hasReferenceAudio = true;
      continue;
    }
    if (role === "first_frame") {
      hasFirstFrame = true;
      continue;
    }
    if (role === "last_frame") {
      hasLastFrame = true;
      continue;
    }
    if (item.type === "image_url" || (role && role !== "text")) hasImage = true;
  }
  if (hasReferenceVideo) return "reference_to_video";
  if (hasReferenceAudio) return "audio_to_video";
  if (hasFirstFrame && hasLastFrame) return "first_last_to_video";
  if (hasImage || hasFirstFrame || hasLastFrame) return "image_to_video";
  return "text_to_video";
}

// Count distinct reference types in a `content` array for validation against
// Stelloria's material limits (9 reference images, 3 videos, 3 audios, 1 each
// first/last frame, at least one text).
function validateContent(content) {
  if (!Array.isArray(content) || content.length === 0)
    throw new Error("content is required and must be a non-empty array");
  var texts = 0;
  var referenceImages = 0;
  var videos = 0;
  var audios = 0;
  var firstFrames = 0;
  var lastFrames = 0;
  for (var i = 0; i < content.length; i++) {
    var item = content[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    var role = trimmed(item.role);
    if (item.type === "text" || role === "text") {
      if (item.type === "text" && typeof item.text === "string" && trimmed(item.text)) texts += 1;
      continue;
    }
    if (item.type === "image_url") {
      if (role === "first_frame") firstFrames += 1;
      else if (role === "last_frame") lastFrames += 1;
      else referenceImages += 1;
      continue;
    }
    if (item.type === "video_url" || role === "reference_video") {
      videos += 1;
      continue;
    }
    if (item.type === "audio_url" || role === "reference_audio") {
      audios += 1;
      continue;
    }
  }
  if (texts === 0 && referenceImages === 0 && videos === 0 && audios === 0 && firstFrames === 0 && lastFrames === 0)
    throw new Error("content must contain at least one text element or a reference material");
  if (referenceImages > 9) throw new Error("reference_image exceeds the limit of 9");
  if (videos > 3) throw new Error("reference_video exceeds the limit of 3");
  if (audios > 3) throw new Error("reference_audio exceeds the limit of 3");
  if (firstFrames > 1) throw new Error("first_frame may be provided at most once");
  if (lastFrames > 1) throw new Error("last_frame may be provided at most once");
}

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
        if (["input_text", "text"].indexOf(part.type) >= 0 && typeof part.text === "string") texts.push(part.text);
        if (["input_image", "image_url"].indexOf(part.type) >= 0) {
          var image = part.image_url;
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

// Turn a plain prompt/image list plus metadata into a Stelloria `content` array
// and the remaining top-level body fields. First image becomes the first_frame.
function contentBodyFromInput(requestBody) {
  var prompt = trimmed((requestBody && requestBody.prompt) || "");
  var images = Array.isArray(requestBody && requestBody.images) ? requestBody.images : [];
  var metadata = (requestBody && requestBody.metadata) || {};
  var content = [];
  if (prompt) content.push({ type: "text", text: prompt, role: "text" });
  for (var i = 0; i < images.length; i++) {
    content.push({ type: "image_url", image_url: { url: String(images[i]) }, role: i === 0 ? "first_frame" : "reference_image" });
  }
  var refContent = Array.isArray(metadata.content) ? metadata.content : [];
  for (var v = 0; v < refContent.length; v++) {
    var item = refContent[v];
    if (!item || typeof item !== "object") continue;
    if (item.type === "video_url" || Object.prototype.hasOwnProperty.call(item, "video_url")) {
      var vu = item.video_url;
      var vurl = vu && typeof vu === "object" ? vu.url : vu;
      if (trimmed(vurl)) content.push({ type: "video_url", video_url: { url: trimmed(vurl) }, role: "reference_video" });
    }
  }
  var preserved = {};
  ["resolution", "duration", "ratio", "aspect_ratio", "generate_audio", "seed", "watermark", "fps"].forEach(function (key) {
    if (requestBody && requestBody[key] !== undefined) preserved[key] = requestBody[key];
  });
  Object.keys(metadata).forEach(function (key) {
    if (key === "content") return;
    if (metadata[key] === undefined) return;
    if (reservedContentKey(key)) return;
    preserved[key] = metadata[key];
  });
  return { content: content, preserved: preserved };
}

function reservedContentKey(key) {
  return ["type", "role", "text", "image_url", "video_url", "audio_url"].indexOf(key) >= 0;
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
    var content = body.content;
    if (content !== undefined && !Array.isArray(content)) throw new Error("content must be an array");
    validateContent(content);
    var requestBody = { model: model };
    var action;
    if (Array.isArray(content)) {
      requestBody.content = content;
      action = actionFromContent(content);
      ["resolution", "duration", "ratio", "aspect_ratio", "generate_audio", "seed", "watermark", "fps"].forEach(function (key) {
        if (body[key] !== undefined) requestBody[key] = body[key];
      });
    } else {
      // No explicit content: build one from prompt/image conveniences so the
      // native route still accepts plain OpenAI-shaped bodies.
      action = "text_to_video";
      var built = contentBodyFromInput(body);
      requestBody.content = built.content;
      Object.keys(built.preserved).forEach(function (key) {
        requestBody[key] = built.preserved[key];
      });
    }
    return { kind: "submit", model: model, action: action, requestBody: requestBody };
  },
  taskCreated: function (ctx, task) {
    var data = task.data && typeof task.data === "object" && !Array.isArray(task.data) ? task.data : {};
    var out = Object.assign({}, data, { task_id: task.task_id });
    if (out.status === undefined) out.status = "processing";
    return out;
  },
  taskStatus: function (ctx, task) {
    var data = task.data && typeof task.data === "object" && !Array.isArray(task.data) ? task.data : {};
    var statusMap = {
      pending: "queued",
      queued: "queued",
      processing: "in_progress",
      in_progress: "in_progress",
      completed: "completed",
      succeeded: "completed",
      success: "completed",
      failed: "failed",
      cancelled: "failed",
    };
    var status = statusMap[String(data.status || "").toLowerCase()] || "in_progress";
    var out = Object.assign({}, data, { task_id: task.task_id, status: status });
    if (data.error && data.error.message) out.error = { code: data.error.code || "task_failed", message: data.error.message };
    return out;
  },
  error: function (ctx, error) {
    return { error: { code: error.code, message: error.message } };
  },
};

// ---- Driver hooks -----------------------------------------------------------

export function buildSubmitRequest(ctx) {
  var req = ctx.requestBody || {};
  var model = ctx.upstreamModel || req.model || "";
  var headers = { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + ctx.apiKey };
  if (isWonderModel(model)) return buildWonderSubmitRequest(ctx, model, req, headers);
  var content = Array.isArray(req.content)
    ? req.content
    : (function () {
        var built = contentBodyFromInput(req);
        return built.content.length ? built.content : [{ type: "text", text: "", role: "text" }];
      })();
  validateContent(content);
  var body = { model: model, content: content };
  ["resolution", "duration", "ratio", "aspect_ratio", "generate_audio", "seed", "watermark", "fps"].forEach(function (key) {
    var value = req[key];
    if (value === undefined && req.metadata && req.metadata[key] !== undefined) value = req.metadata[key];
    if (value !== undefined) body[key] = value;
  });
  var action = req.action || actionFromContent(content);
  return {
    url: ctx.baseUrl + "/v1/videos/generations",
    method: "POST",
    headers: headers,
    body: body,
    action: action,
  };
}

// Wonder-Pro branch: upstream ignores the multimodal `content` array and needs
// a top-level PascalCase `Prompt`. Other fields stay lowercase. Verified
// against the upstream Ark backend (lowercase `prompt` is rejected with
// "Input.Prompt is required"; PascalCase `Prompt` is accepted).
function buildWonderSubmitRequest(ctx, model, req, headers) {
  var metadata = req.metadata || {};
  var prompt = extractPromptText(req);
  var duration = normalizeDuration(req.duration === undefined ? metadata.duration : req.duration);
  var resolutionRaw = req.resolution === undefined ? metadata.resolution || req.size || metadata.aspect_ratio : req.resolution;
  var resolution = normalizeResolution(resolutionRaw);
  var aspectRatioRaw = req.aspect_ratio || req.ratio || metadata.aspect_ratio || metadata.ratio;
  var aspectRatio = normalizeAspectRatio(aspectRatioRaw);
  var body = {
    model: model,
    Prompt: prompt,
    Duration: String(duration),
    AspectRatio: aspectRatio,
    Resolution: resolution,
  };
  var images = requestImages(req);
  if (images.length) body.image_url = images[0];
  if (req.seed !== undefined) body.seed = req.seed;
  else if (metadata.seed !== undefined) body.seed = metadata.seed;
  var action = images.length ? "image_to_video" : "text_to_video";
  return {
    url: ctx.baseUrl + "/v1/videos/generations",
    method: "POST",
    headers: headers,
    body: body,
    action: action,
  };
}

export function parseSubmitResponse(ctx, resp) {
  if (!resp.body || !resp.body.task_id) throw new Error("task_id is empty");
  return { taskId: resp.body.task_id, taskData: resp.body };
}

export function extractUsage(ctx) {
  var req = ctx.requestBody || {};
  var metadata = req.metadata || {};
  var content = requestContent(req);
  if (ctx.usagePurpose === "billing_ratios") {
    var ratio = videoInputRatio(ctx.upstreamModel || ctx.model || req.model, metadata.resolution || req.resolution, content);
    return ratio === 1 ? null : { video_input_ratio: ratio };
  }
  var duration = normalizeDuration(req.duration === undefined ? metadata.duration : req.duration);
  var resolutionRaw = req.resolution === undefined ? metadata.resolution || req.size : req.resolution;
  var resolution = normalizeResolution(resolutionRaw);
  return {
    tokens: estimateTokens(duration, resolution),
    duration: duration,
    resolution: resolution,
    video_input: hasVideo(content) ? "video" : "none",
  };
}

export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl + "/v1/tasks/" + ctx.taskId,
    method: "GET",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + ctx.apiKey },
  };
}

export function parseTaskResult(ctx, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid task result");
  var status = String(body.status || "").toLowerCase();
  if (status === "pending" || status === "queued") return { status: "QUEUED", progress: "10%" };
  if (status === "processing" || status === "in_progress" || status === "running") return { status: "IN_PROGRESS", progress: "50%" };
  if (status === "completed" || status === "succeeded" || status === "success") {
    var result = { status: "SUCCESS", progress: "100%" };
    var res = body.result || {};
    if (trimmed(res.video_url)) result.url = res.video_url;
    return result;
  }
  if (status === "failed" || status === "cancelled" || status === "expired") {
    var reason = body.error && body.error.message ? body.error.message : body.reason || status;
    return { status: "FAILURE", progress: "100%", reason: reason };
  }
  return { status: "IN_PROGRESS", progress: "30%" };
}

function taskDataItem(ctx) {
  var data = (ctx && ctx.data) || {};
  if (data.data && typeof data.data === "object" && data.data.task_id && Object.prototype.hasOwnProperty.call(data.data, "data"))
    return data.data.data || {};
  return data;
}

export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  var body = taskDataItem(task);
  var result = body.result || {};
  var artifacts = [];
  if (trimmed(result.video_url)) artifacts.push({ key: "video", type: "video" });
  if (trimmed(result.cover_url)) artifacts.push({ key: "cover", type: "image", mimeType: "image/jpeg" });
  return artifacts;
}

export function buildContentRequest(ctx) {
  var body = taskDataItem(ctx);
  var result = body.result || {};
  var urls = { video: result.video_url, cover: result.cover_url };
  var url = trimmed(urls[ctx.artifactKey]);
  if (!url) throw new Error("artifact_not_found");
  return { url: url, method: ctx.clientRequest.method, credentialless: true };
}

export function extractUsageOnComplete(task, taskResult, body) {
  if (!body || String(body.status || "").toLowerCase() !== "completed") return {};
  var facts = {};
  var result = body.result || {};
  var duration = parseDuration(result.duration !== undefined ? result.duration : body.duration);
  if (Number.isFinite(duration) && duration > 0) facts.duration = Math.round(duration);
  var resolution = normalizeResolution(result.resolution || body.resolution);
  // Recompute tokens from the real completion figures when available.
  var second = Number.isFinite(facts.duration) ? facts.duration : 0;
  if (second > 0) facts.tokens = estimateTokens(second, resolution);
  facts.resolution = resolution;
  return facts;
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
      if (!prompt && input.images.length === 0) throw new Error("input is required");
      var requestBody = { model: model, prompt: prompt };
      if (input.images.length) requestBody.images = input.images;
      for (var i = 0; i < [req.image, req.input_reference].length; i++) {
        var ref = [req.image, req.input_reference][i];
        if (trimmed(ref) && (!Array.isArray(requestBody.images) || requestBody.images.indexOf(trimmed(ref)) < 0)) {
          if (!Array.isArray(requestBody.images)) requestBody.images = [];
          requestBody.images.push(trimmed(ref));
        }
      }
      var metadata = Object.assign({}, req.metadata || {});
      if (Object.prototype.hasOwnProperty.call(req, "resolution")) metadata.resolution = req.resolution;
      if (Object.prototype.hasOwnProperty.call(req, "ratio")) metadata.ratio = req.ratio;
      if (req.size && !metadata.resolution && !metadata.ratio) metadata.resolution = normalizeResolution(req.size);
      if (Object.prototype.hasOwnProperty.call(req, "seconds")) metadata.duration = req.seconds;
      else if (Object.prototype.hasOwnProperty.call(req, "duration")) metadata.duration = req.duration;
      if (Object.keys(metadata).length) requestBody.metadata = metadata;
      var action = hasVideo(requestContent(req))
        ? "reference_to_video"
        : input.images.length || requestBody.images
        ? "image_to_video"
        : "text_to_video";
      return { kind: "submit", model: model, action: action, requestBody: requestBody };
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
        metadata: { vendor: "stelloria" },
      };
    },
  },
};

protocols.openai_video = {
  decodeRequest: function (ctx) {
    if (!ctx.body || (ctx.body.kind !== "json" && ctx.body.kind !== "multipart")) throw new Error("JSON or multipart body required");
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
      for (var fname of Object.keys(fields)) {
        req[fname] = first(fname);
      }
      for (var f of ctx.body.files || []) {
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
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("metadata must be a JSON object string");
        req.metadata = parsed;
      }
      if (req.seconds !== undefined) req.seconds = Number(req.seconds);
      else if (req.duration !== undefined) req.duration = Number(req.duration);
    }
    var model = ctx.upstreamModel || ctx.model || req.model;
    if (!model) throw new Error("model is required");
    if (req.metadata !== undefined && (!req.metadata || typeof req.metadata !== "object" || Array.isArray(req.metadata)))
      throw new Error("metadata must be an object");
    var prompt = trimmed(req.prompt);
    var images = [];
    var hasFile = req.images ? Array.isArray(req.images) && req.images.some(function (x) { return x && x.__fileRef; }) : false;
    if (Object.keys(fileFields).length) {
      images.push({ __fileRef: "request_file:input_reference", encoding: "base64", maxBytes: 20971520 });
    } else {
      var ref = trimmed(req.input_reference || req.image);
      if (ref && !hasFile) images.push(ref);
      if (Array.isArray(req.images) && !hasFile) {
        for (var i = 0; i < req.images.length; i++) {
          var img = req.images[i];
          if (typeof img === "string" && trimmed(img) && images.indexOf(trimmed(img)) < 0) images.push(trimmed(img));
        }
      }
      if (hasFile) {
        images = [];
        for (var j = 0; j < req.images.length; j++) {
          if (req.images[j] && req.images[j].__fileRef) images.push(req.images[j]);
        }
      }
    }
    if (!prompt && images.length === 0) throw new Error("input is required");
    var requestBody = { model: ctx.model, prompt: prompt };
    if (images.length) requestBody.images = images;
    var metadata = Object.assign({}, req.metadata || {});
    if (Object.prototype.hasOwnProperty.call(req, "resolution")) metadata.resolution = req.resolution;
    if (Object.prototype.hasOwnProperty.call(req, "ratio")) metadata.ratio = req.ratio;
    if (req.size && !metadata.resolution && !metadata.ratio) metadata.resolution = normalizeResolution(req.size);
    var seconds = req.seconds === undefined ? req.duration : req.seconds;
    if (seconds !== undefined) metadata.duration = Number(seconds);
    if (Object.keys(metadata).length) requestBody.metadata = metadata;
    var action = hasVideo(requestContent(req)) ? "reference_to_video" : images.length ? "image_to_video" : "text_to_video";
    return { kind: "submit", model: ctx.model, action: action, requestBody: requestBody };
  },
  render: function (ctx, task) {
    var statusMap = { NOT_START: "queued", SUBMITTED: "queued", QUEUED: "queued", IN_PROGRESS: "in_progress", SUCCESS: "completed", FAILURE: "failed" };
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
