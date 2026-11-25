// Находит чат по точному заголовку и передаёт удаление общей операции только после одобрения DSH.
export function registerDeleteTool(ctx, removeSession) {
  const tools = ctx.get('tools')
  const query = ctx.get('sessionQuery')
  const approval = ctx.get('approval')
  if (!tools || !query || !approval) return
  return tools.register({
    name: 'delete_chat_by_title',
    description: 'Безвозвратно удаляет один чат DSH после отдельного подтверждения пользователя. При неоднозначности ничего не удаляет.',
    parameters: { title: { type: 'string', required: true, description: 'Точное название чата в DSH.' } },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } }, additionalProperties: false },
      render: (_args, result) => [{ type: 'text', text: result.message }],
    },
    async execute(args, exec) {
      const title = typeof args?.title === 'string' ? args.title.trim() : ''
      if (!title || title.length > 512 || !exec.agent) throw new Error('Нужны точное название чата и текущая сессия агента')
      const records = await query.listSessions(exec.signal)
      const titles = await query.readTitleSnapshots(records.map(record => record.header.id), exec.signal)
      if (titles.length !== records.length || titles.some(result => result.status !== 'fulfilled')) {
        return { ok: false, message: 'Не удалось проверить все заголовки. Удаление по названию отменено.' }
      }
      const matches = titles.filter(result => result.value.title?.title === title)
      if (matches.length !== 1) return { ok: false, message: matches.length ? 'Найдено несколько чатов с таким названием. Удалите нужный через меню чата.' : 'Чат с таким точным названием не найден.' }
      const session = matches[0].value.session
      if (exec.agent.session.id === session.id) return { ok: false, message: 'Нельзя удалить чат, в котором выполняется этот запрос. Откройте другой чат.' }
      const label = `${JSON.stringify(title)} (${session.id})`
      const decision = await approval.request({
        agent: exec.agent, toolName: exec.name, callId: exec.callId, signal: exec.signal,
        reason: `Permanently delete chat ${label}?`,
        displayReason: { en: `Permanently delete chat ${label}?`, ru: `Удалить чат ${label} без возможности восстановления?` },
      })
      if (decision !== 'allowed-once') return { ok: false, message: 'Подтверждение DSH не получено. Ничего не удалено.' }
      exec.signal.throwIfAborted()
      const result = await removeSession(session.id, async () => {
        const current = await query.readTitle(session.id, exec.signal)
        if (current?.title !== title) throw new Error('Название чата изменилось. Запросите удаление заново.')
        exec.signal.throwIfAborted()
      })
      return { ok: result.ok, message: result.ok ? `Чат ${label} удалён. ${result.attachments?.message ?? ''}`.trim() : 'Удаление не завершено.' }
    },
  })
}
