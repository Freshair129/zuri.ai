import {describe,it,expect} from 'vitest'
import {officeClientOrigins} from '@/modules/business/office-design/client-origins'
describe('Office handoff origin configuration',()=>{
 it('admits exact HTTPS or loopback origins and rejects unsafe entries',()=>{
  expect(officeClientOrigins('https://office.example,http://localhost:4173')).toEqual(['https://office.example','http://localhost:4173'])
  expect(officeClientOrigins('http://office.example,https://office.example/path,*,https://user:pass@office.example')).toEqual([])
 })
})
