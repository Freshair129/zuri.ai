// @req FR-084 — mandatory contract fields and explicit preview before mutation.
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {it,expect} from 'vitest'
import {NewDependencyModal} from '@/modules/project-manager/views/universal/DependenciesView'
globalThis.React=React
it('renders mandatory deliverable, acceptance and preview; confirmation is unavailable before preview',()=>{const html=renderToStaticMarkup(React.createElement(NewDependencyModal,{open:true,onClose:()=>{}}));expect(html).toContain('aria-label="Source type"');expect(html).toContain('aria-label="Source Project code"');expect(html).toContain('aria-label="Deliverable"');expect(html).toContain('Deliverable');expect(html).toContain('Acceptance');expect(html).toContain('Preview handoff');expect(html).not.toContain('Confirm handoff')})
