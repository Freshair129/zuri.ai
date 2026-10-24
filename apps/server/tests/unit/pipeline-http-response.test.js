// @req FR-084 — typed pipeline refusals retain their HTTP status through the API seam.
import {it,expect} from 'vitest'
import {NextResponse} from 'next/server'
import {handle} from '@/app/api/_helpers'
it('preserves an explicitly constructed typed JSON response',async()=>{const result=await handle(()=>NextResponse.json({committed:false,errors:[{code:'STALE_PREVIEW',path:'',message:'STALE_PREVIEW'}],conflicts:[]},{status:409}));expect(result.status).toBe(409);expect((await result.json()).errors[0].code).toBe('STALE_PREVIEW')})
