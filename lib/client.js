window.__ModuleLoader__.load({
	id: "dsh-douyin-ip-report",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const h = React.createElement;

		const PANEL_ID = "dsh-douyin-report";
		const NS = "dsh-douyin-report";
		const STYLE_ID = "dsh-douyin-report-css";
		const REPORT_URL = "https://www.douyin.com/qinquan/report?enter_from=pc_douyin";
		const STATUS_LABEL = {
			prepared: "已准备",
			preparing: "准备中",
			submitting: "提交中",
			submission_clicked_unverified: "已点击 · 未核验",
			submitted: "已提交",
			preparation_failed: "准备失败",
			failed: "提交失败",
			unknown: "未知",
		};
		const KIND_LABEL = { patent: "专利", trademark: "商标" };
		const HOST_LABEL = { deepseek: "DSH", codex: "Codex" };

		function injectCss() {
			if (typeof document === "undefined") return;
			if (document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]')) return;
			const style = document.createElement("style");
			style.dataset.pluginCss = STYLE_ID;
			style.textContent = `
.ddr-panel{box-sizing:border-box;max-width:920px;margin:0 auto;padding:24px 28px;color:var(--dsw-alias-label-primary,#1f2328);font:13px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.ddr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
.ddr-title{margin:0;font-size:20px;line-height:28px;font-weight:650}
.ddr-sub{margin:6px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ddr-actions{display:flex;flex-wrap:wrap;gap:8px}
.ddr-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2328);border-radius:8px;padding:6px 12px;font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.ddr-btn:hover{border-color:var(--dsw-alias-border-l3,#d9dde3)}
.ddr-btn:disabled{opacity:.55;cursor:default}
.ddr-btn-primary{border-color:var(--dsw-alias-brand-primary,#4f6ef7);background:var(--dsw-alias-brand-primary,#4f6ef7);color:#fff}
.ddr-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px}
.ddr-card{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);border-radius:10px;padding:12px 14px}
.ddr-num{font-size:22px;line-height:28px;font-weight:650;font-variant-numeric:tabular-nums}
.ddr-label{margin-top:2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ddr-section{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);border-radius:10px;padding:14px 16px}
.ddr-section-title{margin:0 0 8px;font-size:13px;font-weight:650}
.ddr-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--dsw-alias-border-l2,#eef0f4);font-size:12px;line-height:18px}
.ddr-row:first-of-type{border-top:none}
.ddr-kind{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:20px;border-radius:5px;background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;font-weight:600}
.ddr-status{font-weight:600}
.ddr-meta{margin-left:auto;color:var(--dsw-alias-label-tertiary,#8b93a1);font-variant-numeric:tabular-nums;white-space:nowrap}
.ddr-empty{padding:18px 0;text-align:center;color:var(--dsw-alias-label-secondary,#9ca3af);font-size:12px}
.ddr-error{margin:0 0 14px;padding:10px 12px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 8%,transparent);color:var(--dsw-alias-state-error-primary,#dc2626);font-size:12px;line-height:18px}
.ddr-note{margin:14px 0 0;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,#8b93a1)}
.ddr-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;border-radius:5px;background:linear-gradient(135deg,#fe2c55,#ff7185);color:#fff;font-weight:700;line-height:1;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
`;
			document.head.appendChild(style);
		}

		function Icon({ size = 16 }) {
			return h("span", {
				className: "ddr-icon",
				style: { width: size, height: size, fontSize: Math.max(9, size - 4) },
				"aria-hidden": "true",
			}, "抖");
		}

		function formatTime(value) {
			if (!value) return "—";
			const date = new Date(value);
			if (Number.isNaN(date.getTime())) return "—";
			return date.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
		}

		function Panel() {
			const [state, setState] = React.useState({ loading: true, data: null, error: null });
			const load = React.useCallback(async () => {
				setState((prev) => ({ ...prev, loading: true, error: null }));
				try {
					const response = await fetch("/dsh-douyin-report/summary", { cache: "no-store" });
					if (!response.ok) throw new Error("HTTP " + response.status);
					const data = await response.json();
					if (!data || data.ok !== true) throw new Error("summary unavailable");
					setState({ loading: false, data, error: null });
				} catch (error) {
					setState({ loading: false, data: null, error: error instanceof Error ? error.message : String(error) });
				}
			}, []);
			React.useEffect(() => { load(); }, [load]);
			const data = state.data;
			const counts = data?.counts || {};
			const cards = [
				{ label: "本地任务", value: data?.total ?? 0 },
				{ label: "已准备", value: counts.prepared ?? 0 },
				{ label: "已提交 / 待核验", value: (counts.submitted ?? 0) + (counts.submission_clicked_unverified ?? 0) },
				{ label: "失败", value: (counts.preparation_failed ?? 0) + (counts.failed ?? 0) },
			];
			return h("div", { className: "ddr-panel" },
				h("div", { className: "ddr-head" },
					h("div", null,
						h("h1", { className: "ddr-title" }, "抖音侵权举报"),
						h("p", { className: "ddr-sub" }, "本机任务状态（DSH / Codex）；平台审核结果请用技能的 status 查询。"),
					),
					h("div", { className: "ddr-actions" },
						h("button", { className: "ddr-btn", onClick: load, disabled: state.loading }, state.loading ? "刷新中…" : "刷新"),
						h("button", { className: "ddr-btn ddr-btn-primary", onClick: () => window.open(REPORT_URL, "_blank", "noopener,noreferrer") }, "打开抖音举报页"),
					),
				),
				state.error ? h("div", { className: "ddr-error" }, "读取本地任务失败：" + state.error) : null,
				h("div", { className: "ddr-cards" }, cards.map((card) => h("div", { className: "ddr-card", key: card.label },
					h("div", { className: "ddr-num" }, String(card.value)),
					h("div", { className: "ddr-label" }, card.label),
				))),
				h("div", { className: "ddr-section" },
					h("h2", { className: "ddr-section-title" }, "最近任务"),
					data && data.recent && data.recent.length
						? data.recent.map((item, index) => h("div", { className: "ddr-row", key: index },
							h("span", { className: "ddr-kind" }, [KIND_LABEL[item.kind] || item.kind, HOST_LABEL[item.host]].filter(Boolean).join(" · ")),
							h("span", { className: "ddr-status" }, STATUS_LABEL[item.status] || item.status),
							h("span", null, item.links == null ? "" : item.links + " 条"),
							h("span", { className: "ddr-meta" }, formatTime(item.updated_at)),
						))
						: h("div", { className: "ddr-empty" }, state.loading ? "读取中…" : "暂无本地任务记录"),
				),
				h("p", { className: "ddr-note" }, "这里只汇总本机 DSH / Codex 任务文件的状态，不会读取或上传举报材料；平台是否受理、审核结果以抖音历史回执为准。"),
			);
		}

		function apply(ctx) {
			injectCss();
			let registered = false;
			ctx.slots.inject("sidebar.panellist", () => {
				if (registered) return;
				registered = true;
				ctx.slots.register({ name: "main", key: PANEL_ID, locale: NS }, () => h(Panel));
				ctx.slots.register({
					name: "sidebar.panellist",
					id: PANEL_ID,
					order: 6,
					label: () => "抖音举报",
					locale: NS,
				}, (owner = {}) => h(Icon, { size: owner.size ?? 16 }));
			});
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		return module.exports;
	},
});
