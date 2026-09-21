// NewAPI Video Relay task plugin.
//
// A transparent relay that forwards video generation requests from this new-api
// instance to *another* new-api instance's standard openai_video endpoints:
//
//   POST {base}/v1/videos            -> submit, returns {id, object:"video", status, ...}
//   GET  {base}/v1/videos/{task_id}  -> poll,   returns {id, status, progress, ...}
//   GET  {base}/v1/videos/{task_id}/content -> proxy video bytes (requires TokenAuth)
//
// The upstream new-api already has its own video task plugins installed (doubao,
// sora, kling, …); this plugin simply speaks the same openai_video wire format
// the upstream exposes, so any model the upstream serves can be relayed without
// per-vendor glue. Only the openai_video host surface (POST /v1/videos) is
// claimed, so this relay can coexist with locally-installed vendor plugins that
// own the openai_responses (POST /v1/responses) surface for the same models.
//
// 1.1.0 — plugin API v1 alignment (BREAKING channel binding change):
//   * Removes the `channelTypes: [60]` declaration. The New API channel type
//     is now reserved by the runtime: plugins may not claim it, and a New API
//     (type-60) channel binds task plugins through its task plugin setting
//     (task_plugin_key / task_extend_plugin_keys) instead. Channels serving
//     this relay must be re-saved with the plugin binding after upgrading the
//     gateway; the previous channelTypes auto-binding no longer compiles on
//     the updated runtime.
//   * Declares `upstreams: ["vendor", "new_api"]` so New API channels can bind
//     this plugin (SupportsUpstream). The relay speaks the upstream's
//     host-owned /v1/videos surface directly, so no native-route prefix is
//     added for either upstream kind.
//   * usageSchema enums now carry localized pricing-display labels
//     (enumLabels), matching the official plugin line.
//
// 1.0.3 billing fixes:
//   * Unspecified resolution now bills the official 720p default tier
//     (previously 1080p, overcharging requests that rely on the documented
//     default).
//   * usageSchema/extractUsage now carry a `duration` fact like the sibling
//     Seedance plugins, so tiered expressions referencing u("duration") no
//     longer evaluate against a missing fact (nil arithmetic fails the whole
//     expression on relayed tasks).
//   * extractUsageOnComplete no longer discards completion usage: real token
//     counts ride on `usage`/`metadata.usage` when the upstream exposes them,
//     and `seconds`+`size` recompute the Seedance tokens from the real
//     completion figures. Without any of those the submit estimate is kept.

export const meta = {
  apiVersion: 1,
  key: "newapi-video",
  name: "NewAPI Video Relay",
  icon: "text:NR",
  description: {
    en: "Transparent relay to another new-api instance's video endpoints (/v1/videos)",
    zh: "透明中继到另一个 new-api 实例的视频接口（/v1/videos）",
  },
  version: "1.1.0",
  author: { name: "QuantumNous" },
  // This plugin declares NO channelTypes. The New API channel type (60) is
  // reserved by the runtime: a type-60 channel binds task plugins through its
  // task plugin setting (task_plugin_key / task_extend_plugin_keys), and the
  // first bound candidate in generation order executes a pinned request, so
  // this relay coexists with vendor plugins (kling/sora/doubao/…) claiming the
  // same models on the same host protocol. Type-59 Task Plugin channels bind
  // it by task_plugin_key as usual.
  models: [
    "sora-2",
    "sora-2-pro",
    "kling-v1",
    "kling-v1-6",
    "kling-v2-master",
    "doubao-seedance-1-0-pro-250528",
    "doubao-seedance-1-0-lite-t2v",
    "doubao-seedance-1-0-lite-i2v",
    "doubao-seedance-1-5-pro-251215",
    "doubao-seedance-2-0-260128",
    "doubao-seedance-2-0-fast-260128",
    "doubao-seedance-2-0-mini-260615",
    "doubao-seedance-2-5-260628",
    // ByteDance ArtsDance video generation models (new family, not claimed by
    // the embedded doubao plugin which only covers doubao-seedance-* names).
    "artsdance-2-0-pro-260801",
    "artsdance-2-5-pro-260801",
    // Upstream-native Seedance 2.0 name (no date suffix). NOT claimed by the
    // embedded doubao plugin (which uses -260128) nor by the stelloria plugin
    // (which claims the dotted "doubao-seedance-2.0"), so newapi-video is the
    // sole legacy claimant here. The upstream api.oinone.top only accepts this
    // hyphenated form; the dotted variant returns 503 on that upstream.
    "doubao-seedance-2-0",
    "MiniMax-Hailuo-2.3",
    "MiniMax-Hailuo-2.3-Fast",
    "MiniMax-Hailuo-02",
    "T2V-01-Director",
    "T2V-01",
    "I2V-01-Director",
    "I2V-01-live",
    "I2V-01",
    "S2V-01",
    "veo-3.0-generate-001",
    "veo-3.0-fast-generate-001",
    "veo-3.1-generate-preview",
    "veo-3.1-fast-generate-preview",
    "jimeng_vgfm_t2v_l20",
    "wan2.7-i2v",
    "wan2.7-t2v",
    "wan2.5-t2v-preview",
    "wan2.5-i2v-preview",
    "wan2.2-i2v-flash",
    "wan2.2-i2v-plus",
    "wanx2.1-i2v-plus",
    "wanx2.1-i2v-turbo",
    "viduq2",
    "viduq1",
    "vidu2.0",
    "vidu1.5",
  ],
  fetchMode: "per_task",
  // The upstream is always another new-api gateway: on a New API (type-60)
  // channel the host injects the new_api upstream kind; on Task Plugin
  // channels the base URL points at the upstream gateway the same way. The
  // relay speaks the upstream's host-owned /v1/videos surface directly, so no
  // native-route prefix is added for either kind.
  upstreams: ["vendor", "new_api"],
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
      enumLabels: {
        "480p": { en: "480p", zh: "480p" },
        "720p": { en: "720p", zh: "720p" },
        "1080p": { en: "1080p", zh: "1080p" },
        "4k": { en: "4k", zh: "4k" },
      },
      description: {
        en: "Output video resolution tier used for the token estimate.",
        zh: "用于 token 预估的输出分辨率档位。",
      },
    },
    video_input: {
      enum: ["none", "video"],
      enumLabels: { none: { en: "No reference video", zh: "无参考视频" }, video: { en: "With reference video", zh: "有参考视频" } },
      description: {
        en: "Whether the request includes reference video input; Seedance 2.0 prices video-to-video tokens at a lower unit rate.",
        zh: "请求是否包含参考视频输入；豆包 Seedance 2.0 对视频生视频 token 按更低单价计费。",
      },
    },
  },
  // Official Seedance formula tokens = seconds × W × H × 24 / 1024, 16:9 max-pixel
  // dimensions. Admins set the per-model ratio to match upstream pricing.
  // The video_input_ratio (returned by extractUsage billing_ratios) adjusts the
  // base estimate for Seedance 2.0's official video-input vs no-video pricing.
  usageExamples: [
    { label: "480p · 5s", facts: { tokens: 48038, duration: 5, resolution: "480p", video_input: "none" } },
    { label: "720p · 5s", facts: { tokens: 108000, duration: 5, resolution: "720p", video_input: "none" } },
    { label: "720p · 5s (视频输入)", facts: { tokens: 108000, duration: 5, resolution: "720p", video_input: "video" } },
    { label: "1080p · 5s", facts: { tokens: 243000, duration: 5, resolution: "1080p", video_input: "none" } },
    { label: "1080p · 5s (视频输入)", facts: { tokens: 243000, duration: 5, resolution: "1080p", video_input: "video" } },
    { label: "4k · 5s", facts: { tokens: 972000, duration: 5, resolution: "4k", video_input: "none" } },
    { label: "720p · 10s", facts: { tokens: 216000, duration: 10, resolution: "720p", video_input: "none" } },
    { label: "1080p · 10s", facts: { tokens: 486000, duration: 10, resolution: "1080p", video_input: "none" } },
  ],
  // Pure-protocol plugin: no native routes; both surfaces are host-owned
  // protocol bindings claimed below.
  routes: [],
  protocols: ["openai_video"],
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

// Normalize any resolution input to a supported tier; unspecified/unknown
// inputs fall back to the official 720p default tier.
function normalizeResolution(value) {
  var raw = trimmed(value).toLowerCase();
  if (["480p", "720p", "1080p", "4k"].indexOf(raw) >= 0) return raw;
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

// Resolve the content array carried by a request body. The openai_video
// protocol stores it at req.content (top-level) or req.metadata.content
// (Doubao-style metadata).
function requestContent(req) {
  if (req && Array.isArray(req.content)) return req.content;
  var metadata = (req && req.metadata) || {};
  if (Array.isArray(metadata.content)) return metadata.content;
  return [];
}

// Detect whether a content/metadata array carries reference video material.
function hasVideo(content) {
  if (!Array.isArray(content)) return false;
  for (var i = 0; i < content.length; i++) {
    var item = content[i];
    if (!item || typeof item !== "object") continue;
    if (item.type === "video_url" || Object.prototype.hasOwnProperty.call(item, "video_url")) return true;
  }
  return false;
}

// Check whether a model name is a Doubao Seedance 2.0 standard variant (not
// fast/mini/2.5/1.x). These models carry the official video-input discount.
function isSeedance20Standard(model) {
  return model === "doubao-seedance-2-0-260128" || model === "doubao-seedance-2-0";
}

// Per-model billing ratio for video-to-video vs no-video-input, mirroring the
// official Doubao Seedance 2.0 price table (doubao-seedance-2-0-260128). Only
// Seedance 2.0 standard carries the discount; other models bill at the plain
// token estimate (ratio 1). The no-video 1080p ratio (>1) corrects the
// max-pixel estimate up to the official 1080p unit price. Video-to-video uses
// a lower ratio reflecting the cheaper per-token unit rate for video input.
function videoInputRatio(model, resolution, content) {
  var video = hasVideo(content);
  var res = trimmed(resolution).toLowerCase();
  if (isSeedance20Standard(model)) {
    if (res === "1080p") return video ? 31 / 46 : 51 / 46;
    if (res === "720p") return video ? 28 / 46 : 1;
  }
  return 1;
}

// Collect image URLs carried by a request body (top-level image/input_reference
// or image_url items inside content/metadata).
function requestImages(req) {
  var images = [];
  var ref = trimmed(req && (req.image || req.input_reference));
  if (ref) images.push(ref);
  if (Array.isArray(req && req.images)) {
    for (var i = 0; i < req.images.length; i++) {
      var img = req.images[i];
      if (img && typeof img === "object" && img.__fileRef) {
        if (images.indexOf(img) < 0) images.push(img);
      } else if (typeof img === "string" && trimmed(img) && images.indexOf(trimmed(img)) < 0) {
        images.push(trimmed(img));
      }
    }
  }
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

// ---- Driver hooks -----------------------------------------------------------

// Forward the decoded requestBody to the upstream new-api's POST /v1/videos.
// The body is openai_video format. The model sent upstream is the
// channel-mapped name (ctx.upstreamModel, honoring the channel's
// model_mapping), falling back to the client-facing original (ctx.model) and
// finally the request body model. This mirrors the doubao/sora plugins which
// send ctx.upstreamModel upstream so model_mapping actually takes effect.
export function buildSubmitRequest(ctx) {
  var req = ctx.requestBody || {};
  var model = ctx.upstreamModel || ctx.model || req.model || "";
  var body = Object.assign({}, req);
  body.model = model;
  var images = requestImages(req);
  var action = images.length ? "image_to_video" : "text_to_video";
  return {
    url: ctx.baseUrl + "/v1/videos",
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
    body: body,
    action: action,
  };
}

// The upstream returns an OpenAI Video object: {id, object:"video", status, ...}
export function parseSubmitResponse(ctx, resp) {
  if (!resp.body || !resp.body.id) throw new Error("upstream returned no task id");
  return { taskId: resp.body.id, taskData: resp.body };
}

export function extractUsage(ctx) {
  var req = ctx.requestBody || {};
  var metadata = req.metadata || {};
  var content = requestContent(req);
  if (ctx.usagePurpose === "billing_ratios") {
    // Seedance 2.0 carries a video-input billing ratio that adjusts the base
    // token estimate to match the official Doubao price table (video-to-video
    // is cheaper per token; 1080p no-video needs a slight upward correction).
    var model = ctx.model || ctx.upstreamModel || req.model || "";
    var ratio = videoInputRatio(model, metadata.resolution || req.resolution, content);
    return ratio === 1 ? null : { video_input_ratio: ratio };
  }
  var seconds = normalizeSeconds(req.seconds === undefined ? req.duration === undefined ? metadata.duration : req.duration : req.seconds);
  var resolutionRaw = metadata.resolution || req.size || req.resolution;
  var resolution = normalizeResolution(resolutionRaw);
  return {
    tokens: estimateTokens(seconds, resolution),
    duration: seconds,
    resolution: resolution,
    video_input: hasVideo(content) ? "video" : "none",
  };
}

// Poll the upstream's GET /v1/videos/{task_id}.
export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl + "/v1/videos/" + ctx.taskId,
    method: "GET",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + ctx.apiKey },
  };
}

// Parse the upstream's OpenAI Video retrieve response (DTO-whitelisted by the
// upstream host; URL-like metadata is stripped, so the video URL is never in
// this body — content is fetched via the /content endpoint).
export function parseTaskResult(ctx, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid task result");
  var status = String(body.status || "").toLowerCase();
  var progress = Number(body.progress);
  var progressPct = Number.isFinite(progress) && progress >= 0 && progress <= 100 ? Math.round(progress) + "%" : null;
  if (status === "queued") return { status: "QUEUED", progress: progressPct || "10%" };
  if (status === "in_progress") return { status: "IN_PROGRESS", progress: progressPct || "50%" };
  if (status === "completed") return { status: "SUCCESS", progress: "100%" };
  if (status === "failed") {
    var err = body.error || {};
    var reason = trimmed(err.message) || "task failed";
    return { status: "FAILURE", progress: "100%", reason: reason };
  }
  // "unknown" is a recognized transitional upstream status; treat as
  // in-progress with low progress so polling continues.
  if (status === "unknown") return { status: "IN_PROGRESS", progress: progressPct || "30%" };
  // Unrecognized status strings are UNKNOWN per the polling contract — the
  // host counts them as consecutive poll failures.
  return { status: "UNKNOWN" };
}

// The video artifact lives at the upstream's /content endpoint.
export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  return [{ key: "video", type: "video" }];
}

// Proxy the upstream's GET /v1/videos/{task_id}/content. The endpoint requires
// TokenAuth (the channel API key owns the upstream task), so we attach the
// Bearer header and set credentialless=false. The URL is under the channel
// base URL, satisfying ValidateRequestURL.
export function buildContentRequest(ctx) {
  var taskId = ctx.upstreamTaskId || ctx.taskId;
  if (!taskId) throw new Error("artifact_not_found");
  return {
    url: ctx.baseUrl + "/v1/videos/" + taskId + "/content",
    method: ctx.clientRequest.method || "GET",
    headers: { Authorization: "Bearer " + ctx.apiKey },
    credentialless: false,
  };
}

// Overlay the real completion bill when the upstream response carries it. The
// upstream OpenAI-video DTO whitelists `seconds`/`size`/`metadata`, so real
// usage tokens ride on `usage`/`metadata.usage` (or are recomputed from
// `seconds`+`size` via the official Seedance formula); without any of those
// the submit-time estimate is kept.
export function extractUsageOnComplete(task, taskResult, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  if (String(body.status || "").toLowerCase() !== "completed") return {};
  var facts = {};
  var metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : {};
  var usage = null;
  if (body.usage && typeof body.usage === "object" && !Array.isArray(body.usage)) usage = body.usage;
  else if (metadata.usage && typeof metadata.usage === "object" && !Array.isArray(metadata.usage)) usage = metadata.usage;
  if (usage) {
    var tokens = Number(usage.completion_tokens);
    if (!Number.isFinite(tokens) || tokens <= 0) tokens = Number(usage.total_tokens);
    if (Number.isFinite(tokens) && tokens > 0) facts.tokens = tokens;
  }
  var seconds = Number(body.seconds);
  var hasSeconds = Number.isFinite(seconds) && seconds > 0;
  if (hasSeconds) facts.duration = Math.min(seconds, 3600);
  var resolutionRaw = trimmed(body.size) || trimmed(metadata.resolution);
  if (resolutionRaw) facts.resolution = normalizeResolution(resolutionRaw);
  if (!usage && hasSeconds && facts.resolution) {
    facts.tokens = estimateTokens(facts.duration, facts.resolution);
  }
  return facts;
}

// ---- Host protocols ---------------------------------------------------------

export const protocols = {};

protocols.openai_video = {
  decodeRequest: function (ctx) {
    if (!ctx.body || (ctx.body.kind !== "json" && ctx.body.kind !== "multipart")) throw new Error("JSON or multipart body required");
    var req;
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
        if (req.input_reference) throw new Error("input_reference must be provided once");
        req.input_reference = { __fileRef: "request_file:" + f.field, encoding: "dataUrl", maxBytes: 20971520 };
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
      else if (req.duration !== undefined) req.seconds = Number(req.duration);
    }
    var model = ctx.model || req.model;
    if (!model) throw new Error("model is required");
    req.model = model;
    if (req.metadata !== undefined && (!req.metadata || typeof req.metadata !== "object" || Array.isArray(req.metadata)))
      throw new Error("metadata must be an object");
    var images = requestImages(req);
    var action = images.length ? "image_to_video" : "text_to_video";
    return { kind: "submit", model: model, action: action, requestBody: req };
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
