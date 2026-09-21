// TelecomJS (江苏电信 AI 网关, aigw.telecomjs.com) Betydance video generation
// plugin.
//
// The gateway resells the official Doubao Seedance family under `*-betydance`
// names (validation errors surface the internal mapping, e.g. "not valid for
// model doubao-seedance-2-5 in t2v"), so capability gating and pricing follow
// the official doubao plugin line exactly.
//
// Wire format (verified live against https://aigw.telecomjs.com):
//   POST {base}/v1/videos/generations                 -> submit
//        {base}/api/v3/contents/generations/tasks     -> submit (alias, same backend)
//        Both accept the same body; responses are identical.
//   GET  {base}/v1/videos/generations/task/{task_id}  -> poll
//        {base}/api/v3/contents/generations/tasks/{task_id} -> poll (alias)
//
// Request body is flat (NOT Ark two-layer): generation params sit at the top
// level (`resolution` top-level is validated by the gateway; the same key
// inside `metadata` is IGNORED — verified: metadata.resolution "300p" was
// accepted while top-level "9k"/"4k" errors). `content` items: text items MUST
// NOT carry a role ("role is not supported in text content"); image/video
// items accept roles (first_frame/last_frame/reference_image/reference_video
// pass validation and switch the gateway into i2v/r2v modes). A top-level
// `prompt` is also accepted and converted to a text item upstream, but this
// driver always sends a canonical `content` array.
//
// Submit response: {id, model, output:{task_id, task_status:"PENDING"},
// request_id}; id == output.task_id.
// Poll response: {status ("pending"/"running"/"succeeded"/...), content:{
// video_url} on success, resolution, duration, ratio, seed, usage:{
// completion_tokens, total_tokens, SR (delivered resolution), duration, ratio,
// audio}, ...}. Real usage tokens include audio cost, so completion overlays
// completion_tokens instead of the formula estimate.
//
// Capability matrix (verified: 4k rejected "not supported for this account
// and model" on 2-5; 4k passes validation on 2-0; fast/mini cap at 720p per
// the official matrix) and default durations (verified via usage.duration on
// live tasks: 2-5 defaults 10s, 2-0-fast defaults 5s):
//   doubao-seedance-2-5-betydance          480p/720p/1080p, default 10s
//   doubao-seedance-2-0-260128-betydance   480p/720p/1080p/4k, default 5s
//   doubao-seedance-2-0-fast-260129-betydance  480p/720p, default 5s
//   doubao-seedance-2-0-mini-260616-betydance   480p/720p, default 5s
//
// A request that leaves the resolution to the upstream reserves the model's
// highest tier up to 1080p (mirroring doubao 1.1.0): the poll body reports the
// delivered resolution (usage.SR / resolution) and real tokens, so
// extractUsageOnComplete settles the estimate.
//
// 1.0.0 — initial release aligned with the official 1.1.0 plugin line:
// upstreams ["vendor","new_api"], per-model capability profiles, localized
// pricing labels, submit-time out-of-tier rejection, and completion overlay.

export const meta = {
  apiVersion: 1,
  key: "telecomjs",
  name: "TelecomJS Betydance Video",
  icon: "text:TJ",
  description: {
    en: "TelecomJS (Jiangsu Telecom AI gateway) Betydance video generation — official Seedance family via /v1/videos/generations",
    zh: "江苏电信 AI 网关 Betydance 视频生成（官方 Seedance 底座），走 /v1/videos/generations",
  },
  version: "1.0.0",
  author: { name: "QuantumNous" },
  // Owns channel type 105 (telecomjs). A type-105 channel auto-binds to this
  // plugin via GetByChannelType; a type-61 (TaskPlugin) channel can bind by
  // task_plugin_key, and a type-60 (New API) channel binds it through the
  // channel's task plugin setting (SupportsUpstream("new_api") below).
  channelTypes: [105],
  models: [
    "doubao-seedance-2-5-betydance",
    "doubao-seedance-2-0-260128-betydance",
    "doubao-seedance-2-0-fast-260129-betydance",
    "doubao-seedance-2-0-mini-260616-betydance",
  ],
  fetchMode: "per_task",
  // Vendor (dedicated TelecomJS channels and TaskPlugin channels) plus New API
  // gateways chaining this plugin through a type-60 channel.
  upstreams: ["vendor", "new_api"],
  usageSchema: {
    tokens: {
      type: "number",
      unit: "token",
      description: {
        en: "Estimated billing tokens (Seedance formula: seconds × width × height × 24 / 1024); the gateway settles the real total on completion.",
        zh: "预估计费 token（Seedance 公式：秒 × 宽 × 高 × 24 / 1024）；完成时按网关回报的真实用量结算。",
      },
    },
    duration: {
      type: "number",
      unit: "second",
      description: {
        en: "Output video duration in seconds. Requests that omit it default to 10s on the 2.5 tier and 5s on the 2.0 tiers.",
        zh: "输出视频时长（秒）。不传时 2.5 档默认 10 秒，2.0 系档默认 5 秒。",
      },
    },
    resolution: {
      enum: ["480p", "720p", "1080p", "4k"],
      enumLabels: {
        "480p": { en: "480p", zh: "480p" },
        "720p": { en: "720p", zh: "720p" },
        "1080p": { en: "1080p", zh: "1080p" },
        "4k": { en: "4k", zh: "4k" },
      },
      description: {
        en: "Output video resolution tier. 4k is supported by the 2.0 standard tier; fast/mini tiers cap at 720p; the 2.5 tier caps at 1080p.",
        zh: "输出视频分辨率档位。4k 仅 2.0 标准版支持；fast/mini 档上限 720p；2.5 档上限 1080p。",
      },
    },
    video_input: {
      enum: ["none", "video"],
      enumLabels: { none: { en: "No reference video", zh: "无参考视频" }, video: { en: "With reference video", zh: "有参考视频" } },
      description: {
        en: "Reference video input.",
        zh: "参考视频输入。",
      },
    },
  },
  // Official Seedance formula tokens = seconds × W × H × 24 / 1024, 16:9
  // max-pixel dimensions. 电信网关底层是官方 seedance，定价完全参考 doubao
  // seedance 价格表：videoInputRatio 按 model 档（2-5/2-0/fast/mini）+
  // resolution（含 4k）+ 参考视频输入(v2v) 算折扣 ratio，billing_ratios 返回
  // {video_input_ratio} 或 null（ratio=1 时）。
  usageExamples: [
    { label: "480p · 5s", facts: { tokens: 48038, duration: 5, resolution: "480p", video_input: "none" } },
    { label: "720p · 5s", facts: { tokens: 108000, duration: 5, resolution: "720p", video_input: "none" } },
    { label: "1080p · 5s", facts: { tokens: 243000, duration: 5, resolution: "1080p", video_input: "none" } },
    { label: "4k · 5s", facts: { tokens: 972000, duration: 5, resolution: "4k", video_input: "none" } },
    { label: "4k · 5s (视频输入)", facts: { tokens: 972000, duration: 5, resolution: "4k", video_input: "video" } },
    { label: "720p · 10s", facts: { tokens: 216000, duration: 10, resolution: "720p", video_input: "none" } },
    { label: "1080p · 10s (2.5 档默认时长)", facts: { tokens: 486000, duration: 10, resolution: "1080p", video_input: "none" } },
    { label: "1080p · 5s (视频输入)", facts: { tokens: 243000, duration: 5, resolution: "1080p", video_input: "video" } },
  ],
  // One usage profile per capability shape: each model tier lists only the
  // resolutions it offers, with per-profile display examples. 2.5 caps at
  // 1080p, the 2.0 standard tier adds 4k, fast/mini cap at 480p/720p
  // (官方 Seedance 能力矩阵，电信侧已实测 2-5 拒 4k、2-0 放行 4k).
  usageProfiles: telecomjsUsageProfiles(),
  routes: [
    { method: "POST", path: "/telecomjs/v1/videos/generations", type: "submit", decode: "createTask", render: "taskCreated" },
    { method: "GET", path: "/telecomjs/v1/videos/generations/task/:task_id", type: "query", render: "taskStatus" },
  ],
  protocols: [{ name: "openai_responses", supports: ["stream", "sync", "background"] }, "openai_video"],
};

// ---- Shared helpers ---------------------------------------------------------

function trimmed(value) {
  return String(value || "").trim();
}

// Another New API gateway serves the TelecomJS dialect only on this plugin's
// prefixed native routes; the vendor API serves the unprefixed paths.
function apiRoot(ctx) {
  return ctx.baseUrl + (ctx.upstream && ctx.upstream.kind === "new_api" ? "/telecomjs" : "");
}

// Seedance capability matrix by model tier (能力矩阵，非价格): the output
// resolutions each tier offers, whether reference-video input is priced
// separately, and the duration the gateway applies when a request omits it
// (verified live: the 2.5 tier defaults to 10s, the 2.0 tiers to 5s).
// Separator-normalized prefix matching maps dotted and hyphenated spellings
// to the same tier; fast/mini are checked before the 2.0 standard prefix.
// Returns null for names without a known tier.
function knownTierProfile(model) {
  var m = trimmed(model).toLowerCase().replace(/[._]/g, "-");
  if (m.indexOf("doubao-seedance-2-0-fast") === 0) return { resolutions: ["480p", "720p"], videoInput: true, defaultSeconds: 5 };
  if (m.indexOf("doubao-seedance-2-0-mini") === 0) return { resolutions: ["480p", "720p"], videoInput: true, defaultSeconds: 5 };
  if (m.indexOf("doubao-seedance-2-0") === 0) return { resolutions: ["480p", "720p", "1080p", "4k"], videoInput: true, defaultSeconds: 5 };
  if (m.indexOf("doubao-seedance-2-5") === 0) return { resolutions: ["480p", "720p", "1080p"], videoInput: true, defaultSeconds: 10 };
  return null;
}

function defaultVideoProfile() {
  return { resolutions: ["480p", "720p", "1080p", "4k"], videoInput: true, defaultSeconds: 5 };
}

// Capability profile of the executing model. Channel mapping may send a
// declared tier name to an upstream endpoint ID; the first recognized name
// (upstreamModel, then the client-facing model) still describes the endpoint.
function videoProfile(ctx) {
  var req = (ctx && ctx.requestBody) || {};
  var candidates = [ctx && ctx.upstreamModel, ctx && ctx.model, req.model];
  for (var i = 0; i < candidates.length; i++) {
    var profile = knownTierProfile(candidates[i]);
    if (profile) return profile;
  }
  return defaultVideoProfile();
}

// Resolution tier for the submit estimate: the requested tier or the tier of
// a WxH size, rejecting tiers the model does not offer (before any quota is
// reserved). A request that leaves the resolution to the upstream reserves
// the model's highest tier up to 1080p (mirroring doubao 1.1.0); the poll
// body reports the delivered resolution (usage.SR), so completion settles
// the estimate.
function videoResolution(ctx) {
  var req = ctx.requestBody || {};
  var metadata = req.metadata || {};
  var raw = trimmed(
    metadata.resolution !== undefined ? metadata.resolution : req.resolution !== undefined ? req.resolution : req.size
  ).toLowerCase();
  var recognized = ["480p", "720p", "1080p", "4k"].indexOf(raw) >= 0 || raw.replace("*", "x").split("x").length === 2;
  var profile = videoProfile(ctx);
  if (!recognized) return profile.resolutions.indexOf("1080p") >= 0 ? "1080p" : profile.resolutions[profile.resolutions.length - 1];
  var resolution = normalizeResolution(raw);
  if (profile.resolutions.indexOf(resolution) < 0)
    throw new Error(trimmed(ctx.upstreamModel || ctx.model || req.model) + " resolution must be one of " + profile.resolutions.join(", "));
  return resolution;
}

// Usage facts schema for one capability profile: the pricing table then lists
// only the resolutions and input kinds the model tier offers.
function usageSchemaForProfile(profile) {
  var resolutionLabels = {};
  for (var i = 0; i < profile.resolutions.length; i++) {
    var resolution = profile.resolutions[i];
    resolutionLabels[resolution] = { en: resolution, zh: resolution };
  }
  var schema = {
    tokens: {
      type: "number",
      unit: "token",
      description: {
        en: "Estimated billing tokens (Seedance formula: seconds × width × height × 24 / 1024); the gateway settles the real total on completion.",
        zh: "预估计费 token（Seedance 公式：秒 × 宽 × 高 × 24 / 1024）；完成时按网关回报的真实用量结算。",
      },
    },
    duration: {
      type: "number",
      unit: "second",
      description: {
        en: "Output video duration in seconds (defaults to " + profile.defaultSeconds + "s when omitted).",
        zh: "输出视频时长（秒），不传时默认 " + profile.defaultSeconds + " 秒。",
      },
    },
    resolution: {
      enum: profile.resolutions,
      enumLabels: resolutionLabels,
      description: { en: "Output video resolution tier", zh: "输出视频分辨率档位" },
    },
  };
  if (profile.videoInput) {
    schema.video_input = {
      enum: ["none", "video"],
      enumLabels: { none: { en: "No reference video", zh: "无参考视频" }, video: { en: "With reference video", zh: "有参考视频" } },
      description: { en: "Reference video input", zh: "参考视频输入" },
    };
  }
  return schema;
}

// Display examples for one capability profile: a 5-second video at each
// offered tier plus the reference-video and long variants the tier prices.
function usageExamplesForProfile(profile) {
  var specs = [];
  for (var i = 0; i < profile.resolutions.length; i++) {
    specs.push({ label: profile.resolutions[i] + " · 5s", resolution: profile.resolutions[i], seconds: 5 });
  }
  var base = profile.resolutions.indexOf("720p") >= 0 ? "720p" : profile.resolutions[0];
  if (profile.videoInput) specs.push({ label: base + " · 5s (视频输入)", resolution: base, seconds: 5, video_input: "video" });
  specs.push({ label: base + " · " + profile.defaultSeconds + "s (默认时长)", resolution: base, seconds: profile.defaultSeconds });
  return specs.map(function (spec) {
    var facts = { tokens: Math.round(estimateTokens(spec.seconds, spec.resolution)), duration: spec.seconds, resolution: spec.resolution };
    if (profile.videoInput) facts.video_input = spec.video_input || "none";
    return { label: spec.label, facts: facts };
  });
}

// One usage profile per declared model tier (capability shape).
function telecomjsUsageProfiles() {
  var tiers = [
    { models: ["doubao-seedance-2-5-betydance"], resolutions: ["480p", "720p", "1080p"], videoInput: true, defaultSeconds: 10 },
    { models: ["doubao-seedance-2-0-260128-betydance"], resolutions: ["480p", "720p", "1080p", "4k"], videoInput: true, defaultSeconds: 5 },
    {
      models: ["doubao-seedance-2-0-fast-260129-betydance", "doubao-seedance-2-0-mini-260616-betydance"],
      resolutions: ["480p", "720p"],
      videoInput: true,
      defaultSeconds: 5,
    },
  ];
  return tiers.map(function (tier) {
    return { models: tier.models, schema: usageSchemaForProfile(tier), examples: usageExamplesForProfile(tier) };
  });
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

// Normalize any resolution input to a supported tier; unrecognized inputs
// return "" so the caller can apply its own default policy.
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

// Normalize duration: accept int seconds; negative values (smart duration)
// and missing values bill the tier default (the gateway applies the same
// default upstream — verified: 2.5 defaults 10s, 2.0-fast defaults 5s); cap
// at 3600.
function normalizeSeconds(value, defaultSeconds) {
  var n = Number(value);
  if (!Number.isFinite(n) || n < 0) return defaultSeconds;
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
// input). Mirrors doubao/stelloria/pgy-seedance/wasu for consistent v2v
// billing.
function hasVideo(content) {
  if (!Array.isArray(content)) return false;
  for (var i = 0; i < content.length; i++) {
    var item = content[i];
    if (!item || typeof item !== "object") continue;
    if (item.type === "video_url" || Object.prototype.hasOwnProperty.call(item, "video_url")) return true;
  }
  return false;
}

// The poll body is stored on task.data; it is the gateway's task object.
function storedBody(ctxOrTask) {
  var d = (ctxOrTask && ctxOrTask.data) || {};
  return d;
}

// Read the generated video URL from a poll body: content.video_url is a
// signed temporary TOS link.
function resultUrlFromBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  var content = body.content && typeof body.content === "object" && !Array.isArray(body.content) ? body.content : {};
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
    var statusMap = {
      pending: "queued",
      queued: "queued",
      not_start: "queued",
      running: "processing",
      processing: "processing",
      in_progress: "processing",
      succeeded: "completed",
      success: "completed",
      failed: "failed",
      expired: "failed",
      cancelled: "failed",
    };
    var status = statusMap[String(body.status || "").toLowerCase()] || "processing";
    var out = Object.assign({}, body, { id: task.task_id, task_id: task.task_id, status: status });
    var videoUrl = resultUrlFromBody(body);
    if (videoUrl) out.video_url = videoUrl;
    if (status === "failed") out.error = { code: "task_failed", message: (body.error && body.error.message) || body.reason || "task failed" };
    return out;
  },
  error: function (ctx, error) {
    return { error: { code: error.code, message: error.message } };
  },
};

// ---- Driver hooks -----------------------------------------------------------

// Build the upstream POST /v1/videos/generations request. The body is FLAT:
// {model, content:[...], resolution?, duration?, ratio?, generate_audio?,
// seed?, watermark?} — generation params at the top level (the gateway
// ignores them inside metadata). content items: text items never carry a
// role ("role is not supported in text content"), image/video reference
// items keep their roles. The model sent upstream honors ctx.upstreamModel
// first (channel model_mapping), then the client-facing model.
export function buildSubmitRequest(ctx) {
  var req = ctx.requestBody || {};
  var metadata = Object.assign({}, req.metadata || {});
  var model = ctx.upstreamModel || ctx.model || req.model || "";
  // Reject output tiers the model does not offer before any quota is
  // reserved; normalize the client's resolution spelling. The reservation
  // tier is NOT sent upstream when the client omitted the resolution — the
  // gateway applies its own 720p default there and the completion overlay
  // settles the estimate.
  var resolutionRaw = metadata.resolution !== undefined ? metadata.resolution : req.resolution !== undefined ? req.resolution : req.size;
  var resolution = videoResolution(ctx);
  // Reference material: client content items (with their roles) first, then
  // images[] merged as plain image_url items; text items are dropped and the
  // prompt is re-appended as a single role-less text item.
  var contentItems = [];
  var content = Array.isArray(metadata.content) ? metadata.content : [];
  for (var i = 0; i < content.length; i++) {
    var item = content[i];
    if (item && typeof item === "object" && item.type !== "text") contentItems.push(item);
  }
  var images = Array.isArray(req.images) ? req.images : [];
  for (var j = 0; j < images.length; j++) {
    var url = mediaUrlOf(images[j]);
    if (url) contentItems.push({ type: "image_url", image_url: { url: url } });
  }
  var hasReference = contentItems.length > 0;
  contentItems.push({ type: "text", text: trimmed(req.prompt) || "" });
  var body = { model: model, content: contentItems };
  if (resolutionRaw !== undefined) body.resolution = resolution;
  var durationRaw = req.duration !== undefined ? req.duration : req.seconds !== undefined ? req.seconds : metadata.duration;
  if (durationRaw !== undefined && Number(durationRaw) >= 0) body.duration = Math.min(Math.floor(Number(durationRaw)), 3600);
  var ratioRaw = metadata.ratio !== undefined ? metadata.ratio : metadata.aspect_ratio !== undefined ? metadata.aspect_ratio : req.ratio;
  if (ratioRaw !== undefined) body.ratio = ratioRaw;
  if (metadata.generate_audio !== undefined) body.generate_audio = metadata.generate_audio;
  else if (req.generate_audio !== undefined) body.generate_audio = req.generate_audio;
  if (metadata.seed !== undefined) body.seed = metadata.seed;
  else if (req.seed !== undefined) body.seed = req.seed;
  if (metadata.watermark !== undefined) body.watermark = metadata.watermark;
  return {
    url: apiRoot(ctx) + "/v1/videos/generations",
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
    body: body,
    action: hasReference ? "image_to_video" : "text_to_video",
    rewriteModel: body.model,
  };
}

// The submit response carries the task id as output.task_id (id and task_id
// are permissive fallbacks; the gateway sets all three to the same value).
export function parseSubmitResponse(ctx, resp) {
  if (!resp.body) throw new Error("upstream returned no body");
  var output = resp.body.output && typeof resp.body.output === "object" && !Array.isArray(resp.body.output) ? resp.body.output : {};
  var taskId = trimmed(output.task_id) || trimmed(resp.body.task_id) || trimmed(resp.body.id);
  if (!taskId) throw new Error("task_id is empty");
  return { taskId: taskId, taskData: resp.body };
}

// Per-model billing ratio mirroring the official Doubao Seedance price table.
// 电信网关底层是官方 seedance（错误信息直指 doubao-seedance-2-5/2-0），模型名
// doubao-seedance-*-betydance 对应 doubao 各档。video-to-video (参考视频输入)
// 享更低单价。模型名分隔符统一（. _ → -）以便带日期后缀的 id 都能匹配。
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
    // 电信网关底层是官方 seedance，定价完全参考 doubao seedance 价格表。
    var ratio = videoInputRatio(ctx.upstreamModel || ctx.model || req.model, metadata.resolution, content);
    return ratio === 1 ? null : { video_input_ratio: ratio };
  }
  var profile = videoProfile(ctx);
  var seconds = normalizeSeconds(
    req.duration !== undefined ? req.duration : req.seconds !== undefined ? req.seconds : metadata.duration,
    profile.defaultSeconds
  );
  // Unspecified resolution reserves the highest tier up to 1080p; the poll
  // body reports the delivered resolution (usage.SR), so completion settles.
  var resolution = videoResolution(ctx);
  var facts = {
    tokens: estimateTokens(seconds, resolution),
    duration: seconds,
    resolution: resolution,
  };
  if (profile.videoInput) facts.video_input = hasVideo(content) ? "video" : "none";
  return facts;
}

// Poll the upstream GET /v1/videos/generations/task/{task_id}.
export function buildQueryRequest(ctx) {
  return {
    url: apiRoot(ctx) + "/v1/videos/generations/task/" + ctx.taskId,
    method: "GET",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + ctx.apiKey },
  };
}

// Parse the poll response: {status ("pending"/"running"/"succeeded"/...),
// content:{video_url}, usage:{completion_tokens, total_tokens, SR, duration},
// resolution, duration, ...}.
export function parseTaskResult(ctx, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid task result");
  var status = String(body.status || "").toLowerCase();
  if (status === "pending" || status === "queued" || status === "not_start") return { status: "QUEUED", progress: "0%" };
  if (status === "running" || status === "processing" || status === "in_progress") return { status: "IN_PROGRESS", progress: "50%" };
  if (status === "succeeded" || status === "success") {
    var result = { status: "SUCCESS", progress: "100%", url: resultUrlFromBody(body) };
    var usage = body.usage || {};
    var completionTokens = Number(usage.completion_tokens || 0);
    var totalTokens = Number(usage.total_tokens || 0);
    if (Number.isFinite(completionTokens) && completionTokens > 0) result.completionTokens = completionTokens;
    if (Number.isFinite(totalTokens) && totalTokens > 0) result.totalTokens = totalTokens;
    return result;
  }
  if (status === "failed" || status === "expired" || status === "cancelled") {
    var reason = (body.error && body.error.message) || body.reason || body.fail_reason || status;
    return { status: "FAILURE", progress: "100%", reason: reason };
  }
  // Unrecognized status strings are UNKNOWN per the polling contract — the host
  // counts them as consecutive poll failures (do NOT fall back to IN_PROGRESS).
  return { status: "UNKNOWN" };
}

export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  if (resultUrlFromBody(storedBody(task))) return [{ key: "video", type: "video" }];
  return [];
}

// The video URL is a signed temporary TOS link in the poll body's
// content.video_url; fetch it without upstream credentials (credentialless).
export function buildContentRequest(ctx) {
  var url = resultUrlFromBody(storedBody(ctx));
  if (!url) throw new Error("artifact_not_found");
  return { url: url, method: (ctx.clientRequest && ctx.clientRequest.method) || "GET", credentialless: true };
}

// The poll body carries the real bill on success: usage.completion_tokens
// (includes audio cost, so it exceeds the formula estimate),
// usage.SR/body.resolution (delivered tier) and usage.duration. Overlay them
// on completion when present, otherwise keep the submit estimate. Only
// succeeded tasks settle; failed tasks settle via the host's full refund, so
// a stray usage blob on a non-success body must not leak facts.
export function extractUsageOnComplete(task, taskResult, body) {
  if (!body || String(body.status || "").toLowerCase() !== "succeeded") return {};
  var facts = {};
  var usage = body.usage && typeof body.usage === "object" ? body.usage : {};
  var tokens = Number(usage.completion_tokens);
  if (!Number.isFinite(tokens) || tokens <= 0) tokens = Number(usage.total_tokens);
  if (Number.isFinite(tokens) && tokens > 0) facts.tokens = tokens;
  var resolution = trimmed(usage.SR || body.resolution).toLowerCase();
  if (["480p", "720p", "1080p", "4k"].indexOf(resolution) >= 0) facts.resolution = resolution;
  var duration = Number(usage.duration !== undefined ? usage.duration : body.duration);
  if (Number.isFinite(duration) && duration > 0) facts.duration = Math.min(Math.floor(duration), 3600);
  return facts;
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
  for (var j = 0; j < content.length; j++) {
    var item = content[j];
    if (!item || typeof item !== "object") continue;
    if (item.type === "image_url" || Object.prototype.hasOwnProperty.call(item, "image_url")) {
      var iu = mediaUrlOf(item);
      if (iu && images.indexOf(iu) < 0) images.push(iu);
    }
  }
  return images;
}

// Parse an OpenAI Responses `input` (string or multimodal array) into a
// {prompt, images} pair, mirroring the wasu/maicang/stelloria convention.
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
        metadata: { vendor: "telecomjs" },
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
