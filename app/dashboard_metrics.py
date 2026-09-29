from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOG_PATH = REPO_ROOT / "data" / "logs.jsonl"
DEFAULT_DASHBOARD_CONFIG = REPO_ROOT / "config" / "dashboard.yaml"


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = (len(ordered) - 1) * pct / 100
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return float(ordered[int(rank)])
    return ordered[low] + (ordered[high] - ordered[low]) * (rank - low)


def _parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def load_records(
    log_path: Path | str = DEFAULT_LOG_PATH, window_minutes: int = 60
) -> list[dict]:
    path = Path(log_path)
    if not path.exists():
        return []

    records: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        ts = _parse_ts(record.get("ts"))
        if ts is None:
            continue
        record["_ts"] = ts
        records.append(record)

    if not records:
        return []

    reference = max(record["_ts"] for record in records)
    start = reference - timedelta(minutes=window_minutes)
    windowed = [record for record in records if record["_ts"] >= start]
    return windowed or records


def _minute(record: dict) -> str:
    return record["_ts"].strftime("%H:%M")


def compute_metrics(
    records: list[dict],
    window_minutes: int = 60,
    thresholds: dict[str, Any] | None = None,
) -> dict:
    responses = [r for r in records if r.get("event") == "response_sent"]
    requests = [r for r in records if r.get("event") == "request_received"]
    failures = [r for r in records if r.get("event") == "request_failed"]

    latency_buckets: dict[str, list[float]] = defaultdict(list)
    ttft_buckets: dict[str, list[float]] = defaultdict(list)
    traffic_buckets: Counter[str] = Counter()
    failure_buckets: Counter[str] = Counter()
    request_buckets: Counter[str] = Counter()
    tool_buckets: dict[str, list[bool]] = defaultdict(list)
    cost_buckets: dict[str, float] = defaultdict(float)
    token_in_buckets: Counter[str] = Counter()
    token_out_buckets: Counter[str] = Counter()
    quality_buckets: dict[str, list[float]] = defaultdict(list)

    latency: list[float] = []
    ttft: list[float] = []
    quality: list[float] = []
    failed_types: Counter[str] = Counter()
    tokens_in = tokens_out = 0

    for record in requests:
        request_buckets[_minute(record)] += 1

    for record in failures:
        minute = _minute(record)
        failure_buckets[minute] += 1
        failed_types[record.get("error_type") or "unknown"] += 1

    for record in records:
        flag = record.get("tool_success")
        if flag is not None:
            tool_buckets[_minute(record)].append(bool(flag))

    for record in responses:
        minute = _minute(record)
        traffic_buckets[minute] += 1
        if isinstance(record.get("latency_ms"), (int, float)):
            latency.append(float(record["latency_ms"]))
            latency_buckets[minute].append(float(record["latency_ms"]))
        if isinstance(record.get("ttft_ms"), (int, float)):
            ttft.append(float(record["ttft_ms"]))
            ttft_buckets[minute].append(float(record["ttft_ms"]))
        cost_buckets[minute] += float(record.get("cost_usd") or 0)
        tokens_in += int(record.get("tokens_in") or 0)
        tokens_out += int(record.get("tokens_out") or 0)
        token_in_buckets[minute] += int(record.get("tokens_in") or 0)
        token_out_buckets[minute] += int(record.get("tokens_out") or 0)
        if isinstance(record.get("quality_score"), (int, float)):
            quality.append(float(record["quality_score"]))
            quality_buckets[minute].append(float(record["quality_score"]))

    minutes = sorted(
        set(traffic_buckets)
        | set(request_buckets)
        | set(cost_buckets)
        | set(latency_buckets)
        | set(quality_buckets)
    )

    def error_rate_at(minute: str) -> float:
        total = request_buckets.get(minute, 0)
        return 100.0 * failure_buckets.get(minute, 0) / total if total else 0.0

    def retrieval_success_at(minute: str) -> float:
        flags = tool_buckets.get(minute, [])
        return 100.0 * sum(1 for f in flags if f) / len(flags) if flags else 100.0

    tool_flags = [flag for flags in tool_buckets.values() for flag in flags]

    latency_series = [
        {
            "t": minute,
            "p50": round(percentile(latency_buckets.get(minute, []), 50), 1),
            "p95": round(percentile(latency_buckets.get(minute, []), 95), 1),
            "p99": round(percentile(latency_buckets.get(minute, []), 99), 1),
            "ttft_p95": round(percentile(ttft_buckets.get(minute, []), 95), 1),
        }
        for minute in minutes
    ]

    return {
        "window_minutes": window_minutes,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
        "record_count": len(records),
        "latency": {
            "p50": round(percentile(latency, 50), 1),
            "p95": round(percentile(latency, 95), 1),
            "p99": round(percentile(latency, 99), 1),
            "ttft_p95": round(percentile(ttft, 95), 1),
            "count": len(latency),
            "series": latency_series,
        },
        "traffic": {
            "count": len(requests),
            "rate_per_minute": round(len(requests) / window_minutes, 3) if window_minutes else 0.0,
            "series": [{"t": minute, "count": traffic_buckets.get(minute, 0)} for minute in minutes],
        },
        "errors": {
            "error_rate_pct": round(
                100.0 * len(failures) / len(requests) if requests else 0.0, 2
            ),
            "retrieval_success_pct": round(
                100.0 * sum(1 for f in tool_flags if f) / len(tool_flags) if tool_flags else 100.0,
                2,
            ),
            "failed": len(failures),
            "by_type": dict(failed_types),
            "series": [
                {
                    "t": minute,
                    "error_rate_pct": round(error_rate_at(minute), 2),
                    "retrieval_success_pct": round(retrieval_success_at(minute), 2),
                }
                for minute in minutes
            ],
        },
        "cost": {
            "total": round(sum(cost_buckets.values()), 6),
            "series": [{"t": m, "value": round(cost_buckets[m], 6)} for m in minutes],
        },
        "tokens": {
            "in": tokens_in,
            "out": tokens_out,
            "series": [
                {
                    "t": minute,
                    "in": token_in_buckets.get(minute, 0),
                    "out": token_out_buckets.get(minute, 0),
                }
                for minute in minutes
            ],
        },
        "quality": {
            "mean": round(sum(quality) / len(quality), 3) if quality else 0.0,
            "count": len(quality),
            "series": [
                {
                    "t": minute,
                    "mean": round(sum(quality_buckets[minute]) / len(quality_buckets[minute]), 3),
                }
                for minute in minutes
                if quality_buckets.get(minute)
            ],
        },
        "thresholds": thresholds or {},
    }


def load_thresholds(config_path: Path | str = DEFAULT_DASHBOARD_CONFIG) -> dict[str, Any]:
    path = Path(config_path)
    if not path.exists():
        return {}
    payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    dashboard = payload.get("dashboard", {})
    result: dict[str, Any] = {}
    for panel in dashboard.get("panels", []):
        threshold = panel.get("threshold") or {}
        result[panel.get("id", "")] = {
            "title": panel.get("title"),
            "unit": panel.get("unit"),
            **threshold,
        }
    return result


def build_dashboard(
    log_path: Path | str = DEFAULT_LOG_PATH,
    config_path: Path | str = DEFAULT_DASHBOARD_CONFIG,
    window_minutes: int = 60,
) -> dict:
    records = load_records(log_path, window_minutes)
    return compute_metrics(records, window_minutes, load_thresholds(config_path))
