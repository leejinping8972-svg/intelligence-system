import {computed, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';

import {state} from './data';

export function useConceptBatchFilter(path: string) {
  const route=useRoute(); const router=useRouter();
  const batch=computed(()=>route.path===path && typeof route.query.conceptBatch==='string' ? route.query.conceptBatch : '');
  const day=computed(()=>batch.value && typeof route.query.conceptDay==='string' ? route.query.conceptDay : '');
  const query=computed(()=>batch.value ? {conceptBatch:batch.value,conceptDay:day.value||undefined} : {});
  function onEntry(reset:()=>void) {
    watch(()=>[route.path,batch.value,day.value,route.query.market],()=>{
      if(!batch.value) return;
      const market=route.query.market;
      if(['ALL','MX','US','VN'].includes(String(market))) state.market=market as typeof state.market;
      reset();
    },{immediate:true});
  }
  function clear() {
    const {conceptBatch:_batch,conceptDay:_day,...rest}=route.query;
    void router.replace({path:route.path,query:rest});
  }
  return {batch,day,query,onEntry,clear};
}
