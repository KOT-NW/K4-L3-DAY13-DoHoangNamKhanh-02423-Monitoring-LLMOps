# Template Alert và Runbook

Mỗi alert phải dựa trên triệu chứng người dùng hoặc SLO, không dựa trực tiếp vào tên implementation nội bộ.

## Alert 1

- Tên: `high_p95_latency`
- Severity: critical
- Duration: 10m
- Kênh thông báo: Slack
- SLI/SLO liên quan: `fast_successful_requests` — `p95(latency_ms) <= 3000ms`
- Điều kiện và thời gian duy trì: `p95(latency_ms) > 3000` trên `response_sent` liên tục 10 phút.
- Ảnh hưởng tới người dùng: câu trả lời chậm, người dùng có thể bỏ dở; SLO latency bị đốt error budget.
- Ba bước kiểm tra đầu tiên:
  1. Mở dashboard panel latency, xác định khoảng thời gian p95/TTFT xấu.
  2. Lọc `data/logs.jsonl` theo khoảng đó, lấy `correlation_id` của request có `latency_ms` cao.
  3. Tìm trace cùng `correlation_id`, so sánh thời lượng span `retrieval` và `llm-generation` để khoanh vùng bước chậm.
- Mitigation tạm thời: nếu `retrieval` chậm, tạm nâng timeout/cache kết quả retrieval hoặc giảm concurrency; nếu `llm-generation` chậm, tạm giảm `max_tokens`/độ dài prompt và bật lại khi hết incident.
- Owner: oncall-llmops

## Alert 2

- Tên: `elevated_error_rate`
- Severity: critical
- Duration: 5m
- Kênh thông báo: Slack
- SLI/SLO liên quan: `fast_successful_requests` (thành công) và guardrail `error_rate_pct_max: 2`, `retrieval_success_rate_pct_min: 90`
- Điều kiện và thời gian duy trì: `error_rate_pct > 2` hoặc `retrieval_success_rate_pct < 90` liên tục 5 phút.
- Ảnh hưởng tới người dùng: request trả lỗi 500, không có câu trả lời; tỉ lệ thành công của SLO tụt.
- Ba bước kiểm tra đầu tiên:
  1. Panel errors: xem `error_type` và retrieval success đang tụt theo loại nào.
  2. Lọc log `request_failed`, lấy `correlation_id` và `error_type`.
  3. Mở trace cùng `correlation_id`, xem span `retrieval` có error/timeout (`tool_success=false`) hay không.
- Mitigation tạm thời: nếu retrieval lỗi, bật fallback không retrieval (trả lời từ corpus/few-shot) và tạm tắt tính năng liên quan; escalate cho đội vector store nếu lỗi hạ tầng.
- Owner: oncall-llmops

## Alert 3

- Tên: `cost_budget_burn`
- Severity: warning
- Duration: 15m
- Kênh thông báo: Slack
- SLI/SLO liên quan: guardrail `daily_cost_usd_max: 2.5`
- Điều kiện và thời gian duy trì: `sum(cost_usd)` trên `response_sent` > 2.5 USD trong 1 giờ, duy trì 15 phút.
- Ảnh hưởng tới người dùng: không gián đoạn trực tiếp, nhưng đốt ngân sách/error budget và có thể buộc giới hạn tính năng.
- Ba bước kiểm tra đầu tiên:
  1. Panel cost và tokens: xác định chi phí tăng do traffic tăng hay do output token/request tăng.
  2. Lọc log `response_sent`, so sánh `tokens_out` và `cost_usd` với baseline.
  3. Mở trace: kiểm tra span `llm-generation` có prompt bất thường (version mới dài hơn) hay usage/cost cao bất thường.
- Mitigation tạm thời: rollback prompt `production` về version ổn định, hạ `max_tokens`, giới hạn rate-limit theo user/feature và làm sạch cache nếu bị lặp.
- Owner: oncall-llmops
