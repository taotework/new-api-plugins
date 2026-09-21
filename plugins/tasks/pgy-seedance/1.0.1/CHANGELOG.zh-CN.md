---
changelogVersion: 1
plugin: "pgy-seedance"
version: "1.0.1"
locale: "zh-CN"
---

# Changelog

## [1.0.1]

### Fixed

- 未指定分辨率的请求现在按官方 720p 默认档计费；此前按 1080p 计费，多收了依赖官方默认档的请求。
- 提交预估和完成覆盖现在都能识别 4k 档位；价格表此前已覆盖 4k，但档位识别清单漏掉了它。
- 请求缺少时长、seconds 和 frames 时现在按官方 5 秒默认值计费；此前按 15 秒计费，是 3 倍高估，会一直作用在按时长分档的计费表达式上。
