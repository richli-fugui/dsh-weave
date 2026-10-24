
import fs from 'node:fs'
import { RemoteProvider, WORKBENCH_REMOTE_CONTRACT_VERSION } from '../lib/providers/remote.js'
let generationCallback, releaseRead
const adapter = {
 connectionId:'audit-connection',
 isReady:()=>true,
 onGenerationChange:cb=>{generationCallback=cb;return ()=>{}},
 invoke:async(endpoint)=>{
  if(endpoint==='workbench.identity.get')return {hostId:'old-host',profileId:'desktop',workbenchContractVersion:WORKBENCH_REMOTE_CONTRACT_VERSION}
  return new Promise(resolve=>{releaseRead=resolve})
 },
 follow:()=>()=>{},
}
const provider=new RemoteProvider(adapter)
await provider.negotiate()
const pending=provider.listProjects()
while(!releaseRead)await Promise.resolve()
generationCallback(2)
releaseRead([{id:'old-generation-project'}])
let staleResponseAccepted=false
try {
 const lateResult=await pending
 staleResponseAccepted=lateResult?.[0]?.id==='old-generation-project'
} catch {
 // Rejecting an old-generation read is the expected safe outcome.
}
let sideEffects=0
const failedIdentity=new RemoteProvider({
 connectionId:'audit-identity-failure',isReady:()=>true,
 invoke:async(endpoint)=>{
  if(endpoint==='workbench.identity.get')throw Error('backend temporarily failed')
  sideEffects++
  return {id:'unexpected-command'}
 },
 follow:()=>()=>{},
})
try { await failedIdentity.createWorkIntent('isolated audit') } catch {
 // An unknown identity backend failure must block business writes.
}
const evidence={
 evidenceLayer:'UNIT/MOCK', product:'dsh-table',
 cases:[
 {id:'T-011a',status:staleResponseAccepted?'FAIL':'PASS',observation:'An old-generation read must be rejected after generation changes; accepted='+staleResponseAccepted},
 {id:'T-011b',status:sideEffects===0?'PASS':'FAIL',observation:'A generic identity backend error allowed a write command through compatibility fallback.',observedInvokeCount:sideEffects},
 ],
 notVerified:['real transport','DSH runtime','Mac'],
}
fs.mkdirSync('evidence', { recursive: true })
fs.writeFileSync('evidence/remote-boundary-audit-20261023.json',JSON.stringify(evidence,null,2)+'\n')
console.log(JSON.stringify(evidence))

if(evidence.cases.some(test=>test.status==='FAIL'))process.exitCode=1
