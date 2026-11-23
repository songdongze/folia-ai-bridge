/**
 * 设置页：Folia AI 桥接。
 * 只读 Host 的 /folia-ai/overview，写入走 /folia-ai/config（同源 + 配置编辑器）。
 * 样式全部走 --dsw-alias-* token，跟随明暗主题；不引入任何外部依赖。
 */

window.__ModuleLoader__.load({
  id: '@local/folia-ai-bridge',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo, useRef } = React

    const ENDPOINT = '/folia-ai'

    const CSS = `
.fai-root { display: flex; flex-direction: column; gap: 16px; padding: 4px 2px 24px; font-size: 13px; color: var(--dsw-alias-label-primary); }
.fai-hero { display: flex; align-items: flex-start; gap: 14px; padding: 16px 18px; border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.fai-hero-mark { flex: none; width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); color: var(--dsw-alias-brand-primary); }
.fai-hero-text { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.fai-hero-title { font-size: 14px; font-weight: 600; }
.fai-hero-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fai-hero-desc { color: var(--dsw-alias-label-secondary); line-height: 1.65; }
.fai-hero-desc code, .fai-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
  padding: 1px 5px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.fai-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.fai-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.fai-card-title { font-weight: 600; }
.fai-card-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }
.fai-card-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
.fai-card-body-flush { padding: 0; }
.fai-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.fai-row-label { width: 96px; flex: none; color: var(--dsw-alias-label-secondary); }
.fai-row-body { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fai-select, .fai-input { min-width: 0; padding: 6px 10px; border-radius: 8px; font-size: 13px;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2); outline: none; }
.fai-select { flex: 1; max-width: 320px; }
.fai-input { flex: 1; max-width: 320px; }
.fai-select:focus, .fai-input:focus { border-color: var(--dsw-alias-brand-primary); }
.fai-select:disabled, .fai-input:disabled { opacity: .6; }
.fai-btn { padding: 6px 14px; border-radius: 8px; font-size: 13px; cursor: pointer; white-space: nowrap;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.fai-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.fai-btn:disabled { opacity: .45; cursor: default; }
.fai-btn-primary { background: var(--dsw-alias-brand-primary); border-color: transparent; color: #fff; }
.fai-btn-primary:hover { filter: brightness(1.06); background: var(--dsw-alias-brand-primary); }
.fai-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 10px; }
.fai-stat { padding: 12px 14px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1); display: flex; flex-direction: column; gap: 4px; }
.fai-stat-num { font-size: 20px; font-weight: 620; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.fai-stat-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.fai-mini-bar { height: 4px; border-radius: 3px; background: var(--dsw-alias-border-l1); overflow: hidden; margin-top: 6px; }
.fai-mini-bar > i { display: block; height: 100%; border-radius: 3px; background: var(--dsw-alias-brand-primary); }
.fai-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.fai-table th { text-align: left; font-weight: 500; color: var(--dsw-alias-label-secondary);
  padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); white-space: nowrap; }
.fai-table td { padding: 9px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); vertical-align: top; }
.fai-table tr:last-child td { border-bottom: none; }
.fai-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.fai-model-name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.fai-tag { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border-radius: 999px;
  font-size: 11px; line-height: 18px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.fai-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: currentColor; }
.fai-ok { color: var(--dsw-alias-state-success-primary); }
.fai-err { color: var(--dsw-alias-state-error-primary); }
.fai-empty { padding: 20px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.fai-toast { font-size: 12px; }
.fai-tabs { display: flex; gap: 4px; padding: 3px; border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); width: fit-content; }
.fai-tab { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border: none; border-radius: 8px;
  background: transparent; color: var(--dsw-alias-label-secondary); font-size: 13px; cursor: pointer;
  font-family: inherit; transition: background .12s, color .12s; }
.fai-tab:hover { color: var(--dsw-alias-label-primary); }
.fai-tab.is-active { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-weight: 600;
  box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.fai-tab-badge { min-width: 18px; padding: 0 5px; border-radius: 9px; font-size: 11px; line-height: 17px;
  text-align: center; font-weight: 500; background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary); }
.fai-tab.is-active .fai-tab-badge { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent);
  color: var(--dsw-alias-brand-primary); }
.fai-panel { display: flex; flex-direction: column; gap: 16px; }
`

    const fmtNum = (n) => {
      const value = Number(n) || 0
      if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M'
      if (value >= 1e4) return (value / 1e3).toFixed(1) + 'k'
      return String(value)
    }

    const fmtDuration = (ms) => {
      const sec = Math.floor((Number(ms) || 0) / 1000)
      if (sec < 60) return sec + ' 秒'
      const min = Math.floor(sec / 60)
      if (min < 60) return min + ' 分 ' + (sec % 60) + ' 秒'
      return Math.floor(min / 60) + ' 时 ' + (min % 60) + ' 分'
    }

    const fmtClock = (at) => {
      if (!at) return '—'
      const d = new Date(at)
      const pad = (n) => String(n).padStart(2, '0')
      return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
    }

    const useStyleOnce = () => {
      useEffect(() => {
        const el = document.createElement('style')
        el.setAttribute('data-folia-ai-bridge', '')
        el.textContent = CSS
        document.head.appendChild(el)
        return () => { el.remove() }
      }, [])
    }

    function BrandMark() {
      return h('svg', { width: 22, height: 22, viewBox: '0 0 36 36', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M7 28V17.5C7 11.4 11.9 6.5 18 6.5C24.1 6.5 29 11.4 29 17.5V28',
          stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round',
        }),
        h('path', { d: 'M7 28H3.6M29 28H32.4', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round' }),
        h('ellipse', {
          cx: 15.9, cy: 23.2, rx: 2.7, ry: 2.2, transform: 'rotate(-18 15.9 23.2)',
          fill: 'currentColor', opacity: 0.85,
        }),
        h('path', {
          d: 'M18.4 22.8V14.6M18.4 14.9C18.4 14.9 21.6 14.7 23 16.6',
          stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round',
        }))
    }

    function Stat({ label, value, hint, ratio }) {
      const bar = ratio === undefined
        ? null
        : h('div', { className: 'fai-mini-bar' },
          h('i', { style: { width: Math.min(100, Math.max(2, ratio * 100)) + '%' } }))
      return h('div', { className: 'fai-stat' },
        h('div', { className: 'fai-stat-num' }, value),
        h('div', { className: 'fai-stat-label' }, label),
        hint ? h('div', { className: 'fai-stat-label' }, hint) : null,
        bar)
    }

    function Field({ label, children }) {
      return h('div', { className: 'fai-row' },
        h('div', { className: 'fai-row-label' }, label),
        h('div', { className: 'fai-row-body' }, children))
    }

    function Hero({ status, stats }) {
      const tags = []
      if (status) {
        tags.push(h('span', { key: 'state', className: 'fai-tag' },
          h('span', { className: 'fai-dot ' + (status.ok ? 'fai-ok' : 'fai-err') }),
          status.ok ? '服务可用' : '模型服务不可用'))
        if (status.tokenRequired) tags.push(h('span', { key: 'token', className: 'fai-tag' }, '需要令牌'))
      }

      const endpoint = (status?.origin || 'http://127.0.0.1:13691') + '/v1/chat/completions'

      const second = status
        ? h('div', { className: 'fai-hero-desc' },
          'DSH 默认模型：',
          h('span', { className: 'fai-code' }, (status.defaultProvider || '—') + ' / ' + (status.defaultModel || '—')),
          ' · 已运行 ' + fmtDuration(stats?.uptimeMs || 0))
        : null

      const text = h('div', { className: 'fai-hero-text' },
        h('div', { className: 'fai-hero-row' },
          h('span', { className: 'fai-hero-title' }, 'Folia AI 桥接'),
          tags),
        h('div', { className: 'fai-hero-desc' },
          '把 DSH 里配置好的模型对外暴露成 OpenAI 兼容接口，供 Folia 的「自定义兼容接口」生成歌词主题。在 Folia 里填接口地址 ',
          h('code', null, endpoint),
          '，密钥随意填一个非空值即可（除非下面设置了令牌）。'),
        second)

      return h('div', { className: 'fai-hero' },
        h('div', { className: 'fai-hero-mark' }, h(BrandMark)),
        text)
    }

    function ModelCard({ status, providers, draft, setDraft, busy, save, toast }) {
      const modelOptions = useMemo(() => {
        if (!draft) return []
        const found = providers.find((p) => p.id === draft.provider)
        return found ? found.models : []
      }, [providers, draft])

      const providerField = h(Field, { label: '提供方' },
        h('select', {
          className: 'fai-select',
          value: draft?.provider ?? '',
          disabled: !draft || busy,
          onChange: (e) => setDraft((prev) => ({ ...prev, provider: e.target.value, model: '' })),
        },
        h('option', { value: '' }, '跟随 DSH 默认'),
        providers.map((p) => h('option', { key: p.id, value: p.id }, p.name + '（' + p.id + '）'))))

      const modelField = h(Field, { label: '模型' },
        modelOptions.length > 0
          ? h('select', {
            className: 'fai-select',
            value: draft?.model ?? '',
            disabled: !draft || busy,
            onChange: (e) => setDraft((prev) => ({ ...prev, model: e.target.value })),
          },
          h('option', { value: '' }, '跟随 DSH 默认'),
          modelOptions.map((m) => h('option', { key: m.id, value: m.id },
            m.name === m.id ? m.id : m.name + '（' + m.id + '）')))
          : h('input', {
            className: 'fai-input',
            placeholder: '模型 id，留空跟随默认',
            value: draft?.model ?? '',
            disabled: !draft || busy,
            onChange: (e) => setDraft((prev) => ({ ...prev, model: e.target.value })),
          }))

      const effortField = h(Field, { label: '思考强度' },
        h('select', {
          className: 'fai-select',
          value: draft?.reasoningEffort ?? 'auto',
          disabled: !draft || busy,
          onChange: (e) => setDraft((prev) => ({ ...prev, reasoningEffort: e.target.value })),
        },
        h('option', { value: 'auto' }, '自动（取最低档，最省 token）'),
        h('option', { value: '' }, '不指定'),
        h('option', { value: 'low' }, 'low'),
        h('option', { value: 'medium' }, 'medium'),
        h('option', { value: 'high' }, 'high')))

      const maxTokensField = h(Field, { label: '输出上限' },
        h('input', {
          className: 'fai-input', type: 'number', min: 1, step: 256,
          value: draft?.maxTokens ?? 8192,
          disabled: !draft || busy,
          onChange: (e) => setDraft((prev) => ({ ...prev, maxTokens: Number(e.target.value) })),
        }),
        h('span', { className: 'fai-card-hint' }, 'Folia 带了 max_tokens 就取较小值'))

      const temperatureField = h(Field, { label: '温度' },
        h('input', {
          className: 'fai-input', type: 'number', min: 0, max: 2, step: 0.1,
          value: draft?.temperature ?? 0.7,
          disabled: !draft || busy,
          onChange: (e) => setDraft((prev) => ({ ...prev, temperature: Number(e.target.value) })),
        }))

      const tokenField = h(Field, { label: '访问令牌' },
        h('input', {
          className: 'fai-input', type: 'password',
          placeholder: status?.tokenRequired ? '已设置，留空则保持不变' : '留空则不校验',
          value: draft?.token ?? '',
          disabled: !draft || busy,
          onChange: (e) => setDraft((prev) => ({ ...prev, token: e.target.value })),
        }))

      const actions = h('div', { className: 'fai-row' },
        h('div', { className: 'fai-row-body', style: { justifyContent: 'flex-end' } },
          toast
            ? h('span', { className: 'fai-toast ' + (toast.kind === 'err' ? 'fai-err' : 'fai-ok') }, toast.text)
            : null,
          h('button', {
            className: 'fai-btn fai-btn-primary',
            disabled: busy || !draft,
            onClick: save,
          }, busy ? '保存中…' : '保存设置')))

      return h('div', { className: 'fai-card' },
        h('div', { className: 'fai-card-head' },
          h('div', null,
            h('div', { className: 'fai-card-title' }, '模型选择'),
            h('div', { className: 'fai-card-hint' }, '留空跟随 DSH 的默认模型；选定了就固定用这一个。'))),
        h('div', { className: 'fai-card-body' },
          providerField, modelField, effortField, maxTokensField, temperatureField, tokenField, actions))
    }

    function UsageCard({ stats, busy, resetStats }) {
      const totals = (stats && stats.totals) || { calls: 0, input: 0, output: 0, failed: 0 }
      const models = (stats && stats.models) || []
      const maxCalls = models.reduce((max, m) => Math.max(max, m.calls), 0) || 1
      const successRate = totals.calls > 0 ? (totals.calls - totals.failed) / totals.calls : 0

      const grid = h('div', { className: 'fai-stat-grid' },
        h(Stat, { key: 'calls', label: '请求次数', value: fmtNum(totals.calls) }),
        h(Stat, { key: 'in', label: '输入 token', value: fmtNum(totals.input) }),
        h(Stat, { key: 'out', label: '输出 token', value: fmtNum(totals.output) }),
        h(Stat, { key: 'total', label: '总 token', value: fmtNum(totals.input + totals.output) }),
        h(Stat, {
          key: 'rate',
          label: '成功率',
          value: totals.calls ? Math.round(successRate * 100) + '%' : '—',
          hint: totals.failed ? totals.failed + ' 次失败' : '无失败',
          ratio: totals.calls ? successRate : 0,
        }))

      const rows = models.map((m) => h('tr', { key: m.provider + '/' + m.model },
        h('td', null,
          h('div', { className: 'fai-model-name' }, m.model),
          h('div', { className: 'fai-card-hint' }, m.provider),
          h('div', { className: 'fai-mini-bar' },
            h('i', { style: { width: Math.max(3, (m.calls / maxCalls) * 100) + '%' } }))),
        h('td', { className: 'num' }, fmtNum(m.calls)),
        h('td', { className: 'num' }, fmtNum(m.input)),
        h('td', { className: 'num' }, fmtNum(m.output)),
        h('td', { className: 'num' + (m.failed ? ' fai-err' : '') }, m.failed ? String(m.failed) : '—'),
        h('td', { className: 'num' }, fmtClock(m.lastAt))))

      const table = models.length > 0
        ? h('table', { className: 'fai-table' },
          h('thead', null,
            h('tr', null,
              h('th', null, '模型'),
              h('th', { className: 'num' }, '次数'),
              h('th', { className: 'num' }, '输入'),
              h('th', { className: 'num' }, '输出'),
              h('th', { className: 'num' }, '失败'),
              h('th', { className: 'num' }, '最近'))),
          h('tbody', null, rows))
        : h('div', { className: 'fai-empty' }, '还没有转发过请求。在 Folia 里触发生成主题后，这里会出现明细。')

      const body = table

      return h('div', { className: 'fai-card' },
        h('div', { className: 'fai-card-head' },
          h('div', null,
            h('div', { className: 'fai-card-title' }, '用量详情'),
            h('div', { className: 'fai-card-hint' }, '只统计本插件转发的请求，只存内存、不落盘，DSH 重启即清零。')),
          h('button', {
            className: 'fai-btn',
            disabled: busy || !totals.calls,
            onClick: resetStats,
          }, '清零')),
        h('div', { className: 'fai-card-body' },
          grid,
          h('div', { className: 'fai-card-body-flush' }, body)))
    }

    function RecentCard({ stats }) {
      const recent = (stats && stats.recent) || []
      if (recent.length === 0) return null

      const rows = recent.map((r, i) => h('tr', { key: String(i) },
        h('td', { className: 'num' }, fmtClock(r.at)),
        h('td', null, h('div', { className: 'fai-model-name' }, r.model)),
        h('td', { className: 'num' }, fmtNum((r.input || 0) + (r.output || 0))),
        h('td', { className: 'num' }, r.ms >= 1000 ? (r.ms / 1000).toFixed(1) + 's' : r.ms + 'ms'),
        h('td', null, r.stream ? '流式' : '一次性'),
        h('td', { className: r.ok ? 'fai-ok' : 'fai-err' }, r.ok ? '成功' : '失败')))

      return h('div', { className: 'fai-card' },
        h('div', { className: 'fai-card-head' },
          h('div', null,
            h('div', { className: 'fai-card-title' }, '最近请求'),
            h('div', { className: 'fai-card-hint' }, '最近 20 条。只记模型与 token 数，不保存请求内容。'))),
        h('div', { className: 'fai-card-body fai-card-body-flush' },
          h('table', { className: 'fai-table' },
            h('thead', null,
              h('tr', null,
                h('th', null, '时间'),
                h('th', null, '模型'),
                h('th', { className: 'num' }, 'token'),
                h('th', { className: 'num' }, '耗时'),
                h('th', null, '类型'),
                h('th', null, '结果'))),
            h('tbody', null, rows))))
    }

    function SyncCard({ status, sync, draft, setDraft, busy, save }) {
      const enabled = draft?.syncEnabled !== false
      const origin = (status && status.origin) || 'http://127.0.0.1:13691'
      const tokenRequired = Boolean(status && status.syncTokenRequired)
      const themeCount = sync && typeof sync.themeCount === 'number' ? sync.themeCount : 0
      const hasSettings = Boolean(sync && sync.settingsUpdatedAt)

      const copy = (text) => {
        try {
          void navigator.clipboard.writeText(text)
        } catch {
          // 剪贴板不可用时用户可手动选中
        }
      }

      const addressRow = h(Field, { label: '同步地址' },
        h('input', {
          className: 'fai-input',
          readOnly: true,
          value: origin,
          onFocus: (e) => e.target.select(),
          style: { fontFamily: 'ui-monospace,monospace' },
        }),
        h('button', { className: 'fai-btn', onClick: () => copy(origin) }, '复制'))

      const tokenRow = h(Field, { label: 'Bearer Token' },
        h('input', {
          className: 'fai-input',
          type: 'password',
          placeholder: tokenRequired ? '已设置，留空则保持不变' : '留空则不校验（仅建议本机）',
          value: draft?.syncToken ?? '',
          disabled: !draft || busy,
          onChange: (e) => setDraft((prev) => ({ ...prev, syncToken: e.target.value })),
        }),
        h('span', { className: 'fai-card-hint' }, '填到 Folia 的「Bearer Token」'))

      const toggleRow = h('div', { className: 'fai-row' },
        h('div', { className: 'fai-row-label' }, '同步服务'),
        h('div', { className: 'fai-row-body' },
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' } },
            h('input', {
              type: 'checkbox',
              checked: enabled,
              disabled: !draft || busy,
              onChange: (e) => setDraft((prev) => ({ ...prev, syncEnabled: e.target.checked })),
            }),
            h('span', null, enabled ? '已开启' : '已关闭')),
          h('span', { className: 'fai-card-hint' }, '关掉后 /state、/themes/* 等同步接口不再注册')))

      const statsRow = h('div', { className: 'fai-stat-grid' },
        h(Stat, { key: 'themes', label: '已同步主题', value: String(themeCount) }),
        h(Stat, { key: 'settings', label: '视觉设置', value: hasSettings ? '有' : '无' }),
        h(Stat, {
          key: 'updated',
          label: '主题更新时间',
          value: sync && sync.themesUpdatedAt ? new Date(sync.themesUpdatedAt).toLocaleString() : '—',
        }))

      const actions = h('div', { className: 'fai-row' },
        h('div', { className: 'fai-row-body', style: { justifyContent: 'flex-end' } },
          h('button', { className: 'fai-btn fai-btn-primary', disabled: busy || !draft, onClick: save },
            busy ? '保存中…' : '保存同步设置')))

      return h('div', { className: 'fai-card' },
        h('div', { className: 'fai-card-head' },
          h('div', null,
            h('div', { className: 'fai-card-title' }, '同步服务'),
            h('div', { className: 'fai-card-hint' },
              '用你自己的服务器同步外观设置与 AI 主题。填到 Folia：设置 → 连接与集成 → 同步服务。'))),
        h('div', { className: 'fai-card-body' },
          toggleRow,
          addressRow,
          tokenRow,
          statsRow,
          actions))
    }

    function StorageCard({ sync }) {
      const usage = sync && sync.usage
      const bytes = usage && typeof usage.bytes === 'number' ? usage.bytes : null
      const counts = (usage && usage.counts) || {}
      const dbPath = (sync && sync.dbPath) || (usage && usage.dbPath) || '—'
      const lastAt = sync && sync.themesUpdatedAt ? new Date(sync.themesUpdatedAt).toLocaleString() : '—'
      const settingsAt = sync && sync.settingsUpdatedAt ? new Date(sync.settingsUpdatedAt).toLocaleString() : '—'

      const human = (n) => {
        if (n === null) return '—'
        if (n < 1024) return n + ' B'
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
        return (n / 1024 / 1024).toFixed(2) + ' MB'
      }

      const copyPath = () => {
        try {
          void navigator.clipboard.writeText(dbPath)
        } catch {
          // 剪贴板不可用时手动选中
        }
      }

      return h('div', { className: 'fai-card' },
        h('div', { className: 'fai-card-head' },
          h('div', null,
            h('div', { className: 'fai-card-title' }, '存储情况'),
            h('div', { className: 'fai-card-hint' }, '同步数据落在下面这个 SQLite 文件里，备份复制它即可。'))),
        h('div', { className: 'fai-card-body' },
          h('div', { className: 'fai-stat-grid' },
            h(Stat, { key: 'size', label: '占用空间', value: human(bytes) }),
            h(Stat, { key: 'themes', label: '主题条数', value: String(counts.themes ?? 0) }),
            h(Stat, { key: 'buckets', label: '非空分桶', value: String(counts.buckets ?? 0) + ' / 256' }),
            h(Stat, { key: 'settings', label: '视觉设置', value: (counts.settings ?? 0) > 0 ? '已保存' : '无' })),
          h(Field, { label: '存储位置' },
            h('input', {
              className: 'fai-input',
              readOnly: true,
              value: dbPath,
              onFocus: (e) => e.target.select(),
              style: { fontFamily: 'ui-monospace,monospace', maxWidth: 460 },
            }),
            h('button', { className: 'fai-btn', onClick: copyPath }, '复制')),
          h('div', { className: 'fai-row' },
            h('div', { className: 'fai-row-label' }, '最近同步'),
            h('div', { className: 'fai-row-body' },
              h('span', { className: 'fai-card-hint' }, '主题：' + lastAt + '　设置：' + settingsAt)))))
    }

    function SettingsPage() {
      useStyleOnce()
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [toast, setToast] = useState(null)
      const [draft, setDraft] = useState(null)
      const [activeTab, setActiveTab] = useState('ai')
      const alive = useRef(true)

      const load = useCallback(async () => {
        try {
          const res = await fetch(ENDPOINT + '/overview', { headers: { accept: 'application/json' } })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const next = await res.json()
          if (!alive.current) return
          setData(next)
          setError('')
          setDraft({
            provider: next.status.provider || '',
            model: next.status.model || '',
            reasoningEffort: next.status.reasoningEffort || 'auto',
            maxTokens: next.status.maxTokens,
            temperature: next.status.temperature,
            token: '',
          })
        } catch (e) {
          if (alive.current) setError(e && e.message ? e.message : String(e))
        }
      }, [])

      useEffect(() => {
        alive.current = true
        void load()
        // 只在页面打开时取一次：不轮询，避免设置页常驻 CPU。
        return () => { alive.current = false }
      }, [load])

      const flash = useCallback((text, kind) => {
        setToast({ text, kind: kind || 'ok' })
        setTimeout(() => setToast(null), 2400)
      }, [])

      const save = useCallback(async () => {
        if (!draft) return
        setBusy(true)
        try {
          const res = await fetch(ENDPOINT + '/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(draft),
          })
          const payload = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(payload.error || 'HTTP ' + res.status)
          flash('已保存，插件正在重启以生效', 'ok')
          setTimeout(() => { void load() }, 1200)
        } catch (e) {
          flash((e && e.message) || '保存失败', 'err')
        } finally {
          setBusy(false)
        }
      }, [draft, flash, load])

      const resetStats = useCallback(async () => {
        setBusy(true)
        try {
          const res = await fetch(ENDPOINT + '/stats/reset', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          await load()
          flash('用量已清零', 'ok')
        } catch (e) {
          flash((e && e.message) || '清零失败', 'err')
        } finally {
          setBusy(false)
        }
      }, [flash, load])

      if (error && !data) {
        return h('div', { className: 'fai-root' },
          h('div', { className: 'fai-card' },
            h('div', { className: 'fai-card-body' },
              h('div', { className: 'fai-err' }, '读取桥接状态失败：' + error),
              h('button', { className: 'fai-btn', onClick: () => { void load() } }, '重试'))))
      }

      const providers = (data && data.providers) || []
      const status = data && data.status
      const syncInfo = data && data.sync
      const themeCount = syncInfo && typeof syncInfo.themeCount === 'number' ? syncInfo.themeCount : 0
      const callCount = (data && data.stats && data.stats.totals && data.stats.totals.calls) || 0

      const tab = (id, label, badge) => h('button', {
        key: id,
        className: 'fai-tab' + (activeTab === id ? ' is-active' : ''),
        onClick: () => setActiveTab(id),
        role: 'tab',
        'aria-selected': activeTab === id,
      }, label, badge ? h('span', { className: 'fai-tab-badge' }, badge) : null)

      const aiPanel = h('div', { className: 'fai-panel', role: 'tabpanel' },
        h(ModelCard, { status, providers, draft, setDraft, busy, save, toast: null }),
        h(UsageCard, { stats: data && data.stats, busy, resetStats }),
        h(RecentCard, { stats: data && data.stats }))

      const syncPanel = h('div', { className: 'fai-panel', role: 'tabpanel' },
        h(SyncCard, { status, sync: syncInfo, draft, setDraft, busy, save }),
        h(StorageCard, { sync: syncInfo }))

      return h('div', { className: 'fai-root' },
        h(Hero, { status, stats: data && data.stats }),
        h('div', { className: 'fai-tabs', role: 'tablist' },
          tab('ai', 'AI 主题', callCount > 0 ? String(callCount) : null),
          tab('sync', '同步服务', themeCount > 0 ? String(themeCount) : null)),
        activeTab === 'ai' ? aiPanel : syncPanel,
        toast ? h('div', { className: 'fai-toast ' + (toast.kind === 'err' ? 'fai-err' : 'fai-ok') }, toast.text) : null)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'folia-ai-bridge',
          order: 55,
          label: () => 'Folia AI 桥接',
        }, SettingsPage))
      },
    }
  },
})
