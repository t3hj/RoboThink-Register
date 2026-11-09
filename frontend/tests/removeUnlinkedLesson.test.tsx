import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import RemoveUnlinkedLesson from '../src/components/RemoveUnlinkedLesson'
const mock=vi.hoisted(()=>({rpc:vi.fn(),notify:vi.fn()}))
vi.mock('../src/lib/supabaseClient',()=>({supabase:{rpc:mock.rpc}}))
vi.mock('../src/components/Toast',()=>({useToast:()=>({notify:mock.notify})}))
vi.mock('../src/components/ui',()=>({ConfirmDialog:({open,busy,onConfirm,onCancel,title,message}:any)=>open?<div role="dialog"><h2>{title}</h2><p>{message}</p><button disabled={busy} onClick={onConfirm}>Confirm</button><button disabled={busy} onClick={onCancel}>Cancel</button></div>:null}))
let renderer:ReactTestRenderer
beforeEach(()=>{mock.rpc.mockReset().mockResolvedValue({error:null});mock.notify.mockReset()})
afterEach(async()=>{if(renderer)await act(async()=>renderer.unmount())})
async function mount(linked=false,onRemoved=vi.fn()){
 await act(async()=>{renderer=create(<RemoveUnlinkedLesson recordId="record" lessonNumber={20} linked={linked} onRemoved={onRemoved}/>)});return onRemoved
}
it('offers no removal for a lesson that still has a recorded session',async()=>{
 await mount(true);expect(renderer.toJSON()).toBeNull();expect(mock.rpc).not.toHaveBeenCalled()
})
it('requires confirmation and preserves cancellation',async()=>{
 await mount();await act(async()=>renderer.root.findByType('button').props.onClick())
 expect(mock.rpc).not.toHaveBeenCalled()
 expect(renderer.root.findByType('p').children.join('')).toContain('Attendance and recorded sessions are kept')
 await act(async()=>renderer.root.findAllByType('button').find(b=>b.children.includes('Cancel'))!.props.onClick())
 expect(renderer.root.findAllByProps({role:'dialog'})).toHaveLength(0)
 expect(mock.rpc).not.toHaveBeenCalled()
})
it('removes the selected unlinked record and refreshes the profile',async()=>{
 const refreshed=await mount();await act(async()=>renderer.root.findByType('button').props.onClick())
 await act(async()=>renderer.root.findAllByType('button').find(b=>b.children.includes('Confirm'))!.props.onClick())
 expect(mock.rpc).toHaveBeenCalledWith('delete_unlinked_lesson_history',expect.objectContaining({in_lesson_record_id:'record',in_reason:expect.any(String)}))
 expect(refreshed).toHaveBeenCalledTimes(1)
 expect(renderer.root.findAllByProps({role:'dialog'})).toHaveLength(0)
})
it('keeps a failed removal visible and reports the server guard',async()=>{
 mock.rpc.mockResolvedValue({error:{message:'This lesson has a recorded session'}})
 const refreshed=await mount();await act(async()=>renderer.root.findByType('button').props.onClick())
 await act(async()=>renderer.root.findAllByType('button').find(b=>b.children.includes('Confirm'))!.props.onClick())
 expect(refreshed).not.toHaveBeenCalled()
 expect(mock.notify).toHaveBeenCalledWith('This lesson has a recorded session','error')
 expect(renderer.root.findAllByProps({role:'dialog'})).toHaveLength(1)
})
