# Báo cáo cá nhân — K4-L3A Day 13 Monitoring & LLMOps

> Mỗi học viên hoàn thiện một file duy nhất này. Khi dẫn evidence, dùng đường dẫn tương đối, ví dụ `evidence/07-trace-waterfall.png`.

## 1. Thông tin học viên

- **Họ và tên:** Đỗ Hoàng Nam Khánh
- **MSSV:** 02423
- **Lớp:** K4-L3A
- **Repository URL:** https://github.com/KOT-NW/K4-L3-DAY13-DoHoangNamKhanh-02423-Monitoring-LLMOps
- **Commit SHA cuối:** `<cập nhật sau khi commit>` (commit hiện tại trước khi nộp: `04e6c14`)
- **Challenge ID:** `day13-k4-l3a-monitoring-llmops-v1`
- **Tên project Langfuse cá nhân:** `yuy` (organization `gigig`) — project cá nhân, hiển thị trong toàn bộ evidence trace/prompt

## 2. Evidence index

Điền đúng đường dẫn tới evidence thực tế. Có thể đổi tên hoặc dùng nhiều ảnh nếu cần.

| Evidence | Đường dẫn | Trạng thái |
|---|---|---|
| Pytest cuối | `evidence/01-pytest.txt` | có sẵn |
| Log validator | `evidence/02-log-validator.txt` | có sẵn |
| Dashboard validator | `evidence/03-dashboard-validator.txt` | có sẵn |
| Structured log | `evidence/04-structured-log.txt` | có sẵn |
| PII redaction | `evidence/05-pii-redaction.txt` | có sẵn |
| Trace list | `evidence/06-trace-list.png` | có sẵn (47 traces) |
| Trace waterfall | `evidence/07-trace-waterfall.png` | có sẵn |
| Trace metadata | `evidence/08-trace-metadata.png` | có sẵn |
| Prompt versions | `evidence/09-prompt-versions.png` | có sẵn |
| Prompt rollback | `evidence/10-prompt-rollback-before-v1.png`, `evidence/10-prompt-rollback-promoted-v2.png`, `evidence/10-prompt-rollback-after-v1.png` | có sẵn (trước/promote/rollback) |
| Dashboard runtime | `evidence/11-dashboard-overview.png` | có sẵn |
| Incident metric | `evidence/12-incident-metric.png` | có sẵn |
| Incident log | `evidence/13-incident-log.txt` | có sẵn |
| Incident trace | `evidence/14-incident-trace.png` | có sẵn |

Ghi chú: `11-dashboard-overview.png` và `12-incident-metric.png` lấy từ React dashboard chạy
local đọc `data/logs.jsonl` qua `GET /dashboard/metrics` (12 là phần KPI + panel latency cho
thấy đỉnh incident p95 và khoảng thời gian 09:56–09:58). Các ảnh `06`–`10`, `14` chụp trên UI
Langfuse cá nhân. Tất cả evidence đã có trong `submission/evidence/`.

## 3. Kết quả kỹ thuật

| Nội dung | Baseline | Kết quả cuối | Nhận xét |
|---|---|---|---|
| `validate_logs.py` | Không đạt (CP1 còn `TODO`) | **100/100** | 0 thiếu field, 0 thiếu enrichment, 0 PII leak |
| `validate_dashboard.py` | 6/6 | **6/6** | Contract đã đủ 6 panel ngay từ starter |
| `pytest` | 22 tests (chưa đạt do `TODO` CP1) | **24 passed** | Thêm 2 test PII: CCCD và thẻ thanh toán |
| Số traces hợp lệ | 0 | **22** (12 có span tree đầy đủ) | Chỉ tính trace do project cá nhân tạo |
| Số PII leak | Có (log trước khi scrub) | **0** | Trên toàn bộ `data/logs.jsonl` |
| Latency P95 / TTFT P95 | 219ms / 50ms (runtime trước incident) | 189ms / 50ms (sau phục hồi) | Đỉnh incident 2660ms |
| Retrieval success rate | 100% | 100% | `tool_success=true` mọi request |

## 4. Logging và PII

- **Cách tạo/nhận và truyền correlation ID:** `app/middleware.py` gọi `clear_contextvars()`,
  đọc header `x-request-id` (nếu có) hoặc sinh `req-<8-hex>`, bind vào structlog
  `contextvars`, gắn vào `request.state`, và trả lại qua response header `x-request-id` +
  `x-response-time-ms`. Mọi log trong cùng request tự có `correlation_id`.
- **Các metadata được ghi vào structured log:** `user_id_hash` (SHA-256 rút gọn 12 ký tự),
  `session_id`, `feature`, `model`, `env`, nối với `correlation_id`, `ts`, `level`,
  `service`, `event`, `latency_ms`, `ttft_ms`, `tokens_in/out`, `cost_usd`,
  `quality_score`, `tool_name`, `tool_success`.
- **Cách bảo đảm PII được scrub trước khi ghi:** `app/logging_config.py` đăng ký processor
  `scrub_event` **trước** `JsonlFileProcessor` và `JSONRenderer`. Hàm này scrub đệ quy mọi
  string trong event (kể cả `payload` lồng nhau). Pattern ở `app/pii.py`: email, số điện
  thoại VN, CCCD, thẻ thanh toán, hộ chiếu VN.
- **Cách kiểm chứng kết quả:** `python scripts/validate_logs.py` → 100/100, 0 leak; log
  `data/logs.jsonl` hiển thị `[REDACTED_EMAIL]`, `[REDACTED_PHONE_VN]`,
  `[REDACTED_CREDIT_CARD]`; `pytest` có test riêng cho email/phone/CCCD/thẻ.

## 5. Tracing và prompt versioning

- **Cách xác nhận traces do chính tôi tạo trong project cá nhân:** key Langfuse trong
  `.env` thuộc project cá nhân `yuy` (org `gigig`); `/health` trả `tracing_enabled: true`;
  trace truy vấn trực tiếp từ ClickHouse của Langfuse local có `metadata` chứa
  `correlation_id`, `model`, `prompt_name/label/version`. Trace không có dữ liệu của người
  khác.
- **Cấu trúc root/retrieval/generation observations:**
  - `lab-agent-run` (`AGENT`) là root.
  - `retrieval` (`RETRIEVER`) là child: input là query đã scrub, output `{doc_count}`.
  - `llm-generation` (`GENERATION`) là child: có `model`, `prompt` (managed prompt),
    `usage_details {input, output}`, `cost_details {total}`.
- **Cách nối trace với log:** `correlation_id` nằm trong metadata của trace và trong mọi
  dòng log; dùng cùng một giá trị (`req-xxxxxxxx`) để đối chiếu.
- **Prompt name:** `day13-chat`
- **Version/label baseline:** version 1, labels `baseline` + `production`
- **Version/label candidate:** version 2, label `candidate`
- **Trace ID của mỗi version:**
  - v1 / production (sau rollback):
    - `1021d48e22aefb2d0943f503a7ec0296` (cid `req-ba616e24`)
    - `bafe47e19b8471f4cfc67310f6cbf946` (cid `req-d2dae22b`)
    - `d1072af4f87b3b00d0e65c2c57b56a6b` (cid `req-2eecd44c`)
    - `af65451a2b4abf74752c1bd985d3e4be` (cid `req-de038548`)
    - `4177459898c16e2f92277679ed9c239d` (cid `req-c098c141`)
  - v2 / candidate:
    - `4cb53d86ab001dc75ec2c0e5a45d3e87` (cid `req-6725cbad`)
    - `a1189591bf267d9af8fb329eda786b4d` (cid `req-a6599bcc`)
    - `1d85331f8f56a7af230bf982f5d9f0d9` (cid `req-bc6cb929`)
    - `e2e90b2f63c37fe5a956d363d76a25c8` (cid `req-8fadc128`)
    - `8745248c9198ce963ec061b3bfe10daa` (cid `req-38032deb`)
- **Cách promote và rollback `production`:** dùng `client.update_prompt(name, version,
  new_labels=[...])`. Promote: gán `production` cho version 2 (giữ `candidate`). Rollback:
  gán `production` lại cho version 1 (giữ `baseline`). Sau mỗi bước chạy lại request để
  trace ghi đúng `prompt_version`. Trạng thái cuối: `production` = v1, `candidate` = v2.

## 6. Dashboard, SLO và alerts

- **Dashboard và sáu panel:** contract `config/dashboard.yaml` đủ 6 panel (latency, traffic,
  errors, cost, tokens, quality) và vượt `validate_dashboard.py` 6/6. Runtime có hai lựa chọn:
  - **React UI (chính):** `dashboard/` (Vite + React + TypeScript + Recharts), gọi
    `GET /dashboard/metrics` (metric engine dùng chung `app/dashboard_metrics.py`). Có 4 KPI
    + 6 panel, đường SLO/threshold, chọn cửa sổ 15m/1h/3h/24h, tự refresh 30s. Chạy:
    `cd dashboard; npm run dev` → `http://localhost:5173`.
  - **Offline HTML:** `python scripts/render_dashboard.py` → `data/dashboard.html`.
- **SLO và lý do chọn:** `fast_successful_requests`, cửa sổ 28 ngày, target 99.5% — request
  `response_sent` phải thành công và `latency_ms <= 3000`. Baseline thực đo p95 ~219ms và
  phần lớn ~150–180ms, thấp hơn nhiều ngưỡng, nên 99.5% đủ chặt mà không gây alert nhiễu.
- **Cách tính error budget:** error budget = 0.5% tổng request. Ví dụ ~2800 request/28 ngày
  → tối đa ~14 request xấu (lỗi hoặc latency > 3000ms) trước khi vi phạm SLO.
- **Ba alert và runbook tương ứng** (`config/alert_rules.yaml`, runbook `docs/alerts.md`):
  1. `high_p95_latency` — critical, `p95(latency_ms) > 3000` giữ 10m, Slack, `#alert-1`.
  2. `elevated_error_rate` — critical, `error_rate_pct > 2` hoặc `retrieval_success_pct < 90`
     giữ 5m, Slack, `#alert-2`.
  3. `cost_budget_burn` — warning, `sum(cost_usd) > 2.5 USD` trong 1h giữ 15m, Slack,
     `#alert-3`.

## 7. Điều tra challenge

- **Challenge ID:** `day13-k4-l3a-monitoring-llmops-v1` (`incident=rag_slow`, feature
  `monitoring`, seed 1311, latency threshold 2000ms)
- **Khoảng thời gian điều tra:** 2026-09-29 09:56–09:58 UTC
- **Triệu chứng từ metrics:** p95 latency `2662ms` (baseline `219ms`), P99 `2662ms`,
  TTFT P95 vẫn `50ms`, error rate `0%`, retrieval success `100%` → chậm nhưng không lỗi và
  không phải ở bước sinh token đầu.
- **Log line và correlation ID liên quan:** 5 dòng `response_sent` với `feature=monitoring`
  và `latency_ms ≈ 2652–2662`, `ttft_ms=50`, `tool_success=true`:
  - `req-8e461e3f` (2654ms), `req-fd99c935` (2652ms), `req-307415c0` (2653ms),
    `req-566df06f` (2662ms), `req-9c331e44` (2661ms)
- **Trace ID và span gây ảnh hưởng:** (cùng correlation ID, lấy từ ClickHouse)

  | trace_id | cid | agent | retrieval | generation |
  |---|---|---|---|---|
  | `96a04f97359c47174ebe97b3ca8434fe` | req-8e461e3f | 2667ms | **2514ms** | 153ms |
  | `17512d3d5053c55b0d590f0638b25a2a` | req-fd99c935 | 2653ms | **2502ms** | 151ms |
  | `15112965ed4d448e067699b708b8e0a5` | req-307415c0 | 2658ms | **2506ms** | 152ms |
  | `b47d0aa66dcf9ef62bae060973a58bff` | req-566df06f | 2664ms | **2506ms** | 154ms |
  | `7d5d812a6b0a667b3ddef44e8ed3a681` | req-9c331e44 | 2668ms | **2512ms** | 152ms |

- **Root cause:** bước `retrieval` (vector store) chậm ~2.5s trên feature `monitoring`; bước
  `llm-generation` bình thường (~152ms), nên độ trễ không đến từ LLM.
- **Fix action:** xử lý độ trễ vector store cho `monitoring` (tắt incident `rag_slow` để mô
  phỏng phục hồi) → đo lại p95 về `189ms`.
- **Preventive measure:** alert symptom-based `high_p95_latency` trên span `retrieval` + SLO
  `latency <= 3000ms`. Vì baseline p95 ~150–200ms, mức 2.5s là suy thoái rõ và bị bắt sớm.

## 8. Giải thích và tự đánh giá

- **Một quyết định kỹ thuật quan trọng và lý do:** tách `retrieval` và `llm-generation` thành
  child observation riêng, truyền `usage_details`/`cost_details`/`prompt` vào generation. Nếu
  chỉ có một root span thì không thể khoanh vùng bước chậm ở CP3; nhờ tách span mà xác định
  ngay retrieval là nguyên nhân.
- **Một lỗi/blocker đã gặp:** Langfuse self-host v4 chạy chế độ `events_only` nên
  `GET /api/public/traces` trả 404 (không dùng để kiểm chứng trace). Xử lý: truy vấn
  ClickHouse (`events_full`) và kiểm tra trace trên UI Langfuse.
- **Cách tìm nguyên nhân và xử lý:** đọc log web container để thấy lỗi/ghi nhận, xác minh
  bằng ClickHouse (`SELECT name, type, ... FROM events_full`). Đồng thời shutdown sai cách làm
  mất buffer SDK — xử lý bằng chờ flush trước khi tắt server.
- **Cách hiểu luồng Metrics → Logs → Traces:** Metrics chỉ ra triệu chứng và khoảng thời gian
  (p95 tăng); Logs lọc theo thời gian để lấy `correlation_id` bất thường; Trace cùng
  `correlation_id` chỉ ra span chậm/lỗi cụ thể.
- **Vai trò của prompt version, token/cost, SLO hoặc rollback:** prompt version giúp biết một
  request dùng biến thể nào và rollback an toàn; token/cost phát hiện chi phí bất thường; SLO +
  error budget biến "chất lượng cảm nhận" thành ngưỡng đo được để quyết định phát hành.
- **Điều quan trọng nhất đã học:** một kết luận incident chỉ hợp lệ khi metric, log và trace
  cùng chỉ về một nguyên nhân; và phải nối chúng bằng `correlation_id`.
- **Hạn chế hoặc phần chưa hoàn thành, nếu có:** mới kiểm chứng trace qua ClickHouse/UI thay
  vì REST API (do `events_only`); ảnh evidence của trace/prompt cần chụp trên UI.

## 9. Checklist trước khi nộp

- [ ] Kết quả và evidence thuộc commit SHA cuối.
- [ ] Tất cả ảnh/output mở được bằng đường dẫn tương đối.
- [ ] Incident evidence nối đúng metric → log → trace.
- [ ] Trace/prompt evidence thuộc project Langfuse cá nhân và ảnh không lộ key/secret.
- [ ] Repository chạy lại được theo README.
- [ ] Không có secret, API key, PII thô hoặc evidence của người khác/lớp khác.
- [ ] URL repo và commit SHA cuối đã được nộp trên LMS/Codelabs.

## Danh sách evidence cần chụp

Lưu vào `submission/evidence/`. Tất cả mục `01`–`14` đã có sẵn.

| # | File | Cần thể hiện | Cách tạo |
|---|---|---|---|
| 01 | `01-pytest.png` | `24 passed` | `python -m pytest -q` rồi chụp terminal |
| 02 | `02-log-validator.png` | `Estimated Score: 100/100` | `python scripts/validate_logs.py` |
| 03 | `03-dashboard-validator.png` | `HỢP LỆ: 6/6 panel` | `python scripts/validate_dashboard.py` |
| 04 | `04-structured-log.png` | Một dòng log có `correlation_id`, `user_id_hash`, `session_id`, `feature`, `model`, `env` | mở `data/logs.jsonl` (dòng `request_received`) |
| 05 | `05-pii-redaction.png` | `[REDACTED_EMAIL]`, `[REDACTED_PHONE_VN]`, `[REDACTED_CREDIT_CARD]` | lọc `data/logs.jsonl` |
| 06 | `06-trace-list.png` | ≥10 trace trong project `day13-k4-l3a-02423` | UI Langfuse → Traces |
| 07 | `07-trace-waterfall.png` | span `lab-agent-run` → `retrieval` + `llm-generation` | mở 1 trace, ví dụ `96a04f...` |
| 08 | `08-trace-metadata.png` | metadata `correlation_id`, `model`, `prompt_name/version/label`, token, cost; **không** có PII thô | tab metadata của trace |
| 09 | `09-prompt-versions.png` | hai version `day13-chat` (v1 `production`+`baseline`, v2 `candidate`) | UI Langfuse → Prompts |
| 10 | `10-prompt-rollback.png` | trước/sau khi đổi label `production` (v2 → rollback v1) | UI Langfuse → Prompts → labels |
| 11 | `11-dashboard-overview.png` | 6 panel, đơn vị, time range, threshold | **đã có sẵn** trong `evidence/` |
| 12 | `12-incident-metric.png` | p95 vọt lên ~2660ms vs ngưỡng 2000/3000ms | React dashboard cửa sổ 15m hoặc `data/dashboard.html` |
| 13 | `13-incident-log.png` | 5 dòng `response_sent` `latency_ms≈2650`, `feature=monitoring`, kèm `correlation_id` | lọc `data/logs.jsonl` |
| 14 | `14-incident-trace.png` | span `retrieval` ~2.5s vs `llm-generation` ~152ms | mở trace `96a04f97359c47174ebe97b3ca8434fe` |

> Lệnh tạo lại workload incident (nếu cần chụp lại): bật API (`.\.venv\Scripts\python.exe -m
> uvicorn app.main:app --env-file .env --port 8000`), rồi `python scripts/inject_incident.py`
> và `python scripts/load_test.py --challenge --concurrency 5`.
