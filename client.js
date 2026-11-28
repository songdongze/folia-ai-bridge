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
.fai-status { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 14px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1); }
.fai-status-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 18%, transparent); }
.fai-status-text { font-weight: 600; font-size: 13px; }
.fai-spark { display: flex; align-items: flex-end; gap: 2px; height: 36px; margin-top: 10px; }
.fai-spark-bar { flex: 1; min-width: 2px; border-radius: 2px 2px 0 0; background: var(--dsw-alias-brand-primary);
  opacity: .72; transition: opacity .12s; }
.fai-spark-bar:hover { opacity: 1; }
.fai-spark-empty { background: var(--dsw-alias-border-l2); opacity: .45; }
.fai-bars { display: flex; flex-direction: column; gap: 10px; }
.fai-bar-row { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
.fai-bar-label { width: 140px; flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.fai-bar-track { flex: 1; height: 8px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.fai-bar-fill { height: 100%; border-radius: 4px; background: var(--dsw-alias-brand-primary); }
.fai-bar-value { width: 84px; flex: none; text-align: right; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary); }
.fai-warn-box { padding: 12px 14px; border-radius: 10px; border: 1px solid var(--dsw-alias-state-warn-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);
  font-size: 12.5px; line-height: 1.7; }
.fai-err-box { padding: 12px 14px; border-radius: 10px; border: 1px solid var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  font-size: 12.5px; line-height: 1.7; }
.fai-btn-danger { background: var(--dsw-alias-state-error-primary); border-color: transparent; color: #fff; }
.fai-btn-danger:hover { filter: brightness(1.06); background: var(--dsw-alias-state-error-primary); }
.fai-scroll { max-height: 440px; overflow: auto; }
.fai-inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fai-chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.fai-chart-box { padding: 14px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1); }
.fai-chart-title { font-size: 12.5px; color: var(--dsw-alias-label-secondary); margin-bottom: 12px; }
.fai-legend { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 12px; font-size: 12px; }
.fai-legend-item { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); }
.fai-legend-dot { width: 8px; height: 8px; border-radius: 2px; flex: none; }
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

    /** 带日期的短时间：跨天看历史时不会混淆。 */
    const fmtDateTime = (at) => {
      if (!at) return '—'
      const d = new Date(at)
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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

    /** 一行「值 + 复制」的只读字段。 */
    function CopyRow({ label, value, mono, hint, onCopied }) {
      const copy = () => {
        try {
          void navigator.clipboard.writeText(value || '')
          if (onCopied) onCopied(label)
        } catch {
          // 剪贴板不可用时用户可手动选中
        }
      }
      return h(Field, { label },
        h('input', {
          className: 'fai-input',
          readOnly: true,
          value: value || '—',
          onFocus: (e) => e.target.select(),
          style: mono === false ? undefined : { fontFamily: 'ui-monospace,monospace', maxWidth: 460 },
        }),
        h('button', { className: 'fai-btn', onClick: copy, disabled: !value }, '复制'),
        hint ? h('span', { className: 'fai-card-hint' }, hint) : null)
    }

    /** 连接状态徽标：ok / fail / unknown。 */
    function StatusBadge({ state, text, detail }) {
      const cls = state === 'ok' ? 'fai-ok' : state === 'fail' ? 'fai-err' : 'fai-warn'
      const label = state === 'ok' ? '连接正常' : state === 'fail' ? '连接失败' : '未检测'
      return h('div', { className: 'fai-status' },
        h('span', { className: 'fai-status-dot ' + cls }),
        h('span', { className: 'fai-status-text ' + cls }, text || label),
        detail ? h('span', { className: 'fai-card-hint' }, detail) : null)
    }

    /**
     * 每个分栏顶部的「怎么连」区块：完整链接 + 密钥 + 实测状态。
     * 这是用户真正要照着填到 Folia 里的东西。
     */
    function ConnectCard({ kind, status, draft, busy, check, checking, result, onCopied, extra }) {
      const isAi = kind === 'ai'
      const origin = (status && status.origin) || ''
      const chatUrl = (status && status.chatUrl) || (origin ? origin + '/v1/chat/completions' : '')
      const syncUrl = (status && status.syncEndpoint) || origin
      const tokenRequired = isAi ? Boolean(status && status.tokenRequired) : Boolean(status && status.syncTokenRequired)
      // 面板的目的就是把「要填到 Folia 的东西」完整摆出来供复制。
      // 已保存的 token 直接显示真实值（仅本机可见），未设置时给出提示而不是空密码框。
      const savedToken = isAi ? (status && status.tokenValue) : (status && status.syncTokenValue)
      const tokenValue = savedToken || (tokenRequired ? '' : (isAi ? 'dsh' : ''))

      const r = result || {}

      return h('div', { className: 'fai-card' },
        h('div', { className: 'fai-card-head' },
          h('div', null,
            h('div', { className: 'fai-card-title' }, isAi ? '连接信息 · AI 主题' : '连接信息 · 外观同步'),
            h('div', { className: 'fai-card-hint' },
              isAi
                ? '照着下面的地址与密钥填到 Folia 的「AI 服务 → 自定义兼容接口」。'
                : '照着下面的地址与密钥填到 Folia 的「连接与集成 → 同步服务」。')),
          h('button', {
            className: 'fai-btn',
            disabled: checking,
            onClick: check,
          }, checking ? '检测中…' : '检测连接')),
        h('div', { className: 'fai-card-body' },
          h(StatusBadge, {
            state: r.state || 'unknown',
            text: r.text,
            detail: r.detail,
          }),

          isAi
            ? h(CopyRow, { label: '接口地址', value: chatUrl, hint: 'Folia「接口地址」填这个', onCopied })
            : h(CopyRow, { label: 'Sync 地址', value: syncUrl, hint: 'Folia「Sync Server 地址」填这个', onCopied }),

          isAi
            ? h(CopyRow, { label: '模型名', value: (status && (status.model || status.defaultModel)) || '', hint: 'Folia「模型」可填这个，或点「获取模型」', onCopied })
            : h(CopyRow, {
              label: '看板地址',
              value: status && status.dashboardEnabled ? (status.dashboardUrl || '') : '',
              hint: status && status.dashboardEnabled ? '浏览器打开可看同步状态（需 dashboardToken）' : '未设置 dashboardToken，看板已关闭',
              onCopied,
            }),

          h(CopyRow, {
            label: isAi ? 'API 密钥' : 'Bearer Token',
            value: tokenValue,
            hint: isAi
              ? (tokenRequired ? '填到 Folia「API 密钥」' : '当前不校验，但 Folia 要求非空——直接复制这个值')
              : (tokenRequired ? '填到 Folia「Bearer Token」' : '当前不校验，但 Folia 要求非空——直接复制这个值'),
            onCopied,
          }),

          extra || null))
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

      const tokenField = h(Field, { label: '修改 AI 令牌' },
        h('input', {
          className: 'fai-input', type: 'password',
          placeholder: status?.tokenRequired ? '已设置，留空则保持不变' : '留空则不校验',
          value: draft?.token ?? '',
          disabled: !draft || busy,
          onChange: (e) => setDraft((prev) => ({ ...prev, token: e.target.value })),
        }),
        h('span', { className: 'fai-card-hint' }, '改了以后记得把新值复制到 Folia'))

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

    /** 近 7 天用量柱状趋势（Sparkline）。 */
    function Sparkline({ days, metric = 'calls' }) {
      const list = Array.isArray(days) ? days : []
      const max = list.reduce((m, d) => Math.max(m, d[metric] || 0), 0) || 1
      const bars = list.map((d) => {
        const value = d[metric] || 0
        const height = value === 0 ? 6 : Math.max(6, Math.round((value / max) * 100))
        return h('div', {
          key: d.day,
          className: 'fai-spark-bar' + (value === 0 ? ' fai-spark-empty' : ''),
          style: { height: height + '%' },
          title: `${d.day} · ${fmtNum(value)}`,
        })
      })
      return h('div', { className: 'fai-spark' }, bars)
    }

    /** 横向条形对比图（按模型）。 */
    function ModelBars({ models, metric = 'total' }) {
      const list = Array.isArray(models) ? models : []
      if (list.length === 0) return h('div', { className: 'fai-empty' }, '这个时间段没有数据')
      const max = list.reduce((m, x) => Math.max(m, x[metric] || 0), 0) || 1
      return h('div', { className: 'fai-bars' },
        list.map((m) => h('div', { key: m.provider + '/' + m.model, className: 'fai-bar-row' },
          h('span', { className: 'fai-bar-label', title: m.model }, m.model),
          h('div', { className: 'fai-bar-track' },
            h('div', { className: 'fai-bar-fill', style: { width: Math.max(2, ((m[metric] || 0) / max) * 100) + '%' } })),
          h('span', { className: 'fai-bar-value' }, fmtNum(m[metric] || 0)))))
    }

    /** 费用估算：单价由用户在设置里填，DSH 本身不提供定价。 */
    const costOf = (row, prices) => {
      const pin = (prices && prices.inputPerM) || 0
      const pout = (prices && prices.outputPerM) || 0
      if (!pin && !pout) return null
      return ((row.input || 0) / 1e6) * pin + ((row.output || 0) / 1e6) * pout
    }

    const fmtCost = (value) => (value === null || value === undefined ? '—' : '¥' + value.toFixed(4))

    function UsageCard({ stats, history, range, setRange, chartView, setChartView, busy, resetStats, onNavigate, flash }) {
      const totals = (history && history.totals) || (stats && stats.totals) || { calls: 0, input: 0, output: 0, failed: 0 }
      const models = (history && history.models) || []
      const days = (history && history.days) || []
      const records = (history && history.records) || []
      const prices = (history && history.prices) || { inputPerM: 0, outputPerM: 0 }
      const persisted = Boolean(history && history.persisted)
      const successRate = totals.calls > 0 ? (totals.calls - totals.failed) / totals.calls : 0
      const totalCost = costOf(totals, prices)

      const rangeTabs = h('div', { className: 'fai-tabs' },
        [['today', '今日'], ['7d', '近 7 天'], ['30d', '近 30 天'], ['all', '总计']].map(([key, label]) =>
          h('button', {
            key,
            className: 'fai-tab' + (range === key ? ' is-active' : ''),
            onClick: () => setRange(key),
          }, label)))

      const viewTabs = h('div', { className: 'fai-tabs' },
        [['list', '列表'], ['chart', '图表']].map(([key, label]) =>
          h('button', {
            key,
            className: 'fai-tab' + (chartView === key ? ' is-active' : ''),
            onClick: () => setChartView(key),
          }, label)))

      const statCards = h('div', { className: 'fai-stat-grid' },
        h(Stat, { key: 'calls', label: '请求次数', value: fmtNum(totals.calls) }),
        h(Stat, { key: 'in', label: '输入 token', value: fmtNum(totals.input) }),
        h(Stat, { key: 'out', label: '输出 token', value: fmtNum(totals.output) }),
        h(Stat, { key: 'total', label: '总 token', value: fmtNum(totals.total ?? (totals.input + totals.output)) }),
        h(Stat, {
          key: 'rate',
          label: '成功率',
          // 0 请求时显示 --，不再显示「无失败」
          value: totals.calls > 0 ? Math.round(successRate * 100) + '%' : '--',
          hint: totals.calls === 0 ? '暂无请求' : (totals.failed ? totals.failed + ' 次失败' : '无失败'),
          ratio: totals.calls > 0 ? successRate : 0,
        }),
        totalCost !== null
          ? h(Stat, { key: 'cost', label: '预估费用', value: fmtCost(totalCost) })
          : null)

      const trendCard = h('div', { className: 'fai-chart-box' },
        h('div', { className: 'fai-chart-title' }, '近 7 天请求趋势'),
        h(Sparkline, { days: days.slice(-7), metric: 'calls' }))

      const modelList = models.length > 0
        ? h('table', { className: 'fai-table' },
          h('thead', null,
            h('tr', null,
              h('th', null, '模型'),
              h('th', { className: 'num' }, '次数'),
              h('th', { className: 'num' }, '输入'),
              h('th', { className: 'num' }, '输出'),
              h('th', { className: 'num' }, '失败'),
              h('th', { className: 'num' }, prices.inputPerM || prices.outputPerM ? '费用' : '平均耗时'))),
          h('tbody', null, models.map((m) => h('tr', { key: m.provider + '/' + m.model },
            h('td', null,
              h('div', { className: 'fai-model-name' }, m.model),
              h('div', { className: 'fai-card-hint' }, m.provider)),
            h('td', { className: 'num' }, fmtNum(m.calls)),
            h('td', { className: 'num' }, fmtNum(m.input)),
            h('td', { className: 'num' }, fmtNum(m.output)),
            h('td', { className: 'num' + (m.failed ? ' fai-err' : '') }, m.failed ? String(m.failed) : '—'),
            h('td', { className: 'num' }, prices.inputPerM || prices.outputPerM
              ? fmtCost(costOf(m, prices))
              : (m.avgMs >= 1000 ? (m.avgMs / 1000).toFixed(1) + 's' : m.avgMs + 'ms'))))))
        : h('div', { className: 'fai-empty' }, '这个时间段还没有请求。在 Folia 里触发生成主题后，这里会出现明细。')

      const detailRows = records.map((r) => {
        const cost = costOf(r, prices)
        return h('tr', { key: String(r.id) },
          h('td', { className: 'fai-mono-sm' }, fmtDateTime(r.at)),
          h('td', null, h('div', { className: 'fai-model-name' }, r.model),
            h('div', { className: 'fai-card-hint' }, r.provider)),
          h('td', { className: 'num' }, fmtNum(r.input)),
          h('td', { className: 'num' }, fmtNum(r.output)),
          h('td', { className: 'num' }, fmtNum(r.total)),
          cost !== null ? h('td', { className: 'num' }, fmtCost(cost)) : null,
          h('td', { className: 'num' }, r.ms >= 1000 ? (r.ms / 1000).toFixed(1) + 's' : r.ms + 'ms'),
          h('td', null, r.stream ? '流式' : '一次性'),
          h('td', { className: r.ok ? 'fai-ok' : 'fai-err' }, r.ok ? '成功' : '失败'))
      })

      const detailTable = records.length > 0
        ? h('div', { className: 'fai-scroll' },
          h('table', { className: 'fai-table' },
            h('thead', null,
              h('tr', null,
                h('th', null, '时间'),
                h('th', null, '模型'),
                h('th', { className: 'num' }, '输入'),
                h('th', { className: 'num' }, '输出'),
                h('th', { className: 'num' }, '总'),
                prices.inputPerM || prices.outputPerM ? h('th', { className: 'num' }, '费用') : null,
                h('th', { className: 'num' }, '耗时'),
                h('th', null, '类型'),
                h('th', null, '状态'))),
            h('tbody', null, detailRows)))
        : h('div', { className: 'fai-empty' }, '暂无明细记录')

      const chartPanel = h('div', { className: 'fai-chart-grid' },
        trendCard,
        h('div', { className: 'fai-chart-box' },
          h('div', { className: 'fai-chart-title' }, '各模型 token 占比'),
          h(ModelBars, { models, metric: 'total' })))

      const listPanel = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        h('div', { className: 'fai-chart-box' },
          h('div', { className: 'fai-chart-title' }, '按模型汇总'),
          modelList),
        h('div', { className: 'fai-chart-box', style: { padding: 0 } },
          h('div', { className: 'fai-chart-title', style: { padding: '14px 14px 0' } }, '历史明细'),
          detailTable))

      const hint = persisted
        ? `历史记录保存在本机（${history && history.retentionDays ? history.retentionDays : 30} 天明细），DSH 重启后不会丢失，仅限当前设备可见。`
        : '当前未开启历史落盘，下面只有本次运行的统计，DSH 重启后会清零。'

      const headerActions = h('div', { className: 'fai-inline' },
        h('button', {
          className: 'fai-btn',
          disabled: busy || !persisted || !totals.calls,
          onClick: () => onNavigate('history-export', range),
          title: '把当前时间范围的明细导出成 CSV',
        }, '导出 CSV'),
        h('button', {
          className: 'fai-btn',
          disabled: busy || !totals.calls,
          onClick: resetStats,
          title: '只清本次运行的统计，不影响历史记录',
        }, '清空统计'))

      return h('div', { className: 'fai-card' },
        h('div', { className: 'fai-card-head' },
          h('div', null,
            h('div', { className: 'fai-card-title' }, '用量与历史'),
            h('div', { className: 'fai-card-hint' }, hint)),
          headerActions),
        h('div', { className: 'fai-card-body' },
          h('div', { className: 'fai-inline', style: { justifyContent: 'space-between' } },
            rangeTabs,
            viewTabs),
          statCards,
          !persisted
            ? h('div', { className: 'fai-warn-box' },
              '历史落盘已关闭。到「设置」标签页打开「记录历史明细」后，用量会保存到本机数据库，重启不丢。')
            : null,
          chartView === 'chart' ? chartPanel : listPanel,
          h('div', { className: 'fai-inline', style: { justifyContent: 'space-between' } },
            h('span', { className: 'fai-card-hint' },
              history && history.dbPath ? '数据库：' + history.dbPath : ''),
            h('button', {
              className: 'fai-btn',
              disabled: busy || !persisted,
              onClick: () => onNavigate('history-clear'),
              style: { color: 'var(--dsw-alias-state-error-primary)' },
            }, '清空历史记录…'))))
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

      const savedToken = (status && status.syncTokenValue) || (tokenRequired ? '' : 'dsh')

      const addressRow = h(CopyRow, {
        label: '同步地址',
        value: origin,
        hint: 'Folia「Sync Server 地址」填这个',
        onCopied: () => {},
      })

      const tokenRow = h(CopyRow, {
        label: 'Bearer Token',
        value: savedToken,
        hint: tokenRequired ? '填到 Folia「Bearer Token」' : '当前不校验，直接复制这个值',
        onCopied: () => {},
      })

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

      const editTokenRow = h(Field, { label: '修改同步令牌' },
        h('input', {
          className: 'fai-input', type: 'password',
          placeholder: tokenRequired ? '已设置，留空则保持不变' : '留空则不校验',
          value: draft?.syncToken ?? '',
          disabled: !draft || busy,
          onChange: (e) => setDraft((prev) => ({ ...prev, syncToken: e.target.value })),
        }),
        h('span', { className: 'fai-card-hint' }, '改了以后记得把新值复制到 Folia'))

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
          editTokenRow,
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

    /** 历史记录的开关、保留天数、费用单价。 */
    function HistorySettingsCard({ draft, setDraft, busy, save, status, history }) {
      const enabled = draft?.historyEnabled !== false

      const toggleRow = h('div', { className: 'fai-row' },
        h('div', { className: 'fai-row-label' }, '记录历史'),
        h('div', { className: 'fai-row-body' },
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' } },
            h('input', {
              type: 'checkbox',
              checked: enabled,
              disabled: !draft || busy,
              onChange: (e) => setDraft((prev) => ({ ...prev, historyEnabled: e.target.checked })),
            }),
            h('span', null, enabled ? '已开启' : '已关闭')),
          h('span', { className: 'fai-card-hint' }, '关闭后不再落盘，只剩本次运行的内存统计')))

      const retentionRow = h(Field, { label: '明细保留' },
        h('input', {
          className: 'fai-input', type: 'number', min: 1, max: 3650, step: 1,
          value: draft?.historyRetentionDays ?? 30,
          disabled: !draft || busy || !enabled,
          onChange: (e) => setDraft((prev) => ({ ...prev, historyRetentionDays: Number(e.target.value) })),
        }),
        h('span', { className: 'fai-card-hint' }, '天。更早的明细会按月聚合后删除，总览仍统计得到'))

      const priceRowIn = h(Field, { label: '输入单价' },
        h('input', {
          className: 'fai-input', type: 'number', min: 0, step: 0.01,
          value: draft?.priceInputPerM ?? 0,
          disabled: !draft || busy,
          onChange: (e) => setDraft((prev) => ({ ...prev, priceInputPerM: Number(e.target.value) })),
        }),
        h('span', { className: 'fai-card-hint' }, '元 / 百万 token，只用于估算，不影响实际请求'))

      const priceRowOut = h(Field, { label: '输出单价' },
        h('input', {
          className: 'fai-input', type: 'number', min: 0, step: 0.01,
          value: draft?.priceOutputPerM ?? 0,
          disabled: !draft || busy,
          onChange: (e) => setDraft((prev) => ({ ...prev, priceOutputPerM: Number(e.target.value) })),
        }),
        h('span', { className: 'fai-card-hint' }, '元 / 百万 token。填 0 则不显示费用列'))

      const dbPath = (history && history.dbPath) || (status && status.historyDbPath) || ''

      const infoRow = h('div', { className: 'fai-row' },
        h('div', { className: 'fai-row-label' }, '存储位置'),
        h('div', { className: 'fai-row-body' },
          h('span', { className: 'fai-card-hint', style: { fontFamily: 'ui-monospace,monospace', wordBreak: 'break-all' } },
            dbPath || '（尚未创建）'),
          history && history.sizeBytes > 0
            ? h('span', { className: 'fai-card-hint' }, `占用 ${(history.sizeBytes / 1024).toFixed(1)} KB`)
            : null))

      const actions = h('div', { className: 'fai-row' },
        h('div', { className: 'fai-row-body', style: { justifyContent: 'flex-end' } },
          h('button', { className: 'fai-btn fai-btn-primary', disabled: busy || !draft, onClick: save },
            busy ? '保存中…' : '保存历史设置')))

      return h('div', { className: 'fai-card' },
        h('div', { className: 'fai-card-head' },
          h('div', null,
            h('div', { className: 'fai-card-title' }, '历史记录设置'),
            h('div', { className: 'fai-card-hint' },
              '明细存在本机 SQLite，DSH 重启不丢；仅当前设备可见，不上传任何地方。'))),
        h('div', { className: 'fai-card-body' },
          toggleRow, retentionRow, priceRowIn, priceRowOut, infoRow, actions))
    }

    /** 清空历史的二次确认。 */
    function ConfirmClearDialog({ open, busy, onCancel, onConfirm }) {
      if (!open) return null
      return h('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center',
          background: 'rgba(0,0,0,.45)', padding: 24,
        },
        onClick: (e) => { if (e.target === e.currentTarget && !busy) onCancel() },
      },
      h('div', {
        role: 'dialog',
        'aria-modal': 'true',
        style: {
          width: 'min(440px, 100%)', padding: 20, borderRadius: 12,
          background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l2)',
          boxShadow: '0 12px 32px rgba(0,0,0,.36)', display: 'flex', flexDirection: 'column', gap: 14,
        },
      },
      h('div', { style: { fontWeight: 620, fontSize: 14 } }, '清空全部历史记录？'),
      h('div', { className: 'fai-card-hint', style: { lineHeight: 1.7 } },
        '这会删除本机数据库里的全部用量明细与按月归档，无法恢复。当前运行的统计也会一并清零。'),
      h('div', { className: 'fai-inline', style: { justifyContent: 'flex-end' } },
        h('button', { className: 'fai-btn', disabled: busy, onClick: onCancel }, '取消'),
        h('button', { className: 'fai-btn fai-btn-danger', disabled: busy, onClick: onConfirm },
          busy ? '删除中…' : '确认清空'))))
    }

    function SettingsPage() {
      useStyleOnce()
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [toast, setToast] = useState(null)
      const [draft, setDraft] = useState(null)
      const [activeTab, setActiveTab] = useState('ai')
      const [history, setHistory] = useState(null)
      const [range, setRange] = useState('7d')
      const [chartView, setChartView] = useState('list')
      const [pendingClear, setPendingClear] = useState(null)
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
            // 用「配置里显式写了什么」初始化，而不是解析后的默认值：
            // 否则一次保存就把当时的默认模型钉死成固定配置。
            provider: next.status.configuredProvider ?? '',
            model: next.status.configuredModel ?? '',
            reasoningEffort: next.status.configuredReasoningEffort ?? 'auto',
            maxTokens: next.status.maxTokens,
            temperature: next.status.temperature,
            token: '',
            syncEnabled: next.status.syncEnabled !== false,
            syncToken: '',
            dashboardToken: '',
            historyEnabled: next.status.historyEnabled !== false,
            historyRetentionDays: next.status.historyRetentionDays ?? 30,
            priceInputPerM: next.status.prices ? next.status.prices.inputPerM : 0,
            priceOutputPerM: next.status.prices ? next.status.prices.outputPerM : 0,
          })
        } catch (e) {
          if (alive.current) setError(e && e.message ? e.message : String(e))
        }
      }, [])

      const flash = useCallback((text, kind) => {
        setToast({ text, kind: kind || 'ok' })
        setTimeout(() => setToast(null), 2400)
      }, [])

      /** 历史用量：切换时间范围时重新取。 */
      const loadHistory = useCallback(async (nextRange) => {
        try {
          const res = await fetch(`${ENDPOINT}/history?range=${encodeURIComponent(nextRange)}`, {
            headers: { accept: 'application/json' },
          })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const payload = await res.json()
          if (alive.current) setHistory(payload)
        } catch (e) {
          if (alive.current) flash('读取历史失败：' + ((e && e.message) || e), 'err')
        }
      }, [flash])

      useEffect(() => {
        alive.current = true
        void load()
        void loadHistory('7d')
        // 只在页面打开时取一次：不轮询，避免设置页常驻 CPU。
        return () => { alive.current = false }
      }, [load, loadHistory])

      /** 切换范围时重取历史。 */
      useEffect(() => {
        if (data) void loadHistory(range)
      }, [range, data, loadHistory])

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
          flash('本次运行的统计已清零（历史记录保留）', 'ok')
        } catch (e) {
          flash((e && e.message) || '清零失败', 'err')
        } finally {
          setBusy(false)
        }
      }, [flash, load])

      /** 导出 CSV：走后端直出文件，避免前端拼大字符串。 */
      const exportCsv = useCallback(async (exportRange) => {
        setBusy(true)
        try {
          const res = await fetch(`${ENDPOINT}/history/export?range=${encodeURIComponent(exportRange)}`)
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          const stamp = new Date().toISOString().slice(0, 10)
          a.href = url
          a.download = `folia-ai-usage-${exportRange}-${stamp}.csv`
          document.body.appendChild(a)
          a.click()
          a.remove()
          setTimeout(() => URL.revokeObjectURL(url), 4000)
          flash('CSV 已开始下载', 'ok')
        } catch (e) {
          flash((e && e.message) || '导出失败', 'err')
        } finally {
          setBusy(false)
        }
      }, [flash])

      /** 清空历史：必须经过确认对话框。 */
      const clearHistory = useCallback(async () => {
        setBusy(true)
        try {
          const res = await fetch(ENDPOINT + '/history/clear', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
          const payload = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(payload.error || 'HTTP ' + res.status)
          await load()
          await loadHistory(range)
          flash(`已删除 ${payload.removed || 0} 条历史记录`, 'ok')
        } catch (e) {
          flash((e && e.message) || '清空失败', 'err')
        } finally {
          setBusy(false)
          setPendingClear(null)
        }
      }, [flash, load, loadHistory, range])

      /** 用量卡上的导航动作（导出 / 清空历史）。 */
      const onNavigate = useCallback((action, actionRange) => {
        if (action === 'history-export') void exportCsv(actionRange || range)
        else if (action === 'history-clear') setPendingClear(true)
      }, [exportCsv, range])

      /**
       * 真实连通性检测：调 Host 的 /folia-ai/selfcheck，
       * 它内部会真的跑一次模型请求 + 真的读一次同步库。
       */
      const [checking, setChecking] = useState(false)
      const [checkResult, setCheckResult] = useState(null)

      const runCheck = useCallback(async () => {
        setChecking(true)
        try {
          const res = await fetch(ENDPOINT + '/selfcheck', { headers: { accept: 'application/json' } })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const r = await res.json()
          setCheckResult(r)
          const aiOk = r.ai && r.ai.ok
          const syncOk = r.sync && r.sync.ok
          flash(aiOk && syncOk ? '两项都正常' : (aiOk || syncOk ? '部分正常' : '两项都失败'),
            aiOk && syncOk ? 'ok' : 'err')
        } catch (e) {
          setCheckResult({ error: (e && e.message) || String(e) })
          flash('检测失败', 'err')
        } finally {
          setChecking(false)
        }
      }, [flash])

      const flashCopied = useCallback((label) => {
        flash('已复制' + (label ? '：' + label : ''), 'ok')
      }, [flash])

      const aiCheck = useMemo(() => {
        if (!checkResult) return { state: 'unknown' }
        if (checkResult.error) return { state: 'fail', text: '检测失败', detail: checkResult.error }
        const ai = checkResult.ai || {}
        return ai.ok
          ? { state: 'ok', text: `连接正常 · ${ai.ms}ms`, detail: `${ai.provider} / ${ai.model}　回复: ${ai.reply || '（空）'}` }
          : { state: 'fail', text: '连接失败', detail: ai.error || '未知错误' }
      }, [checkResult])

      const syncCheck = useMemo(() => {
        if (!checkResult) return { state: 'unknown' }
        if (checkResult.error) return { state: 'fail', text: '检测失败', detail: checkResult.error }
        const s = checkResult.sync || {}
        return s.ok
          ? {
            state: 'ok',
            text: `连接正常 · ${s.ms}ms`,
            detail: `已存 ${s.themeCount} 个主题${s.settingsUpdatedAt ? ' + 视觉设置' : ''}　${(s.bytes / 1024).toFixed(1)} KB`,
          }
          : { state: 'fail', text: '连接失败', detail: s.error || '未知错误' }
      }, [checkResult])

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
        h(ConnectCard, {
          kind: 'ai',
          status,
          draft,
          busy,
          checking,
          check: runCheck,
          result: aiCheck,
          onCopied: flashCopied,
        }),
        h(ModelCard, { status, providers, draft, setDraft, busy, save, toast: null }),
        h(UsageCard, {
          stats: data && data.stats,
          history,
          range,
          setRange,
          chartView,
          setChartView,
          busy,
          resetStats,
          onNavigate,
          flash,
        }),
        h(HistorySettingsCard, { draft, setDraft, busy, save, status, history }))

      const syncPanel = h('div', { className: 'fai-panel', role: 'tabpanel' },
        h(ConnectCard, {
          kind: 'sync',
          status,
          draft,
          busy,
          checking,
          check: runCheck,
          result: syncCheck,
          onCopied: flashCopied,
        }),
        h(SyncCard, { status, sync: syncInfo, draft, setDraft, busy, save }),
        h(StorageCard, { sync: syncInfo }))

      return h('div', { className: 'fai-root' },
        h(Hero, { status, stats: data && data.stats }),
        h('div', { className: 'fai-tabs', role: 'tablist' },
          tab('ai', 'AI 主题', callCount > 0 ? String(callCount) : null),
          tab('sync', '同步服务', themeCount > 0 ? String(themeCount) : null)),
        activeTab === 'ai' ? aiPanel : syncPanel,
        h(ConfirmClearDialog, {
          open: Boolean(pendingClear),
          busy,
          onCancel: () => setPendingClear(null),
          onConfirm: clearHistory,
        }),
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
