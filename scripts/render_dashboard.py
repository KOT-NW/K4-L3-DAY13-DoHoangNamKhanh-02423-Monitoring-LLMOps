from __future__ import annotations

import argparse
import html
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.cli import configure_utf8_stdio  # noqa: E402
from app.dashboard_metrics import build_dashboard  # noqa: E402

DEFAULT_LOG = REPO_ROOT / "data" / "logs.jsonl"
DEFAULT_CONFIG = REPO_ROOT / "config" / "dashboard.yaml"
DEFAULT_OUT = REPO_ROOT / "data" / "dashboard.html"


def bar_row(label: str, value: float, unit: str, scale: float, threshold: float | None) -> str:
    width = min(100.0, (value / scale) * 100) if scale else 0.0
    marker = ""
    if threshold is not None and scale:
        marker = (
            f'<div class="marker" style="left:{min(100.0, threshold / scale * 100):.2f}%" '
            f'title="threshold {threshold}"></div>'
        )
    return (
        f'<div class="row"><span class="row-label">{html.escape(label)}</span>'
        f'<span class="track">{marker}<span class="fill" style="width:{width:.2f}%"></span></span>'
        f'<span class="row-value">{value:,.1f} {html.escape(unit)}</span></div>'
    )


def panel(title: str, unit: str, threshold_note: str, body: str) -> str:
    return (
        f'<section class="panel"><h2>{html.escape(title)}</h2>'
        f'<p class="meta">unit: {html.escape(unit)} · {html.escape(threshold_note)}</p>'
        f"{body}</section>"
    )


def render(metrics: dict, dashboard: dict) -> str:
    latency = metrics["latency"]
    traffic = metrics["traffic"]
    errors = metrics["errors"]
    cost = metrics["cost"]
    tokens = metrics["tokens"]
    quality = metrics["quality"]

    lat_scale = max(3000.0, latency["p99"])
    latency_body = "".join(
        [
            bar_row("P50", latency["p50"], "ms", lat_scale, None),
            bar_row("P95", latency["p95"], "ms", lat_scale, 3000),
            bar_row("P99", latency["p99"], "ms", lat_scale, None),
            bar_row("TTFT P95", latency["ttft_p95"], "ms", lat_scale, None),
        ]
    )
    traffic_body = bar_row("requests", traffic["count"], "req", max(traffic["count"], 1), None)
    traffic_body += bar_row(
        "rate", traffic["rate_per_minute"], "req/min", max(traffic["rate_per_minute"], 1), 1
    )

    error_types = "".join(
        f"<li>{html.escape(str(k))}: {v}</li>" for k, v in sorted(errors["by_type"].items())
    ) or "<li>none</li>"
    errors_body = "".join(
        [
            bar_row("error rate", errors["error_rate_pct"], "%", 100, 2),
            bar_row("retrieval success", errors["retrieval_success_pct"], "%", 100, 90),
        ]
    ) + f'<ul class="breakdown">by error_type:{error_types}</ul>'

    cost_scale = max(cost["total"], 2.5)
    cost_body = bar_row("total cost", cost["total"], "usd", cost_scale, 2.5)
    if cost["series"]:
        peak = max(point["value"] for point in cost["series"]) or 1
        cost_body += '<div class="spark">' + "".join(
            f'<span title="{html.escape(point["t"])}: {point["value"]:.4f} usd" '
            f'style="height:{max(2.0, point["value"] / peak * 100):.0f}%"></span>'
            for point in cost["series"]
        ) + "</div>"

    tokens_body = "".join(
        [
            bar_row("input", tokens["in"], "tok", max(tokens["in"], tokens["out"], 1), None),
            bar_row("output", tokens["out"], "tok", max(tokens["in"], tokens["out"], 1), None),
        ]
    )
    quality_body = bar_row("mean quality", quality["mean"], "score", 1.0, 0.75)

    panels = {
        "latency": panel(
            "Latency percentiles and TTFT", "ms", "threshold: p95 ≤ 3000 ms", latency_body
        ),
        "traffic": panel("Request traffic", "requests_per_minute", "threshold: rate ≥ 1", traffic_body),
        "errors": panel(
            "Error rate and retrieval success",
            "percent",
            "thresholds: error ≤ 2%, retrieval ≥ 90%",
            errors_body,
        ),
        "cost": panel("Cost over time", "usd", "threshold: total ≤ 2.5 usd", cost_body),
        "tokens": panel("Input and output tokens", "tokens", "threshold: total ≤ 50000", tokens_body),
        "quality": panel("Quality proxy", "score_0_to_1", "threshold: mean ≥ 0.75", quality_body),
    }

    grid = "".join(
        panels[p.get("id", "")] for p in dashboard.get("panels", []) if p.get("id") in panels
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{html.escape(dashboard.get("title", "Day 13 Dashboard"))}</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{ margin:0; background:#0d1117; color:#e6edf3;
         font-family:"Segoe UI",Roboto,Helvetica,Arial,sans-serif; padding:24px; }}
  header h1 {{ margin:0 0 4px; font-size:20px; }}
  header p {{ margin:0 0 20px; color:#8b949e; font-size:13px; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(340px,1fr)); gap:16px; }}
  .panel {{ background:#161b22; border:1px solid #30363d; border-radius:10px; padding:16px; }}
  .panel h2 {{ margin:0 0 4px; font-size:15px; }}
  .meta {{ margin:0 0 14px; color:#8b949e; font-size:12px; }}
  .row {{ display:grid; grid-template-columns:110px 1fr 110px; align-items:center;
          gap:8px; margin:7px 0; font-size:12px; }}
  .row-label {{ color:#c9d1d9; }}
  .row-value {{ text-align:right; font-variant-numeric:tabular-nums; color:#e6edf3; }}
  .track {{ position:relative; height:12px; background:#21262d; border-radius:6px; overflow:hidden; }}
  .fill {{ position:absolute; left:0; top:0; bottom:0; background:linear-gradient(90deg,#1f6feb,#58a6ff); }}
  .marker {{ position:absolute; top:-3px; bottom:-3px; width:2px; background:#f85149; z-index:2; }}
  .breakdown {{ list-style:none; margin:10px 0 0; padding:8px 10px; background:#21262d;
                border-radius:6px; font-size:12px; color:#c9d1d9; }}
  .breakdown li {{ margin:2px 0; }}
  .spark {{ display:flex; align-items:flex-end; gap:3px; height:60px; margin-top:12px; }}
  .spark span {{ flex:1; background:#238636; border-radius:2px 2px 0 0; min-width:3px; }}
</style>
</head>
<body>
<header>
  <h1>{html.escape(dashboard.get("title", "Day 13 Dashboard"))}</h1>
  <p>window: last {metrics["window_minutes"]} min · generated {metrics["generated_at"]} ·
     source data/logs.jsonl</p>
</header>
<div class="grid">{grid}</div>
</body>
</html>
"""


def main() -> int:
    configure_utf8_stdio()
    parser = argparse.ArgumentParser(description="Render 6-panel dashboard from data/logs.jsonl")
    parser.add_argument("--log", type=Path, default=DEFAULT_LOG)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--window-minutes", type=int, default=60)
    args = parser.parse_args()

    import yaml

    dashboard = yaml.safe_load(args.config.read_text(encoding="utf-8"))["dashboard"]
    metrics = build_dashboard(args.log, args.config, args.window_minutes)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render(metrics, dashboard), encoding="utf-8")
    print(f"Wrote dashboard: {args.out} ({metrics['record_count']} records)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
