/**
 * dsh-share-card — 浏览器半（browser half）。
 *
 * 手写 `window.__ModuleLoader__` bundle（没有打包步骤）：客户端模块系统只在这里「注册」这个工厂，
 * 工厂体在客户端内核物化该行时才执行，`apply()` 随后在客户端插件 fiber 上被调用。
 *
 * 设计约束（有意为之）：
 *  - 纯浏览器半、零第三方依赖：真机 DOM 提取 → 与 DOM 无关的纯数据 → canvas 2D 自绘 → toBlob 导出。
 *    不联网、不上传，卡片在你本机画好再导出。
 *  - 只可选 require("react")：拿不到 react 时动作按钮与设置页面板自动跳过，工作台与
 *    automation API（window.__dshShareCard）照常可用。
 *  - 整个 factory 体带兜底 try/catch：浏览器半一旦抛异常会拖垮客户端启动图，绝不能发生。
 *  - 提取结果是纯数据（blocks/runs），渲染器不认识 DOM，所以可以单独跑、也方便无头断言。
 *  - 两个槽位：conversation.chat.assistant-actions（id=share-card，order=55）与
 *    settings.section（id=share-card，order=620）；注册只走动态 inject(["slots"]) ——
 *    不要用 ctx.slots 试探：Cordis 对未声明的服务直接抛错。
 */
window.__ModuleLoader__.load({
	id: "dsh-share-card",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var inject = [];
		var apply = function () {};
		exports.inject = inject;
		exports.apply = apply;

		try {
			// ==================== 可选的 react（动作按钮 / 设置页面板需要；拿不到就只留工作台） ====================
			var react = null;
			try {
				if (typeof require === "function") react = require("react");
			} catch (error) {
				react = null;
			}

			// ==================== 常量 ====================
			var VERSION = "0.1.0";
			var STORE_KEY = "dsh-share-card:config";
			var STYLE_ID = "dsh-share-card-style";
			var STYLE_ATTR = "data-dsh-share-card";
			var Z_INDEX = 2147483000;
			var ACTION_SLOT = "conversation.chat.assistant-actions";
			var SETTINGS_SLOT = "settings.section";
			/** 逻辑高度上限：超过就截断并画「内容过长已截断」，避免一张卡片把内存吃光。 */
			var MAX_LOGICAL_HEIGHT = 20000;
			/** 单个代码块最多渲染的源码行数（防呆，正常回答远达不到）。 */
			var MAX_CODE_LINES = 600;
			/** 一次提取最多收集的块数（防呆）。 */
			var MAX_BLOCKS = 400;
			var CJK_CLASS = "\\u2E80-\\u9FFF\\u3000-\\u303F\\uFF00-\\uFFEF";
			/** 原子切分：单个 CJK 字符 / 一段非空白非 CJK（英文单词、数字、符号）/ 一段空白。 */
			var ATOM_RE = new RegExp("[" + CJK_CLASS + "]|[^\\s" + CJK_CLASS + "]+|\\s+", "g");
			var CJK_RE = new RegExp("[" + CJK_CLASS + "]");
			var BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,table,hr,img,pre,div[data-code-wrap='true']";

			/** 8 套渐变预设。浅色系（paper / snow）dark=false 且给出浅底深字配色。 */
			var PRESETS = [
				{
					id: "deepseek", label: "深空蓝紫", dark: true, from: "#111634", to: "#2b2360", angle: 135,
					text: "#e9ecff", dim: "#a7aede", codeBg: "rgba(6,10,28,0.55)", codeText: "#dbe3ff",
					accent: "#7aa2ff", line: "rgba(255,255,255,0.14)"
				},
				{
					id: "midnight", label: "暗夜石墨", dark: true, from: "#14161a", to: "#23272f", angle: 150,
					text: "#e7e9ee", dim: "#9aa1ab", codeBg: "rgba(0,0,0,0.42)", codeText: "#dfe3ea",
					accent: "#8ab4f8", line: "rgba(255,255,255,0.12)"
				},
				{
					id: "sunset", label: "日落橙粉", dark: true, from: "#3d1a4d", to: "#b8452f", angle: 160,
					text: "#ffeee6", dim: "#f0b9a4", codeBg: "rgba(40,10,20,0.45)", codeText: "#ffe4d6",
					accent: "#ffb27a", line: "rgba(255,255,255,0.16)"
				},
				{
					id: "mint", label: "薄荷青绿", dark: true, from: "#08251f", to: "#155f52", angle: 145,
					text: "#e3fff6", dim: "#93cbbd", codeBg: "rgba(0,20,16,0.45)", codeText: "#d5f7ec",
					accent: "#5fe0c0", line: "rgba(255,255,255,0.14)"
				},
				{
					id: "paper", label: "纸感米黄", dark: false, from: "#f8f2e4", to: "#ecdfc6", angle: 135,
					text: "#312a20", dim: "#7d7259", codeBg: "#e7dbc2", codeText: "#3a3226",
					accent: "#a9622a", line: "rgba(96,76,46,0.22)"
				},
				{
					id: "snow", label: "纯白极简", dark: false, from: "#ffffff", to: "#eef1f7", angle: 150,
					text: "#1b1f27", dim: "#69707d", codeBg: "#f1f3f7", codeText: "#232a33",
					accent: "#2f6fed", line: "rgba(24,34,60,0.12)"
				},
				{
					id: "neon", label: "赛博霓虹", dark: true, from: "#0a0a20", to: "#3a0b4a", angle: 145,
					text: "#eaf6ff", dim: "#9fb6d8", codeBg: "rgba(8,4,26,0.6)", codeText: "#e6f0ff",
					accent: "#48f2c8", line: "rgba(120,240,220,0.22)"
				},
				{
					id: "ocean", label: "深海鲸蓝", dark: true, from: "#04182e", to: "#0b4570", angle: 150,
					text: "#e2f2ff", dim: "#9dc2da", codeBg: "rgba(2,16,32,0.5)", codeText: "#d7ecff",
					accent: "#4fd1ff", line: "rgba(255,255,255,0.14)"
				}
			];
			var PRESET_MAP = {};
			var PRESET_LIST = [];
			for (var pi = 0; pi < PRESETS.length; pi++) {
				PRESET_MAP[PRESETS[pi].id] = PRESETS[pi];
				PRESET_LIST.push(PRESETS[pi]);
			}

			/** 浅色主题的统一「墨水」配色（预设自带的是深色墨水）。 */
			var LIGHT_INK = {
				text: "#1b1f27", dim: "#5f6874", codeBg: "rgba(15,23,42,0.06)",
				codeText: "#1f2937", line: "rgba(20,30,60,0.14)"
			};
			var SYNTAX_DARK = { kw: "#c792ea", str: "#9ddc8a", num: "#f0a869", com: "#7c86a8", fn: "#7fd1f0", op: "#cfd6e6" };
			var SYNTAX_LIGHT = { kw: "#0b62d6", str: "#0a7a3d", num: "#b45309", com: "#8a94a6", fn: "#0a7a8a", op: "#334155" };

			var FONTS = [
				{
					id: "sans", label: "无衬线",
					stack: '"Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, -apple-system, sans-serif',
					mono: 'Consolas, "Cascadia Mono", "SFMono-Regular", "Courier New", "Microsoft YaHei", monospace'
				},
				{
					id: "serif", label: "衬线",
					stack: 'Georgia, "Songti SC", "SimSun", "Noto Serif SC", "Times New Roman", serif',
					mono: 'Consolas, "Cascadia Mono", "Courier New", "Microsoft YaHei", monospace'
				},
				{
					id: "mono", label: "等宽",
					stack: '"Cascadia Mono", Consolas, "Microsoft YaHei", "PingFang SC", "Noto Sans SC", monospace',
					mono: '"Cascadia Mono", Consolas, "Courier New", "Microsoft YaHei", monospace'
				}
			];
			var FONT_MAP = {};
			for (var fi = 0; fi < FONTS.length; fi++) FONT_MAP[FONTS[fi].id] = FONTS[fi];

			var WIDTHS = [720, 880, 1080];
			var SCALES = [1, 2, 3];

			var DEFAULTS = {
				theme: "dark",
				preset: "deepseek",
				font: "sans",
				width: 880,
				radius: 28,
				padding: 48,
				scale: 2,
				fontSize: 16,
				lineHeight: 1.7,
				codeWrap: true,
				highlight: true,
				lineNumbers: false,
				includeImages: false,
				showHeader: true,
				showFooter: true,
				showQuestion: true,
				showTime: true,
				showWatermark: true,
				/** 空字符串 = 自动取会话标题 */
				title: "",
				footer: "DeepSeek Harness · 对话分享",
				questionLabel: "提问",
				watermark: "dsh-share-card"
			};

			// ==================== 小工具 ====================
			function clamp(value, min, max) {
				var n = Number(value);
				if (!isFinite(n)) n = min;
				if (n < min) return min;
				if (n > max) return max;
				return n;
			}

			function msgOf(error) {
				if (error === null || error === undefined) return "未知错误";
				if (typeof error === "string") return error;
				if (error.message !== undefined) return String(error.message);
				return String(error);
			}

			function warn(message, error) {
				try {
					if (error === undefined) console.warn("[dsh-share-card] " + message);
					else console.warn("[dsh-share-card] " + message, error);
				} catch (inner) {
					/* 忽略 */
				}
			}

			function el(tag, className) {
				var node = document.createElement(tag);
				if (className) node.className = className;
				return node;
			}

			function control(tag, className, text) {
				var node = el(tag, className);
				if (text !== undefined && text !== null) node.textContent = String(text);
				return node;
			}

			/**
			 * 取节点的文本。真机实测结论：innerText 不可靠 —— 折叠的推理行 innerText 长度为 0
			 * 但 textContent 有内容（反向也有，回答行 innerText 1306 / textContent 1285）。
			 * 所以判空与取文本统一优先 textContent，innerText 只作为兜底。
			 */
			function textOf(node) {
				if (!node) return "";
				if (typeof node.textContent === "string") return node.textContent;
				if (typeof node.innerText === "string") return node.innerText;
				return "";
			}

			function hexToRgb(hex) {
				var match = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ""));
				if (!match) return null;
				var value = parseInt(match[1], 16);
				return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
			}

			function rgbHex(c) {
				function part(n) {
					var text = clamp(Math.round(n), 0, 255).toString(16);
					return text.length === 1 ? "0" + text : text;
				}
				return "#" + part(c.r) + part(c.g) + part(c.b);
			}

			/** 两个十六进制色之间线性插值；任一侧不是 #rrggbb 就原样返回 from（防御式）。 */
			function mixHex(from, to, amount) {
				var a = hexToRgb(from);
				var b = hexToRgb(to);
				if (!a || !b) return from;
				return rgbHex({
					r: a.r + (b.r - a.r) * amount,
					g: a.g + (b.g - a.g) * amount,
					b: a.b + (b.b - a.b) * amount
				});
			}

			function isDarkColor(hex) {
				var c = hexToRgb(hex);
				if (!c) return true;
				return (c.r * 299 + c.g * 587 + c.b * 114) / 1000 < 140;
			}

			/** 圆角矩形路径：优先用原生 roundRect，没有就手写（老 Chromium 兜底）。 */
			function roundRectPath(ctx, x, y, w, h, r) {
				var radius = clamp(r, 0, Math.min(w, h) / 2);
				if (typeof ctx.roundRect === "function") {
					ctx.beginPath();
					ctx.roundRect(x, y, w, h, radius);
					return;
				}
				ctx.beginPath();
				ctx.moveTo(x + radius, y);
				ctx.lineTo(x + w - radius, y);
				ctx.arcTo(x + w, y, x + w, y + radius, radius);
				ctx.lineTo(x + w, y + h - radius);
				ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
				ctx.lineTo(x + radius, y + h);
				ctx.arcTo(x, y + h, x, y + h - radius, radius);
				ctx.lineTo(x, y + radius);
				ctx.arcTo(x, y, x + radius, y, radius);
				ctx.closePath();
			}

			function stampNow() {
				var d = new Date();
				function p(n) {
					return (n < 10 ? "0" : "") + n;
				}
				return String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
			}

			// ==================== 配置（localStorage + sanitize 兜底） ====================
			function textOr(value, fallback, maxLength) {
				if (typeof value !== "string") return fallback;
				var text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
				if (text.length > maxLength) text = text.slice(0, maxLength);
				return text;
			}

			function boolOr(value, fallback) {
				return typeof value === "boolean" ? value : fallback;
			}

			function oneOf(value, list, fallback) {
				for (var i = 0; i < list.length; i++) if (list[i] === value) return value;
				return fallback;
			}

			function sanitize(source) {
				var raw = source && typeof source === "object" ? source : {};
				var out = {};
				out.theme = raw.theme === "light" ? "light" : "dark";
				out.preset = PRESET_MAP[raw.preset] ? raw.preset : DEFAULTS.preset;
				out.font = FONT_MAP[raw.font] ? raw.font : DEFAULTS.font;
				out.width = oneOf(Number(raw.width), WIDTHS, DEFAULTS.width);
				out.radius = Math.round(clamp(raw.radius === undefined ? DEFAULTS.radius : raw.radius, 0, 48));
				out.padding = Math.round(clamp(raw.padding === undefined ? DEFAULTS.padding : raw.padding, 24, 80));
				out.scale = oneOf(Number(raw.scale), SCALES, DEFAULTS.scale);
				out.fontSize = Math.round(clamp(raw.fontSize === undefined ? DEFAULTS.fontSize : raw.fontSize, 14, 22));
				var lh = Number(raw.lineHeight);
				out.lineHeight = isFinite(lh) ? Math.round(clamp(lh, 1.4, 2) * 100) / 100 : DEFAULTS.lineHeight;
				out.codeWrap = boolOr(raw.codeWrap, DEFAULTS.codeWrap);
				out.highlight = boolOr(raw.highlight, DEFAULTS.highlight);
				out.lineNumbers = boolOr(raw.lineNumbers, DEFAULTS.lineNumbers);
				out.includeImages = boolOr(raw.includeImages, DEFAULTS.includeImages);
				out.showHeader = boolOr(raw.showHeader, DEFAULTS.showHeader);
				out.showFooter = boolOr(raw.showFooter, DEFAULTS.showFooter);
				out.showQuestion = boolOr(raw.showQuestion, DEFAULTS.showQuestion);
				out.showTime = boolOr(raw.showTime, DEFAULTS.showTime);
				out.showWatermark = boolOr(raw.showWatermark, DEFAULTS.showWatermark);
				out.title = textOr(raw.title, DEFAULTS.title, 80);
				out.footer = textOr(raw.footer, DEFAULTS.footer, 80);
				out.questionLabel = textOr(raw.questionLabel, DEFAULTS.questionLabel, 20);
				out.watermark = textOr(raw.watermark, DEFAULTS.watermark, 40);
				return out;
			}

			function readConfig() {
				var raw = null;
				try {
					raw = JSON.parse(globalThis.localStorage.getItem(STORE_KEY) || "null");
				} catch (error) {
					raw = null;
				}
				return sanitize(raw);
			}

			function writeConfig(patch) {
				var next = readConfig();
				if (patch && typeof patch === "object") {
					for (var key in patch) {
						if (Object.prototype.hasOwnProperty.call(patch, key) && key !== "returnDataUrl") next[key] = patch[key];
					}
				}
				next = sanitize(next);
				try {
					globalThis.localStorage.setItem(STORE_KEY, JSON.stringify(next));
				} catch (error) {
					/* localStorage 不可用时只影响持久化 */
				}
				notifyConfigChanged();
				return next;
			}

			/** automation API 里的 set：合并写回并返回新配置。 */
			function writeConfigAndPersist(patch) {
				return writeConfig(patch);
			}

			function resetConfig() {
				try {
					globalThis.localStorage.removeItem(STORE_KEY);
				} catch (error) {
					/* 忽略 */
				}
				notifyConfigChanged();
				return readConfig();
			}

			// ==================== 样式（一次性注入 head） ====================
			var CSS = [
				/* --- 每条回复下面的动作按钮 --- */
				".dsh-share-card-action{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 6px;" +
					"border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:11px;line-height:1;" +
					"cursor:pointer;opacity:.72;transition:opacity .12s ease,background .12s ease;white-space:nowrap}",
				".dsh-share-card-action:hover{opacity:1;background:rgba(127,127,127,.16)}",
				".dsh-share-card-action:active{transform:scale(.96)}",
				".dsh-share-card-action .dsc-icon{display:inline-flex;width:13px;height:13px;align-items:center;justify-content:center}",
				".dsh-share-card-action .dsc-icon svg{display:block;width:13px;height:13px}",
				".dsh-share-card-action .dsc-label{font-size:11px;letter-spacing:.2px}",
				/* --- 工作台浮层 --- */
				".dsc-mask{position:fixed;inset:0;z-index:" + Z_INDEX + ";display:flex;align-items:center;justify-content:center;" +
					"background:rgba(6,8,14,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);" +
					"font-family:'Segoe UI','Microsoft YaHei','PingFang SC','Noto Sans SC',system-ui,sans-serif;color:#e8ebf2}",
				".dsc-panel{display:flex;flex-direction:column;width:min(1200px,96vw);height:min(90vh,960px);" +
					"background:#14171d;border:1px solid rgba(255,255,255,.10);border-radius:14px;overflow:hidden;" +
					"box-shadow:0 24px 70px rgba(0,0,0,.55);overscroll-behavior:contain}",
				".dsc-head{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);" +
					"background:#181c23;flex:0 0 auto}",
				".dsc-head .dsc-title{font-size:13px;font-weight:600;letter-spacing:.2px}",
				".dsc-head .dsc-sub{font-size:11px;color:#8d95a5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto}",
				".dsc-head-actions{display:flex;gap:6px;flex:0 0 auto}",
				".dsc-body{display:flex;flex:1 1 auto;min-height:0}",
				".dsc-preview{flex:1 1 auto;min-width:0;overflow:auto;overscroll-behavior:contain;background:" +
					"repeating-conic-gradient(#1b1f26 0% 25%,#171a20 0% 50%) 50%/22px 22px;padding:18px}",
				".dsc-stage{display:flex;justify-content:center;align-items:flex-start;min-height:100%}",
				".dsc-canvas{display:block;border-radius:10px;box-shadow:0 10px 34px rgba(0,0,0,.5);background:#0b0e14;max-width:none}",
				".dsc-side{flex:0 0 326px;width:326px;overflow:auto;overscroll-behavior:contain;border-left:1px solid rgba(255,255,255,.08);" +
					"background:#161a21;padding:12px 14px 24px}",
				".dsc-sec{margin:0 0 6px;font-size:11px;font-weight:600;color:#8f98a8;text-transform:none;letter-spacing:.4px}",
				".dsc-card{border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:8px 10px;margin:0 0 10px;background:#1a1e26}",
				".dsc-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 0;min-height:24px}",
				".dsc-row>.k{font-size:12px;color:#c6ccd8;flex:0 0 auto}",
				".dsc-row>.v{display:flex;align-items:center;gap:8px;flex:0 1 auto;min-width:0}",
				".dsc-num{font-size:11px;color:#8d95a5;min-width:38px;text-align:right;font-variant-numeric:tabular-nums}",
				".dsc-range{width:132px;accent-color:#5b8cff}",
				".dsc-pill{border:1px solid rgba(255,255,255,.14);background:transparent;color:#c6ccd8;border-radius:999px;" +
					"padding:3px 11px;font-size:11px;cursor:pointer;font-family:inherit;line-height:1.4}",
				".dsc-pill.on{background:rgba(91,140,255,.20);border-color:rgba(122,162,255,.6);color:#dce6ff}",
				".dsc-pills{display:flex;gap:6px;flex-wrap:wrap}",
				".dsc-presets{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}",
				".dsc-preset{position:relative;height:38px;border-radius:8px;border:1px solid rgba(255,255,255,.14);cursor:pointer;" +
					"padding:0;font-family:inherit;overflow:hidden}",
				".dsc-preset span{position:absolute;left:0;right:0;bottom:0;font-size:9px;padding:2px 0;text-align:center;" +
					"background:rgba(0,0,0,.42);color:#fff;letter-spacing:.2px}",
				".dsc-preset.on{box-shadow:0 0 0 2px #5b8cff inset,0 0 0 1px #5b8cff}",
				".dsc-input{width:150px;background:#0f1218;border:1px solid rgba(255,255,255,.12);color:#e8ebf2;" +
					"border-radius:7px;padding:4px 7px;font-size:12px;font-family:inherit;min-width:0}",
				".dsc-input:focus{outline:none;border-color:rgba(122,162,255,.7)}",
				".dsc-btn{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#e8ebf2;border-radius:8px;" +
					"padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;line-height:1.4}",
				".dsc-btn:hover{background:rgba(255,255,255,.12)}",
				".dsc-btn.primary{background:#3b6ddd;border-color:#4f7fe8;color:#fff}",
				".dsc-btn.primary:hover{background:#4a7ceb}",
				".dsc-btn.ghost{background:transparent}",
				".dsc-foot{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid rgba(255,255,255,.08);" +
					"background:#181c23;flex:0 0 auto}",
				".dsc-foot .dsc-spacer{flex:1 1 auto}",
				".dsc-hint{font-size:11px;color:#8d95a5;line-height:1.6;margin:4px 0 0}",
				".dsc-zoom{font-size:11px;color:#8d95a5;margin-left:auto;font-variant-numeric:tabular-nums}",
				".dsc-toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:" + (Z_INDEX + 1) + ";" +
					"max-width:min(560px,86vw);background:rgba(24,28,35,.97);border:1px solid rgba(255,255,255,.14);color:#e8ebf2;" +
					"border-radius:10px;padding:9px 14px;font-size:12px;line-height:1.55;box-shadow:0 12px 30px rgba(0,0,0,.45);" +
					"font-family:'Segoe UI','Microsoft YaHei','PingFang SC',system-ui,sans-serif}",
				".dsc-toast.err{border-color:rgba(255,120,120,.5);color:#ffdede}",
				".dsc-panel-host{display:block}",
				/* --- 浅色系统下的浮层（面板本身仍是工具面，但浅色下别太刺眼） --- */
				"@media (prefers-color-scheme: light){.dsc-mask{background:rgba(30,34,40,.5)}" +
					".dsc-panel{background:#f7f8fa;color:#1d2129;border-color:rgba(0,0,0,.12)}" +
					".dsc-head,.dsc-foot{background:#eff1f5;border-color:rgba(0,0,0,.08)}" +
					".dsc-head .dsc-sub,.dsc-hint,.dsc-num,.dsc-sec,.dsc-zoom{color:#6a7280}" +
					".dsc-side{background:#f2f3f6;border-color:rgba(0,0,0,.08)}" +
					".dsc-card{background:#fff;border-color:rgba(0,0,0,.09)}" +
					".dsc-row>.k{color:#333a45}.dsc-input{background:#fff;color:#1d2129;border-color:rgba(0,0,0,.16)}" +
					".dsc-btn{background:#fff;color:#1d2129;border-color:rgba(0,0,0,.16)}" +
					".dsc-pill{color:#3a4250;border-color:rgba(0,0,0,.18)}" +
					".dsc-preview{background:repeating-conic-gradient(#e9ebef 0% 25%,#e2e5ea 0% 50%) 50%/22px 22px}" +
					".dsc-toast{background:rgba(255,255,255,.98);color:#1d2129;border-color:rgba(0,0,0,.14)}" +
					".dsc-toast.err{color:#8a1f1f}}",
				"@media (max-width:820px){.dsc-panel{width:100vw;height:100vh;border-radius:0;border:0}" +
					".dsc-body{flex-direction:column}.dsc-side{flex:1 1 auto;width:auto;border-left:0;border-top:1px solid rgba(255,255,255,.08)}}"
			].join("\n");

			function ensureStyle() {
				try {
					if (!globalThis.document || typeof document.getElementById !== "function") return false;
					var existing = document.getElementById(STYLE_ID);
					if (existing !== null && existing !== undefined) return true;
					var node = document.createElement("style");
					node.id = STYLE_ID;
					node.setAttribute(STYLE_ATTR, "1");
					node.textContent = CSS;
					var head = document.head || document.documentElement;
					if (!head) return false;
					head.appendChild(node);
					return true;
				} catch (error) {
					warn("样式注入失败（不影响导出，只是浮层会难看一点）", error);
					return false;
				}
			}

			// ==================== 消息提取：真机 DOM → 与 DOM 无关的纯数据 ====================
			/** 行内 run：{ text, bold?, italic?, code?, link? } —— 渲染器只认这个。 */
			function inlineState(base) {
				return {
					bold: base && base.bold === true,
					italic: base && base.italic === true,
					code: base && base.code === true,
					link: (base && base.link) || null
				};
			}

			function pushRun(out, text, state) {
				if (!text) return;
				var last = out.length > 0 ? out[out.length - 1] : null;
				if (
					last &&
					last.bold === state.bold &&
					last.italic === state.italic &&
					last.code === state.code &&
					last.link === state.link
				) {
					last.text += text;
					return;
				}
				out.push({
					text: text,
					bold: state.bold === true,
					italic: state.italic === true,
					code: state.code === true,
					link: state.link || null
				});
			}

			function inlineRuns(node, state, out, skip) {
				out = out || [];
				var kids = node.childNodes || [];
				for (var i = 0; i < kids.length; i++) {
					var child = kids[i];
					if (!child) continue;
					if (child.nodeType === 3) {
						pushRun(out, String(child.nodeValue || ""), state);
						continue;
					}
					if (child.nodeType !== 1) continue;
					if (skip && skip.indexOf(child) >= 0) continue;
					var tag = String(child.tagName || "").toLowerCase();
					if (tag === "svg" || tag === "script" || tag === "style" || tag === "button" || tag === "noscript") continue;
					if (tag === "br") {
						out.push({ text: "\n", br: true, bold: state.bold === true, italic: state.italic === true, code: state.code === true, link: state.link || null });
						continue;
					}
					if (tag === "img") {
						// 附件图：默认不画（canvas 污染风险），统一替换成占位文本
						var alt = String(child.getAttribute("alt") || "");
						pushRun(out, alt ? "[图片：" + alt + "]" : "[图片]", state);
						continue;
					}
					if (tag === "code" || tag === "kbd" || tag === "samp") {
						var codeState = inlineState(state);
						codeState.code = true;
						inlineRuns(child, codeState, out, skip);
						continue;
					}
					if (tag === "strong" || tag === "b") {
						var boldState = inlineState(state);
						boldState.bold = true;
						inlineRuns(child, boldState, out, skip);
						continue;
					}
					if (tag === "em" || tag === "i") {
						var italicState = inlineState(state);
						italicState.italic = true;
						inlineRuns(child, italicState, out, skip);
						continue;
					}
					if (tag === "a") {
						var linkState = inlineState(state);
						linkState.link = String(child.getAttribute("href") || child.href || "");
						inlineRuns(child, linkState, out, skip);
						continue;
					}
					// span / mark / del / sup / sub / u / time / font … 原样下钻
					inlineRuns(child, state, out, skip);
				}
				return out;
			}

			function isBlockEl(node) {
				if (!node || node.nodeType !== 1) return false;
				var tag = String(node.tagName || "").toLowerCase();
				if (tag === "p" || tag === "hr" || tag === "img" || tag === "table" || tag === "pre" || tag === "blockquote") return true;
				if (tag === "ul" || tag === "ol") return true;
				if (tag.length === 2 && tag.charAt(0) === "h" && "123456".indexOf(tag.charAt(1)) >= 0) return true;
				if (node.getAttribute && node.getAttribute("data-code-wrap") === "true") return true;
				return false;
			}

			function directChildrenByTag(node, tagName) {
				var out = [];
				var kids = node.children || [];
				for (var i = 0; i < kids.length; i++) {
					if (String(kids[i].tagName || "").toLowerCase() === tagName) out.push(kids[i]);
				}
				return out;
			}

			function parseCodeBlock(node) {
				var lang = "";
				var spans = node.querySelectorAll ? node.querySelectorAll("span") : [];
				for (var i = 0; i < spans.length; i++) {
					var candidate = textOf(spans[i]).trim();
					// 横幅里的语言名：短、单行、不含空白段落
					if (candidate && candidate.length <= 20 && candidate.indexOf("\n") < 0 && !/^(复制|copy)$/i.test(candidate)) {
						lang = candidate;
						break;
					}
				}
				var code = "";
				var holder = node.querySelector ? node.querySelector("[data-code-block-content='true']") : null;
				if (holder) {
					var pre = holder.querySelector ? holder.querySelector("pre") : null;
					var codeEl = pre && pre.querySelector ? pre.querySelector("code") : null;
					code = codeEl ? textOf(codeEl) : textOf(pre || holder);
				} else {
					var pre2 = node.querySelector ? node.querySelector("pre") : null;
					code = pre2 ? textOf(pre2) : textOf(node);
				}
				return { type: "code", lang: lang, code: String(code || "").replace(/\r/g, "") };
			}

			function parseTable(node) {
				var header = [];
				var rows = [];
				var thead = node.querySelector ? node.querySelector("thead") : null;
				var headRow = thead && thead.querySelector ? thead.querySelector("tr") : null;
				if (!headRow && node.querySelector) headRow = node.querySelector("tr");
				if (headRow) header = cellRuns(headRow, "th");
				var bodyRows = node.querySelectorAll ? node.querySelectorAll("tbody tr") : [];
				if (bodyRows.length === 0 && node.querySelectorAll) bodyRows = node.querySelectorAll("tr");
				for (var i = 0; i < bodyRows.length && rows.length < 80; i++) {
					var row = bodyRows[i];
					if (headRow && row === headRow) continue;
					var cells = cellRuns(row, "td");
					if (cells.length === 0) cells = cellRuns(row, "th");
					if (cells.length > 0) rows.push(cells);
				}
				// 列数取表头与各行的最大值
				var columns = header.length;
				for (var r = 0; r < rows.length; r++) if (rows[r].length > columns) columns = rows[r].length;
				if (columns === 0) return null;
				return { type: "table", header: header, rows: rows, columns: columns };
			}

			function cellRuns(row, cellTag) {
				var out = [];
				var cells = row.children || [];
				for (var i = 0; i < cells.length; i++) {
					var cell = cells[i];
					var tag = String(cell.tagName || "").toLowerCase();
					if (tag !== cellTag && tag !== "th" && tag !== "td") continue;
					out.push(inlineRuns(cell, inlineState(null), []));
				}
				return out;
			}

			function parseList(listEl, level, outItems) {
				outItems = outItems || [];
				var ordered = String(listEl.tagName || "").toLowerCase() === "ol";
				var items = listEl.children || [];
				var index = 0;
				for (var i = 0; i < items.length; i++) {
					var li = items[i];
					if (String(li.tagName || "").toLowerCase() !== "li") continue;
					index += 1;
					var nested = [];
					var kids = li.children || [];
					for (var k = 0; k < kids.length; k++) {
						var tag = String(kids[k].tagName || "").toLowerCase();
						if (tag === "ul" || tag === "ol") nested.push(kids[k]);
					}
					var paragraphs = [];
					var paraNodes = directChildrenByTag(li, "p");
					if (paraNodes.length > 0) {
						for (var p = 0; p < paraNodes.length; p++) paragraphs.push(inlineRuns(paraNodes[p], inlineState(null), []));
					} else {
						paragraphs.push(inlineRuns(li, inlineState(null), [], nested));
					}
					// 清掉空段落
					var kept = [];
					for (var q = 0; q < paragraphs.length; q++) {
						var hasText = false;
						for (var t = 0; t < paragraphs[q].length; t++) {
							if (String(paragraphs[q][t].text || "").trim() !== "") hasText = true;
						}
						if (hasText) kept.push(paragraphs[q]);
					}
					outItems.push({
						level: level,
						ordered: ordered,
						index: index,
						paragraphs: kept.length > 0 ? kept : [[]]
					});
					for (var n = 0; n < nested.length; n++) parseList(nested[n], level + 1, outItems);
				}
				return outItems;
			}

			function parseQuote(node) {
				var paragraphs = [];
				var paraNodes = node.querySelectorAll ? node.querySelectorAll("p") : [];
				if (paraNodes.length > 0) {
					for (var i = 0; i < paraNodes.length; i++) paragraphs.push(inlineRuns(paraNodes[i], inlineState(null), []));
				} else {
					paragraphs.push(inlineRuns(node, inlineState(null), []));
				}
				// 引用里若有 ul/ol，简单拼在后面（保持纯数据形状简单）
				var lists = node.querySelectorAll ? node.querySelectorAll("li") : [];
				for (var l = 0; l < lists.length; l++) paragraphs.push(inlineRuns(lists[l], inlineState(null), []));
				return { type: "quote", paragraphs: paragraphs };
			}

			function parseBlock(node) {
				var tag = String(node.tagName || "").toLowerCase();
				try {
					if (node.getAttribute && node.getAttribute("data-code-wrap") === "true") return parseCodeBlock(node);
					if (tag === "hr") return { type: "hr" };
					if (tag === "img") {
						return { type: "image", src: String(node.currentSrc || node.getAttribute("src") || ""), alt: String(node.getAttribute("alt") || "") };
					}
					if (tag === "table") return parseTable(node);
					if (tag === "blockquote") return parseQuote(node);
					if (tag === "ul" || tag === "ol") return { type: "list", ordered: tag === "ol", items: parseList(node, 0, []) };
					if (tag === "pre") {
						var inner = node.querySelector ? node.querySelector("code") : null;
						return { type: "code", lang: "", code: String(textOf(inner || node) || "").replace(/\r/g, "") };
					}
					if (tag.length === 2 && tag.charAt(0) === "h") {
						var level = parseInt(tag.charAt(1), 10);
						return { type: "heading", level: isFinite(level) ? level : 2, runs: inlineRuns(node, inlineState(null), []) };
					}
					if (tag === "p") return { type: "paragraph", runs: inlineRuns(node, inlineState(null), []) };
					return { type: "paragraph", runs: inlineRuns(node, inlineState(null), []) };
				} catch (error) {
					warn("解析块失败，已跳过：" + tag, error);
					return null;
				}
			}

			/**
			 * 在子树里按文档顺序收集块级元素；遇到一个块就把它的子树整体吃掉（不再往里递归找块），
			 * 这样表格里的 p、代码块里的 div 都不会被重复收集。
			 */
			function collectBlocks(root) {
				var out = [];
				function walk(node) {
					var kids = node.children || [];
					for (var i = 0; i < kids.length; i++) {
						if (out.length >= MAX_BLOCKS) return;
						var child = kids[i];
						if (isBlockEl(child)) {
							var block = parseBlock(child);
							if (block) out.push(block);
						} else {
							walk(child);
						}
					}
				}
				walk(root);
				return out;
			}

			function lastNonEmptyNodeList(nodes) {
				if (!nodes) return null;
				for (var i = nodes.length - 1; i >= 0; i--) {
					if (textOf(nodes[i]).trim().length > 0) return nodes[i];
				}
				return null;
			}

			/** 是不是「推理过程」行（实测：data-chat-flow-key 形如 ["14:assistant-step9:1","reasoning"]）。 */
			function isReasoningRow(el) {
				if (!el || typeof el.getAttribute !== "function") return false;
				try {
					if (String(el.getAttribute("data-chat-group-part") || "") === "reasoning") return true;
					var key = String(el.getAttribute("data-chat-flow-key") || "");
					return key.indexOf("reasoning") >= 0;
				} catch (error) {
					return false;
				}
			}

			function queryAllSafe(scope, selector) {
				if (!scope || typeof scope.querySelectorAll !== "function") return null;
				try {
					return scope.querySelectorAll(selector);
				} catch (error) {
					return null;
				}
			}

			function attrOf(el, name) {
				if (!el || typeof el.getAttribute !== "function") return null;
				try {
					var v = el.getAttribute(name);
					return v == null || String(v) === "" ? null : String(v);
				} catch (error) {
					return null;
				}
			}

			/**
			 * 从锚点按钮推出「回合号」。
			 * 真机实测：回合不是容器元素 —— 聊天区是一列扁平 flow item，每个 item 自带
			 * data-chat-turn="N"，同一回合的多个 item 是兄弟节点。所以锚点 closest("[data-chat-turn]")
			 * 拿到的其实只是 turn-tail 行本身（里面没有任何 assistant-step 后代），必须靠回合号
			 * 去全文档找同一回合的其它行。
			 */
			function turnNumberFromAnchor(anchorEl) {
				if (!anchorEl || typeof anchorEl.closest !== "function") return null;
				try {
					var tail = anchorEl.closest("[data-turn-tail]") || anchorEl.closest('[data-chat-flow-kind="turn-tail"]');
					if (tail) {
						var t = attrOf(tail, "data-turn-tail");
						if (t === null) t = attrOf(tail, "data-chat-turn");
						if (t !== null) return t;
					}
					var item = anchorEl.closest("[data-chat-turn]");
					var v = attrOf(item, "data-chat-turn");
					if (v !== null) return v;
				} catch (error) {
					return null;
				}
				return null;
			}

			/**
			 * 按回合号找这一回合的「最终回答行」与「提问行」。
			 * 回答行优先用 data-chat-group-part="response"（实测回答行同时带 data-chat-group-part="response"
			 * 与 data-turn-process-answer="true"）；取不到时放宽到该回合所有 assistant-step 并排除推理行。
			 * 判空用 textContent（见 textOf 注释）。
			 */
			function findTurnRows(turnNumber) {
				var out = { answer: null, question: null, answerCandidates: 0, relaxed: false };
				var scope = globalThis.document;
				if (!scope || turnNumber == null) return out;
				var turn = String(turnNumber);
				var answers = [];
				var exact = queryAllSafe(
					scope,
					'[data-chat-turn="' + turn + '"][data-chat-flow-kind="assistant-step"][data-chat-group-part="response"]'
				);
				if (exact) {
					for (var i = 0; i < exact.length; i++) {
						if (isReasoningRow(exact[i])) continue;
						if (textOf(exact[i]).trim().length === 0) continue;
						answers.push(exact[i]);
					}
				}
				if (answers.length === 0) {
					out.relaxed = true;
					var loose = queryAllSafe(scope, '[data-chat-turn="' + turn + '"][data-chat-flow-kind="assistant-step"]');
					if (loose) {
						for (var j = 0; j < loose.length; j++) {
							if (isReasoningRow(loose[j])) continue;
							if (textOf(loose[j]).trim().length === 0) continue;
							answers.push(loose[j]);
						}
					}
				}
				out.answerCandidates = answers.length;
				out.answer = answers.length > 0 ? answers[answers.length - 1] : null;
				var users = queryAllSafe(scope, '[data-chat-turn="' + turn + '"][data-chat-flow-kind="user"]');
				out.question = lastNonEmptyNodeList(users);
				return out;
			}

			/** 用户问题末尾会带时间（如 21:07），把最后一行的这个时间去掉。 */
			function stripTrailingTime(text) {
				var lines = String(text || "").replace(/\r/g, "").split("\n");
				for (var i = lines.length - 1; i >= 0; i--) {
					if (lines[i].trim() === "") continue;
					lines[i] = lines[i].replace(/\s*\b\d{1,2}:\d{2}\b\s*$/, "");
					break;
				}
				return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
			}

			function blockText(blocks) {
				var parts = [];
				for (var i = 0; i < blocks.length; i++) {
					var b = blocks[i];
					if (b.type === "code") parts.push(b.code || "");
					else if (b.type === "table") {
						var rows = (b.header ? [b.header] : []).concat(b.rows || []);
						for (var r = 0; r < rows.length; r++) {
							var cells = [];
							for (var c = 0; c < rows[r].length; c++) cells.push(runsText(rows[r][c]));
							parts.push(cells.join(" | "));
						}
					} else if (b.type === "list") {
						for (var k = 0; k < b.items.length; k++) {
							for (var p = 0; p < b.items[k].paragraphs.length; p++) parts.push(runsText(b.items[k].paragraphs[p]));
						}
					} else if (b.type === "quote") {
						for (var q = 0; q < b.paragraphs.length; q++) parts.push(runsText(b.paragraphs[q]));
					} else if (b.runs) parts.push(runsText(b.runs));
					else if (b.type === "hr") parts.push("---");
				}
				return parts.join("\n\n");
			}

			function runsText(runs) {
				var out = "";
				for (var i = 0; i < (runs || []).length; i++) out += String(runs[i].text || "");
				return out;
			}

			/**
			 * 提取一条回答，返回 { ok:true, turn, turnNumber, messageId, blocks, question, plainText, meta }
			 * 或 { ok:false, reason }。
			 *
			 * target 可以传「回合号」（字符串/"14"）或一个 DOM 元素（按钮/turn-tail 行/任意行）；
			 * 传元素时会从它的 data-chat-turn / data-turn-tail 推回合号，再全文档找同一回合的回答行
			 * —— 因为回合不是容器元素，只在祖先里找 assistant-step 一定找不到（实测 stepsInside = 0）。
			 */
			function extractMessage(target) {
				var turnNumber = null;
				var fallbackRow = null;
				if (target && typeof target === "object" && typeof target.querySelectorAll === "function") {
					fallbackRow = target;
					turnNumber = attrOf(target, "data-chat-turn") || attrOf(target, "data-turn-tail") || turnNumberFromAnchor(target);
				} else if (target !== null && target !== undefined && target !== "") {
					turnNumber = String(target);
				}
				var rows = { answer: null, question: null, answerCandidates: 0, relaxed: false };
				if (turnNumber !== null) {
					try {
						rows = findTurnRows(turnNumber);
					} catch (error) {
						rows = { answer: null, question: null, answerCandidates: 0, relaxed: false };
					}
				}
				var row = rows.answer;
				if (!row && fallbackRow && typeof fallbackRow.matches === "function") {
					// 兜底：target 自身就是一条有内容的 assistant-step（例如外部直接传行元素）
					try {
						if (fallbackRow.matches('[data-chat-flow-kind="assistant-step"]') && textOf(fallbackRow).trim().length > 0) {
							row = fallbackRow;
						}
					} catch (error) {
						row = null;
					}
				}
				if (!row) {
					return {
						ok: false,
						reason: turnNumber === null
							? "没找到这条回答所在的回合，先把它滚动到可见位置再试一次"
							: "这条回答还没渲染出来，先把它滚动到可见位置再试一次"
					};
				}
				var host = null;
				try {
					host = row.querySelector('[data-dsh-part="message-row"]');
				} catch (error) {
					host = null;
				}
				if (!host) host = row;
				var blocks = [];
				try {
					blocks = collectBlocks(host);
				} catch (error) {
					return { ok: false, reason: "读取这条回答的正文失败：" + msgOf(error) };
				}
				if (blocks.length === 0) {
					return { ok: false, reason: "这条回答里没有可渲染的正文块，先把它滚动到可见位置再试一次" };
				}
				var question = "";
				var timeText = "";
				try {
					var userNode = rows.question;
					if (!userNode && turnNumber === null) {
						// 没有回合号时退回到「锚点所在容器内的提问行」
						var anchorScope = fallbackRow && fallbackRow.parentNode ? fallbackRow.parentNode : null;
						userNode = lastNonEmptyNodeList(queryAllSafe(anchorScope, '[data-chat-flow-kind="user"]'));
					}
					if (userNode) {
						var rawQuestion = textOf(userNode);
						var timeMatch = /\b(\d{1,2}:\d{2})\b/.exec(rawQuestion);
						if (timeMatch) timeText = timeMatch[1];
						question = stripTrailingTime(rawQuestion);
					}
				} catch (error) {
					question = "";
				}
				var plainText = "";
				try {
					plainText = textOf(host);
				} catch (error) {
					plainText = blockText(blocks);
				}
				var turnAttr = turnNumber === null ? "" : String(turnNumber);
				return {
					ok: true,
					turn: row,
					turnNumber: turnAttr,
					messageId: turnAttr ? "turn:" + turnAttr : "turn:?",
					blocks: blocks,
					question: question,
					plainText: plainText,
					meta: {
						turnNumber: turnAttr,
						blockCount: blocks.length,
						charCount: plainText.length,
						time: timeText,
						answerCandidates: rows.answerCandidates,
						relaxedMatch: rows.relaxed === true
					}
				};
			}

			/** 兼容旧调用：从锚点推回合号（回合不是容器，只是取号）。 */
			function turnFromAnchor(anchorEl) {
				var turn = turnNumberFromAnchor(anchorEl);
				if (turn !== null) return turn;
				if (!anchorEl || typeof anchorEl.closest !== "function") return null;
				try {
					return anchorEl.closest("[data-chat-turn]") || anchorEl.closest('[data-chat-flow-kind="turn-tail"]');
				} catch (error) {
					return null;
				}
			}

			/** automation API：当前页面最后一个「有内容」的回合。 */
			function extractLastTurn() {
				try {
					if (!globalThis.document || typeof document.querySelectorAll !== "function") {
						return { ok: false, reason: "当前环境没有 DOM" };
					}
					var nodes = document.querySelectorAll("[data-chat-turn]");
					var seen = {};
					var order = [];
					for (var i = 0; i < nodes.length; i++) {
						var num = attrOf(nodes[i], "data-chat-turn");
						if (num === null || seen[num] === true) continue;
						seen[num] = true;
						order.push(num);
					}
					for (var j = order.length - 1; j >= 0; j--) {
						var data = extractMessage(order[j]);
						if (data.ok === true) return data;
					}
					return { ok: false, reason: "页面上还没有可分享的回答" };
				} catch (error) {
					return { ok: false, reason: "读取页面失败：" + msgOf(error) };
				}
			}

			// ==================== 渲染：度量上下文 / 折行 / 高亮 ====================
			function resolvePalette(config) {
				var preset = PRESET_MAP[config.preset] || PRESET_MAP[DEFAULTS.preset];
				var dark;
				if (config.theme === "light") dark = false;
				else if (config.theme === "dark") dark = true;
				else dark = preset.dark === true;
				var from = preset.from;
				var to = preset.to;
				// 主题与预设本来的明暗相反时，把渐变往对应端拉一把，保证对比度够
				if (!dark && preset.dark === true) {
					from = mixHex(from, "#ffffff", 0.72);
					to = mixHex(to, "#ffffff", 0.8);
				} else if (dark && preset.dark === false) {
					from = mixHex(from, "#0b1020", 0.74);
					to = mixHex(to, "#0b1020", 0.8);
				}
				var ink = dark
					? { text: preset.text, dim: preset.dim, codeBg: preset.codeBg, codeText: preset.codeText, line: preset.line }
					: LIGHT_INK;
				var accent = preset.accent;
				if (!dark) accent = mixHex(accent, "#101828", 0.32);
				var base = dark ? SYNTAX_DARK : SYNTAX_LIGHT;
				return {
					id: preset.id,
					label: preset.label,
					dark: dark,
					from: from,
					to: to,
					angle: isFinite(Number(preset.angle)) ? Number(preset.angle) : 135,
					accent: accent,
					text: ink.text,
					dim: ink.dim,
					codeBg: ink.codeBg,
					codeText: ink.codeText,
					line: ink.line,
					syntax: {
						kw: dark ? accent : base.kw,
						str: base.str,
						num: base.num,
						com: base.com,
						fn: base.fn,
						op: base.op
					}
				};
			}

			function makeRenderContext(mctx, config) {
				var preset = resolvePalette(config);
				var fontDef = FONT_MAP[config.font] || FONT_MAP[DEFAULTS.font];
				var R = {
					config: config,
					preset: preset,
					ctx: mctx,
					width: config.width,
					pad: config.padding,
					base: config.fontSize,
					lh: Math.round(config.fontSize * config.lineHeight * 100) / 100,
					family: fontDef.stack,
					mono: fontDef.mono,
					accent: preset.accent,
					text: preset.text,
					dim: preset.dim,
					link: preset.accent,
					codeBg: preset.codeBg,
					codeText: preset.codeText,
					line: preset.line,
					syntax: preset.syntax,
					cache: {},
					limit: MAX_LOGICAL_HEIGHT - config.padding * 2
				};
				R.inner = R.width - R.pad * 2;
				R.gap = Math.round(R.base * 0.72);
				R.listGap = Math.round(R.base * 0.28);
				R.headGapBefore = Math.round(R.base * 1.0);
				R.headGapAfter = Math.round(R.base * 0.42);
				R.blockGap = Math.round(R.base * 0.86);
				R.ruleGap = Math.round(R.base * 0.9);
				R.onAssetReady = null;

				R.fontFor = function (size, style) {
					var family = style && style.code ? R.mono : R.family;
					var parts = [];
					if (style && style.italic === true) parts.push("italic");
					parts.push(style && style.bold === true ? "700" : "400");
					parts.push(Math.round(size * 100) / 100 + "px");
					parts.push(family);
					return parts.join(" ");
				};
				R.measure = function (text, size, style) {
					var font = R.fontFor(size, style);
					var key = font + "\u0000" + text;
					var hit = R.cache[key];
					if (hit !== undefined) return hit;
					var w = 0;
					try {
						mctx.font = font;
						w = mctx.measureText(text).width;
					} catch (error) {
						w = String(text).length * size * 0.6;
					}
					if (!isFinite(w)) w = String(text).length * size * 0.6;
					R.cache[key] = w;
					return w;
				};
				R.styleOf = function (run, base) {
					return {
						bold: (run && run.bold === true) || (base && base.bold === true),
						italic: (run && run.italic === true) || (base && base.italic === true),
						code: (run && run.code === true) || (base && base.code === true),
						link: (run && run.link) || null
					};
				};
				R.atomize = function (runs, size, styleBase) {
					var out = [];
					for (var i = 0; i < (runs || []).length; i++) {
						var run = runs[i];
						if (!run) continue;
						var style = R.styleOf(run, styleBase);
						var atomSize = style.code ? Math.round(size * 0.94) : size;
						if (run.br === true) {
							out.push({ br: true, text: "", style: style, size: atomSize });
							continue;
						}
						var segments = String(run.text === undefined ? "" : run.text).split("\n");
						for (var s = 0; s < segments.length; s++) {
							if (s > 0) out.push({ br: true, text: "", style: style, size: atomSize });
							var segment = segments[s];
							if (!segment) continue;
							var matches = segment.match(ATOM_RE) || [];
							for (var m = 0; m < matches.length; m++) {
								var piece = matches[m];
								var isSpace = /^\s+$/.test(piece);
								out.push({
									text: isSpace ? " " : piece,
									style: style,
									size: atomSize,
									space: isSpace
								});
							}
						}
					}
					return out;
				};
				/** 贪心折行：英文按空格断词，中日韩逐字断行，超宽的长词按字符硬切。 */
				R.wrap = function (runs, maxWidth, size, styleBase) {
					// 防御：可用宽度必须是正数。负数/NaN 会让「每行只放得下一个原子」，
					// 行数随字符数暴涨（表格单元格、深层缩进列表都可能算出这种宽度）。
					if (!isFinite(maxWidth) || maxWidth <= 0) maxWidth = Math.max(16, R.inner);
					var atoms = R.atomize(runs, size, styleBase);
					var lines = [];
					var cur = { atoms: [], width: 0 };
					var i = 0;
					var guard = 0;
					while (i < atoms.length && guard < 100000) {
						guard += 1;
						var a = atoms[i];
						if (a.br === true) {
							lines.push(cur);
							cur = { atoms: [], width: 0 };
							i += 1;
							continue;
						}
						var w = R.measure(a.text, a.size, a.style);
						a.w = w;
						if (a.space === true) {
							if (cur.width === 0) {
								i += 1;
								continue;
							}
							var next = atoms[i + 1];
							if (!next || next.br === true) {
								i += 1;
								continue;
							}
							var nextW = R.measure(next.text, next.size, next.style);
							if (cur.width + w + nextW > maxWidth) {
								lines.push(cur);
								cur = { atoms: [], width: 0 };
								i += 1;
								continue;
							}
							// 空格宽度统一按半角算，避免 1px 抖动放大
							a.w = R.measure(" ", a.size, a.style);
							cur.atoms.push(a);
							cur.width += a.w;
							i += 1;
							continue;
						}
						if (cur.width > 0 && cur.width + w > maxWidth) {
							lines.push(cur);
							cur = { atoms: [], width: 0 };
						}
						if (w > maxWidth && cur.width === 0 && String(a.text).length > 1) {
							// 超宽的长词（长 URL、长路径、连写英文）：按字符拆成单字符原子再走一遍折行。
							// 注意：必须先把原原子删掉（splice(i, 1)）再把字符按顺序插回 i 处；
							// 若只插入不删除，i 不前进 ⇒ 同一个超宽原子被反复拆开、行数无限膨胀（真机上表现为整块被当成「内容过长」丢弃）。
							var chars = String(a.text).split("");
							atoms.splice(i, 1);
							for (var c = 0; c < chars.length; c++) {
								atoms.splice(i + c, 0, { text: chars[c], style: a.style, size: a.size });
							}
							continue;
						}
						cur.atoms.push(a);
						cur.width += w;
						i += 1;
					}
					lines.push(cur);
					if (lines.length === 0) lines.push({ atoms: [], width: 0 });
					return lines;
				};
				return R;
			}

			// ---- 简易、防御式的代码高亮 ----
			var KEYWORDS = {
				js: "var let const function return if else for while do break continue new class extends super this null undefined true false try catch finally throw switch case default typeof instanceof in of await async yield delete void import export from as static get set",
				ts: "var let const function return if else for while do break continue new class extends implements interface type enum namespace declare public private protected readonly abstract as any unknown never void null undefined true false try catch finally throw switch case default typeof instanceof in of await async yield import export from satisfies keyof infer is",
				py: "def class return if elif else for while break continue import from as pass raise try except finally with lambda yield global nonlocal assert del not and or in is None True False async await match case self",
				sh: "if then else elif fi for while do done case esac function return export local readonly declare source echo cd set unset trap exit in",
				json: "true false null",
				sql: "select from where insert into values update set delete create table alter drop index join left right inner outer on group by order having limit offset union all distinct as and or not null is like between count sum avg min max primary key foreign references",
				java: "public private protected class interface extends implements static final void int long double float boolean char String new return if else for while do break continue try catch finally throw throws import package this super null true false abstract synchronized volatile transient enum instanceof",
				go: "package import func var const type struct interface map chan go defer return if else for range break continue switch case default select nil true false string int int64 float64 bool error make new append len cap",
				rust: "fn let mut const struct enum impl trait pub use mod crate self super match if else for while loop break continue return unsafe where as dyn ref move async await true false Some None Ok Err String Vec",
				c: "int char float double void long short unsigned signed struct union enum typedef static const return if else for while do break continue switch case default sizeof goto extern register volatile inline NULL true false class public private template namespace using nullptr bool auto"
			};
			var LANG_ALIAS = {
				javascript: "js", jsx: "js", mjs: "js", cjs: "js", node: "js",
				typescript: "ts", tsx: "ts",
				python: "py", py3: "py",
				bash: "sh", shell: "sh", zsh: "sh", console: "sh", powershell: "sh", ps1: "sh", pwsh: "sh",
				json5: "json", jsonc: "json",
				postgres: "sql", postgresql: "sql", mysql: "sql", sqlite: "sql",
				golang: "go",
				rs: "rust",
				cpp: "c", "c++": "c", csharp: "java", cs: "java", kotlin: "java", swift: "java"
			};
			var HASH_COMMENT = { py: true, sh: true, rb: true, yaml: true, yml: true, toml: true, r: true, perl: true };
			var DASH_COMMENT = { sql: true, lua: true, hs: true };
			var BLOCK_COMMENT = { js: true, ts: true, java: true, c: true, go: true, rust: true, css: true, php: true };

			function normalizeLang(lang) {
				var key = String(lang || "").trim().toLowerCase();
				if (!key) return "";
				if (KEYWORDS[key]) return key;
				if (LANG_ALIAS[key]) return LANG_ALIAS[key];
				if (HASH_COMMENT[key]) return key;
				return key;
			}

			function keywordSet(lang) {
				var key = normalizeLang(lang);
				var text = KEYWORDS[key] || "";
				if (!text) return null;
				var parts = text.split(" ");
				var set = {};
				for (var i = 0; i < parts.length; i++) set[parts[i]] = true;
				return set;
			}

			/**
			 * 把一行代码切成 [{text, kind}]，kind ∈ text|com|str|num|kw|fn。
			 * 任何异常都回退成「整行 text」——渲染绝不能因为高亮挂掉。
			 */
			function highlightLine(line, lang) {
				var plain = [{ text: String(line), kind: "text" }];
				try {
					var key = normalizeLang(lang);
					var set = keywordSet(lang);
					var patterns = [];
					if (BLOCK_COMMENT[key]) patterns.push("\\/\\*[\\s\\S]*?\\*\\/");
					if (key !== "json") patterns.push("\\/\\/[^\\n]*");
					if (HASH_COMMENT[key] || key === "" || !set) patterns.push("#[^\\n]*");
					if (DASH_COMMENT[key]) patterns.push("--[^\\n]*");
					patterns.push("\"(?:[^\"\\\\]|\\\\.)*\"?");
					patterns.push("'(?:[^'\\\\]|\\\\.)*'?");
					patterns.push("`(?:[^`\\\\]|\\\\.)*`?");
					var re = new RegExp("(" + patterns.join("|") + ")|\\b(0[xX][0-9a-fA-F]+|\\d+(?:\\.\\d+)?)\\b|([A-Za-z_$][A-Za-z0-9_$]*)", "g");
					var out = [];
					var last = 0;
					var match;
					var guard = 0;
					while ((match = re.exec(String(line))) !== null && guard < 4000) {
						guard += 1;
						if (match.index > last) out.push({ text: String(line).slice(last, match.index), kind: "text" });
						var token = match[0];
						var kind = "text";
						if (match[1] !== undefined) {
							kind = /^(\/\/|#|--|\/\*)/.test(token) ? "com" : "str";
						} else if (match[2] !== undefined) {
							kind = "num";
						} else if (match[3] !== undefined) {
							if (set && set[token] === true) kind = "kw";
							else if (String(line).charAt(match.index + token.length) === "(") kind = "fn";
						}
						out.push({ text: token, kind: kind });
						last = match.index + token.length;
						if (token.length === 0) re.lastIndex += 1;
					}
					if (last < String(line).length) out.push({ text: String(line).slice(last), kind: "text" });
					return out.length > 0 ? out : plain;
				} catch (error) {
					return plain;
				}
			}

			function colorForKind(R, kind) {
				if (kind === "com") return R.syntax.com;
				if (kind === "str") return R.syntax.str;
				if (kind === "num") return R.syntax.num;
				if (kind === "kw") return R.syntax.kw;
				if (kind === "fn") return R.syntax.fn;
				return R.codeText;
			}

			/** 把一行（已高亮的）token 折成若干可视行；缩进宽度作为续行前缀。 */
			function wrapCodeTokens(R, tokens, firstWidth, contWidth, size) {
				// 防御：负数/NaN 的可用宽度同样会让每行只放一个原子
				if (!isFinite(firstWidth) || firstWidth <= 0) firstWidth = Math.max(size * 4, R.inner);
				if (!isFinite(contWidth) || contWidth <= 0) contWidth = firstWidth;
				var lines = [];
				var cur = [];
				var curWidth = 0;
				var limit = firstWidth;
				var guard = 0;
				for (var i = 0; i < tokens.length && guard < 20000; i++) {
					var token = tokens[i];
					var atoms = String(token.text).match(ATOM_RE) || [String(token.text)];
					for (var a = 0; a < atoms.length && guard < 20000; a++) {
						guard += 1;
						var piece = atoms[a];
						var w = R.measure(piece, size, { code: true });
						if (w > limit && curWidth === 0 && piece.length > 1) {
							// 单个超宽原子（长 URL / 长字符串）：按字符硬切。
							// 必须从前往后遍历，否则字符会被逐字倒序（push 的顺序 = 遍历顺序）。
							var chars = piece.split("");
							for (var c = 0; c < chars.length; c++) {
								var cw = R.measure(chars[c], size, { code: true });
								if (curWidth + cw > limit && cur.length > 0) {
									lines.push(cur);
									cur = [];
									curWidth = 0;
									limit = contWidth;
								}
								cur.push({ text: chars[c], kind: token.kind, w: cw });
								curWidth += cw;
							}
							continue;
						}
						if (curWidth > 0 && curWidth + w > limit) {
							lines.push(cur);
							cur = [];
							curWidth = 0;
							limit = contWidth;
						}
						cur.push({ text: piece, kind: token.kind, w: w });
						curWidth += w;
					}
				}
				lines.push(cur);
				return lines;
			}

			// ==================== 渲染：绘制原语 ====================
			function drawTextLine(ctx, R, line, x, y) {
				var cx = x;
				for (var i = 0; i < line.atoms.length; i++) {
					var atom = line.atoms[i];
					if (atom.br === true) continue;
					if (atom.space === true) {
						cx += atom.w;
						continue;
					}
					ctx.font = R.fontFor(atom.size, atom.style);
					if (atom.style.code === true) {
						ctx.fillStyle = R.codeBg;
						roundRectPath(ctx, cx - 2, y - atom.size * 0.72, atom.w + 4, atom.size * 1.44, 3);
						ctx.fill();
						ctx.fillStyle = R.codeText;
					} else if (atom.style.link) {
						ctx.fillStyle = R.link;
					} else {
						ctx.fillStyle = R.text;
					}
					ctx.fillText(atom.text, cx, y);
					if (atom.style.link) {
						ctx.strokeStyle = R.link;
						ctx.lineWidth = 1;
						ctx.beginPath();
						ctx.moveTo(cx, y + atom.size * 0.44);
						ctx.lineTo(cx + atom.w, y + atom.size * 0.44);
						ctx.stroke();
					}
					cx += atom.w;
				}
				return cx;
			}

			function linesWidth(line) {
				var total = 0;
				for (var i = 0; i < line.atoms.length; i++) total += line.atoms[i].w || 0;
				return total;
			}

			/** opts: { align:"left"|"right", maxWidth } */
			function drawWrapped(ctx, R, lines, x, top, lh, opts) {
				opts = opts || {};
				ctx.textBaseline = "middle";
				var y = top + lh / 2;
				for (var i = 0; i < lines.length; i++) {
					var drawX = x;
					if (opts.align === "right") {
						var maxWidth = opts.maxWidth === undefined ? R.inner : opts.maxWidth;
						drawX = x + maxWidth - linesWidth(lines[i]);
					}
					drawTextLine(ctx, R, lines[i], drawX, y);
					y += lh;
				}
				return y;
			}

			function drawDivider(ctx, R, top, x, width) {
				ctx.strokeStyle = R.line;
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(x, top + 0.5);
				ctx.lineTo(x + width, top + 0.5);
				ctx.stroke();
			}

			// ---- 附件图缓存（默认不画；includeImages 打开才尝试，失败一律回退占位） ----
			var imageCache = {};

			function ensureImage(src, onReady) {
				if (!src) return null;
				var entry = imageCache[src];
				if (entry) {
					if (entry.state === "loading" && typeof onReady === "function") entry.waiters.push(onReady);
					return entry;
				}
				entry = { state: "loading", img: null, waiters: typeof onReady === "function" ? [onReady] : [] };
				imageCache[src] = entry;
				try {
					var img = new Image();
					img.onload = function () {
						entry.state = "ready";
						entry.img = img;
						flushImageWaiters(entry);
					};
					img.onerror = function () {
						entry.state = "failed";
						flushImageWaiters(entry);
					};
					img.src = src;
				} catch (error) {
					entry.state = "failed";
					flushImageWaiters(entry);
				}
				return entry;
			}

			function flushImageWaiters(entry) {
				var waiters = entry.waiters || [];
				entry.waiters = [];
				for (var i = 0; i < waiters.length; i++) {
					try {
						waiters[i]();
					} catch (error) {
						/* 单个回调失败不影响其它 */
					}
				}
			}

			// ==================== 渲染：排版规划 ====================
			function planParagraph(R, block, push) {
				var lines = R.wrap(block.runs, R.inner, R.base, null);
				var h = lines.length * R.lh + R.gap;
				push(h, function (ctx, top) {
					drawWrapped(ctx, R, lines, R.pad, top, R.lh, { maxWidth: R.inner });
				});
			}

			function planHeading(R, block, push, first) {
				var level = clamp(block.level || 2, 1, 6);
				var factor = [0, 1.62, 1.4, 1.24, 1.14, 1.06, 1.0][level] || 1.2;
				var size = Math.round(R.base * factor * 100) / 100;
				var lines = R.wrap(block.runs, R.inner, size, { bold: true });
				var lh = Math.round(size * 1.4 * 100) / 100;
				var h = lines.length * lh + (first ? 0 : R.headGapBefore) + R.headGapAfter;
				push(h, function (ctx, top) {
					var y = top + (first ? 0 : R.headGapBefore);
					var baseline = y + lh / 2;
					ctx.textBaseline = "middle";
					for (var i = 0; i < lines.length; i++) {
						var line = lines[i];
						var cx = R.pad;
						for (var j = 0; j < line.atoms.length; j++) {
							var atom = line.atoms[j];
							if (atom.br === true) continue;
							if (atom.space === true) {
								cx += atom.w;
								continue;
							}
							ctx.font = R.fontFor(atom.size, { bold: true, code: atom.style.code === true, italic: atom.style.italic === true });
							ctx.fillStyle = R.text;
							ctx.fillText(atom.text, cx, baseline);
							cx += atom.w;
						}
						baseline += lh;
					}
				});
			}

			function planList(R, block, push) {
				var size = R.base;
				var lh = R.lh;
				var indentUnit = Math.round(R.base * 1.6);
				var items = block.items || [];
				var plan = [];
				for (var i = 0; i < items.length; i++) {
					var item = items[i];
					var indent = R.pad + indentUnit * (item.level + 1);
					var bodyWidth = R.pad + R.inner - indent;
					var paragraphs = [];
					for (var p = 0; p < item.paragraphs.length; p++) {
						paragraphs.push(R.wrap(item.paragraphs[p], bodyWidth, size, null));
					}
					var lines = 0;
					for (var q = 0; q < paragraphs.length; q++) lines += paragraphs[q].length;
					plan.push({
						indent: indent,
						marker: item.ordered === true ? String(item.index) + "." : "•",
						markerIndent: R.pad + indentUnit * item.level,
						paragraphs: paragraphs,
						height: lines * lh + R.listGap
					});
				}
				var total = 0;
				for (var t = 0; t < plan.length; t++) total += plan[t].height;
				total += R.gap;
				push(total, function (ctx, top) {
					var y = top;
					ctx.textBaseline = "middle";
					for (var i2 = 0; i2 < plan.length; i2++) {
						var entry = plan[i2];
						ctx.font = R.fontFor(size, { bold: entry.marker !== "•" });
						ctx.fillStyle = R.dim;
						ctx.fillText(entry.marker, entry.markerIndent + R.base * 0.2, y + lh / 2);
						for (var p2 = 0; p2 < entry.paragraphs.length; p2++) {
							var lines2 = entry.paragraphs[p2];
							for (var l = 0; l < lines2.length; l++) {
								drawTextLine(ctx, R, lines2[l], entry.indent, y + lh / 2 + l * lh);
							}
							y += lines2.length * lh;
						}
						y += R.listGap;
					}
				});
			}

			function planQuote(R, block, push) {
				var bar = 3;
				var innerPad = Math.round(R.base * 0.9);
				var bodyWidth = R.inner - bar - innerPad * 2;
				var paragraphs = [];
				var paragraphsRaw = block.paragraphs && block.paragraphs.length > 0 ? block.paragraphs : [[]];
				for (var i = 0; i < paragraphsRaw.length; i++) paragraphs.push(R.wrap(paragraphsRaw[i], bodyWidth, R.base, null));
				var lines = 0;
				for (var p = 0; p < paragraphs.length; p++) lines += paragraphs[p].length;
				var textHeight = lines * R.lh;
				var boxHeight = textHeight + innerPad * 2;
				var h = boxHeight + R.gap;
				push(h, function (ctx, top) {
					ctx.fillStyle = R.preset.dark ? "rgba(255,255,255,0.055)" : "rgba(20,30,60,0.045)";
					roundRectPath(ctx, R.pad, top, R.inner, boxHeight, 8);
					ctx.fill();
					ctx.fillStyle = R.accent;
					roundRectPath(ctx, R.pad, top, bar, boxHeight, 1.5);
					ctx.fill();
					var y = top + innerPad;
					var x = R.pad + bar + innerPad;
					ctx.textBaseline = "middle";
					ctx.globalAlpha = 0.94;
					for (var p2 = 0; p2 < paragraphs.length; p2++) {
						for (var l = 0; l < paragraphs[p2].length; l++) {
							drawTextLine(ctx, R, paragraphs[p2][l], x, y + R.lh / 2);
							y += R.lh;
						}
					}
					ctx.globalAlpha = 1;
				});
			}

			function planCode(R, block, push) {
				var size = Math.round(R.base * 0.9 * 100) / 100;
				var lh = Math.round(size * 1.6 * 100) / 100;
				var padX = Math.round(size * 0.95);
				var padY = Math.round(size * 0.7);
				var labelH = Math.round(size * 1.75);
				var gutter = R.config.lineNumbers === true ? Math.round(size * 2.4) : 0;
				var avail = R.inner - padX * 2 - gutter;
				var source = String(block.code || "").replace(/\t/g, "  ").replace(/\r/g, "");
				var sourceLines = source.split("\n");
				var clipped = false;
				if (sourceLines.length > MAX_CODE_LINES) {
					sourceLines = sourceLines.slice(0, MAX_CODE_LINES);
					clipped = true;
				}
				// 去掉首尾空行
				while (sourceLines.length > 1 && sourceLines[0].trim() === "") sourceLines.shift();
				while (sourceLines.length > 1 && sourceLines[sourceLines.length - 1].trim() === "") sourceLines.pop();
				var visual = [];
				for (var i = 0; i < sourceLines.length; i++) {
					var raw = sourceLines[i];
					var leadMatch = /^[ ]*/.exec(raw);
					var lead = leadMatch ? leadMatch[0].length : 0;
					var indentText = new Array(Math.min(lead, 24) + 1).join(" ");
					var indentWidth = R.measure(indentText, size, { code: true });
					var tokens = R.config.highlight === true ? highlightLine(raw, block.lang) : [{ text: raw, kind: "text" }];
					var wrapped;
					if (R.config.codeWrap === true) {
						wrapped = wrapCodeTokens(R, tokens, avail - indentWidth, avail - indentWidth, size);
					} else {
						wrapped = [[]];
						for (var t = 0; t < tokens.length; t++) {
							var pieces = String(tokens[t].text).match(ATOM_RE) || [String(tokens[t].text)];
							for (var pc = 0; pc < pieces.length; pc++) {
								wrapped[0].push({ text: pieces[pc], kind: tokens[t].kind, w: R.measure(pieces[pc], size, { code: true }) });
							}
						}
					}
					for (var w = 0; w < wrapped.length; w++) {
						visual.push({ indentText: w === 0 ? "" : indentText, width: indentWidth, tokens: wrapped[w], source: i + 1 });
					}
					if (visual.length > 1600) {
						clipped = true;
						break;
					}
				}
				if (clipped) {
					visual.push({ indentText: "", width: 0, tokens: [{ text: "…（代码过长已截断）", kind: "com", w: 0 }], source: 0, note: true });
				}
				var codeHeight = visual.length * lh;
				var total = labelH + padY * 2 + codeHeight + R.gap;
				push(total, function (ctx, top) {
					ctx.fillStyle = R.codeBg;
					roundRectPath(ctx, R.pad, top, R.inner, labelH + padY * 2 + codeHeight, 10);
					ctx.fill();
					ctx.strokeStyle = R.line;
					ctx.lineWidth = 1;
					roundRectPath(ctx, R.pad + 0.5, top + 0.5, R.inner - 1, labelH + padY * 2 + codeHeight - 1, 10);
					ctx.stroke();
					// 顶部语言标签行
					ctx.textBaseline = "middle";
					ctx.font = R.fontFor(Math.round(size * 0.85), { code: true });
					ctx.fillStyle = R.dim;
					var label = String(block.lang || "").trim() || "code";
					ctx.fillText(label, R.pad + padX, top + labelH / 2);
					ctx.strokeStyle = R.line;
					ctx.beginPath();
					ctx.moveTo(R.pad, top + labelH + 0.5);
					ctx.lineTo(R.pad + R.inner, top + labelH + 0.5);
					ctx.stroke();
					// 代码正文
					var y = top + labelH + padY;
					ctx.textBaseline = "middle";
					for (var i2 = 0; i2 < visual.length; i2++) {
						var entry = visual[i2];
						var cx = R.pad + padX + gutter;
						if (R.config.lineNumbers === true && entry.note !== true) {
							ctx.font = R.fontFor(Math.round(size * 0.85), { code: true });
							ctx.fillStyle = R.syntax.com;
							var numberText = String(entry.source);
							var numberWidth = R.measure(numberText, Math.round(size * 0.85), { code: true });
							ctx.fillText(numberText, R.pad + padX + gutter - 8 - numberWidth, y + lh / 2);
						}
						if (entry.indentText) {
							ctx.font = R.fontFor(size, { code: true });
							ctx.fillStyle = R.codeText;
							ctx.fillText(entry.indentText, cx, y + lh / 2);
							cx += entry.width;
						}
						for (var t2 = 0; t2 < entry.tokens.length; t2++) {
							var token = entry.tokens[t2];
							ctx.font = R.fontFor(size, { code: true });
							ctx.fillStyle = entry.note === true ? R.syntax.com : colorForKind(R, token.kind);
							var width = token.w || R.measure(token.text, size, { code: true });
							if (!R.config.codeWrap) {
								// 不折行时裁掉超出内容区的部分
								if (cx + width > R.pad + R.inner - padX) break;
							}
							ctx.fillText(token.text, cx, y + lh / 2);
							cx += width;
						}
						y += lh;
					}
				});
			}

			function planTable(R, block, push) {
				var size = Math.round(R.base * 0.92 * 100) / 100;
				var lh = Math.round(size * 1.5 * 100) / 100;
				var cellPadX = Math.round(size * 0.72);
				var cellPadY = Math.round(size * 0.5);
				var columns = clamp(block.columns || 0, 1, 12);
				var header = block.header || [];
				var rows = block.rows || [];
				// 自然宽度：按每列最长内容估，再等比缩放到内容区宽度
				var natural = [];
				var c;
				for (c = 0; c < columns; c++) natural.push(size * 3);
				for (c = 0; c < columns; c++) {
					if (header[c]) {
						var headerText = runsText(header[c]);
						natural[c] = Math.max(natural[c], Math.min(R.measure(headerText, size, { bold: true }) + cellPadX * 2, R.inner * 0.7));
					}
					for (var r = 0; r < rows.length; r++) {
						if (!rows[r][c]) continue;
						var cellText = runsText(rows[r][c]);
						natural[c] = Math.max(natural[c], Math.min(R.measure(cellText, size, null) + cellPadX * 2, R.inner * 0.7));
					}
				}
				var totalNatural = 0;
				for (c = 0; c < columns; c++) totalNatural += natural[c];
				var widths = [];
				var scale = totalNatural > 0 ? R.inner / totalNatural : 1;
				for (c = 0; c < columns; c++) widths.push(Math.max(size * 2.6, natural[c] * scale));
				// 等比缩放后可能仍有溢出，按比例削到刚好放下
				var widthSum = 0;
				for (c = 0; c < columns; c++) widthSum += widths[c];
				if (widthSum > R.inner) {
					for (c = 0; c < columns; c++) widths[c] = widths[c] * (R.inner / widthSum);
				}
				var plan = [];
				var headerLines = null;
				if (header.length > 0) {
					headerLines = [];
					var headerHeight = 0;
					for (c = 0; c < columns; c++) {
						var hLines = R.wrap(header[c] || [], Math.max(20, widths[c] - cellPadX * 2), size, { bold: true });
						headerLines.push(hLines);
						headerHeight = Math.max(headerHeight, hLines.length);
					}
					plan.push({ header: true, cells: headerLines, height: headerHeight * lh + cellPadY * 2 });
				}
				for (var r2 = 0; r2 < rows.length; r2++) {
					var cellLines = [];
					var maxLines = 1;
					for (c = 0; c < columns; c++) {
						var lines = R.wrap(rows[r2][c] || [], Math.max(20, widths[c] - cellPadX * 2), size, null);
						cellLines.push(lines);
						maxLines = Math.max(maxLines, lines.length);
					}
					plan.push({ header: false, cells: cellLines, height: maxLines * lh + cellPadY * 2 });
				}
				var tableHeight = 0;
				for (var i = 0; i < plan.length; i++) tableHeight += plan[i].height;
				var total = tableHeight + R.gap;
				push(total, function (ctx, top) {
					var y = top;
					ctx.textBaseline = "middle";
					for (var i2 = 0; i2 < plan.length; i2++) {
						var row = plan[i2];
						if (row.header) {
							ctx.fillStyle = R.codeBg;
							ctx.fillRect(R.pad, y, R.inner, row.height);
						}
						// 单元格文字
						var cx = R.pad;
						for (var c2 = 0; c2 < columns; c2++) {
							var colWidth = widths[c2];
							var lines2 = row.cells[c2] || [];
							var textY = y + cellPadY + lh / 2;
							for (var l = 0; l < lines2.length; l++) {
								if (row.header) {
									var line = lines2[l];
									var lx = cx + cellPadX;
									for (var a = 0; a < line.atoms.length; a++) {
										var atom = line.atoms[a];
										if (atom.br === true) continue;
										if (atom.space === true) {
											lx += atom.w;
											continue;
										}
										ctx.font = R.fontFor(atom.size, { bold: true, code: atom.style.code === true });
										ctx.fillStyle = R.text;
										ctx.fillText(atom.text, lx, textY + l * lh);
										lx += atom.w;
									}
								} else {
									drawTextLine(ctx, R, lines2[l], cx + cellPadX, textY + l * lh);
								}
							}
							cx += colWidth;
						}
						y += row.height;
					}
					// 表格线
					ctx.strokeStyle = R.line;
					ctx.lineWidth = 1;
					var lineY = top;
					ctx.beginPath();
					ctx.moveTo(R.pad + 0.5, lineY);
					ctx.lineTo(R.pad + 0.5, lineY + tableHeight);
					var xCursor = R.pad;
					for (var c3 = 0; c3 <= columns; c3++) {
						ctx.moveTo(xCursor + 0.5, lineY);
						ctx.lineTo(xCursor + 0.5, lineY + tableHeight);
						if (c3 < columns) xCursor += widths[c3];
					}
					for (var i3 = 0; i3 < plan.length; i3++) {
						ctx.moveTo(R.pad, lineY + 0.5);
						ctx.lineTo(R.pad + R.inner, lineY + 0.5);
						lineY += plan[i3].height;
					}
					ctx.moveTo(R.pad, lineY - 0.5);
					ctx.lineTo(R.pad + R.inner, lineY - 0.5);
					ctx.stroke();
				});
			}

			function planRule(R, push) {
				var h = R.ruleGap * 2;
				push(h, function (ctx, top) {
					drawDivider(ctx, R, top + R.ruleGap, R.pad, R.inner);
				});
			}

			function planImage(R, block, push) {
				if (R.config.includeImages === true && block.src) {
					var entry = ensureImage(block.src, R.onAssetReady);
					if (entry && entry.state === "ready" && entry.img) {
						var img = entry.img;
						var naturalW = img.naturalWidth || img.width || R.inner;
						var naturalH = img.naturalHeight || img.height || naturalW * 0.6;
						var drawW = Math.min(R.inner, naturalW);
						var drawH = Math.round(drawW * (naturalH / Math.max(1, naturalW)));
						var maxH = Math.round(R.base * 26);
						if (drawH > maxH) {
							drawH = maxH;
							drawW = Math.round(drawH * (naturalW / Math.max(1, naturalH)));
						}
						var h = drawH + R.gap;
						push(h, function (ctx, top) {
							try {
								ctx.save();
								roundRectPath(ctx, R.pad, top, drawW, drawH, 8);
								ctx.clip();
								ctx.drawImage(img, R.pad, top, drawW, drawH);
								ctx.restore();
							} catch (error) {
								ctx.restore();
								warn("图片绘制失败，回退成占位文本", error);
							}
						});
						return;
					}
					// 正在加载 / 加载失败 → 占位（不影响导出）
					var placeholder = [{ text: block.alt ? "[图片：" + block.alt + "]（加载中或不可用）" : "[图片]（加载中或不可用）", bold: false, italic: false, code: false, link: null }];
					planParagraph(R, { type: "paragraph", runs: placeholder }, push);
					return;
				}
				planParagraph(R, { type: "paragraph", runs: [{ text: block.alt ? "[图片：" + block.alt + "]" : "[图片]" }] }, push);
			}

			function planBlock(R, block, push, first) {
				if (!block || !block.type) return;
				try {
					if (block.type === "paragraph") return planParagraph(R, block, push);
					if (block.type === "heading") return planHeading(R, block, push, first);
					if (block.type === "list") return planList(R, block, push);
					if (block.type === "quote") return planQuote(R, block, push);
					if (block.type === "code") return planCode(R, block, push);
					if (block.type === "table") return planTable(R, block, push);
					if (block.type === "hr") return planRule(R, push);
					if (block.type === "image") return planImage(R, block, push);
					if (block.runs) return planParagraph(R, block, push);
				} catch (error) {
					warn("块排版失败，已跳过：" + block.type, error);
				}
			}

			function autoTitle() {
				try {
					var node = document.querySelector("[data-conversation-header-leading]");
					if (node) {
						var text = textOf(node).trim();
						if (text) return text.slice(0, 60);
					}
				} catch (error) {
					/* 忽略 */
				}
				try {
					var docTitle = String(document.title || "").trim();
					if (docTitle) {
						var cleaned = docTitle.replace(/\s*[·\-—|]\s*DeepSeek Harness\s*$/i, "").trim();
						return (cleaned || docTitle).slice(0, 60);
					}
				} catch (error) {
					/* 忽略 */
				}
				return "对话分享";
			}

			function normalizeModel(model) {
				if (typeof model === "string") {
					var text = model;
					var paras = text.split(/\n{2,}/);
					var blocks = [];
					for (var i = 0; i < paras.length; i++) blocks.push({ type: "paragraph", runs: [{ text: paras[i] }] });
					return { blocks: blocks, question: "", meta: {}, title: "" };
				}
				var src = model && typeof model === "object" ? model : {};
				return {
					blocks: src.blocks && src.blocks.length ? src.blocks : [],
					question: src.question || "",
					meta: src.meta || {},
					title: src.title || ""
				};
			}

			/** 规划整张卡片：先量（ops 只算高度）后画（同一批 ops 再喂给真 canvas）。 */
			function planCard(R, model) {
				var ops = [];
				var y = R.pad;
				var truncated = false;
				function push(height, draw) {
					if (y + height > R.pad + R.limit) {
						truncated = true;
						return false;
					}
					ops.push({ h: height, draw: draw });
					y += height;
					return true;
				}
				var config = R.config;
				// ---- 头部：标题 + 可选时间 + 细分割线 ----
				if (config.showHeader === true) {
					var titleText = String(config.title || "").trim() || autoTitle();
					var size = Math.round(R.base * 1.28 * 100) / 100;
					var titleLines = R.wrap([{ text: titleText, bold: true }], R.inner * (config.showTime ? 0.72 : 1), size, null);
					var timeText = String((model.meta && model.meta.time) || "").trim();
					var lh = Math.round(size * 1.5 * 100) / 100;
					var h = titleLines.length * lh + R.base * 0.9 + 1;
					push(h, function (ctx, top) {
						ctx.textBaseline = "middle";
						drawWrapped(ctx, R, titleLines, R.pad, top, lh, { maxWidth: R.inner * (config.showTime ? 0.72 : 1) });
						if (config.showTime === true && timeText) {
							ctx.font = R.fontFor(Math.round(R.base * 0.9), null);
							ctx.fillStyle = R.dim;
							var width = R.measure(timeText, Math.round(R.base * 0.9), null);
							ctx.fillText(timeText, R.pad + R.inner - width, top + lh / 2);
						}
						drawDivider(ctx, R, top + titleLines.length * lh + R.base * 0.9, R.pad, R.inner);
					});
				}
				// ---- 提问 ----
				if (config.showQuestion === true) {
					var question = String(model.question || "").trim();
					if (question) {
						var qSize = Math.round(R.base * 0.98 * 100) / 100;
						var qLh = Math.round(qSize * 1.5 * 100) / 100;
						var labelSize = Math.round(R.base * 0.8);
						var qLines = R.wrap([{ text: question }], R.inner - R.base * 2.2, qSize, null);
						if (qLines.length > 6) qLines = qLines.slice(0, 6);
						var labelWidth = R.measure(String(config.questionLabel || "提问"), labelSize, { bold: true }) + R.base * 0.6;
						var qTextHeight = qLines.length * qLh;
						var boxHeight = Math.max(qTextHeight + R.base * 1.6, R.base * 3.2);
						push(boxHeight + R.gap, function (ctx, top) {
							ctx.fillStyle = R.preset.dark ? "rgba(255,255,255,0.055)" : "rgba(20,30,60,0.045)";
							roundRectPath(ctx, R.pad, top, R.inner, boxHeight, 10);
							ctx.fill();
							ctx.strokeStyle = R.line;
							ctx.lineWidth = 1;
							roundRectPath(ctx, R.pad + 0.5, top + 0.5, R.inner - 1, boxHeight - 1, 10);
							ctx.stroke();
							ctx.textBaseline = "middle";
							ctx.font = R.fontFor(labelSize, { bold: true });
							ctx.fillStyle = R.accent;
							var textTop = top + (boxHeight - qTextHeight) / 2;
							ctx.fillText(String(config.questionLabel || "提问"), R.pad + R.base * 0.9, textTop + qLh / 2);
							drawWrapped(ctx, R, qLines, R.pad + R.base * 0.9 + labelWidth, textTop, qLh, { maxWidth: R.inner - R.base * 2.2 });
						});
					}
				}
				// ---- 正文块 ----
				var blocks = model.blocks || [];
				for (var i = 0; i < blocks.length; i++) {
					if (truncated) break;
					planBlock(R, blocks[i], push, i === 0);
				}
				// ---- 页脚 ----
				if (config.showFooter === true || config.showWatermark === true) {
					var fSize = Math.round(R.base * 0.85);
					var footerText = String(config.footer || "");
					var watermarkText = String(config.watermark || "");
					var h2 = R.base * 1.4 + 1;
					if (config.showFooter === true && footerText) {
						push(h2, function (ctx, top) {
							drawDivider(ctx, R, top + R.base * 0.5, R.pad, R.inner);
							ctx.textBaseline = "middle";
							ctx.font = R.fontFor(fSize, null);
							ctx.fillStyle = R.dim;
							ctx.fillText(footerText, R.pad, top + R.base * 0.9);
							if (config.showWatermark === true && watermarkText) {
								var width = R.measure(watermarkText, fSize, null);
								ctx.globalAlpha = 0.75;
								ctx.fillText(watermarkText, R.pad + R.inner - width, top + R.base * 0.9);
								ctx.globalAlpha = 1;
							}
						});
					} else if (config.showWatermark === true && watermarkText) {
						push(R.base * 1.6, function (ctx, top) {
							ctx.textBaseline = "middle";
							ctx.font = R.fontFor(fSize, null);
							ctx.fillStyle = R.dim;
							ctx.globalAlpha = 0.75;
							var width = R.measure(watermarkText, fSize, null);
							ctx.fillText(watermarkText, R.pad + R.inner - width, top + R.base * 0.7);
							ctx.globalAlpha = 1;
						});
					}
				}
				return { ops: ops, height: y + R.pad, truncated: truncated };
			}

			function paintBackground(ctx, R, W, H) {
				try {
					var angle = (R.preset.angle * Math.PI) / 180;
					var dx = Math.sin(angle);
					var dy = -Math.cos(angle);
					var cx = W / 2;
					var cy = H / 2;
					var len = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
					var gradient = ctx.createLinearGradient(cx - dx * len, cy - dy * len, cx + dx * len, cy + dy * len);
					gradient.addColorStop(0, R.preset.from);
					gradient.addColorStop(1, R.preset.to);
					ctx.fillStyle = gradient;
					ctx.fillRect(0, 0, W, H);
				} catch (error) {
					ctx.fillStyle = R.preset.from;
					ctx.fillRect(0, 0, W, H);
				}
				try {
					var glow = ctx.createRadialGradient(W * 0.18, -H * 0.06, 0, W * 0.18, -H * 0.06, Math.max(W, H) * 0.95);
					glow.addColorStop(0, R.preset.dark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.62)");
					glow.addColorStop(1, "rgba(255,255,255,0)");
					ctx.fillStyle = glow;
					ctx.fillRect(0, 0, W, H);
				} catch (error) {
					/* 高光失败不影响主体 */
				}
			}

			/**
			 * 把纯数据画成卡片。
			 * 返回 { canvas, width, height, truncated, model, preset }；width/height 是逻辑尺寸（canvas 是 scale 倍）。
			 * 第三个参数 hooks（可选）：{ onAssetReady } —— 附件图加载完成后回调，用来触发重绘。
			 */
			function renderCard(model, config, hooks) {
				if (!globalThis.document || typeof document.createElement !== "function") {
					throw new Error("当前环境没有 DOM/canvas，无法渲染卡片");
				}
				var cfg = sanitize(config || readConfig());
				var normalized = normalizeModel(model);
				var measureCanvas = document.createElement("canvas");
				measureCanvas.width = 8;
				measureCanvas.height = 8;
				var mctx = measureCanvas.getContext("2d");
				if (!mctx) throw new Error("当前环境拿不到 2D 画布上下文");
				var R = makeRenderContext(mctx, cfg);
				if (hooks && typeof hooks.onAssetReady === "function") R.onAssetReady = hooks.onAssetReady;
				var plan = planCard(R, normalized);
				var W = cfg.width;
				var H = Math.max(Math.round(R.base * 4), Math.round(plan.height));
				var scale = cfg.scale;
				var canvas = document.createElement("canvas");
				canvas.width = Math.max(1, Math.round(W * scale));
				canvas.height = Math.max(1, Math.round(H * scale));
				var ctx = canvas.getContext("2d");
				if (!ctx) throw new Error("当前环境拿不到 2D 画布上下文");
				ctx.save();
				if (scale !== 1) ctx.scale(scale, scale);
				roundRectPath(ctx, 0, 0, W, H, cfg.radius);
				ctx.clip();
				paintBackground(ctx, R, W, H);
				// 规划时的 y 从 R.pad 起步，绘制也必须从 R.pad 起步（ops 的 top 由这里传入）
				var y = R.pad;
				for (var i = 0; i < plan.ops.length; i++) {
					try {
						plan.ops[i].draw(ctx, y);
					} catch (error) {
						warn("绘制块失败，已跳过", error);
					}
					y += plan.ops[i].h;
				}
				if (plan.truncated) {
					ctx.textBaseline = "middle";
					ctx.font = R.fontFor(Math.round(R.base * 0.9), null);
					ctx.fillStyle = R.dim;
					var note = "……（内容过长已截断）";
					var noteWidth = R.measure(note, Math.round(R.base * 0.9), null);
					ctx.fillText(note, (W - noteWidth) / 2, H - R.base * 1.4);
				}
				ctx.restore();
				return { canvas: canvas, width: W, height: H, truncated: plan.truncated, model: normalized, preset: R.preset };
			}

			// ==================== 工作台浮层（studio） ====================
			var studio = null;
			var studioOpen = false;
			var lastError = "";
			var lastBlocksCount = 0;

			function showToast(message, isError) {
				var text = String(message || "");
				if (!text) return;
				try {
					var host = studio && studio.root ? studio.root : document.body;
					if (!host) return;
					var node = el("div", "dsc-toast" + (isError === true ? " err" : ""));
					node.textContent = text;
					host.appendChild(node);
					setTimeout(function () {
						try {
							if (node.parentNode) node.parentNode.removeChild(node);
						} catch (error) {
							/* 忽略 */
						}
					}, 3400);
				} catch (error) {
					warn(text);
				}
			}

			function clickDownload(url, filename) {
				var link = document.createElement("a");
				link.setAttribute("download", filename);
				link.setAttribute("href", url);
				link.style.display = "none";
				document.body.appendChild(link);
				link.click();
				setTimeout(function () {
					try {
						if (link.parentNode) link.parentNode.removeChild(link);
					} catch (error) {
						/* 忽略 */
					}
				}, 0);
			}

			function openStudioWithData(data) {
				ensureStyle();
				var model = { blocks: data.blocks, question: data.question, meta: data.meta };
				var root = el("div", "dsc-mask");
				root.setAttribute(STYLE_ATTR, "1");
				var panel = el("div", "dsc-panel");
				// ---- 头部 ----
				var head = el("div", "dsc-head");
				head.appendChild(control("span", "dsc-title", "分享卡片"));
				var sub = control("span", "dsc-sub", "");
				head.appendChild(sub);
				var headActions = el("div", "dsc-head-actions");
				var fitButton = control("button", "dsc-btn ghost", "适应窗口");
				fitButton.setAttribute("type", "button");
				var fullButton = control("button", "dsc-btn ghost", "100%");
				fullButton.setAttribute("type", "button");
				var closeTop = control("button", "dsc-btn ghost", "关闭");
				closeTop.setAttribute("type", "button");
				headActions.appendChild(fitButton);
				headActions.appendChild(fullButton);
				headActions.appendChild(closeTop);
				head.appendChild(headActions);
				panel.appendChild(head);
				// ---- 主体：预览 + 参数 ----
				var body = el("div", "dsc-body");
				var preview = el("div", "dsc-preview");
				var stage = el("div", "dsc-stage");
				var previewCanvas = el("canvas", "dsc-canvas");
				stage.appendChild(previewCanvas);
				preview.appendChild(stage);
				var side = el("div", "dsc-side");
				body.appendChild(preview);
				body.appendChild(side);
				panel.appendChild(body);
				// ---- 底部动作 ----
				var foot = el("div", "dsc-foot");
				var exportButton = control("button", "dsc-btn primary", "导出 PNG");
				exportButton.setAttribute("type", "button");
				var copyButton = control("button", "dsc-btn", "复制到剪贴板");
				copyButton.setAttribute("type", "button");
				var resetButton = control("button", "dsc-btn ghost", "恢复默认");
				resetButton.setAttribute("type", "button");
				var zoomLabel = control("span", "dsc-zoom", "");
				var closeFoot = control("button", "dsc-btn ghost", "关闭");
				closeFoot.setAttribute("type", "button");
				foot.appendChild(exportButton);
				foot.appendChild(copyButton);
				foot.appendChild(resetButton);
				foot.appendChild(zoomLabel);
				foot.appendChild(closeFoot);
				panel.appendChild(foot);
				root.appendChild(panel);

				var handle = {
					root: root,
					panel: panel,
					preview: preview,
					previewCanvas: previewCanvas,
					zoom: "fit",
					out: null,
					lastCanvas: null,
					config: null,
					destroy: null,
					refresh: null,
					schedule: null
				};

				// ---- 事件绑定登记（关闭时逐一摘掉） ----
				var bindings = [];
				function bind(target, type, handler, options) {
					if (!target || typeof target.addEventListener !== "function") return;
					target.addEventListener(type, handler, options);
					bindings.push({ target: target, type: type, handler: handler, options: options });
				}

				// ---- 重绘调度（rAF + 100ms 兜底，多次改动合并成一次） ----
				var rafId = 0;
				var timerId = 0;
				function doRender() {
					var cfg = readConfig();
					handle.config = cfg;
					var out;
					try {
						out = renderCard(model, cfg, { onAssetReady: handle.onAssetReady });
					} catch (error) {
						lastError = "渲染失败：" + msgOf(error);
						showToast(lastError, true);
						return;
					}
					handle.out = out;
					handle.lastCanvas = out.canvas;
					var pc = handle.previewCanvas;
					pc.width = out.canvas.width;
					pc.height = out.canvas.height;
					var pctx = pc.getContext("2d");
					if (pctx) {
						pctx.clearRect(0, 0, pc.width, pc.height);
						pctx.drawImage(out.canvas, 0, 0);
					}
					applyZoom();
					sub.textContent =
						(data.meta && data.meta.turnNumber ? "回合 #" + data.meta.turnNumber + " · " : "") +
						out.model.blocks.length + " 个区块 · " +
						out.width + "×" + out.height + " 逻辑像素 · " + cfg.scale + "× 导出" +
						(out.truncated ? " · 已截断" : "");
					refreshControls();
				}
				handle.schedule = function () {
					if (rafId !== 0 || timerId !== 0) return;
					var run = function () {
						if (rafId !== 0 && typeof cancelAnimationFrame === "function") {
							try {
								cancelAnimationFrame(rafId);
							} catch (error) {
								/* 忽略 */
							}
						}
						if (timerId !== 0) clearTimeout(timerId);
						rafId = 0;
						timerId = 0;
						doRender();
					};
					if (typeof requestAnimationFrame === "function") rafId = requestAnimationFrame(run);
					timerId = setTimeout(run, 100);
				};
				handle.refresh = function () {
					handle.schedule();
				};

				function currentFactor() {
					if (!handle.out) return 1;
					var avail = Math.max(120, preview.clientWidth - 40);
					if (handle.zoom === "fit") return Math.min(1, avail / handle.out.width);
					return Number(handle.zoom) || 1;
				}

				function applyZoom() {
					if (!handle.out) return;
					var factor = currentFactor();
					handle.previewCanvas.style.width = Math.round(handle.out.width * factor) + "px";
					handle.previewCanvas.style.height = "auto";
					zoomLabel.textContent = Math.round(factor * 100) + "%";
					fitButton.className = handle.zoom === "fit" ? "dsc-btn" : "dsc-btn ghost";
					fullButton.className = handle.zoom === 1 ? "dsc-btn" : "dsc-btn ghost";
				}

				// ---- 控件 ----
				var refreshers = [];
				buildControlSet(side, STUDIO_CONTROLS, refreshers);
				function refreshControls() {
					for (var i = 0; i < refreshers.length; i++) {
						try {
							refreshers[i]();
						} catch (error) {
							/* 单个控件刷新失败不影响其它 */
						}
					}
				}

				// ---- 动作 ----
				function exportPng() {
					var canvas = handle.lastCanvas;
					if (!canvas) {
						showToast("还没有渲染结果", true);
						return;
					}
					var filename = "share-card-" + stampNow() + ".png";
					function viaDataUrl() {
						try {
							var url = canvas.toDataURL("image/png");
							clickDownload(url, filename);
							showToast("已导出 " + filename);
						} catch (error) {
							lastError = "导出失败：" + msgOf(error);
							showToast(lastError + "（含图片时可能被画布污染拦下，可关掉「画入图片」再导）", true);
						}
					}
					if (typeof canvas.toBlob !== "function") {
						viaDataUrl();
						return;
					}
					try {
						canvas.toBlob(function (blob) {
							if (!blob) {
								viaDataUrl();
								return;
							}
							try {
								var url = URL.createObjectURL(blob);
								clickDownload(url, filename);
								showToast("已导出 " + filename);
								setTimeout(function () {
									try {
										URL.revokeObjectURL(url);
									} catch (error) {
										/* 忽略 */
									}
								}, 12000);
							} catch (error) {
								viaDataUrl();
							}
						}, "image/png");
					} catch (error) {
						viaDataUrl();
					}
				}

				function copyPng() {
					var canvas = handle.lastCanvas;
					var ClipboardItemCtor = globalThis.ClipboardItem;
					var clipboard = globalThis.navigator && globalThis.navigator.clipboard;
					if (!canvas || typeof canvas.toBlob !== "function") {
						showToast("当前环境不支持图片剪贴板，请用「导出 PNG」", true);
						return;
					}
					if (typeof ClipboardItemCtor !== "function" || !clipboard || typeof clipboard.write !== "function") {
						showToast("当前环境不支持图片剪贴板，请用「导出 PNG」", true);
						return;
					}
					try {
						canvas.toBlob(function (blob) {
							if (!blob) {
								showToast("生成图片失败，请用「导出 PNG」", true);
								return;
							}
							try {
								var item = new ClipboardItemCtor({ "image/png": blob });
								clipboard.write([item]).then(
									function () {
										showToast("已复制到剪贴板");
									},
									function (error) {
										showToast("复制失败：" + msgOf(error) + "；可以改用「导出 PNG」", true);
									}
								);
							} catch (error) {
								showToast("复制失败：" + msgOf(error) + "；可以改用「导出 PNG」", true);
							}
						}, "image/png");
					} catch (error) {
						showToast("复制失败：" + msgOf(error) + "；可以改用「导出 PNG」", true);
					}
				}

				function closeNow() {
					closeStudio();
				}

				exportButton.addEventListener("click", exportPng);
				copyButton.addEventListener("click", copyPng);
				resetButton.addEventListener("click", function () {
					resetConfig();
					showToast("已恢复默认外观");
					handle.schedule();
				});
				closeTop.addEventListener("click", closeNow);
				closeFoot.addEventListener("click", closeNow);
				fitButton.addEventListener("click", function () {
					handle.zoom = "fit";
					applyZoom();
				});
				fullButton.addEventListener("click", function () {
					handle.zoom = 1;
					applyZoom();
				});

				// 点遮罩空白处关闭；面板内滚轮不穿透到宿主页面
				bind(root, "mousedown", function (event) {
					if (event.target === root) closeNow();
				});
				bind(root, "wheel", function (event) {
					event.stopPropagation();
				}, { passive: true });
				bind(preview, "wheel", function (event) {
					if (event.ctrlKey !== true && event.altKey !== true) return;
					event.preventDefault();
					event.stopPropagation();
					var next = currentFactor() * (event.deltaY > 0 ? 0.92 : 1.08);
					handle.zoom = clamp(next, 0.15, 3);
					applyZoom();
				}, { passive: false });
				bind(document, "keydown", function (event) {
					if (event.key === "Escape" || event.keyCode === 27) {
						event.stopPropagation();
						closeNow();
					}
				}, true);
				bind(globalThis, "resize", function () {
					applyZoom();
				});
				// 让图片加载完成后能自动重绘一次（可用时才生效）
				handle.onAssetReady = function () {
					handle.schedule();
				};

				document.body.appendChild(root);
				studio = handle;
				studioOpen = true;
				handle.destroy = function () {
					for (var i = bindings.length - 1; i >= 0; i--) {
						try {
							bindings[i].target.removeEventListener(bindings[i].type, bindings[i].handler, bindings[i].options);
						} catch (error) {
							/* 忽略 */
						}
					}
					bindings.length = 0;
					if (rafId !== 0 && typeof cancelAnimationFrame === "function") {
						try {
							cancelAnimationFrame(rafId);
						} catch (error) {
							/* 忽略 */
						}
					}
					if (timerId !== 0) clearTimeout(timerId);
					rafId = 0;
					timerId = 0;
					try {
						if (root.parentNode) root.parentNode.removeChild(root);
					} catch (error) {
						/* 忽略 */
					}
					try {
						previewCanvas.width = 1;
						previewCanvas.height = 1;
					} catch (error) {
						/* 忽略 */
					}
					handle.lastCanvas = null;
					handle.out = null;
					preview.textContent = "";
					side.textContent = "";
				};
				// 图片加载完成后自动重绘（planImage 会拿 R.onAssetReady 当回调）
				handle.refresh();
				return handle;
			}

			/** 宿主给的 messageId 有时形如 "turn:14"，能直接当回合号用。 */
			function turnNumberFromMessageId(messageId) {
				var raw = String(messageId == null ? "" : messageId);
				var m = /^turn[:/](\d+)$/.exec(raw);
				return m ? m[1] : null;
			}

			/** 打开工作台：先由锚点定位回合号 → 提取纯数据 → 建浮层。 */
			function openStudio(messageId, anchorEl) {
				var turnNumber = turnNumberFromAnchor(anchorEl);
				var target = turnNumber !== null ? turnNumber : anchorEl;
				var data = null;
				try {
					data = extractMessage(target);
				} catch (error) {
					data = { ok: false, reason: "提取消息失败：" + msgOf(error) };
				}
				// 锚点推不出回合号时（例如按钮不在 flow 行里），再用宿主给的 messageId 兜一次
				if (!data || data.ok !== true) {
					var byId = turnNumberFromMessageId(messageId);
					if (byId !== null && byId !== turnNumber) {
						try {
							var retry = extractMessage(byId);
							if (retry && retry.ok === true) data = retry;
						} catch (error) {
							/* 保持原错误 */
						}
					}
				}
				if (!data || data.ok !== true) {
					lastError = (data && data.reason) || "这条回答还没渲染出来，先把它滚动到可见位置再试一次";
					showToast(lastError, true);
					return { ok: false, reason: lastError };
				}
				lastError = "";
				lastBlocksCount = data.blocks.length;
				closeStudio();
				try {
					return { ok: true, handle: openStudioWithData(data) };
				} catch (error) {
					lastError = "工作台打开失败：" + msgOf(error);
					showToast(lastError, true);
					return { ok: false, reason: lastError };
				}
			}

			/** automation API：直接对当前页面最后一个回合打开工作台。 */
			function openStudioForLast() {
				var data = extractLastTurn();
				if (!data || data.ok !== true) {
					lastError = (data && data.reason) || "页面上还没有可分享的回答";
					showToast(lastError, true);
					return { ok: false, reason: lastError };
				}
				lastError = "";
				lastBlocksCount = data.blocks.length;
				closeStudio();
				try {
					openStudioWithData(data);
					return { ok: true };
				} catch (error) {
					lastError = "工作台打开失败：" + msgOf(error);
					showToast(lastError, true);
					return { ok: false, reason: lastError };
				}
			}

			function closeStudio() {
				if (!studio) {
					studioOpen = false;
					return false;
				}
				var handle = studio;
				studio = null;
				studioOpen = false;
				try {
					if (typeof handle.destroy === "function") handle.destroy();
				} catch (error) {
					warn("关闭浮层时出错（已忽略）", error);
				}
				return true;
			}

			/** automation API：无 DOM 交互地提取最后一条回答并渲染。 */
			function extractAndRender(partialConfig) {
				var partial = partialConfig && typeof partialConfig === "object" ? partialConfig : {};
				var data = extractLastTurn();
				if (!data || data.ok !== true) {
					lastError = (data && data.reason) || "页面上还没有可分享的回答";
					return { ok: false, reason: lastError };
				}
				var config = readConfig();
				try {
					if (Object.keys(partial).length > 0) config = sanitize(patchForRender(config, partial));
				} catch (error) {
					warn("配置合并失败，改用当前配置", error);
				}
				var out;
				try {
					out = renderCard({ blocks: data.blocks, question: data.question, meta: data.meta }, config);
				} catch (error) {
					lastError = "渲染失败：" + msgOf(error);
					return { ok: false, reason: lastError };
				}
				lastError = "";
				lastBlocksCount = data.blocks.length;
				var result = {
					ok: true,
					width: out.width,
					height: out.height,
					scale: config.scale,
					truncated: out.truncated,
					blocks: data.blocks.length,
					question: data.question,
					preset: out.preset ? out.preset.id : config.preset,
					dataUrl: null,
					canvas: out.canvas
				};
				if (partial.returnDataUrl === true) {
					try {
						result.dataUrl = out.canvas.toDataURL("image/png");
					} catch (error) {
						lastError = "导出 DataURL 失败：" + msgOf(error);
						result.dataUrl = null;
						result.reason = lastError;
					}
				}
				return result;
			}

			/** 把 automation API 的 partial 合并进配置（丢弃非配置字段，如 returnDataUrl）。 */
			function patchForRender(config, partial) {
				var merged = {};
				for (var key in config) {
					if (Object.prototype.hasOwnProperty.call(config, key)) merged[key] = config[key];
				}
				for (var name in partial) {
					if (!Object.prototype.hasOwnProperty.call(partial, name)) continue;
					if (name === "returnDataUrl" || name === "blocks" || name === "question") continue;
					merged[name] = partial[name];
				}
				return merged;
			}

			// ==================== 参数控件（工作台与设置页共用） ====================
			function rowOf(labelText, node) {
				var wrap = el("div", "dsc-row");
				wrap.appendChild(control("div", "k", labelText));
				var value = el("div", "v");
				value.appendChild(node);
				wrap.appendChild(value);
				return wrap;
			}

			function pillButton(labelText, onClick) {
				var button = control("button", "dsc-pill", labelText);
				button.setAttribute("type", "button");
				button.addEventListener("click", onClick);
				return button;
			}

			function rangeInput(min, max, step, value, onInput) {
				var input = document.createElement("input");
				input.setAttribute("type", "range");
				input.className = "dsc-range";
				input.min = String(min);
				input.max = String(max);
				input.step = String(step);
				input.value = String(value);
				input.addEventListener("input", function () {
					onInput(Number(input.value));
				});
				return input;
			}

			function numberLabel() {
				return control("span", "dsc-num", "");
			}

			function addPresetGrid(host, refreshers) {
				var grid = el("div", "dsc-presets");
				var buttons = [];
				for (var i = 0; i < PRESET_LIST.length; i++) {
					(function (preset) {
						var button = el("button", "dsc-preset");
						button.setAttribute("type", "button");
						button.setAttribute("data-preset-id", preset.id);
						button.setAttribute("title", preset.label);
						button.style.background = "linear-gradient(135deg," + preset.from + "," + preset.to + ")";
						button.appendChild(control("span", null, preset.label));
						button.addEventListener("click", function () {
							// 点浅色预设顺手把主题也切过去，反之亦然 —— 不然对比度会很难看
							writeConfig({ preset: preset.id, theme: preset.dark === true ? "dark" : "light" });
						});
						grid.appendChild(button);
						buttons.push(button);
					})(PRESET_LIST[i]);
				}
				host.appendChild(grid);
				refreshers.push(function () {
					var config = readConfig();
					for (var i2 = 0; i2 < buttons.length; i2++) {
						var on = buttons[i2].getAttribute("data-preset-id") === config.preset;
						buttons[i2].className = on ? "dsc-preset on" : "dsc-preset";
					}
				});
			}

			function addPillRow(host, labelText, options, key, refreshers) {
				var box = el("div", "dsc-pills");
				var buttons = [];
				for (var i = 0; i < options.length; i++) {
					(function (option) {
						var button = pillButton(option.label, function () {
							var patch = {};
							patch[key] = option.value;
							writeConfig(patch);
						});
						box.appendChild(button);
						buttons.push({ node: button, value: option.value });
					})(options[i]);
				}
				host.appendChild(rowOf(labelText, box));
				refreshers.push(function () {
					var config = readConfig();
					for (var i2 = 0; i2 < buttons.length; i2++) {
						buttons[i2].node.className = buttons[i2].value === config[key] ? "dsc-pill on" : "dsc-pill";
					}
				});
			}

			function addToggleRow(host, labelText, key, refreshers) {
				var button = pillButton("", function () {
					var config = readConfig();
					var patch = {};
					patch[key] = config[key] !== true;
					writeConfig(patch);
				});
				host.appendChild(rowOf(labelText, button));
				refreshers.push(function () {
					var on = readConfig()[key] === true;
					button.className = on ? "dsc-pill on" : "dsc-pill";
					button.textContent = on ? "开" : "关";
				});
			}

			function addRangeRow(host, labelText, min, max, step, key, format, refreshers) {
				var valueLabel = numberLabel();
				var input = rangeInput(min, max, step, DEFAULTS[key], function (value) {
					var patch = {};
					patch[key] = value;
					writeConfig(patch);
				});
				var row = rowOf(labelText, input);
				row.lastChild.appendChild(valueLabel);
				host.appendChild(row);
				refreshers.push(function () {
					var value = readConfig()[key];
					if (document.activeElement !== input) input.value = String(value);
					valueLabel.textContent = format(value);
				});
			}

			function addTextRow(host, labelText, key, placeholder, refreshers) {
				var input = document.createElement("input");
				input.setAttribute("type", "text");
				input.className = "dsc-input";
				input.setAttribute("data-field", key);
				if (placeholder) input.setAttribute("placeholder", placeholder);
				var timer = 0;
				input.addEventListener("input", function () {
					var patch = {};
					patch[key] = input.value;
					writeConfig(patch);
					// 输入防抖：立即落盘，200ms 后才重绘预览
					if (timer !== 0) clearTimeout(timer);
					timer = setTimeout(function () {
						timer = 0;
						if (studio && typeof studio.schedule === "function") studio.schedule();
					}, 200);
				});
				host.appendChild(rowOf(labelText, input));
				refreshers.push(function () {
					var value = readConfig()[key];
					// 正在输入时不要覆盖用户的光标内容
					if (document.activeElement !== input) input.value = value;
				});
			}

			function addSectionTitle(host, text) {
				host.appendChild(control("div", "dsc-sec", text));
			}

			var STUDIO_CONTROLS = [
				"#预设", "presets",
				"#主题", "theme", "font",
				"#尺寸", "width", "radius", "padding", "fontSize", "lineHeight", "scale",
				"#渲染", "codeWrap", "highlight", "lineNumbers", "includeImages",
				"#显示", "showHeader", "showFooter", "showQuestion", "showTime", "showWatermark",
				"#文案", "title", "footer", "questionLabel", "watermark"
			];
			var SETTINGS_CONTROLS = [
				"#预设", "presets",
				"#外观", "theme", "font",
				"#尺寸", "width", "radius", "padding", "fontSize", "scale",
				"#显示", "showHeader", "showFooter", "showWatermark",
				"#文案", "title", "footer"
			];

			function buildControlSet(host, spec, refreshers) {
				for (var i = 0; i < spec.length; i++) {
					var key = spec[i];
					if (key.charAt(0) === "#") {
						addSectionTitle(host, key.slice(1));
						continue;
					}
					if (key === "presets") addPresetGrid(host, refreshers);
					else if (key === "theme") {
						addPillRow(host, "深浅", [{ value: "dark", label: "深色" }, { value: "light", label: "浅色" }], "theme", refreshers);
					} else if (key === "font") {
						addPillRow(
							host, "字体",
							[{ value: "sans", label: "无衬线" }, { value: "serif", label: "衬线" }, { value: "mono", label: "等宽" }],
							"font", refreshers
						);
					} else if (key === "width") {
						addPillRow(
							host, "宽度",
							[{ value: 720, label: "720" }, { value: 880, label: "880" }, { value: 1080, label: "1080" }],
							"width", refreshers
						);
					} else if (key === "scale") {
						addPillRow(
							host, "导出倍率",
							[{ value: 1, label: "1×" }, { value: 2, label: "2×" }, { value: 3, label: "3×" }],
							"scale", refreshers
						);
					} else if (key === "radius") {
						addRangeRow(host, "圆角", 0, 48, 1, "radius", function (v) {
							return Math.round(v) + "px";
						}, refreshers);
					} else if (key === "padding") {
						addRangeRow(host, "内边距", 24, 80, 1, "padding", function (v) {
							return Math.round(v) + "px";
						}, refreshers);
					} else if (key === "fontSize") {
						addRangeRow(host, "正文字号", 14, 22, 1, "fontSize", function (v) {
							return Math.round(v) + "px";
						}, refreshers);
					} else if (key === "lineHeight") {
						addRangeRow(host, "行高", 1.4, 2, 0.05, "lineHeight", function (v) {
							return Number(v).toFixed(2);
						}, refreshers);
					} else if (key === "codeWrap") addToggleRow(host, "代码折行", "codeWrap", refreshers);
					else if (key === "highlight") addToggleRow(host, "代码高亮", "highlight", refreshers);
					else if (key === "lineNumbers") addToggleRow(host, "代码行号", "lineNumbers", refreshers);
					else if (key === "includeImages") addToggleRow(host, "画入图片", "includeImages", refreshers);
					else if (key === "showHeader") addToggleRow(host, "显示头部", "showHeader", refreshers);
					else if (key === "showFooter") addToggleRow(host, "显示页脚", "showFooter", refreshers);
					else if (key === "showQuestion") addToggleRow(host, "显示提问", "showQuestion", refreshers);
					else if (key === "showTime") addToggleRow(host, "显示时间", "showTime", refreshers);
					else if (key === "showWatermark") addToggleRow(host, "显示水印", "showWatermark", refreshers);
					else if (key === "title") addTextRow(host, "标题", "title", autoTitle(), refreshers);
					else if (key === "footer") addTextRow(host, "页脚", "footer", DEFAULTS.footer, refreshers);
					else if (key === "questionLabel") addTextRow(host, "提问标签", "questionLabel", DEFAULTS.questionLabel, refreshers);
					else if (key === "watermark") addTextRow(host, "水印", "watermark", DEFAULTS.watermark, refreshers);
				}
			}

			// ==================== 设置页面板（settings.section 内容，纯 DOM） ====================
			var panels = [];

			function notifyConfigChanged() {
				if (studio && typeof studio.refresh === "function") {
					try {
						studio.refresh();
					} catch (error) {
						/* 单个刷新失败不影响其它 */
					}
				}
				for (var i = 0; i < panels.length; i++) {
					try {
						panels[i].refresh();
					} catch (error) {
						/* 单个面板刷新失败不影响其它 */
					}
				}
			}

			/** 构建设置页内容；返回 { refresh, destroy }。 */
			function buildSettingsPanel(host) {
				if (!host) return null;
				ensureStyle();
				host.textContent = "";
				var wrap = el("div", "dsc-settings");
				wrap.appendChild(control("p", "dsc-hint", "默认点每条回复下面的「分享卡片」生成 PNG；这里设默认外观。"));
				var refreshers = [];
				buildControlSet(wrap, SETTINGS_CONTROLS, refreshers);
				var actions = el("div", "dsc-foot");
				var resetButton = control("button", "dsc-btn ghost", "恢复默认");
				resetButton.setAttribute("type", "button");
				resetButton.addEventListener("click", function () {
					resetConfig();
				});
				actions.appendChild(resetButton);
				wrap.appendChild(actions);
				wrap.appendChild(control("p", "dsc-hint", "数据不出本机：全部在浏览器里排版导出，不联网、不上传。配置存于 localStorage 的 " + STORE_KEY + "。"));
				wrap.appendChild(control("p", "dsc-hint", "控制台可用 __dshShareCard（config / set / open / extractLast / render / extractAndRender / close / state）。"));
				host.appendChild(wrap);
				var instance = {
					host: host,
					refresh: function () {
						for (var i = 0; i < refreshers.length; i++) {
							try {
								refreshers[i]();
							} catch (error) {
								/* 忽略 */
							}
						}
					},
					destroy: function () {
						var index = panels.indexOf(instance);
						if (index >= 0) panels.splice(index, 1);
						try {
							host.textContent = "";
						} catch (error) {
							/* 忽略 */
						}
					}
				};
				panels.push(instance);
				instance.refresh();
				return instance;
			}

			// ==================== react 组件（动作按钮 + 设置页容器） ====================
			/** 小图标：内联 SVG（静态字符串，无用户输入，用 dangerouslySetInnerHTML 免去 children 数组的 key 噪音）。 */
			var ICON_SVG =
				'<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
				'<rect x="2.1" y="3.1" width="11.8" height="9.8" rx="2.2" stroke="currentColor" stroke-width="1.2"/>' +
				'<circle cx="5.9" cy="6.9" r="1.05" fill="currentColor"/>' +
				'<path d="M3.1 12.2l3.1-3 2.2 2.1 1.9-1.7 2.6 2.6" stroke="currentColor" stroke-width="1.2" ' +
				'stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

			function ShareCardAction(props) {
				var messageId = props ? props.messageId : undefined;
				function onClick(event) {
					try {
						if (event && typeof event.preventDefault === "function") event.preventDefault();
						if (event && typeof event.stopPropagation === "function") event.stopPropagation();
						var anchor = event && event.currentTarget ? event.currentTarget : event && event.target ? event.target : null;
						if (props && typeof props.openStudio === "function") props.openStudio(messageId, anchor);
						else warn("没有拿到 openStudio，工作台打不开");
					} catch (error) {
						warn("打开分享卡片工作台失败", error);
					}
				}
				return react.createElement(
					"button",
					{
						type: "button",
						className: "dsh-share-card-action",
						title: "生成分享卡片",
						"aria-label": "生成分享卡片",
						onClick: onClick
					},
					react.createElement("span", {
						className: "dsc-icon",
						dangerouslySetInnerHTML: { __html: ICON_SVG }
					}),
					react.createElement("span", { className: "dsc-label" }, "分享卡片")
				);
			}

			/** settings.section 槽要的是 React 组件；内容仍旧由 buildSettingsPanel 生成（纯 DOM）。 */
			function ShareCardSettingsSection() {
				var hostRef = react.useRef(null);
				react.useEffect(function () {
					var handle = buildSettingsPanel(hostRef.current);
					return function () {
						if (handle) handle.destroy();
					};
				}, []);
				return react.createElement("div", { ref: hostRef, className: "dsc-panel-host" });
			}

			// ==================== 槽位注册 ====================
			function registerActionSlot(slots) {
				if (!slots || typeof slots.inject !== "function" || typeof slots.register !== "function") return false;
				if (react === null || typeof react.createElement !== "function") {
					warn("拿不到 react，跳过「分享卡片」动作按钮（控制台仍可用 __dshShareCard.open()）");
					return false;
				}
				return slots.inject(ACTION_SLOT, function () {
					return slots.register(
						{
							name: ACTION_SLOT,
							id: "share-card",
							order: 55,
							// face 的字段会被展开进组件 props（连同 ownerProps 的 messageId 与标准 props）
							inject: function (sessionId) {
								return {
									openStudio: function (messageId, element) {
										return openStudio(messageId, element);
									}
								};
							}
						},
						ShareCardAction
					);
				});
			}

			function registerSettingsSlot(slots) {
				if (!slots || typeof slots.inject !== "function" || typeof slots.register !== "function") return false;
				if (react === null || typeof react.createElement !== "function") {
					warn("拿不到 react，跳过设置页「分享卡片」面板（控制台仍可用 __dshShareCard.set()）");
					return false;
				}
				return slots.inject(SETTINGS_SLOT, function () {
					return slots.register(
						{
							name: SETTINGS_SLOT,
							id: "share-card",
							order: 620,
							label: function () {
								return "分享卡片";
							}
						},
						function () {
							return react.createElement(ShareCardSettingsSection);
						}
					);
				});
			}

			function registerSlots(scoped) {
				var slots = null;
				if (scoped && scoped.slots) slots = scoped.slots;
				else {
					try {
						slots = (scoped && scoped.slots) || null;
					} catch (error) {
						slots = null;
					}
				}
				if (!slots) {
					warn("slots 服务不可用，跳过两个槽位注册（automation API 仍可用）");
					return false;
				}
				var okAction = false;
				var okSettings = false;
				try {
					okAction = registerActionSlot(slots) !== false;
				} catch (error) {
					warn("注册「分享卡片」动作按钮失败", error);
				}
				try {
					okSettings = registerSettingsSlot(slots) !== false;
				} catch (error) {
					warn("注册设置页「分享卡片」面板失败", error);
				}
				return okAction || okSettings;
			}

			// ==================== automation API（无头验证用） ====================
			function installAutomation() {
				var g = globalThis;
				if (!g) return false;
				g.__dshShareCard = {
					version: VERSION,
					config: readConfig,
					set: writeConfigAndPersist,
					reset: resetConfig,
					open: openStudioForLast,
					extractLast: extractLastTurn,
					render: renderCard,
					extractAndRender: extractAndRender,
					close: closeStudio,
					presets: function () {
						var out = [];
						for (var i = 0; i < PRESET_LIST.length; i++) {
							out.push({ id: PRESET_LIST[i].id, label: PRESET_LIST[i].label, dark: PRESET_LIST[i].dark });
						}
						return out;
					},
					// 便于调试：把纯数据直接画出来（不读页面）
					renderBlocks: function (blocks, partialConfig) {
						var config = readConfig();
						if (partialConfig && typeof partialConfig === "object") config = sanitize(patchForRender(config, partialConfig));
						var out = renderCard({ blocks: blocks || [] }, config);
						return { ok: true, width: out.width, height: out.height, canvas: out.canvas };
					},
					state: function () {
						return { version: VERSION, open: studioOpen, lastError: lastError, blocks: lastBlocksCount };
					}
				};
				return true;
			}

			// ==================== 客户端插件入口 ====================
			// 工厂体执行时就把 automation API 挂上：即使 react/slots 都拿不到，无头断言也能用。
			try {
				installAutomation();
			} catch (error) {
				warn("automation API 挂载失败", error);
			}

			apply = function (ctx) {
				try {
					ensureStyle();
				} catch (error) {
					/* 样式失败不影响功能 */
				}
				try {
					installAutomation();
				} catch (error) {
					warn("automation API 挂载失败", error);
				}
				// 卸载时彻底清掉浮层与监听器
				if (ctx && typeof ctx.effect === "function") {
					try {
						ctx.effect(function () {
							return function () {
								closeStudio();
							};
						}, "dsh-share-card: studio teardown");
					} catch (error) {
						/* 忽略 */
					}
				}
				// 两个槽位都只走动态 inject(["slots"])：不要用 ctx.slots 试探 ——
				// Cordis 对未声明的服务直接抛错，真机上正是这一步吞掉了注册分支。
				try {
					if (ctx && typeof ctx.inject === "function") {
						ctx.inject(["slots"], function (scoped) {
							try {
								registerSlots(scoped || ctx);
							} catch (error) {
								warn("槽位注册流程异常", error);
							}
						});
					} else if (ctx) {
						var directSlots = null;
						try {
							directSlots = ctx.slots || null;
						} catch (error) {
							directSlots = null;
						}
						if (directSlots) registerSlots({ slots: directSlots });
					}
				} catch (error) {
					warn("槽位注册流程异常", error);
				}
				try {
					console.info(
						"[dsh-share-card] " + VERSION + " ready — 每条回复下面点「分享卡片」即可生成 PNG；" +
							"设置 → 分享卡片 可设默认外观；控制台用 __dshShareCard（config/set/open/extractLast/render/extractAndRender/close/state）。数据不出本机。"
					);
				} catch (error) {
					/* 忽略 */
				}
			};
			exports.apply = apply;
		} catch (error) {
			try {
				console.error("[dsh-share-card] client half failed to initialize", error);
			} catch (inner) {
				/* 忽略 */
			}
		}

		return module.exports;
	}
});
