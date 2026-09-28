const NAMESPACES = new Set(['ZAI', 'ZNEXT', 'edge'])
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

export class DocumentIdentityError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'DocumentIdentityError'
    this.code = code
    this.details = details
  }
}

export function isDocumentIdentity(identity) {
  return Boolean(identity && NAMESPACES.has(identity.namespace)
    && typeof identity.id === 'string' && ID_PATTERN.test(identity.id))
}

function assertIdentityParts(identity) {
  if (!isDocumentIdentity(identity)) throw new DocumentIdentityError('INVALID_IDENTITY_REFERENCE',
    'Identity must have a supported namespace and a non-empty, unqualified ID.', { identity })
}

/** Parse syntax only; a bare ID has no namespace until exact resolution. */
export function parseQualifiedIdentity(reference) {
  if (typeof reference !== 'string') throw new DocumentIdentityError('INVALID_IDENTITY_REFERENCE', 'Identity reference must be a string.', { reference })
  const value = reference.trim()
  let identity
  if (value.startsWith('edge::')) identity = { namespace: 'edge', id: value.slice('edge::'.length) }
  else {
    const match = /^(ZAI|ZNEXT):(.+)$/.exec(value)
    if (match) identity = { namespace: match[1], id: match[2] }
  }
  if (!identity) {
    if (!ID_PATTERN.test(value) || value.includes(':')) throw new DocumentIdentityError('INVALID_IDENTITY_REFERENCE', `Invalid qualified identity: ${reference}`, { reference })
    return null
  }
  assertIdentityParts(identity)
  return identity
}

export function formatQualifiedIdentity(identity) {
  assertIdentityParts(identity)
  return identity.namespace === 'edge' ? `edge::${identity.id}` : `${identity.namespace}:${identity.id}`
}
