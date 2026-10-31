// @req FR-295 — user-mediated Office handoff with session-scoped readback.
// @tested tests/integration/office-ui-transfer.test.js
import OfficeHandoff from './transfer'
import {officeClientOrigins} from '@/modules/business/office-design/client-origins'

export const dynamic = 'force-dynamic'
export default function Page() {
 const allowed=officeClientOrigins(process.env.OFFICE_HANDOFF_ALLOWED_ORIGINS)
 return <OfficeHandoff allowedOrigins={allowed}/>
}
