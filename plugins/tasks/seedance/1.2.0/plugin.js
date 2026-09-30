// Seedance video generation plugin — one plugin for the five Seedance-upstream
// gateways behind channel types 101 (MaiCang), 102 (Stelloria), 103 (PGY),
// 104 (Wasu) and 105 (TelecomJS).
//
// Every vendor resells the same Doubao Seedance family (plus Stelloria's
// Wonder-Pro animation model), so capability gating and pricing follow the
// official doubao plugin line; only the wire dialects differ. The dialect is
// the executing channel's type when the host provides ctx.channelType
// (101 MaiCang, 102 Stelloria, 103 PGY, 104 Wasu, 105 TelecomJS), and the
// channel-mapped model name is the fallback for hosts without channel
// identity (or generic Task Plugin / New API chain channels):
//
//   doubao-seedance-2.0 / -fast / -mini            -> Wasu dialect
//   doubao-seedance-*-betydance                    -> TelecomJS dialect
//   tipdance-*                                     -> MaiCang dialect
//   seedance-2.0 / Wonder-Pro                      -> Stelloria dialect
//   pgy-*                                          -> PGY dialect
//
// Wire dialects (vendor paths against the channel base URL):
//
//   Wasu (https://token.wasu.cn)
//     POST {base}/v1/video/generations            -> submit {id, task_id, status:"queued", ...}
//     GET  {base}/v1/video/generations/{task_id}  -> poll   {code, message, data:{status(UPPER), progress, result_url, fail_reason, data:{usage}}}
//     Two-layer body: prompt/duration top level, generation params and reference
//     material inside metadata (resolution/ratio MUST go via metadata).
//
//   TelecomJS (https://aigw.telecomjs.com)
//     POST {base}/v1/videos/generations                 -> submit {id, output:{task_id, task_status}}
//     GET  {base}/v1/videos/generations/task/{task_id}  -> poll   {status(lower), content:{video_url}, usage:{completion_tokens, SR, duration}, resolution}
//     Flat body: generation params top level, canonical content[] (text items
//     never carry a role, image/video items keep theirs).
//
//   MaiCang (https://ai.tiptotip.cn)
//     POST {base}/v1/video/generations            -> submit {id, task_id, status:"pending", ...}
//     GET  {base}/v1/video/generations/{task_id}  -> poll   {status(lower), data:[{url}], usage:{completion_tokens}}
//     Flat body {model, prompt?, images:[{url}], resolution?, duration?, generate_audio?}
//     with NO content array — a single image is the first frame, two images
//     specify first+last frame (the upstream decides framing from array length).
//
//   Stelloria (https://stelloria.link)
//     POST {base}/v1/videos/generations   -> submit {task_id, status, model}
//     GET  {base}/v1/tasks/{task_id}      -> poll   {status(lower), result:{video_url, cover_url, duration, resolution}}
//     Seedance body: flat {model, content[], resolution?, duration?, ratio?,
//     aspect_ratio?, generate_audio?, seed?, watermark?, fps?} — content text
//     items CARRY role:"text" (the opposite of TelecomJS). Wonder-Pro speaks a
//     second dialect on the same endpoint: PascalCase {model, Prompt, Duration,
//     AspectRatio, Resolution, image_url} with a single reference image.
//
//   PGY (https://seedance.pgysd.com, Mobile Cloud relay)
//     POST {base}/api/v3/contents/generations/tasks        -> submit {id:"cgt-..."}
//     GET  {base}/api/v3/contents/generations/tasks/{id}   -> poll   {status(lower), content:{video_url, last_frame_url}, usage}
//     Ark-style body: {model, content[], ...metadata spread}; the upstream
//     receives "doubao-seedance-2.0" unless the channel mapping overrides;
//     a `service_tier` key must be ABSENT (not empty) in pure t2v mode; a
//     frames count may stand in for duration (seconds = frames / 24).
//
// Billing per dialect (official Seedance price table, videoInputRatio below):
//   * TelecomJS polls report the delivered tier (usage.SR) and real tokens, so
//     an unspecified resolution reserves the model's highest tier up to 1080p
//     and completion settles tokens/resolution/duration; the 2.5 tier defaults
//     to 10s when a request omits duration.
//   * Wasu/MaiCang polls never report the delivered resolution, so unspecified
//     resolutions bill the official 720p default tier; completion overlays the
//     real token total.
//   * Stelloria durations coerce to 5 or 10 seconds; completion overlays the
//     delivered duration/resolution and recomputes tokens from them.
//   * PGY unspecified duration bills 5s (or frames/24); completion overlays
//     real tokens and the delivered resolution (content.resolution).
//
// Chained New API gateways: a type-60 channel bound to this plugin targets
// this plugin's own /seedance native routes on the upstream gateway. The
// gateway-to-gateway body is the plugin's uniform internal shape
// ({model, prompt, duration?, metadata:{resolution?, content[]}}); the
// upstream gateway then rewrites it per ITS executing channel's dialect. Polls
// hit the upstream native query route, whose render output (status
// queued/processing/completed/failed + result_url/video_url + progress) this
// driver's parsers also accept defensively, so chained polling works whether
// the host maps the native render directly or feeds it through
// parseTaskResult.
//
// Official Ark-format surface (1.2.0): the same task pipeline is also
// reachable in the Volcengine-native request/response shape, alongside the
// routes above. Clients speak the official format — POST {gateway}/seedance/
// v3/contents/generations/tasks with {model, content:[text/image_url/
// video_url/audio_url items with roles], resolution?, ratio?, duration?,
// generate_audio?, seed?, watermark?, camera_fixed?, return_last_frame?,
// service_tier?, callback_url?} (flat params, prompt as a content text item,
// no metadata wrapper) — and receive the official response shapes: submit
// {id, model, status}, poll the task object {id, status(queued/running/
// succeeded/failed), content:{video_url, last_frame_url?}, usage?,
// resolution?, duration?, error?}. Both surfaces share one task store: a task
// submitted through either route polls through either route. The decode
// carries every official parameter on the internal metadata; each dialect's
// driver forwards the subset its upstream supports.

export const meta = {
  apiVersion: 1,
  key: "seedance",
  name: "Seedance Video (Wasu + TelecomJS + MaiCang + Stelloria + PGY)",
  icon: "text:SD",
  description: {
    en: "Doubao Seedance video generation through the Wasu, TelecomJS, MaiCang, Stelloria, and PGY gateways — five upstream dialects behind one plugin, for channels of type 101 through 105",
    zh: "豆包 Seedance 视频生成，一个插件支持华数、江苏电信、麦仓、星瞳、蒲公英五条上游方言（渠道类型 101–105）",
  },
  version: "1.2.0",
  author: { name: "QuantumNous" },
  // Owns channel types 101 (maicang), 102 (stelloria), 103 (pgy-seedance),
  // 104 (wasu) and 105 (telecomjs); a channel of any of these types auto-binds
  // to this plugin via GetByChannelType, so every vendor channel on one
  // gateway shares a single plugin and the mapped model name picks the
  // dialect. A type-59/61 (TaskPlugin) channel can bind by task_plugin_key,
  // and a type-60 (New API) channel binds it through the channel's task plugin
  // setting (SupportsUpstream("new_api") below).
  channelTypes: [101, 102, 103, 104, 105],
  models: [
    "doubao-seedance-2.0",
    "doubao-seedance-2.0-fast",
    "doubao-seedance-2.0-mini",
    "doubao-seedance-2-5-betydance",
    "doubao-seedance-2-0-260128-betydance",
    "doubao-seedance-2-0-fast-260129-betydance",
    "doubao-seedance-2-0-mini-260616-betydance",
    "tipdance-2-5-pro",
    "tipdance-2-5-pro-inel",
    "tipdance-2-0-pro",
    "tipdance-2-0-pro-intl",
    "tipdance-2-0-fast",
    "tipdance-2-0-fast-intl",
    "tipdance-2-0-mini",
    "tipdance-2-0-mini-intl",
    "seedance-2.0",
    "Wonder-Pro",
    "pgy-seedance-2.0",
  ],
  fetchMode: "per_task",
  // Vendor (dedicated channels and TaskPlugin channels) plus New API gateways
  // chaining this plugin through a type-60 channel.
  upstreams: ["vendor", "new_api"],
  usageSchema: {
    tokens: {
      type: "number",
      unit: "token",
      description: {
        en: "Estimated billing tokens (Seedance formula: seconds × width × height × 24 / 1024); completion settles the bill with the upstream-reported figures when available.",
        zh: "预估计费 token（Seedance 公式：秒 × 宽 × 高 × 24 / 1024）；上游回报真实数据时完成结算会覆盖预估值。",
      },
    },
    duration: {
      type: "number",
      unit: "second",
      description: {
        en: "Output video duration in seconds. Requests that omit it default to 5s, except the TelecomJS 2.5 tier which defaults to 10s; Stelloria only offers 5s or 10s.",
        zh: "输出视频时长（秒）。不传时默认 5 秒；电信 2.5 档默认 10 秒；星瞳仅支持 5 或 10 秒。",
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
        en: "Output video resolution tier. 4k is supported by the 2.0 standard tiers; fast/mini tiers cap at 720p; the 2.5 tier caps at 1080p; the Stelloria models offer 720p and above.",
        zh: "输出视频分辨率档位。4k 仅 2.0 标准版支持；fast/mini 档上限 720p；2.5 档上限 1080p；星瞳系模型仅提供 720p 及以上。",
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
  // max-pixel dimensions. 五个网关底层都是官方 seedance（星瞳的报错与模型
  // 族、电信的报错都直指 doubao-seedance），定价完全参考 doubao seedance
  // 价格表：videoInputRatio 按 model 档（2-5/2-0/fast/mini）+ resolution
  // （含 4k）+ 参考视频输入(v2v) 算折扣 ratio，billing_ratios 返回
  // {video_input_ratio} 或 null（ratio=1 时）。
  usageExamples: [
    { label: "480p · 5s", facts: { tokens: 48038, duration: 5, resolution: "480p", video_input: "none" } },
    { label: "720p · 5s", facts: { tokens: 108000, duration: 5, resolution: "720p", video_input: "none" } },
    { label: "1080p · 5s", facts: { tokens: 243000, duration: 5, resolution: "1080p", video_input: "none" } },
    { label: "4k · 5s", facts: { tokens: 972000, duration: 5, resolution: "4k", video_input: "none" } },
    { label: "4k · 5s (视频输入)", facts: { tokens: 972000, duration: 5, resolution: "4k", video_input: "video" } },
    { label: "720p · 10s", facts: { tokens: 216000, duration: 10, resolution: "720p", video_input: "none" } },
    { label: "1080p · 10s (电信 2.5 档默认时长)", facts: { tokens: 486000, duration: 10, resolution: "1080p", video_input: "none" } },
    { label: "1080p · 5s (视频输入)", facts: { tokens: 243000, duration: 5, resolution: "1080p", video_input: "video" } },
  ],
  // One usage profile per capability shape: each model tier lists only the
  // resolutions it offers, with per-profile display examples. 2.5 caps at
  // 1080p (电信侧已实测拒 4k), the 2.0 standard tiers add 4k, fast/mini cap
  // at 480p/720p, the Stelloria models offer 720p/1080p/4k and Wonder-Pro
  // carries no reference-video pricing (官方 Seedance 能力矩阵).
  usageProfiles: seedanceUsageProfiles(),
  routes: [
    { method: "POST", path: "/seedance/v1/video/generations", type: "submit", decode: "createTask", render: "taskCreated" },
    { method: "GET", path: "/seedance/v1/video/generations/:task_id", type: "query", render: "taskStatus" },
    { method: "POST", path: "/seedance/v3/contents/generations/tasks", type: "submit", decode: "createArkTask", render: "arkTaskCreated" },
    { method: "GET", path: "/seedance/v3/contents/generations/tasks/:task_id", type: "query", render: "arkTaskStatus" },
  ],
  protocols: [{ name: "openai_responses", supports: ["stream", "sync", "background"] }, "openai_video"],
};

// ---- Shared helpers ---------------------------------------------------------

function trimmed(value) {
  return String(value || "").trim();
}

// Another New API gateway serves this plugin only on its prefixed native
// routes; every vendor API serves the unprefixed paths.
function apiRoot(ctx) {
  return ctx.baseUrl + (ctx.upstream && ctx.upstream.kind === "new_api" ? "/seedance" : "");
}

// Separator-normalized model name every tier/dialect lookup agrees on, so
// "doubao-seedance-2.0" (dotted) and "doubao-seedance-2-0-260128" (hyphenated
// with build date) map to the same tier.
function normalizedModelName(ctx) {
  var req = (ctx && ctx.requestBody) || {};
  return trimmed((ctx && (ctx.upstreamModel || ctx.model)) || req.model).toLowerCase().replace(/[._]/g, "-");
}

// Vendor dialect for the executing channel. The channel type is
// authoritative when the host provides it — types 101-105 map 1:1 to the
// five gateways (101 MaiCang, 102 Stelloria, 103 PGY, 104 Wasu, 105
// TelecomJS), so a channel serving model names outside its family still
// speaks its own wire protocol. A missing/zero type (older hosts omit the
// field) or any other type (61 generic Task Plugin channel whose upstream
// vendor the model mapping decides, 60 New API chain) falls back to the
// model-name family: *-betydance resells via TelecomJS, tipdance-* via
// MaiCang, pgy-* via the PGY relay, seedance-2.* and Wonder-* via
// Stelloria, and the plain doubao-seedance-* names via Wasu. Chain mode
// ignores the dialect — the gateway-to-gateway body is uniform.
// ctx.channelId is gateway-internal and never persisted.
function dialectOf(ctx) {
  var t = Number(ctx && ctx.channelType) || 0;
  if (t === 101) return "maicang";
  if (t === 102) return "stelloria";
  if (t === 103) return "pgy";
  if (t === 104) return "wasu";
  if (t === 105) return "telecomjs";
  var m = normalizedModelName(ctx);
  if (/-betydance$/.test(m)) return "telecomjs";
  if (m.indexOf("tipdance-") === 0) return "maicang";
  if (m.indexOf("pgy-") === 0) return "pgy";
  if (m.indexOf("wonder") === 0) return "stelloria";
  if (m.indexOf("seedance-2") === 0) return "stelloria";
  return "wasu";
}

// Vendor label for protocol render metadata ("seedance" when no model is in
// context to inspect).
function vendorLabel(ctx) {
  var m = normalizedModelName(ctx);
  if (!m) return "seedance";
  return dialectOf(ctx);
}

// Doubao price-table tier a model name belongs to: 2-5 / 2-0 / fast / mini, or
// "wonder" (no reference-video pricing). fast/mini are checked before the
// 2-0 standard prefix so dated ids still match their tier.
function seedanceTier(model) {
  var m = trimmed(model).toLowerCase().replace(/[._]/g, "-");
  if (m.indexOf("wonder") === 0) return "wonder";
  if (m.indexOf("tipdance-2-0-fast") === 0) return "fast";
  if (m.indexOf("tipdance-2-0-mini") === 0) return "mini";
  if (m.indexOf("doubao-seedance-2-0-fast") === 0) return "fast";
  if (m.indexOf("doubao-seedance-2-0-mini") === 0) return "mini";
  if (m.indexOf("tipdance-2-5") === 0) return "2-5";
  if (m.indexOf("tipdance-2-0") === 0) return "2-0";
  if (m.indexOf("doubao-seedance-2-5") === 0) return "2-5";
  if (m.indexOf("doubao-seedance-2-0") === 0) return "2-0";
  if (m.indexOf("seedance-2") === 0) return "2-0";
  if (m.indexOf("pgy-") === 0) return "2-0";
  return "";
}

// Seedance capability matrix by model tier (能力矩阵，非价格): the output
// resolutions the tier offers, whether reference-video input is priced
// separately, and the duration the upstream applies when a request omits it
// (verified live: TelecomJS 2.5 defaults to 10s, everything else to 5s —
// MaiCang's 2.5 included). The Stelloria aliases offer no 480p tier. Returns
// null for names without a known tier.
function knownTierProfile(model) {
  var m = trimmed(model).toLowerCase().replace(/[._]/g, "-");
  var tier = seedanceTier(m);
  if (!tier) return null;
  if (tier === "wonder") return { resolutions: ["720p", "1080p", "4k"], videoInput: false, defaultSeconds: 5 };
  if (tier === "fast" || tier === "mini") return { resolutions: ["480p", "720p"], videoInput: true, defaultSeconds: 5 };
  if (tier === "2-5") return { resolutions: ["480p", "720p", "1080p"], videoInput: true, defaultSeconds: m.indexOf("tipdance-") === 0 ? 5 : 10 };
  if (m.indexOf("seedance-2") === 0) return { resolutions: ["720p", "1080p", "4k"], videoInput: true, defaultSeconds: 5 };
  return { resolutions: ["480p", "720p", "1080p", "4k"], videoInput: true, defaultSeconds: 5 };
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

// Duration the upstream applies (and the estimate bills) when a request omits
// it: Wasu and MaiCang apply 5s across their tiers; TelecomJS applies the tier
// default (10s on 2.5, 5s on the 2.0 family); Stelloria only offers 5s/10s.
function effectiveDefaultSeconds(ctx) {
  var profile = videoProfile(ctx);
  return dialectOf(ctx) === "telecomjs" ? profile.defaultSeconds : 5;
}

// Resolution tier for the submit estimate: the requested tier or the tier of
// a WxH size, rejecting tiers the model does not offer (before any quota is
// reserved). A request that leaves the resolution to the upstream reserves the
// model's highest tier up to 1080p on the TelecomJS dialect (the poll body
// reports the delivered resolution, so completion settles the estimate);
// every other dialect bills the official 720p default tier instead.
function videoResolution(ctx) {
  var req = ctx.requestBody || {};
  var metadata = req.metadata || {};
  var raw = trimmed(
    metadata.resolution !== undefined ? metadata.resolution : req.resolution !== undefined ? req.resolution : req.size
  ).toLowerCase();
  var recognized = ["480p", "720p", "1080p", "4k"].indexOf(raw) >= 0 || raw.replace("*", "x").split("x").length === 2;
  var profile = videoProfile(ctx);
  if (!recognized) {
    if (dialectOf(ctx) === "telecomjs") return profile.resolutions.indexOf("1080p") >= 0 ? "1080p" : profile.resolutions[profile.resolutions.length - 1];
    return "720p";
  }
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
        en: "Estimated billing tokens (Seedance formula: seconds × width × height × 24 / 1024); completion settles the bill with the upstream-reported figures when available.",
        zh: "预估计费 token（Seedance 公式：秒 × 宽 × 高 × 24 / 1024）；上游回报真实数据时完成结算会覆盖预估值。",
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
// offered tier plus the reference-video variant, and the tier's default
// duration when it differs from 5s.
function usageExamplesForProfile(profile) {
  var specs = [];
  for (var i = 0; i < profile.resolutions.length; i++) {
    specs.push({ label: profile.resolutions[i] + " · 5s", resolution: profile.resolutions[i], seconds: 5 });
  }
  var base = profile.resolutions.indexOf("720p") >= 0 ? "720p" : profile.resolutions[0];
  if (profile.videoInput) specs.push({ label: base + " · 5s (视频输入)", resolution: base, seconds: 5, video_input: "video" });
  if (profile.defaultSeconds !== 5) specs.push({ label: base + " · " + profile.defaultSeconds + "s (默认时长)", resolution: base, seconds: profile.defaultSeconds });
  return specs.map(function (spec) {
    var facts = { tokens: Math.round(estimateTokens(spec.seconds, spec.resolution)), duration: spec.seconds, resolution: spec.resolution };
    if (profile.videoInput) facts.video_input = spec.video_input || "none";
    return { label: spec.label, facts: facts };
  });
}

// One usage profile per declared model tier (capability shape). Vendors of
// the same shape stay separate when their duration defaults differ (the
// TelecomJS 2.5 tier defaults to 10s, MaiCang's to 5s).
function seedanceUsageProfiles() {
  var tiers = [
    { models: ["doubao-seedance-2.0"], resolutions: ["480p", "720p", "1080p", "4k"], videoInput: true, defaultSeconds: 5 },
    { models: ["doubao-seedance-2.0-fast", "doubao-seedance-2.0-mini"], resolutions: ["480p", "720p"], videoInput: true, defaultSeconds: 5 },
    { models: ["doubao-seedance-2-5-betydance"], resolutions: ["480p", "720p", "1080p"], videoInput: true, defaultSeconds: 10 },
    { models: ["doubao-seedance-2-0-260128-betydance"], resolutions: ["480p", "720p", "1080p", "4k"], videoInput: true, defaultSeconds: 5 },
    {
      models: ["doubao-seedance-2-0-fast-260129-betydance", "doubao-seedance-2-0-mini-260616-betydance"],
      resolutions: ["480p", "720p"],
      videoInput: true,
      defaultSeconds: 5,
    },
    { models: ["tipdance-2-5-pro", "tipdance-2-5-pro-inel"], resolutions: ["480p", "720p", "1080p"], videoInput: true, defaultSeconds: 5 },
    { models: ["tipdance-2-0-pro", "tipdance-2-0-pro-intl"], resolutions: ["480p", "720p", "1080p", "4k"], videoInput: true, defaultSeconds: 5 },
    {
      models: ["tipdance-2-0-fast", "tipdance-2-0-fast-intl", "tipdance-2-0-mini", "tipdance-2-0-mini-intl"],
      resolutions: ["480p", "720p"],
      videoInput: true,
      defaultSeconds: 5,
    },
    { models: ["seedance-2.0"], resolutions: ["720p", "1080p", "4k"], videoInput: true, defaultSeconds: 5 },
    { models: ["Wonder-Pro"], resolutions: ["720p", "1080p", "4k"], videoInput: false, defaultSeconds: 5 },
    { models: ["pgy-seedance-2.0"], resolutions: ["480p", "720p", "1080p", "4k"], videoInput: true, defaultSeconds: 5 },
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

// Normalize any resolution input to a supported tier; WxH sizes map by their
// larger dimension, anything unrecognized falls back to the 720p tier.
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
// and missing values bill the effective tier default (the upstream applies
// the same default); cap at 3600.
function normalizeSeconds(value, defaultSeconds) {
  var n = Number(value);
  if (!Number.isFinite(n) || n < 0) return defaultSeconds;
  return Math.min(Math.floor(n), 3600);
}

// Stelloria only offers 5s or 10s outputs; anything else coerces to the 5s
// default (mirroring the standalone Stelloria plugin).
function stellariaDuration(value) {
  return Number(value) === 10 ? 10 : 5;
}

// Parse a completion duration that may carry a unit suffix ("10s" -> 10).
function parseDurationText(value) {
  var n = Number(String(value || "").replace(/\s*s$/i, ""));
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

// Wonder-Pro's AspectRatio: 16:9 / 9:16 / 1:1, with friendly word aliases.
function normalizeAspectRatio(value) {
  var raw = trimmed(value).toLowerCase().replace(/\s+/g, "");
  if (raw === "9:16" || raw === "16:9" || raw === "1:1") return raw;
  if (raw === "portrait" || raw === "vertical") return "9:16";
  if (raw === "square") return "1:1";
  return "16:9";
}

// Extract a URL string from a single media-shaped value (string | {url} |
// {image_url} | {image_url:{url}} | {video_url} | {video_url:{url}} |
// {audio_url} | {audio_url:{url}}).
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
    var au = item.audio_url;
    if (au && typeof au === "object") return trimmed(au.url);
    if (typeof au === "string") return trimmed(au);
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
// input). Mirrors doubao/stelloria/pgy-seedance/wasu/telecomjs for consistent
// v2v billing.
function hasVideo(content) {
  if (!Array.isArray(content)) return false;
  for (var i = 0; i < content.length; i++) {
    var item = content[i];
    if (!item || typeof item !== "object") continue;
    if (item.type === "video_url" || Object.prototype.hasOwnProperty.call(item, "video_url")) return true;
  }
  return false;
}

// Which upstream shape a stored body speaks:
//   * "wasu"    — the {code, message, data:{status UPPERCASE, ...}} envelope;
//   * "wrapped" — a task-shaped object one level inside data (MaiCang's
//                 defensive wrap: data:{task_id, status lower, ...});
//   * "flat"    — everything else: the TelecomJS/MaiCang/Stelloria/PGY vendor
//                 bodies (lowercase top-level status) and this plugin's own
//                 native render output (the gateway-normalized contract), so
//                 the flat parser covers them all.
function pollBodyKind(body) {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    var data = body.data;
    if (data && typeof data === "object" && !Array.isArray(data) && typeof data.status === "string") {
      return ["NOT_START", "QUEUED", "IN_PROGRESS", "SUCCESS", "FAILURE"].indexOf(data.status) >= 0 ? "wasu" : "wrapped";
    }
  }
  return "flat";
}

// The poll body is stored on task.data; it is the raw vendor poll response on
// the executing gateway, or the upstream gateway's native render output when
// chained. A MaiCang-style wrap is unwrapped for the artifact readers.
function storedBody(ctxOrTask) {
  var d = (ctxOrTask && ctxOrTask.data) || {};
  if (pollBodyKind(d) === "wrapped") {
    var inner = d.data && typeof d.data === "object" && !Array.isArray(d.data) ? d.data : {};
    if (inner.task_id) return inner;
  }
  return d;
}

// Read the generated video URL from any poll body shape: Wasu's
// data.result_url (a signed temporary URL), TelecomJS/PGY's content.video_url,
// Stelloria's result.video_url, MaiCang's data:[{url}] array, or the
// result_url/video_url fields this plugin's native render lifts to the top.
function resultUrlFromBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  if (trimmed(body.result_url)) return trimmed(body.result_url);
  if (trimmed(body.video_url)) return trimmed(body.video_url);
  if (Array.isArray(body.data)) {
    for (var i = 0; i < body.data.length; i++) {
      var arrUrl = mediaUrlOf(body.data[i]);
      if (arrUrl) return arrUrl;
    }
    return "";
  }
  var data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
  if (trimmed(data.result_url)) return trimmed(data.result_url);
  var content = body.content && typeof body.content === "object" && !Array.isArray(body.content) ? body.content : {};
  if (trimmed(content.video_url)) return trimmed(content.video_url);
  var result = body.result && typeof body.result === "object" && !Array.isArray(body.result) ? body.result : {};
  if (trimmed(result.video_url)) return trimmed(result.video_url);
  var inner = data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : {};
  var innerContent = inner.content && typeof inner.content === "object" && !Array.isArray(inner.content) ? inner.content : {};
  return trimmed(innerContent.video_url);
}

// URL of one artifact key: the video itself, Stelloria's cover image, or
// PGY's last-frame image.
function artifactUrlFromBody(body, key) {
  if (!key || key === "video") return resultUrlFromBody(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  if (key === "cover") {
    var result = body.result && typeof body.result === "object" && !Array.isArray(body.result) ? body.result : {};
    return trimmed(result.cover_url);
  }
  if (key === "last_frame") {
    var content = body.content && typeof body.content === "object" && !Array.isArray(body.content) ? body.content : {};
    return trimmed(content.last_frame_url);
  }
  return "";
}

// Inspect a Stelloria `content` array and derive the generation action from
// its material.
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

// Validate a Stelloria content array against the upstream material limits
// (9 reference images, 3 videos, 3 audios, 1 each first/last frame, at least
// one text item or a piece of reference material).
function validateStellariaContent(content) {
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

// ---- Official Ark-surface helpers -------------------------------------------

// Usage tokens from any poll shape, in the official field naming; undefined
// when the poll body carries no usage object (Stelloria).
function arkUsageFromBody(body) {
  var usage = {};
  if (pollBodyKind(body) === "wasu") {
    var data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
    var inner = data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : {};
    usage = inner.usage || {};
  } else if (body.usage && typeof body.usage === "object") {
    usage = body.usage;
  } else if (body.data && typeof body.data === "object" && body.data.usage && typeof body.data.usage === "object") {
    usage = body.data.usage;
  }
  var completion = Number(usage.completion_tokens || 0);
  var total = Number(usage.total_tokens || 0);
  var hasCompletion = Number.isFinite(completion) && completion > 0;
  var hasTotal = Number.isFinite(total) && total > 0;
  if (!hasCompletion && !hasTotal) return undefined;
  var out = {};
  if (hasCompletion) out.completion_tokens = completion;
  if (hasTotal) out.total_tokens = total;
  return out;
}

// Failure reason from any poll shape.
function arkFailReasonFromBody(body) {
  if (pollBodyKind(body) === "wasu") {
    var data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
    return trimmed(data.fail_reason);
  }
  var error = body.error && typeof body.error === "object" ? body.error : {};
  return trimmed(error.message) || trimmed(body.reason) || trimmed(body.fail_reason);
}

// Delivered resolution tier, when the poll body reports one.
function arkResolutionFromBody(body) {
  var usage = body.usage && typeof body.usage === "object" ? body.usage : {};
  var result = body.result && typeof body.result === "object" && !Array.isArray(body.result) ? body.result : {};
  var content = body.content && typeof body.content === "object" && !Array.isArray(body.content) ? body.content : {};
  var resolution = trimmed(usage.SR || body.resolution || content.resolution || result.resolution).toLowerCase();
  return ["480p", "720p", "1080p", "4k"].indexOf(resolution) >= 0 ? resolution : "";
}

// Delivered duration, when the poll body reports one (values may carry an
// "s" suffix).
function arkDurationFromBody(body) {
  var usage = body.usage && typeof body.usage === "object" ? body.usage : {};
  var result = body.result && typeof body.result === "object" && !Array.isArray(body.result) ? body.result : {};
  var duration = parseDurationText(usage.duration !== undefined ? usage.duration : result.duration !== undefined ? result.duration : body.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
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
    var metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? Object.assign({}, body.metadata) : {};
    // Promote the flat conveniences a native caller (or a chained downstream)
    // may send at the top level into metadata, so duration/resolution/ratio
    // survive the internal request shape the driver rebuilds from.
    if (metadata.duration === undefined && body.duration !== undefined) metadata.duration = body.duration;
    else if (metadata.duration === undefined && body.seconds !== undefined) metadata.duration = body.seconds;
    if (metadata.resolution === undefined && body.resolution !== undefined) metadata.resolution = body.resolution;
    else if (metadata.resolution === undefined && body.size !== undefined) metadata.resolution = normalizeResolution(body.size);
    if (metadata.ratio === undefined && body.ratio !== undefined) metadata.ratio = body.ratio;
    if (metadata.aspect_ratio === undefined && body.aspect_ratio !== undefined) metadata.aspect_ratio = body.aspect_ratio;
    if (metadata.generate_audio === undefined && body.generate_audio !== undefined) metadata.generate_audio = body.generate_audio;
    if (metadata.seed === undefined && body.seed !== undefined) metadata.seed = body.seed;
    if (metadata.watermark === undefined && body.watermark !== undefined) metadata.watermark = body.watermark;
    if (metadata.frames === undefined && body.frames !== undefined) metadata.frames = body.frames;
    if (metadata.camera_fixed === undefined && body.camera_fixed !== undefined) metadata.camera_fixed = body.camera_fixed;
    if (metadata.return_last_frame === undefined && body.return_last_frame !== undefined) metadata.return_last_frame = body.return_last_frame;
    if (metadata.callback_url === undefined && body.callback_url !== undefined) metadata.callback_url = body.callback_url;
    if (metadata.service_tier === undefined && body.service_tier !== undefined) metadata.service_tier = body.service_tier;
    if (metadata.fps === undefined && body.fps !== undefined) metadata.fps = body.fps;
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
    var out;
    if (pollBodyKind(body) === "wasu") {
      var data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
      var upperMap = {
        NOT_START: "queued",
        QUEUED: "queued",
        IN_PROGRESS: "processing",
        SUCCESS: "completed",
        FAILURE: "failed",
      };
      var status = upperMap[data.status] || "processing";
      out = Object.assign({}, data, { id: task.task_id, task_id: task.task_id, status: status });
      var wasuUrl = resultUrlFromBody(body);
      if (wasuUrl) {
        out.result_url = wasuUrl;
        out.video_url = wasuUrl;
      }
      if (data.fail_reason) out.error = { code: "task_failed", message: data.fail_reason };
      return out;
    }
    if (pollBodyKind(body) === "wrapped") body = storedBody(body);
    var lowerMap = {
      pending: "queued",
      queued: "queued",
      not_start: "queued",
      running: "processing",
      processing: "processing",
      in_progress: "processing",
      succeeded: "completed",
      success: "completed",
      completed: "completed",
      failed: "failed",
      expired: "failed",
      cancelled: "failed",
    };
    var flatStatus = lowerMap[String(body.status || "").toLowerCase()] || "processing";
    out = Object.assign({}, body, { id: task.task_id, task_id: task.task_id, status: flatStatus });
    var videoUrl = resultUrlFromBody(body);
    if (videoUrl) {
      out.result_url = videoUrl;
      out.video_url = videoUrl;
    }
    if (flatStatus === "failed")
      out.error = { code: "task_failed", message: (body.error && body.error.message) || body.reason || body.fail_reason || "task failed" };
    return out;
  },
  // Official Ark-format submit decode: the Volcengine-native request with the
  // prompt and reference material inside a content array and the generation
  // parameters flat at the top level (no metadata wrapper, no top-level
  // prompt). Normalized into the plugin's internal request shape so both
  // surfaces share one task pipeline; the driver forwards the parameter
  // subset each upstream supports.
  createArkTask: function (ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    var body = ctx.body.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("request body must be an object");
    var model = trimmed(body.model);
    if (!model) throw new Error("model is required");
    if (!Array.isArray(body.content) || body.content.length === 0)
      throw new Error("content is required and must be a non-empty array");
    var texts = [];
    var reference = [];
    for (var i = 0; i < body.content.length; i++) {
      var item = body.content[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("content items must be objects");
      if (item.type === "text") {
        if (typeof item.text !== "string") throw new Error("text content items require a string text field");
        if (trimmed(item.text)) texts.push(trimmed(item.text));
        continue;
      }
      if (item.type === "image_url" || item.type === "video_url" || item.type === "audio_url") {
        if (!mediaUrlOf(item)) throw new Error(item.type + " content items require a " + item.type + ".url field");
        reference.push(item);
        continue;
      }
      throw new Error("unsupported content item type: " + item.type);
    }
    var prompt = texts.join("\n");
    if (!prompt && reference.length === 0) throw new Error("content must contain at least one text element or a reference material");
    var metadata = {};
    if (reference.length) metadata.content = reference;
    // Official flat generation parameters ride the internal metadata carrier
    // (plus the sibling extras the dialects understand); per-dialect
    // forwarding decides what each upstream actually receives.
    var params = [
      "resolution", "ratio", "aspect_ratio", "duration", "generate_audio", "seed",
      "watermark", "camera_fixed", "return_last_frame", "service_tier", "callback_url", "frames", "fps",
    ];
    for (var p = 0; p < params.length; p++) {
      var key = params[p];
      if (body[key] !== undefined) metadata[key] = body[key];
    }
    return {
      kind: "submit",
      model: model,
      action: reference.length ? "image_to_video" : "text_to_video",
      requestBody: { model: model, prompt: prompt, metadata: metadata },
    };
  },
  // Official submit response shape: {id, model, status:"queued"}. Official
  // Ark echoes the requested model, so the request body is the primary model
  // source (the host task view does not expose task.properties); the stored
  // upstream response and properties stay as fallbacks.
  arkTaskCreated: function (ctx, task) {
    var data = task.data && typeof task.data === "object" && !Array.isArray(task.data) ? task.data : {};
    var out = { id: task.task_id, status: "queued" };
    var ctxBody = (ctx && ctx.body) || {};
    var reqBody = ctxBody.value && typeof ctxBody.value === "object" && !Array.isArray(ctxBody.value) ? ctxBody.value : {};
    var model = trimmed(reqBody.model) || trimmed(data.model) || (task.properties ? trimmed(task.properties.origin_model_name) : "");
    if (model) out.model = model;
    return out;
  },
  // Official poll response shape: the Ark task object with lowercase
  // statuses (queued/running/succeeded/failed), content.video_url /
  // content.last_frame_url on success, usage / delivered resolution /
  // duration when reported, and error on failure.
  arkTaskStatus: function (ctx, task) {
    var body = task.data && typeof task.data === "object" && !Array.isArray(task.data) ? task.data : {};
    if (pollBodyKind(body) === "wrapped") body = storedBody(body);
    var status;
    if (pollBodyKind(body) === "wasu") {
      var data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
      var upperMap = { NOT_START: "queued", QUEUED: "queued", IN_PROGRESS: "running", SUCCESS: "succeeded", FAILURE: "failed" };
      status = upperMap[data.status] || "running";
    } else {
      var lowerMap = {
        pending: "queued",
        queued: "queued",
        not_start: "queued",
        running: "running",
        processing: "running",
        in_progress: "running",
        succeeded: "succeeded",
        success: "succeeded",
        completed: "succeeded",
        failed: "failed",
        expired: "failed",
        cancelled: "failed",
      };
      status = lowerMap[String(body.status || "").toLowerCase()] || "running";
    }
    var out = { id: task.task_id, status: status };
    var modelBody = pollBodyKind(body) === "wasu" && body.data && typeof body.data === "object" ? body.data : body;
    var model =
      modelBody.model !== undefined && trimmed(modelBody.model)
        ? trimmed(modelBody.model)
        : task.properties
          ? trimmed(task.properties.origin_model_name)
          : "";
    if (model) out.model = model;
    if (status === "succeeded") {
      var content = {};
      var videoUrl = resultUrlFromBody(body);
      if (videoUrl) content.video_url = videoUrl;
      var lastFrame = artifactUrlFromBody(body, "last_frame");
      if (lastFrame) content.last_frame_url = lastFrame;
      if (Object.keys(content).length) out.content = content;
      var usage = arkUsageFromBody(body);
      if (usage) out.usage = usage;
      var resolution = arkResolutionFromBody(body);
      if (resolution) out.resolution = resolution;
      var duration = arkDurationFromBody(body);
      if (duration) out.duration = duration;
      return out;
    }
    if (status === "failed") {
      out.error = { code: "task_failed", message: arkFailReasonFromBody(body) || "task failed" };
    }
    return out;
  },
  error: function (ctx, error) {
    return { error: { code: error.code, message: error.message } };
  },
};

// ---- Driver hooks -----------------------------------------------------------

// Build the upstream submit request, one shape per executing dialect:
//   * new_api upstream — this plugin's uniform internal shape posted to the
//     /seedance native routes of the upstream gateway;
//   * telecomjs — flat body with a canonical role-less-text content array;
//   * maicang — flat body with an images[] array and no content wire format;
//   * stelloria — flat body with a role-carrying-text content array, or the
//     PascalCase Wonder-Pro shape;
//   * pgy — Ark content-array body with the metadata spread and the
//     must-be-absent service_tier cleanup;
//   * wasu — two-layer body with metadata-wrapped params.
// The model sent upstream honors ctx.upstreamModel first (channel
// model_mapping), then the client-facing model.
export function buildSubmitRequest(ctx) {
  var req = ctx.requestBody || {};
  var model = ctx.upstreamModel || ctx.model || req.model || "";
  var metadata = Object.assign({}, req.metadata || {});
  var metadataContent = Array.isArray(metadata.content) ? metadata.content : [];
  var imageContent = [];
  var images = Array.isArray(req.images) ? req.images : [];
  for (var i = 0; i < images.length; i++) {
    var url = mediaUrlOf(images[i]);
    if (url) imageContent.push({ type: "image_url", image_url: { url: url } });
  }
  // Reject output tiers the model does not offer before any quota is
  // reserved (videoResolution throws); normalize the client's resolution
  // spelling when supplied.
  var resolutionRaw = metadata.resolution !== undefined ? metadata.resolution : req.resolution !== undefined ? req.resolution : req.size;
  var resolution = videoResolution(ctx);
  var durationRaw = req.duration !== undefined ? req.duration : req.seconds !== undefined ? req.seconds : metadata.duration;
  var headers = { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + ctx.apiKey };
  var dialect = dialectOf(ctx);

  if (ctx.upstream && ctx.upstream.kind === "new_api") {
    // Chained gateway: the internal shape is the contract. Reference material
    // rides in metadata.content (roles preserved, text items dropped — the
    // prompt travels at the top level), and the upstream gateway's own driver
    // rewrites it into the dialect of ITS executing channel.
    var chainMetadata = Object.assign({}, metadata);
    chainMetadata.content = imageContent.concat(metadataContent).filter(function (item) {
      return item && item.type !== "text";
    });
    if (resolutionRaw !== undefined) chainMetadata.resolution = resolution;
    var chainBody = { model: model, prompt: trimmed(req.prompt) || "" };
    if (durationRaw !== undefined) chainBody.duration = normalizeSeconds(durationRaw, effectiveDefaultSeconds(ctx));
    chainBody.metadata = chainMetadata;
    return {
      url: apiRoot(ctx) + "/v1/video/generations",
      method: "POST",
      headers: headers,
      body: chainBody,
      action: chainMetadata.content.length > 0 ? "image_to_video" : "text_to_video",
      rewriteModel: chainBody.model,
    };
  }

  if (dialect === "telecomjs") {
    // Flat TelecomJS body: generation params at the top level (the gateway
    // ignores them inside metadata); client content items first (roles kept),
    // then images[] merged as plain image_url items, text items dropped and
    // the prompt re-appended as a single role-less text item. The reservation
    // tier is NOT sent upstream when the client omitted the resolution — the
    // gateway applies its own default there and the completion overlay
    // settles the estimate.
    var telecomContent = [];
    for (var c = 0; c < metadataContent.length; c++) {
      var contentItem = metadataContent[c];
      if (contentItem && typeof contentItem === "object" && contentItem.type !== "text") telecomContent.push(contentItem);
    }
    for (var t = 0; t < imageContent.length; t++) telecomContent.push(imageContent[t]);
    var telecomBody = { model: model, content: telecomContent.concat([{ type: "text", text: trimmed(req.prompt) || "" }]) };
    if (resolutionRaw !== undefined) telecomBody.resolution = resolution;
    if (durationRaw !== undefined && Number(durationRaw) >= 0) telecomBody.duration = Math.min(Math.floor(Number(durationRaw)), 3600);
    var ratioRaw = metadata.ratio !== undefined ? metadata.ratio : metadata.aspect_ratio !== undefined ? metadata.aspect_ratio : req.ratio;
    if (ratioRaw !== undefined) telecomBody.ratio = ratioRaw;
    if (metadata.generate_audio !== undefined) telecomBody.generate_audio = metadata.generate_audio;
    else if (req.generate_audio !== undefined) telecomBody.generate_audio = req.generate_audio;
    if (metadata.seed !== undefined) telecomBody.seed = metadata.seed;
    else if (req.seed !== undefined) telecomBody.seed = req.seed;
    if (metadata.watermark !== undefined) telecomBody.watermark = metadata.watermark;
    return {
      url: apiRoot(ctx) + "/v1/videos/generations",
      method: "POST",
      headers: headers,
      body: telecomBody,
      action: telecomContent.length > 0 ? "image_to_video" : "text_to_video",
      rewriteModel: telecomBody.model,
    };
  }

  if (dialect === "maicang") {
    // Flat MaiCang body with no content wire format: every image input
    // flattens into {url} objects (single image = first frame, two images =
    // first+last frame — the upstream decides framing from the array length),
    // roles ride the image count instead. Forward optional fields only when
    // the client supplied them, so the upstream keeps its own defaults.
    var maiImageUrls = [];
    for (var m1 = 0; m1 < images.length; m1++) {
      var maiUrl = mediaUrlOf(images[m1]);
      if (maiUrl && maiImageUrls.indexOf(maiUrl) < 0) maiImageUrls.push(maiUrl);
    }
    for (var m2 = 0; m2 < metadataContent.length; m2++) {
      var maiItem = metadataContent[m2];
      if (maiItem && typeof maiItem === "object" && (maiItem.type === "image_url" || Object.prototype.hasOwnProperty.call(maiItem, "image_url"))) {
        var maiContentUrl = mediaUrlOf(maiItem);
        if (maiContentUrl && maiImageUrls.indexOf(maiContentUrl) < 0) maiImageUrls.push(maiContentUrl);
      }
    }
    var maiImages = [];
    for (var m3 = 0; m3 < maiImageUrls.length; m3++) maiImages.push({ url: maiImageUrls[m3] });
    var maiBody = { model: model };
    var maiPrompt = trimmed(req.prompt);
    if (maiPrompt) maiBody.prompt = maiPrompt;
    if (maiImages.length) maiBody.images = maiImages;
    if (resolutionRaw !== undefined) maiBody.resolution = resolution;
    if (durationRaw !== undefined) maiBody.duration = normalizeSeconds(durationRaw, 5);
    if (req.generate_audio !== undefined) maiBody.generate_audio = !!req.generate_audio;
    else if (metadata.generate_audio !== undefined) maiBody.generate_audio = !!metadata.generate_audio;
    return {
      url: apiRoot(ctx) + "/v1/video/generations",
      method: "POST",
      headers: headers,
      body: maiBody,
      action: maiImages.length ? "image_to_video" : "text_to_video",
      rewriteModel: maiBody.model,
    };
  }

  if (dialect === "stelloria") {
    // Stelloria: the Seedance-family body is flat with a content array whose
    // text items CARRY role:"text" (the opposite of TelecomJS) — the prompt
    // text item leads, top-level images[] become first_frame/reference_image
    // roles, client content items keep their roles. Optional generation params
    // pass through at the top level. Wonder-Pro instead ignores content and
    // needs the PascalCase {Prompt, Duration, AspectRatio, Resolution} shape
    // with a single reference image.
    var stellariaModel = trimmed(normalizedModelName(ctx));
    if (stellariaModel.indexOf("wonder") === 0) {
      var wonderImages = requestImages(req);
      var wonderBody = {
        model: model,
        Prompt: trimmed(req.prompt) || "",
        Duration: String(stellariaDuration(durationRaw)),
        AspectRatio: normalizeAspectRatio(req.aspect_ratio || req.ratio || metadata.aspect_ratio || metadata.ratio),
        Resolution: resolution,
      };
      if (wonderImages.length) wonderBody.image_url = wonderImages[0];
      if (req.seed !== undefined) wonderBody.seed = req.seed;
      else if (metadata.seed !== undefined) wonderBody.seed = metadata.seed;
      return {
        url: apiRoot(ctx) + "/v1/videos/generations",
        method: "POST",
        headers: headers,
        body: wonderBody,
        action: wonderImages.length ? "image_to_video" : "text_to_video",
        rewriteModel: wonderBody.model,
      };
    }
    var stellariaContent = [];
    var stellariaPrompt = trimmed(req.prompt);
    if (stellariaPrompt) stellariaContent.push({ type: "text", text: stellariaPrompt, role: "text" });
    for (var s1 = 0; s1 < imageContent.length; s1++) {
      stellariaContent.push({ type: "image_url", image_url: imageContent[s1].image_url, role: s1 === 0 ? "first_frame" : "reference_image" });
    }
    for (var s2 = 0; s2 < metadataContent.length; s2++) {
      var stellariaItem = metadataContent[s2];
      if (stellariaItem && typeof stellariaItem === "object" && stellariaItem.type !== "text") stellariaContent.push(stellariaItem);
    }
    if (stellariaContent.length === 0) stellariaContent.push({ type: "text", text: "", role: "text" });
    validateStellariaContent(stellariaContent);
    var stellariaBody = { model: model, content: stellariaContent };
    ["resolution", "duration", "ratio", "aspect_ratio", "generate_audio", "seed", "watermark", "fps"].forEach(function (key) {
      var value = req[key];
      if (value === undefined && metadata[key] !== undefined) value = metadata[key];
      if (value !== undefined) stellariaBody[key] = value;
    });
    return {
      url: apiRoot(ctx) + "/v1/videos/generations",
      method: "POST",
      headers: headers,
      body: stellariaBody,
      action: req.action || actionFromContent(stellariaContent),
      rewriteModel: stellariaBody.model,
    };
  }

  if (dialect === "pgy") {
    // PGY Ark-style body: the metadata spreads into the top level (so
    // resolution/ratio/serviceTier/frames ride along), content rebuilds from
    // images[] plus client content items with the prompt re-appended as a
    // text item, and the upstream model is the channel-mapped name or the
    // relay's canonical doubao-seedance-2.0. The Mobile Cloud platform
    // rejects a `service_tier` key that is present-but-empty in t2v mode, so
    // null/empty values are removed entirely.
    var pgyBody = Object.assign({ model: model || "doubao-seedance-2.0", content: [] }, metadata);
    var pgyContent = imageContent
      .concat(Array.isArray(pgyBody.content) ? pgyBody.content : [])
      .filter(function (item) { return item && item.type !== "text"; });
    var pgyHasReference = pgyContent.length > 0;
    pgyBody.content = pgyContent;
    if (trimmed(req.prompt) || !pgyHasReference) pgyBody.content.push({ type: "text", text: trimmed(req.prompt) || "" });
    var pgySeconds = Number(durationRaw);
    if (Number.isFinite(pgySeconds) && pgySeconds > 0) pgyBody.duration = pgySeconds;
    pgyBody.model = model || "doubao-seedance-2.0";
    if (pgyBody.serviceTier === null || pgyBody.serviceTier === undefined || trimmed(pgyBody.serviceTier) === "") {
      delete pgyBody.serviceTier;
    }
    // The snake_case spelling official-format clients send gets the same
    // cleanup, so an empty service_tier cannot trip the t2v restriction
    // either.
    if (pgyBody.service_tier === null || pgyBody.service_tier === undefined || trimmed(pgyBody.service_tier) === "") {
      delete pgyBody.service_tier;
    }
    return {
      url: apiRoot(ctx) + "/api/v3/contents/generations/tasks",
      method: "POST",
      headers: headers,
      body: pgyBody,
      action: pgyHasReference ? "image_to_video" : "text_to_video",
      rewriteModel: pgyBody.model,
    };
  }

  // Wasu two-layer body: prompt and duration at the top level, generation
  // params and reference material inside metadata (resolution/ratio MUST go
  // via metadata; top-level values are ignored). images[] merge ahead of
  // client content items, and text items are dropped (the upstream appends
  // the prompt as a text item itself).
  var wasuMetadata = Object.assign({}, metadata);
  wasuMetadata.content = imageContent.concat(metadataContent).filter(function (item) {
    return item && item.type !== "text";
  });
  if (resolutionRaw !== undefined) wasuMetadata.resolution = resolution;
  var wasuBody = { model: model, prompt: trimmed(req.prompt) || "" };
  if (durationRaw !== undefined) wasuBody.duration = normalizeSeconds(durationRaw, effectiveDefaultSeconds(ctx));
  wasuBody.metadata = wasuMetadata;
  return {
    url: apiRoot(ctx) + "/v1/video/generations",
    method: "POST",
    headers: headers,
    body: wasuBody,
    action: wasuMetadata.content.length > 0 ? "image_to_video" : "text_to_video",
    rewriteModel: wasuBody.model,
  };
}

// The submit response carries the task id as output.task_id (TelecomJS; id
// and task_id are permissive fallbacks since every gateway sets all three to
// the same value), as id (PGY's cgt-* ids), or as task_id/id (Wasu, MaiCang,
// Stelloria and chained native renders).
export function parseSubmitResponse(ctx, resp) {
  if (!resp.body) throw new Error("upstream returned no body");
  var output = resp.body.output && typeof resp.body.output === "object" && !Array.isArray(resp.body.output) ? resp.body.output : {};
  var taskId = trimmed(output.task_id) || trimmed(resp.body.task_id) || trimmed(resp.body.id);
  if (!taskId) throw new Error("task_id is empty");
  return { taskId: taskId, taskData: resp.body };
}

// Per-model billing ratio mirroring the official Doubao Seedance price table,
// keyed on the price-table tier the model name belongs to. 五个网关底层都是
// 官方 seedance（电信报错直指 doubao-seedance、星瞳同款模型同价），video-to-
// video (参考视频输入) 享更低单价；Wonder-Pro takes no reference-video input.
function videoInputRatio(model, resolution, content) {
  var video = hasVideo(content);
  var res = trimmed(resolution).toLowerCase();
  var tier = seedanceTier(model);
  if (tier === "2-5") {
    if (res === "1080p") return video ? 7.0 / 10.7 : 11.7 / 10.7;
    return video ? 42 / 70 : 1;
  }
  if (tier === "fast") return video ? 22 / 37 : 1;
  if (tier === "mini") return video ? 14 / 23 : 1;
  if (tier === "2-0") {
    if (res === "1080p") return video ? 31 / 46 : 51 / 46;
    if (res === "4k") return video ? 16 / 46 : 26 / 46;
    return video ? 28 / 46 : 1;
  }
  return 1;
}

// Duration the submit estimate bills, per dialect: the generic Seedance
// default (5s, 10s on the TelecomJS 2.5 tier, -1 smart duration included),
// Stelloria's 5-or-10 coercion, or PGY's frames/24 fallback.
function estimateSeconds(ctx) {
  var req = ctx.requestBody || {};
  var metadata = req.metadata || {};
  var raw = req.duration !== undefined ? req.duration : req.seconds !== undefined ? req.seconds : metadata.duration;
  if (dialectOf(ctx) === "stelloria") return stellariaDuration(raw);
  if (dialectOf(ctx) === "pgy") {
    var seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(Math.floor(seconds), 3600);
    var frames = Number(metadata.frames);
    if (Number.isFinite(frames) && frames > 0) return Math.min(Math.floor(frames / 24), 3600);
    return 5;
  }
  return normalizeSeconds(raw, effectiveDefaultSeconds(ctx));
}

export function extractUsage(ctx) {
  var req = ctx.requestBody || {};
  var metadata = req.metadata || {};
  var content = requestContent(req);
  if (ctx.usagePurpose === "billing_ratios") {
    // 五个网关底层都是官方 seedance，定价完全参考 doubao seedance 价格表。
    var ratio = videoInputRatio(ctx.upstreamModel || ctx.model || req.model, metadata.resolution, content);
    return ratio === 1 ? null : { video_input_ratio: ratio };
  }
  var profile = videoProfile(ctx);
  var seconds = estimateSeconds(ctx);
  // Unspecified resolution: the TelecomJS dialect reserves the highest tier
  // up to 1080p (the poll body reports the delivered tier, so completion
  // settles); every other dialect bills the official 720p default tier.
  var resolution = videoResolution(ctx);
  var facts = {
    tokens: estimateTokens(seconds, resolution),
    duration: seconds,
    resolution: resolution,
  };
  if (profile.videoInput) facts.video_input = hasVideo(content) ? "video" : "none";
  return facts;
}

// Poll the upstream: GET /v1/video/generations/{task_id} (Wasu and MaiCang,
// and the /seedance native route of a chained gateway), GET
// /v1/videos/generations/task/{task_id} (TelecomJS), GET /v1/tasks/{task_id}
// (Stelloria), or GET /api/v3/contents/generations/tasks/{id} (PGY).
export function buildQueryRequest(ctx) {
  var path;
  if (ctx.upstream && ctx.upstream.kind === "new_api") path = "/v1/video/generations/" + ctx.taskId;
  else if (dialectOf(ctx) === "telecomjs") path = "/v1/videos/generations/task/" + ctx.taskId;
  else if (dialectOf(ctx) === "stelloria") path = "/v1/tasks/" + ctx.taskId;
  else if (dialectOf(ctx) === "pgy") path = "/api/v3/contents/generations/tasks/" + ctx.taskId;
  else path = "/v1/video/generations/" + ctx.taskId;
  return {
    url: apiRoot(ctx) + path,
    method: "GET",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + ctx.apiKey },
  };
}

// Parse the poll response. Shape-detected, so one parser covers the Wasu
// envelope ({code, message, data:{status UPPERCASE, ...}}), the MaiCang
// wrapped variant, the flat vendor bodies of TelecomJS ({status, content:
// {video_url}, usage}), MaiCang ({status, data:[{url}], usage}), Stelloria
// ({status, result:{video_url}}) and PGY ({status, content:{video_url},
// usage}), and this plugin's own native render output (flat with normalized
// statuses queued/processing/completed/failed) should the host feed a
// chained poll through this hook. Unrecognized status strings are UNKNOWN
// per the polling contract — the host counts them as consecutive poll
// failures (do NOT fall back to IN_PROGRESS).
export function parseTaskResult(ctx, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid task result");
  var kind = pollBodyKind(body);
  if (kind === "wasu") {
    var data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
    var status = data.status;
    if (status === "NOT_START" || status === "QUEUED") return { status: "QUEUED", progress: data.progress || "0%" };
    if (status === "IN_PROGRESS") return { status: "IN_PROGRESS", progress: data.progress || "50%" };
    if (status === "SUCCESS") {
      var wasuResult = { status: "SUCCESS", progress: "100%", url: resultUrlFromBody(body) };
      var inner = data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : {};
      var wasuUsage = inner.usage || {};
      var wasuCompletion = Number(wasuUsage.completion_tokens || 0);
      var wasuTotal = Number(wasuUsage.total_tokens || 0);
      if (Number.isFinite(wasuCompletion) && wasuCompletion > 0) wasuResult.completionTokens = wasuCompletion;
      if (Number.isFinite(wasuTotal) && wasuTotal > 0) wasuResult.totalTokens = wasuTotal;
      return wasuResult;
    }
    if (status === "FAILURE") {
      return { status: "FAILURE", progress: "100%", reason: data.fail_reason || "failed" };
    }
    return { status: "UNKNOWN" };
  }
  if (kind === "wrapped") body = storedBody(body);
  var flat = String(body.status || "").toLowerCase();
  if (flat === "pending" || flat === "queued" || flat === "not_start") return { status: "QUEUED", progress: body.progress !== undefined && body.progress !== null ? String(body.progress) : "0%" };
  if (flat === "running" || flat === "processing" || flat === "in_progress") return { status: "IN_PROGRESS", progress: body.progress !== undefined && body.progress !== null ? String(body.progress) : "50%" };
  if (flat === "succeeded" || flat === "success" || flat === "completed") {
    var result = { status: "SUCCESS", progress: "100%", url: resultUrlFromBody(body) };
    var usage = {};
    if (body.usage && typeof body.usage === "object") usage = body.usage;
    else if (body.data && typeof body.data === "object" && body.data.usage && typeof body.data.usage === "object") usage = body.data.usage;
    var completionTokens = Number(usage.completion_tokens || 0);
    var totalTokens = Number(usage.total_tokens || 0);
    if (Number.isFinite(completionTokens) && completionTokens > 0) result.completionTokens = completionTokens;
    if (Number.isFinite(totalTokens) && totalTokens > 0) result.totalTokens = totalTokens;
    return result;
  }
  if (flat === "failed" || flat === "expired" || flat === "cancelled") {
    var reason = (body.error && body.error.message) || body.reason || body.fail_reason || flat;
    return { status: "FAILURE", progress: "100%", reason: reason };
  }
  return { status: "UNKNOWN" };
}

export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  var body = storedBody(task);
  var artifacts = [];
  if (artifactUrlFromBody(body, "video")) artifacts.push({ key: "video", type: "video" });
  if (artifactUrlFromBody(body, "cover")) artifacts.push({ key: "cover", type: "image", mimeType: "image/jpeg" });
  if (artifactUrlFromBody(body, "last_frame")) artifacts.push({ key: "last_frame", type: "image", mimeType: "image/png" });
  return artifacts;
}

// Video/cover/last-frame URLs are signed or public CDN links in the poll
// body; fetch them without upstream credentials (credentialless).
export function buildContentRequest(ctx) {
  var key = (ctx && ctx.artifactKey) || "video";
  var url = artifactUrlFromBody(storedBody(ctx), key);
  if (!url) throw new Error("artifact_not_found");
  return { url: url, method: (ctx.clientRequest && ctx.clientRequest.method) || "GET", credentialless: true };
}

// The poll body carries the real bill on success; overlay it on completion
// when present, otherwise keep the submit estimate. Shape-detected like
// parseTaskResult:
//   * Wasu vendor — data.data.usage tokens only (no delivered resolution);
//   * TelecomJS vendor — usage.completion_tokens (includes audio cost, so it
//     exceeds the formula estimate), usage.SR (delivered tier) and
//     usage.duration;
//   * MaiCang vendor — usage tokens only;
//   * Stelloria vendor — delivered duration/resolution from result, tokens
//     recomputed from them (no usage object);
//   * PGY vendor — usage tokens plus the delivered resolution
//     (content.resolution);
//   * native render output (chained) — the same flat fields the render
//     spreads through.
// Only successful tasks settle; failed tasks settle via the host's full
// refund, so a stray usage blob on a non-success body must not leak facts.
export function extractUsageOnComplete(task, taskResult, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  if (pollBodyKind(body) === "wasu") {
    var data = body.data && typeof body.data === "object" ? body.data : {};
    if (data.status !== "SUCCESS") return {};
    var inner = data.data && typeof data.data === "object" ? data.data : {};
    var wasuUsage = inner.usage || {};
    var wasuTokens = Number(wasuUsage.completion_tokens);
    if (!Number.isFinite(wasuTokens) || wasuTokens <= 0) wasuTokens = Number(wasuUsage.total_tokens);
    if (Number.isFinite(wasuTokens) && wasuTokens > 0) return { tokens: wasuTokens };
    return {};
  }
  if (pollBodyKind(body) === "wrapped") body = storedBody(body);
  var status = String(body.status || "").toLowerCase();
  if (status !== "succeeded" && status !== "completed" && status !== "success") return {};
  var usage = {};
  if (body.usage && typeof body.usage === "object") usage = body.usage;
  else if (body.data && typeof body.data === "object" && body.data.usage && typeof body.data.usage === "object") usage = body.data.usage;
  var result = body.result && typeof body.result === "object" && !Array.isArray(body.result) ? body.result : {};
  var content = body.content && typeof body.content === "object" && !Array.isArray(body.content) ? body.content : {};
  var facts = {};
  var tokens = Number(usage.completion_tokens);
  if (!Number.isFinite(tokens) || tokens <= 0) tokens = Number(usage.total_tokens);
  if (Number.isFinite(tokens) && tokens > 0) facts.tokens = tokens;
  var resolution = trimmed(usage.SR || body.resolution || content.resolution || result.resolution).toLowerCase();
  if (["480p", "720p", "1080p", "4k"].indexOf(resolution) >= 0) facts.resolution = resolution;
  var duration = parseDurationText(usage.duration !== undefined ? usage.duration : result.duration !== undefined ? result.duration : body.duration);
  if (Number.isFinite(duration) && duration > 0) facts.duration = Math.min(Math.floor(duration), 3600);
  // Stelloria reports no usage object: recompute the token total from the
  // delivered duration and resolution figures.
  if (!facts.tokens && facts.duration && facts.resolution) facts.tokens = estimateTokens(facts.duration, facts.resolution);
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
// {prompt, images} pair, mirroring the sibling plugin convention.
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
        metadata: { vendor: vendorLabel(ctx) },
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
