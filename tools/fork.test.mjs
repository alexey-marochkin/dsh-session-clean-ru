import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerDeleteTool } from '../agent-tool.js'
import { inspectAttachments } from '../attachments.js'

// Имитирует штатное подтверждение и фиксирует вызовы общей операции удаления.
function fixture({ decision = 'allowed-once', duplicate = false, current = 'Цель' } = {}) {
  let tool
  const claimed = []
  const ids = duplicate ? ['a', 'b'] : ['a']
  const services = {
    tools: { register(value) { tool = value } },
    approval: { async request() { claimed.push('approval'); return decision } },
    sessionQuery: {
      listSessions: async () => ids.map(id => ({ header: { id } })),
      readTitleSnapshots: async () => ids.map(id => ({ status: 'fulfilled', value: { session: { id }, title: { title: 'Цель' } } })),
      readTitle: async () => ({ title: current }),
    },
  }
  registerDeleteTool({ get: name => services[name] }, async (id, revalidate) => {
    await revalidate()
    claimed.push(id)
    return { ok: true }
  })
  const exec = { agent: { session: { id: 'source' } }, signal: new AbortController().signal }
  return { run: () => tool.execute({ title: 'Цель' }, exec), claimed }
}

test('инструмент передаёт точный ID после одобрения', async () => {
  const { run, claimed } = fixture()
  assert.equal((await run()).ok, true)
  assert.deepEqual(claimed, ['approval', 'a'])
})

test('отказ, дубли и переименование не удаляют данные', async () => {
  const refused = fixture({ decision: 'rejected' })
  assert.equal((await refused.run()).ok, false)
  assert.deepEqual(refused.claimed, ['approval'])
  const duplicate = fixture({ duplicate: true })
  assert.equal((await duplicate.run()).ok, false)
  assert.deepEqual(duplicate.claimed, [])
  const renamed = fixture({ current: 'Новое имя' })
  await assert.rejects(renamed.run(), /Название чата изменилось/)
  assert.deepEqual(renamed.claimed, ['approval'])
})

test('ссылки из других чатов не расширяют список кандидатов', async () => {
  const ref = char => ({ attachmentId: `sha256:${char.repeat(64)}` })
  const result = await inspectAttachments({
    listSessions: async () => ['target', 'other'].map(id => ({ header: { id } })),
    readSession: async id => ({ events: id === 'target'
      ? [{ type: 'image', attachment: ref('a') }, { type: 'file', attachment: ref('b') }, ref('d')]
      : [ref('b'), ref('c')] }),
  }, 'target')
  assert.deepEqual([result.candidates, result.shared, result.removed, result.status], [2, 1, 0, 'skipped'])
})

test('отличает подтверждённые общие вложения от неполной проверки', async () => {
  const events = [{ type: 'image', attachment: { attachmentId: `sha256:${'a'.repeat(64)}` } }]
  const result = await inspectAttachments({
    listSessions: async () => [{ header: { id: 'other' } }],
    readSession: async () => ({ events }),
  }, 'target')
  assert.deepEqual([result.candidates, result.shared, result.removed, result.status], [1, 1, 0, 'shared'])
})

test('ошибка чтения оставляет все вложения на диске', async () => {
  const result = await inspectAttachments({
    listSessions: async () => [{ header: { id: 'broken' } }],
    readSession: async id => {
      if (id === 'broken') throw new Error('Unreadable')
      return { events: [{ type: 'image', attachment: { attachmentId: `sha256:${'a'.repeat(64)}` } }] }
    },
  }, 'target')
  assert.deepEqual([result.candidates, result.removed, result.status], [1, 0, 'skipped'])
})
