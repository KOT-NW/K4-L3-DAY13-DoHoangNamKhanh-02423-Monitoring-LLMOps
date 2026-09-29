import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  Coins,
  DollarSign,
  Gauge,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Timer,
  Users,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'

type Series = { t: string; [key: string]: number | string }

type Threshold = {
  title?: string
  unit?: string
  aggregation?: string
  operator?: string
  value?: number
}

type Metrics = {
  window_minutes: number
  generated_at: string
  record_count: number
  latency: {
    p50: number
    p95: number
    p99: number
    ttft_p95: number
    count: number
    series: Series[]
  }
  traffic: { count: number; rate_per_minute: number; series: Series[] }
  errors: {
    error_rate_pct: number
    retrieval_success_pct: number
    failed: number
    by_type: Record<string, number>
    series: Series[]
  }
  cost: { total: number; series: Series[] }
  tokens: { in: number; out: number; series: Series[] }
  quality: { mean: number; count: number; series: Series[] }
  thresholds: Record<string, Threshold>
}

const C = {
  accent: '#5b8cff',
  cyan: '#22d3ee',
  purple: '#a78bfa',
  good: '#34d399',
  warn: '#fbbf24',
  bad: '#fb7185',
  grid: 'rgba(139, 154, 192, 0.14)',
  axis: '#8b9ac0',
}

const tooltipStyle = {
  background: 'rgba(10, 15, 28, 0.96)',
  border: '1px solid rgba(96, 125, 190, 0.35)',
  borderRadius: 12,
  color: '#e8eefc',
  boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
  fontSize: 12,
} as const

const WINDOWS = [15, 60, 180, 1440]

function statusOf(value: number, threshold?: Threshold): 'good' | 'bad' | 'none' {
  if (!threshold || threshold.value === undefined) return 'none'
  if (threshold.operator === 'lte') return value <= threshold.value ? 'good' : 'bad'
  if (threshold.operator === 'gte') return value >= threshold.value ? 'good' : 'bad'
  return 'none'
}

function statusColor(status: 'good' | 'bad' | 'none') {
  if (status === 'good') return C.good
  if (status === 'bad') return C.bad
  return C.accent
}

function fmt(value: number, digits = 1) {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function Sparkline({ data, color, dataKey = 'value' }: { data: Series[]; color: string; dataKey?: string }) {
  if (!data.length) return <div className="sparkline-empty" />
  const values = data.map((d) => Number(d[dataKey] ?? 0))
  const max = Math.max(...values, 1)
  return (
    <div className="sparkline">
      {data.map((d, i) => (
        <span
          key={`${d.t}-${i}`}
          style={{ height: `${Math.max(6, (values[i] / max) * 100)}%`, background: color }}
          title={`${d.t}: ${fmt(values[i], 3)}`}
        />
      ))}
    </div>
  )
}

function GaugeArc({ value, threshold, color }: { value: number; threshold?: number; color: string }) {
  const pct = Math.max(0, Math.min(1, value))
  const r = 80
  const cx = 100
  const cy = 100
  const len = Math.PI * r
  const track = `M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`
  const angle = Math.PI * (1 - (threshold ?? 0))
  const tx = cx + r * Math.cos(angle)
  const ty = cy - r * Math.sin(angle)
  return (
    <svg viewBox="0 0 200 128" className="gauge-svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.55" />
          <stop offset="100%" stopColor={color} />
        </linearGradient>
      </defs>
      <path d={track} fill="none" stroke="rgba(139,154,192,0.16)" strokeWidth="16" strokeLinecap="round" />
      <path
        d={track}
        fill="none"
        stroke="url(#gaugeGrad)"
        strokeWidth="16"
        strokeLinecap="round"
        strokeDasharray={`${len * pct} ${len}`}
      />
      {threshold !== undefined && <circle cx={tx} cy={ty} r="4" fill={C.bad} />}
    </svg>
  )
}

function StatusPill({ status, label }: { status: 'good' | 'bad' | 'none'; label: string }) {
  return <span className={`pill pill-${status}`}>{label}</span>
}

function Panel({
  icon,
  title,
  unit,
  threshold,
  status,
  children,
}: {
  icon: ReactNode
  title: string
  unit: string
  threshold: string
  status: 'good' | 'bad' | 'none'
  children: ReactNode
}) {
  return (
    <section className={`panel ${status === 'bad' ? 'panel-alert' : ''}`}>
      <header className="panel-head">
        <div className="panel-title">
          <span className="panel-icon">{icon}</span>
          <div>
            <h2>{title}</h2>
            <p className="panel-meta">
              unit: {unit} · {threshold}
            </p>
          </div>
        </div>
        <StatusPill status={status} label={status === 'bad' ? 'SLO breach' : status === 'good' ? 'healthy' : 'no SLO'} />
      </header>
      <div className="panel-body">{children}</div>
    </section>
  )
}

function StatCard({
  icon,
  label,
  value,
  unit,
  status,
  spark,
  color,
}: {
  icon: ReactNode
  label: string
  value: string
  unit: string
  status: 'good' | 'bad' | 'none'
  spark: Series[]
  color: string
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span className="stat-icon" style={{ color }}>
          {icon}
        </span>
        <span className={`dot dot-${status}`} />
      </div>
      <div className="stat-value">
        {value} <span className="stat-unit">{unit}</span>
      </div>
      <div className="stat-label">{label}</div>
      <Sparkline data={spark} color={color} />
    </div>
  )
}

export default function App() {
  const [windowMinutes, setWindowMinutes] = useState(60)
  const [data, setData] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(30)
  const windowRef = useRef(windowMinutes)

  useEffect(() => {
    windowRef.current = windowMinutes
  }, [windowMinutes])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/dashboard/metrics?window_minutes=${windowRef.current}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData((await res.json()) as Metrics)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed')
    } finally {
      setLoading(false)
      setSecondsLeft(30)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [windowMinutes, load])

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          void load()
          return 30
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [load])

  const threshold = useMemo(() => data?.thresholds ?? {}, [data])
  const kpis = useMemo(() => {
    if (!data) return []
    return [
      {
        id: 'traffic',
        label: 'Requests in window',
        icon: <Users size={18} />,
        value: fmt(data.traffic.count, 0),
        unit: 'req',
        status: statusOf(data.traffic.rate_per_minute, threshold.traffic),
        spark: data.traffic.series,
        color: C.cyan,
      },
      {
        id: 'latency',
        label: 'Latency P95',
        icon: <Timer size={18} />,
        value: fmt(data.latency.p95, 0),
        unit: 'ms',
        status: statusOf(data.latency.p95, threshold.latency),
        spark: data.latency.series,
        color: C.accent,
      },
      {
        id: 'errors',
        label: 'Error rate',
        icon: <ShieldCheck size={18} />,
        value: fmt(data.errors.error_rate_pct, 2),
        unit: '%',
        status: statusOf(data.errors.error_rate_pct, threshold.errors),
        spark: data.errors.series,
        color: C.bad,
      },
      {
        id: 'quality',
        label: 'Avg quality',
        icon: <Sparkles size={18} />,
        value: fmt(data.quality.mean, 2),
        unit: '/1',
        status: statusOf(data.quality.mean, threshold.quality),
        spark: data.quality.series,
        color: C.purple,
      },
    ]
  }, [data, threshold])

  const qualityStatus = data ? statusOf(data.quality.mean, threshold.quality) : 'none'
  const gaugeColor = statusColor(qualityStatus)

  return (
    <div className="app">
      <div className="aurora" aria-hidden />
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Activity size={22} />
          </span>
          <div>
            <h1>
              Day 13 <span className="grad">Monitoring &amp; LLMOps</span>
            </h1>
            <p>Metrics observability · source data/logs.jsonl</p>
          </div>
        </div>

        <div className="controls">
          <div className="segmented">
            {WINDOWS.map((w) => (
              <button
                key={w}
                className={w === windowMinutes ? 'seg active' : 'seg'}
                onClick={() => {
                  setLoading(true)
                  setWindowMinutes(w)
                }}
              >
                {w < 60 ? `${w}m` : w < 1440 ? `${w / 60}h` : '24h'}
              </button>
            ))}
          </div>
          <span className="live">
            <Radio size={14} className="live-dot" /> live · {secondsLeft}s
          </span>
          <button
            className="icon-btn"
            onClick={() => {
              setLoading(true)
              void load()
            }}
            title="Refresh now"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      {error && (
        <div className="banner banner-error">
          <AlertTriangle size={16} /> {error} — is the API running on port 8000?
        </div>
      )}
      {loading && !data && <div className="banner">Loading metrics…</div>}

      {data && (
        <>
          <div className="updated">
            window: last {data.window_minutes} min · {data.record_count} log records · generated {data.generated_at}
          </div>

          <section className="kpis">
            {kpis.map(({ id, ...rest }) => (
              <StatCard key={id} {...rest} />
            ))}
          </section>

          <section className="grid">
            <Panel
              icon={<Timer size={16} />}
              title="Latency percentiles and TTFT"
              unit="ms"
              threshold={`threshold: p95 ≤ ${threshold.latency?.value ?? 3000} ms`}
              status={statusOf(data.latency.p95, threshold.latency)}
            >
              <ResponsiveContainer width="100%" height={230}>
                <ComposedChart data={data.latency.series} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="t" stroke={C.axis} fontSize={11} tickLine={false} />
                  <YAxis stroke={C.axis} fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine
                    y={threshold.latency?.value ?? 3000}
                    stroke={C.bad}
                    strokeDasharray="5 5"
                    label={{ value: 'SLO', fill: C.bad, fontSize: 10, position: 'right' }}
                  />
                  <Bar dataKey="p50" name="P50" fill={C.cyan} radius={[5, 5, 0, 0]} maxBarSize={20} isAnimationActive={false} />
                  <Bar dataKey="p95" name="P95" fill={C.accent} radius={[5, 5, 0, 0]} maxBarSize={20} isAnimationActive={false} />
                  <Bar dataKey="p99" name="P99" fill={C.purple} radius={[5, 5, 0, 0]} maxBarSize={20} isAnimationActive={false} />
                  <Line
                    type="monotone"
                    dataKey="ttft_p95"
                    name="TTFT P95"
                    stroke={C.good}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </Panel>

            <Panel
              icon={<Users size={16} />}
              title="Request traffic"
              unit="req"
              threshold={`threshold: rate ≥ ${threshold.traffic?.value ?? 1}/min`}
              status={statusOf(data.traffic.rate_per_minute, threshold.traffic)}
            >
              <ResponsiveContainer width="100%" height={230}>
                <AreaChart data={data.traffic.series} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.cyan} stopOpacity={0.55} />
                      <stop offset="100%" stopColor={C.cyan} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="t" stroke={C.axis} fontSize={11} tickLine={false} />
                  <YAxis stroke={C.axis} fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="requests"
                    stroke={C.cyan}
                    strokeWidth={2}
                    fill="url(#trafficFill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Panel>

            <Panel
              icon={<ShieldCheck size={16} />}
              title="Error rate and retrieval success"
              unit="%"
              threshold={`thresholds: error ≤ ${threshold.errors?.value ?? 2}%, retrieval ≥ 90%`}
              status={statusOf(data.errors.error_rate_pct, threshold.errors)}
            >
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={data.errors.series} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="t" stroke={C.axis} fontSize={11} tickLine={false} />
                  <YAxis stroke={C.axis} fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={threshold.errors?.value ?? 2} stroke={C.bad} strokeDasharray="5 5" />
                  <Bar dataKey="error_rate_pct" name="error %" fill={C.bad} radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
                  <Line
                    type="monotone"
                    dataKey="retrieval_success_pct"
                    name="retrieval %"
                    stroke={C.good}
                    strokeWidth={2}
                    dot={false} isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="breakdown">
                <span>by error_type</span>
                {Object.keys(data.errors.by_type).length === 0 ? (
                  <em>none</em>
                ) : (
                  Object.entries(data.errors.by_type).map(([k, v]) => (
                    <span key={k} className="chip">
                      {k}: {v}
                    </span>
                  ))
                )}
              </div>
            </Panel>

            <Panel
              icon={<DollarSign size={16} />}
              title="Cost over time"
              unit="usd"
              threshold={`threshold: total ≤ ${threshold.cost?.value ?? 2.5} usd`}
              status={statusOf(data.cost.total, threshold.cost)}
            >
              <div className="big-number">
                ${fmt(data.cost.total, 4)}
                <span>total</span>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={data.cost.series} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.good} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={C.good} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="t" stroke={C.axis} fontSize={11} tickLine={false} />
                  <YAxis stroke={C.axis} fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    name="cost usd"
                    stroke={C.good}
                    strokeWidth={2}
                    fill="url(#costFill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Panel>

            <Panel
              icon={<Coins size={16} />}
              title="Input and output tokens"
              unit="tokens"
              threshold={`threshold: total ≤ ${threshold.tokens?.value ?? 50000}`}
              status={statusOf(data.tokens.in + data.tokens.out, threshold.tokens)}
            >
              <div className="token-totals">
                <span>
                  <b>{fmt(data.tokens.in, 0)}</b> input
                </span>
                <span>
                  <b>{fmt(data.tokens.out, 0)}</b> output
                </span>
              </div>
              <ResponsiveContainer width="100%" height={185}>
                <BarChart data={data.tokens.series} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="t" stroke={C.axis} fontSize={11} tickLine={false} />
                  <YAxis stroke={C.axis} fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="in" name="input" stackId="t" fill={C.accent} radius={[0, 0, 0, 0]} maxBarSize={26} isAnimationActive={false} />
                  <Bar dataKey="out" name="output" stackId="t" fill={C.purple} radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel
              icon={<Gauge size={16} />}
              title="Quality proxy"
              unit="score 0–1"
              threshold={`threshold: mean ≥ ${threshold.quality?.value ?? 0.75}`}
              status={qualityStatus}
            >
              <div className="gauge-wrap">
                <GaugeArc value={data.quality.mean} threshold={threshold.quality?.value} color={gaugeColor} />
                <div className="gauge-value">
                  {(data.quality.mean * 100).toFixed(0)}
                  <span>%</span>
                  <small>mean {fmt(data.quality.mean, 2)} · n={data.quality.count}</small>
                </div>
              </div>
            </Panel>
          </section>
        </>
      )}
    </div>
  )
}
