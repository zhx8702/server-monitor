import { useState } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { useServer } from '../../../core/contexts/ServerContext'
import { useToast } from '../../../core/contexts/ToastContext'
import { useAgentQuery } from '../../../core/hooks/useAgentQuery'
import { PullToRefresh } from '../../../core/components/PullToRefresh'
import { QueryErrorState } from '../../../core/components/QueryErrorState'
import { DetailSkeleton } from '../../../core/components/Skeleton'
import type { AlertRule, NotifyChannel, AlertsOverview } from '../../../core/types/server'
import {
  Bell, Plus, Trash2, Send, ChevronDown,
  AlertTriangle, Info, Loader2,
} from 'lucide-react'

const METRICS = [
  { value: 'memory_usage', label: '内存使用率', unit: '%' },
  { value: 'disk_usage', label: '磁盘使用率', unit: '%' },
  { value: 'load_1', label: '1分钟负载', unit: '' },
  { value: 'load_5', label: '5分钟负载', unit: '' },
  { value: 'load_15', label: '15分钟负载', unit: '' },
]

const OPERATORS = ['>', '>=', '<', '<=']

const DURATIONS = [
  { value: 0, label: '立即' },
  { value: 60, label: '1 分钟' },
  { value: 180, label: '3 分钟' },
  { value: 300, label: '5 分钟' },
  { value: 600, label: '10 分钟' },
]

const SEVERITIES = [
  { value: 'critical', label: '严重', color: 'text-rose-500 bg-rose-50 dark:bg-rose-500/10' },
  { value: 'warning', label: '警告', color: 'text-amber-500 bg-amber-50 dark:bg-amber-500/10' },
  { value: 'info', label: '信息', color: 'text-sky-500 bg-sky-50 dark:bg-sky-500/10' },
]

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

const inputClass = 'w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.04] text-gray-800 dark:text-gray-200 outline-none focus:border-emerald-400 dark:focus:border-emerald-500 transition-colors'
const selectClass = inputClass + ' appearance-none'
const btnPrimary = 'px-4 py-2 text-xs font-medium rounded-xl bg-emerald-500 text-white active:bg-emerald-600 transition-colors disabled:opacity-50'
const btnSecondary = 'px-4 py-2 text-xs font-medium rounded-xl bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-300 active:bg-gray-200 dark:active:bg-white/[0.1] transition-colors'

export function AlertSettingsPage() {
  const { activeServerId, getClient } = useServer()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: overview, isLoading, error, refetch } = useAgentQuery<AlertsOverview>('/api/alerts', undefined, { refetchInterval: 10_000 })
  const { data: rules } = useAgentQuery<AlertRule[]>('/api/alerts/rules', undefined, { refetchInterval: 10_000 })
  const { data: channels } = useAgentQuery<NotifyChannel[]>('/api/alerts/channels', undefined, { refetchInterval: 10_000 })

  const [showAddRule, setShowAddRule] = useState(false)
  const [showAddChannel, setShowAddChannel] = useState(false)
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  // --- Rule form state ---
  const emptyRule: AlertRule = { id: '', name: '', metric: 'memory_usage', operator: '>', threshold: 85, duration: 180, severity: 'warning', enabled: true }
  const [ruleForm, setRuleForm] = useState<AlertRule>(emptyRule)

  // --- Channel form state ---
  const [chName, setChName] = useState('')
  const [chUrl, setChUrl] = useState('')

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['agent', activeServerId] })

  const ruleMutation = useMutation({
    mutationFn: async (rule: AlertRule) => {
      const client = getClient()
      if (!client) throw new Error('No client')
      return client.post('/api/alerts/rules', rule)
    },
    onSuccess: () => { invalidate(); toast('规则已保存', 'success') },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: string) => {
      const client = getClient()
      if (!client) throw new Error('No client')
      return client.post('/api/alerts/rules/delete', { id })
    },
    onSuccess: () => { invalidate(); toast('规则已删除', 'success') },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const channelMutation = useMutation({
    mutationFn: async (ch: NotifyChannel) => {
      const client = getClient()
      if (!client) throw new Error('No client')
      return client.post('/api/alerts/channels', ch)
    },
    onSuccess: () => { invalidate(); toast('通道已保存', 'success') },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const deleteChannelMutation = useMutation({
    mutationFn: async (id: string) => {
      const client = getClient()
      if (!client) throw new Error('No client')
      return client.post('/api/alerts/channels/delete', { id })
    },
    onSuccess: () => { invalidate(); toast('通道已删除', 'success') },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const testMutation = useMutation({
    mutationFn: async (channelId: string) => {
      const client = getClient()
      if (!client) throw new Error('No client')
      return client.post('/api/alerts/test', { channelId })
    },
    onSuccess: () => toast('测试通知已发送', 'success'),
    onError: (e: Error) => toast('发送失败: ' + e.message, 'error'),
  })

  const handleSaveRule = () => {
    const rule = { ...ruleForm }
    if (!rule.id) rule.id = genId()
    if (!rule.name.trim()) { toast('请输入规则名称', 'error'); return }
    ruleMutation.mutate(rule)
    setShowAddRule(false)
    setEditingRule(null)
    setRuleForm(emptyRule)
  }

  const handleEditRule = (rule: AlertRule) => {
    setRuleForm(rule)
    setEditingRule(rule)
    setShowAddRule(true)
  }

  const handleToggleRule = (rule: AlertRule) => {
    ruleMutation.mutate({ ...rule, enabled: !rule.enabled })
  }

  const handleSaveChannel = () => {
    if (!chName.trim() || !chUrl.trim()) { toast('请填写名称和 URL', 'error'); return }
    channelMutation.mutate({ id: genId(), name: chName, type: 'webhook', url: chUrl, enabled: true })
    setShowAddChannel(false)
    setChName('')
    setChUrl('')
  }

  const handleToggleChannel = (ch: NotifyChannel) => {
    channelMutation.mutate({ ...ch, enabled: !ch.enabled })
  }

  if (isLoading) return <DetailSkeleton />
  if (error && !overview) return <QueryErrorState message="加载告警配置失败" onRetry={() => refetch()} />

  const sevBadge = (s: string) => SEVERITIES.find(v => v.value === s) ?? SEVERITIES[2]
  const metricLabel = (m: string) => METRICS.find(v => v.value === m)?.label ?? m

  return (
    <div className="h-full flex flex-col">
      <PullToRefresh onRefresh={invalidate}>
        <div className="p-4 pb-6 space-y-3">

          {/* Overview */}
          <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 animate-fade-in">
            <div className="flex items-center gap-2 mb-3">
              <Bell size={16} className="text-emerald-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">告警概览</h3>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-emerald-50/30 dark:bg-[#0f2428] rounded-xl p-3 text-center">
                <div className="text-[10px] text-gray-400 mb-1">活跃告警</div>
                <div className={`text-lg font-bold tabular-nums ${(overview?.activeCount ?? 0) > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                  {overview?.activeCount ?? 0}
                </div>
              </div>
              <div className="bg-emerald-50/30 dark:bg-[#0f2428] rounded-xl p-3 text-center">
                <div className="text-[10px] text-gray-400 mb-1">规则数</div>
                <div className="text-lg font-bold tabular-nums text-gray-700 dark:text-gray-200">{overview?.ruleCount ?? 0}</div>
              </div>
              <div className="bg-emerald-50/30 dark:bg-[#0f2428] rounded-xl p-3 text-center">
                <div className="text-[10px] text-gray-400 mb-1">通知通道</div>
                <div className="text-lg font-bold tabular-nums text-gray-700 dark:text-gray-200">{overview?.channelCount ?? 0}</div>
              </div>
            </div>
          </div>

          {/* Notification Channels */}
          <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 animate-slide-up">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">通知通道</h3>
              <button onClick={() => setShowAddChannel(!showAddChannel)} className="flex items-center gap-1 text-xs text-emerald-500 active:opacity-70">
                <Plus size={14} /> 添加
              </button>
            </div>

            {showAddChannel && (
              <div className="mb-3 p-3 bg-gray-50 dark:bg-white/[0.03] rounded-xl space-y-2">
                <input className={inputClass} placeholder="通道名称（如：企业微信）" value={chName} onChange={e => setChName(e.target.value)} />
                <input className={inputClass} placeholder="Webhook URL" value={chUrl} onChange={e => setChUrl(e.target.value)} />
                <div className="flex gap-2 justify-end">
                  <button className={btnSecondary} onClick={() => { setShowAddChannel(false); setChName(''); setChUrl('') }}>取消</button>
                  <button className={btnPrimary} onClick={handleSaveChannel} disabled={channelMutation.isPending}>保存</button>
                </div>
              </div>
            )}

            {channels && channels.length > 0 ? (
              <div className="space-y-2">
                {channels.map(ch => (
                  <div key={ch.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-gray-50/50 dark:bg-white/[0.02]">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-700 dark:text-gray-200">{ch.name}</div>
                      <div className="text-[10px] text-gray-400 truncate">{ch.url}</div>
                    </div>
                    <button
                      onClick={() => testMutation.mutate(ch.id)}
                      disabled={testMutation.isPending}
                      className="p-1.5 text-gray-400 hover:text-emerald-500 active:scale-90 transition"
                      title="发送测试"
                    >
                      {testMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    </button>
                    <button
                      onClick={() => handleToggleChannel(ch)}
                      className={`w-9 h-5 rounded-full transition-colors ${ch.enabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${ch.enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                    </button>
                    <button onClick={() => deleteChannelMutation.mutate(ch.id)} className="p-1.5 text-gray-400 hover:text-rose-500 active:scale-90 transition">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-4">暂无通知通道，点击上方添加</p>
            )}
          </div>

          {/* Alert Rules */}
          <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 animate-slide-up">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">告警规则</h3>
              <button onClick={() => { setShowAddRule(!showAddRule); setEditingRule(null); setRuleForm(emptyRule) }} className="flex items-center gap-1 text-xs text-emerald-500 active:opacity-70">
                <Plus size={14} /> 添加
              </button>
            </div>

            {showAddRule && (
              <div className="mb-3 p-3 bg-gray-50 dark:bg-white/[0.03] rounded-xl space-y-2.5">
                <input className={inputClass} placeholder="规则名称" value={ruleForm.name} onChange={e => setRuleForm(f => ({ ...f, name: e.target.value }))} />
                <div className="grid grid-cols-2 gap-2">
                  <select className={selectClass} value={ruleForm.metric} onChange={e => setRuleForm(f => ({ ...f, metric: e.target.value }))}>
                    {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <select className={selectClass} value={ruleForm.operator} onChange={e => setRuleForm(f => ({ ...f, operator: e.target.value }))}>
                    {OPERATORS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className={inputClass} type="number" placeholder="阈值" value={ruleForm.threshold} onChange={e => setRuleForm(f => ({ ...f, threshold: parseFloat(e.target.value) || 0 }))} />
                  <select className={selectClass} value={ruleForm.duration} onChange={e => setRuleForm(f => ({ ...f, duration: parseInt(e.target.value) }))}>
                    {DURATIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </div>
                {ruleForm.metric === 'disk_usage' && (
                  <input className={inputClass} placeholder="挂载点（如 /）" value={ruleForm.mountPoint ?? ''} onChange={e => setRuleForm(f => ({ ...f, mountPoint: e.target.value }))} />
                )}
                <div className="flex gap-2">
                  {SEVERITIES.map(s => (
                    <button
                      key={s.value}
                      onClick={() => setRuleForm(f => ({ ...f, severity: s.value }))}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        ruleForm.severity === s.value ? s.color : 'bg-gray-100 dark:bg-white/[0.04] text-gray-400'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 justify-end">
                  <button className={btnSecondary} onClick={() => { setShowAddRule(false); setEditingRule(null) }}>取消</button>
                  <button className={btnPrimary} onClick={handleSaveRule} disabled={ruleMutation.isPending}>
                    {editingRule ? '更新' : '保存'}
                  </button>
                </div>
              </div>
            )}

            {rules && rules.length > 0 ? (
              <div className="space-y-2">
                {rules.map(rule => {
                  const sev = sevBadge(rule.severity)
                  return (
                    <div key={rule.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-gray-50/50 dark:bg-white/[0.02]" onClick={() => handleEditRule(rule)}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`px-1.5 py-0.5 text-[9px] font-semibold rounded ${sev.color}`}>{sev.label}</span>
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{rule.name}</span>
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          {metricLabel(rule.metric)} {rule.operator} {rule.threshold}{rule.metric.includes('usage') ? '%' : ''}
                          {rule.duration > 0 && ` · 持续 ${rule.duration >= 60 ? `${rule.duration / 60}分钟` : `${rule.duration}秒`}`}
                          {rule.mountPoint && ` · ${rule.mountPoint}`}
                        </div>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); handleToggleRule(rule) }}
                        className={`w-9 h-5 rounded-full transition-colors shrink-0 ${rule.enabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      >
                        <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${rule.enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); deleteRuleMutation.mutate(rule.id) }} className="p-1.5 text-gray-400 hover:text-rose-500 active:scale-90 transition shrink-0">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-4">暂无告警规则，点击上方添加</p>
            )}
          </div>

          {/* Alert History */}
          <div className="bg-white dark:bg-dark-surface-2 border border-gray-100 dark:border-white/[0.06] rounded-2xl p-4 animate-slide-up">
            <button onClick={() => setHistoryOpen(!historyOpen)} className="flex items-center justify-between w-full">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">告警历史</h3>
              <ChevronDown size={16} className={`text-gray-400 transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
            </button>

            {historyOpen && (
              <div className="mt-3">
                {overview?.recentEvents && overview.recentEvents.length > 0 ? (
                  <div className="space-y-2">
                    {overview.recentEvents.map((evt, i) => (
                      <div key={i} className="flex items-start gap-2.5 p-2 rounded-lg">
                        {evt.status === 'firing' ? (
                          <AlertTriangle size={14} className="text-rose-500 mt-0.5 shrink-0" />
                        ) : (
                          <Info size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-gray-700 dark:text-gray-200">
                            {evt.ruleName}
                            <span className={`ml-1.5 text-[10px] font-semibold ${evt.status === 'firing' ? 'text-rose-500' : 'text-emerald-500'}`}>
                              {evt.status === 'firing' ? '触发' : '恢复'}
                            </span>
                          </div>
                          <div className="text-[10px] text-gray-400">
                            {metricLabel(evt.metric)} = {evt.value.toFixed(1)} (阈值 {evt.threshold})
                          </div>
                          <div className="text-[10px] text-gray-400">
                            {new Date(evt.firedAt).toLocaleString()}
                            {evt.resolvedAt && ` → ${new Date(evt.resolvedAt).toLocaleString()}`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 text-center py-4">暂无告警记录</p>
                )}
              </div>
            )}
          </div>

        </div>
      </PullToRefresh>
    </div>
  )
}
