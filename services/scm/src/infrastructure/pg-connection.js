import { MessageChannel, Worker, receiveMessageOnPort } from 'node:worker_threads'

// A synchronous PostgreSQL connection. The SCM unit-of-work port is synchronous
// (`sql.get/all/run`, the node:sqlite shape) so every module stays engine-neutral;
// this keeps that shape on PostgreSQL. One worker thread owns one `pg` client; a
// call posts the statement, blocks this thread on a shared flag (Atomics.wait —
// exactly how node:sqlite blocks during a statement), then takes the reply from
// its port. One statement at a time, which is also what one connection allows.
// A statement that does not answer within `statementTimeoutMs` (+ a margin) is a
// dead connection: the call fails and the connection is unusable from then on.

export class PgConnectionError extends Error {
  constructor(message, { code = null, constraint = null, detail = null } = {}) {
    super(message)
    Object.assign(this, { pgCode: code, constraint, detail })
  }

  /** The connection itself is gone (not a statement error): no SQLSTATE, class 08, or an admin/crash shutdown. */
  get connectionLost() {
    return !this.pgCode || this.pgCode === 'SCM_PG_NO_REPLY' || this.pgCode.startsWith('08') || ['57P01', '57P02', '57P03'].includes(this.pgCode)
  }
}

export function openPgConnection(url, { connectTimeoutMs = 10000, callTimeoutMs = 60000 } = {}) {
  const flag = new Int32Array(new SharedArrayBuffer(4))
  const requestChannel = new MessageChannel()
  const replyChannel = new MessageChannel()
  const worker = new Worker(new URL('./pg-worker.js', import.meta.url), {
    workerData: { url, flag, requests: requestChannel.port2, replies: replyChannel.port2, connectTimeoutMs },
    transferList: [requestChannel.port2, replyChannel.port2],
  })
  worker.unref()
  requestChannel.port1.unref()
  replyChannel.port1.unref()
  let broken = null

  function awaitReply(timeoutMs) {
    const outcome = Atomics.wait(flag, 0, 0, timeoutMs)
    const message = receiveMessageOnPort(replyChannel.port1)
    Atomics.store(flag, 0, 0)
    if (!message) {
      broken = new PgConnectionError(outcome === 'timed-out' ? 'SCM PostgreSQL connection did not answer' : 'SCM PostgreSQL connection lost', { code: 'SCM_PG_NO_REPLY' })
      throw broken
    }
    return message.message
  }

  const ready = awaitReply(connectTimeoutMs + 2000)
  if (ready.error) {
    worker.terminate()
    throw new PgConnectionError(ready.error.message, ready.error)
  }

  return {
    /** Run one statement (params → extended protocol; none → simple protocol, may hold several). */
    query(text, params) {
      if (broken) throw broken
      requestChannel.port1.postMessage({ text, params: params ?? null })
      const reply = awaitReply(callTimeoutMs)
      if (reply.error) throw new PgConnectionError(reply.error.message, reply.error)
      return reply
    },
    close() {
      requestChannel.port1.close()
      return worker.terminate()
    },
  }
}
