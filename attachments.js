// Собирает идентификаторы вложений, встречающиеся в структурированных событиях журнала.
export function attachmentIds(events, { candidatesOnly = false } = {}) {
  const ids = new Set()
  const stack = [...events]
  while (stack.length) {
    const value = stack.pop()
    if (value === null || typeof value !== 'object') continue
    const ref = candidatesOnly
      ? (value.type === 'image' || value.type === 'file' ? value.attachment : undefined)
      : value
    if (typeof ref?.attachmentId === 'string' && /^sha256:[0-9a-f]{64}$/.test(ref.attachmentId)) {
      ids.add(ref.attachmentId)
    }
    for (const field of Object.values(value)) if (field !== null && typeof field === 'object') stack.push(field)
  }
  return ids
}

// Проверяет только вложения удаляемого чата; чужие журналы используются лишь для исключения общих объектов.
export async function inspectAttachments(query, sessionId) {
  let candidates = 0
  try {
    const remaining = attachmentIds((await query.readSession(sessionId)).events, { candidatesOnly: true })
    candidates = remaining.size
    if (!candidates) return { candidates, removed: 0, status: 'none' }
    const sessions = await query.listSessions()
    for (const { header } of sessions) {
      if (header.id === sessionId) continue
      const references = attachmentIds((await query.readSession(header.id)).events)
      for (const id of references) remaining.delete(id)
      if (!remaining.size) break
    }
    // DSH не показывает загруженные, но ещё не отправленные вложения и может пропустить нечитаемый журнал.
    if (!remaining.size) {
      return { candidates, shared: candidates, removed: 0, status: 'shared',
        message: 'Все вложения используются в других чатах и сохранены.' }
    }
    return { candidates, shared: candidates - remaining.size, removed: 0, status: 'skipped',
      message: 'Вложения сохранены: нельзя исключить ссылки из незавершённых загрузок или недоступных журналов.' }
  } catch {
    return { candidates, removed: 0, status: 'skipped', message: 'Вложения сохранены: не удалось полностью проверить журналы.' }
  }
}
