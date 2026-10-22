<script setup lang="ts">
import type { PersonaEvidence, PersonaFinding, PersonaStudy } from '../persona-research';
import { computed, onUnmounted, ref, watch } from 'vue';
import { Alert, Button, Empty, Input, Modal, Select, Table, Tag } from 'ant-design-vue';
import { cloudRequest } from '../cloud-workspace';
import { downloadPersona, evidenceClasses, personaSections } from '../persona-research';
import { session } from '../session';
import { reportStatus } from '../consumer-reports';
const props = defineProps<{ id: string }>();
const study = ref<PersonaStudy>();
const report = ref<{ personaResearch: { sampling: Record<string, number>; coverage: Record<string, unknown>[]; consumption: { basis: string; products: number; priced: number; currency: string; priceBands: { low: number; high: null | number; count: number; denominator: number }[]; categories: { value: string; count: number; denominator: number }[]; channels: { value: string; count: number; denominator: number }[] }; limitations: string[]; missingSections: string[]; journal: Record<string, unknown>[] } }>();
const error = ref(''), busy = ref(false), group = ref('ALL'), role = ref('ALL'), source = ref('ALL'), status = ref('ALL');
const selected = ref<PersonaEvidence>();
const editClass = ref('unknown'), editStatus = ref('accepted'), note = ref('');
const assertions = ref<Record<string, { value: string; quote: string }>>({});
const finding = ref<PersonaFinding>();
const editingFindingIndex = ref(-1);
const verdicts: Record<string, string> = { supported: '证据支持', partial: '部分支持', unverified: '待验证', contradicted: '有反证' };
const reviewNames: Record<string, string> = { accepted: '接受', rejected: '排除', pending: '待审' };
const scopeNames: Record<string, string> = { in_period: '周期内', historical_context: '历史背景', unknown: '日期未知' };
let timer: ReturnType<typeof setTimeout> | undefined;
let active = true;
async function load() {
  if (timer) clearTimeout(timer);
  busy.value = true;
  const requestedId = props.id;
  try {
    const r = await cloudRequest<{ study: PersonaStudy; report: NonNullable<typeof report.value> }>('server_persona_detail', { id: props.id });
    if (!active || requestedId !== props.id) return;
    study.value = r.study; report.value = r.report; error.value = '';
    if (['queued','running'].includes(r.study.status)) timer = setTimeout(() => void load(), 5000);
  } catch (e) { error.value = e instanceof Error ? e.message : '读取失败'; }
  finally { busy.value = false; }
}
watch(() => props.id, () => void load(), { immediate: true });
onUnmounted(() => { active = false; if (timer) clearTimeout(timer); });
const admin = computed(() => session.user?.role === 'admin');
const canEdit = computed(() => admin.value && study.value && !['queued','running'].includes(study.value.status));
const rows = computed(() => (study.value?.evidence || []).filter((r) => (group.value === 'ALL' || r.memberships.some((m) => m.groupId === group.value)) && (role.value === 'ALL' || r.memberships.some((m) => m.role === role.value)) && (source.value === 'ALL' || r.platform === source.value) && (status.value === 'ALL' || r.review.status === status.value)));
const options = (obj: Record<string, string>) => Object.entries(obj).map(([value,label]) => ({label,value}));
function edit(value: Record<string, unknown>) { const r = value as unknown as PersonaEvidence; selected.value = r; editClass.value = r.evidenceClass; editStatus.value = r.review.status === 'pending' ? 'accepted' : r.review.status; note.value = r.review.note || ''; assertions.value = JSON.parse(JSON.stringify(r.assertions)); }
async function mutate(action: string, input: Record<string, unknown>) {
  if (!study.value) return;
  busy.value = true; error.value = '';
  try { await cloudRequest(action, { id: props.id, revision: study.value.revision, ...input }); selected.value = undefined; finding.value = undefined; await load(); }
  catch (e) { error.value = e instanceof Error ? e.message : '保存失败'; }
  finally { busy.value = false; }
}
function saveReview() { return mutate('server_persona_review', { evidenceId: selected.value?.id, patch: { status: editStatus.value, evidenceClass: editClass.value, note: note.value, assertions: assertions.value } }); }
function addFinding() { editingFindingIndex.value = -1; finding.value = { section: 'needs', label: '', interpretation: '', suggestion: '', verdict: 'unverified', evidenceIds: [], confidence: '低', groupId: 'all' }; }
function editFinding(value: PersonaFinding) { editingFindingIndex.value = study.value?.findings.indexOf(value) ?? -1; finding.value = JSON.parse(JSON.stringify(value)); }
function saveFinding() {
  if (!finding.value) return;
  const findings = [...(study.value?.findings || [])];
  if (editingFindingIndex.value < 0) findings.push(finding.value); else findings[editingFindingIndex.value] = finding.value;
  void mutate('server_persona_finalize', { findings, complete: false });
}
function printReport() {
  const s = study.value, r = report.value?.personaResearch;
  if (!s || !r) return;
  const preview = window.open('', '_blank', 'width=1000,height=800');
  if (!preview) { error.value = '请允许浏览器打开打印窗口'; return; }
  preview.opener = null;
  const doc = preview.document;
  doc.title = s.plan.title;
  doc.documentElement.lang = 'zh-CN';
  const style = doc.createElement('style');
  style.textContent = '@page{size:A4;margin:18mm}body{font:12px/1.7 "Microsoft YaHei","Segoe UI",sans-serif;color:#242a2b;margin:0}h1{font-size:24px}h2{font-size:18px;margin-top:28px;break-after:avoid}h3{font-size:14px;break-after:avoid}p,blockquote{white-space:pre-wrap;overflow-wrap:anywhere}article{break-inside:avoid;border-bottom:1px solid #ddd;padding-bottom:12px}blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #267565}a{color:#17685d}';
  doc.head.append(style);
  const append = (tag: string, text: string, parent: HTMLElement = doc.body) => {
    const element = doc.createElement(tag); element.textContent = text; parent.append(element); return element;
  };
  append('h1', s.plan.title);
  append('p', `${s.plan.market} · ${s.plan.startDate} 至 ${s.plan.endDate}\n${s.plan.researchQuestion}`);
  append('h2', '目标画像与样本');
  for (const g of s.plan.groups) append('p', `${g.label} · ${g.minAge}-${g.maxAge}岁\n${g.lifeStage} · ${g.familyRole}`);
  append('p', `去重证据 ${r.sampling.retrieved} · 已接受 ${r.sampling.accepted} · 待审 ${r.sampling.pending}\n年龄与家庭角色同时自述 ${r.sampling.ageAndRoleSelfReports} · 周期内 ${r.sampling.inPeriod} · 历史 ${r.sampling.historical} · 日期未知 ${r.sampling.unknownDate}`);
  for (const line of r.limitations) append('p', line);
  append('h2', '分层采样与来源覆盖');
  for (const c of r.coverage) append('p', `${c.id} · ${c.topic}\n${c.query}\n取回 ${c.retrieved} · 接受 ${c.accepted} · 身份未确认 ${c.unknownIdentity}`);
  append('h2', '商品供给与价格/渠道'); append('p', r.consumption.basis);
  append('p', `审核商品 ${r.consumption.products} · 有效价格 ${r.consumption.priced} · ${r.consumption.currency}`);
  for (const b of r.consumption.priceBands) append('p', `${b.low} - ${b.high ?? '以上'}：${b.count} / ${b.denominator} 条商品`);
  for (const c of [...r.consumption.categories, ...r.consumption.channels]) append('p', `${c.value}：${c.count} / ${c.denominator} 条商品`);
  for (const [key, label] of Object.entries(personaSections)) {
    append('h2', label);
    const findings = s.findings.filter(f => f.section === key);
    if (!findings.length) append('p', '证据与分析缺失，保留未知');
    for (const f of findings) {
      append('h3', `${f.label} · ${verdicts[f.verdict]} · ${f.confidence}`);
      append('p', `${f.interpretation}\n${f.suggestion}\n引用证据：${f.evidenceIds.join('、') || '无，待验证'}`);
    }
  }
  append('h2', '审核接受的证据与原文');
  for (const e of s.evidence.filter(e => e.review.status === 'accepted')) {
    const article = append('article', '');
    append('h3', e.id, article); append('blockquote', e.text, article);
    append('p', `${evidenceClasses[e.evidenceClass as keyof typeof evidenceClasses] || e.evidenceClass} · 发布 ${e.postedAt || '未知'} · 采集 ${e.collectedAt || '未知'}\n${e.review.note || ''}`, article);
    const link = append('a', e.sourceUrl, article) as HTMLAnchorElement; link.href = e.sourceUrl;
  }
  preview.focus(); void doc.fonts.ready.then(() => preview.print());
}
function csv() {
  const head = ['id','group','role','query','class','age','location','familyRole','childAge','decisionRole','purchaseUsage','text','url','postedAt','collectedAt','timeScope','status','note'];
  const cells = rows.value.map((r) => [r.id,r.memberships.map(m=>m.groupId).join('|'),r.memberships.map(m=>m.role).join('|'),r.memberships.map(m=>m.query).join('|'),r.evidenceClass,...['age','location','familyRole','childAge','decisionRole','purchaseUsage'].map(k=>JSON.stringify(r.assertions[k])),r.text,r.sourceUrl,r.postedAt,r.collectedAt,r.timeScope,r.review.status,r.review.note]);
  const quote = (v: unknown) => `"${String(v ?? '').replaceAll('"','""')}"`;
  const url = URL.createObjectURL(new Blob(['\uFEFF' + [head,...cells].map(row=>row.map(quote).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a'); a.href=url; a.download=`persona-${props.id}-evidence.csv`; a.click(); URL.revokeObjectURL(url);
}
</script>
<template>
  <div class="persona-report">
    <Alert v-if="error" type="error" :message="error" show-icon />
    <div class="actions"><Button :loading="busy" @click="load">刷新人群研究</Button><Button :disabled="!study" @click="downloadPersona(`persona-${id}.json`,{study,report})">导出研究及审计记录</Button><Button :disabled="!study" @click="csv">导出当前证据CSV</Button><Button @click="printReport">打印 / PDF</Button></div>
    <template v-if="study && report">
      <Button v-if="admin && ['queued','running'].includes(study.status)" danger :loading="busy" @click="mutate('server_persona_cancel',{})">停止后续补采</Button>
      <section><h2>目标画像与样本</h2><Tag>{{ reportStatus(study.status) }}</Tag>
        <p>{{ study.plan.startDate }} 至 {{ study.plan.endDate }} · {{ study.plan.researchQuestion }}</p>
        <p v-for="g in study.plan.groups" :key="g.id"><b>{{ g.label }} · {{ g.minAge }}-{{ g.maxAge }}岁</b> · {{ g.lifeStage }} · {{ g.familyRole }}</p>
        <p>去重证据 {{ report.personaResearch.sampling.retrieved }} · 已审核接受 {{ report.personaResearch.sampling.accepted }} · 待审 {{ report.personaResearch.sampling.pending }} · 年龄与家庭角色均有自述 {{ report.personaResearch.sampling.ageAndRoleSelfReports }}</p>
        <p>周期内发布 {{ report.personaResearch.sampling.inPeriod }} · 历史背景 {{ report.personaResearch.sampling.historical }} · 发布日期未知 {{ report.personaResearch.sampling.unknownDate }}</p>
        <p v-for="line in report.personaResearch.limitations" :key="line" class="muted">{{ line }}</p>
      </section>
      <section><h2>需求与来源覆盖</h2><Table size="small" row-key="id" :data-source="report.personaResearch.coverage" :pagination="false" :scroll="{x:900}" :columns="[{title:'人群/角色',dataIndex:'id',width:140},{title:'需求',dataIndex:'topic',width:140},{title:'越南语/当地关键词',dataIndex:'query'},{title:'取回',dataIndex:'retrieved',width:70},{title:'接受',dataIndex:'accepted',width:70},{title:'身份未确认',dataIndex:'unknownIdentity',width:110}]" /></section>
      <section><h2>商品供给与价格/渠道</h2><p>{{ report.personaResearch.consumption.basis }}</p><p>审核商品 {{ report.personaResearch.consumption.products }} · 有效价格 {{ report.personaResearch.consumption.priced }} · {{ report.personaResearch.consumption.currency }}</p>
        <p v-for="b in report.personaResearch.consumption.priceBands" :key="b.low">{{ b.low }} 至 {{ b.high ?? '以上' }}：{{ b.count }} / {{ b.denominator }} 条商品</p>
        <p v-for="c in report.personaResearch.consumption.channels" :key="c.value">渠道 {{ c.value }}：{{ c.count }} / {{ c.denominator }} 条商品</p>
        <p v-for="c in report.personaResearch.consumption.categories" :key="c.value">品类 {{ c.value }}：{{ c.count }} / {{ c.denominator }} 条商品</p>
      </section>
      <section v-for="(label,key) in personaSections" :key="key"><h2>{{ label }}</h2>
        <article v-for="(f,i) in study.findings.filter(f=>f.section === key)" :key="i"><h3>{{ f.label }} <Tag>{{ verdicts[f.verdict] || f.verdict }} · {{ f.confidence }}</Tag><Tag>{{ study.plan.groups.find(g=>g.id === f.groupId)?.label || '跨人群/归属未知' }}</Tag></h3><p>{{ f.interpretation }}</p><p>{{ f.suggestion }}</p><p class="muted">引用证据 {{ f.evidenceIds.join('、') || '无；待验证假设' }}</p><div v-if="canEdit" class="actions"><Button size="small" @click="editFinding(f)">编辑分析</Button><Button size="small" danger @click="mutate('server_persona_finalize',{findings:study.findings.filter(item=>item !== f),complete:false})">删除分析</Button></div></article>
        <Empty v-if="!study.findings.some(f=>f.section === key)" description="证据与分析缺失，保留未知" :image="Empty.PRESENTED_IMAGE_SIMPLE" />
      </section>
      <div v-if="canEdit" class="actions"><Button @click="addFinding">增加审核分析</Button><Button type="primary" :loading="busy" @click="mutate('server_persona_finalize',{findings:study.findings,complete:true})">完成报告</Button></div>
      <section><h2>证据审核与原文</h2><div class="filters"><Select v-model:value="group" aria-label="人群筛选" :options="[{label:'全部目标人群',value:'ALL'},...study.plan.groups.map((g,i)=>({label:g.label,value:g.id || `g${i+1}`}))]" /><Select v-model:value="role" aria-label="需求筛选" :options="options({ALL:'全部需求',self:'本人',child:'孩子',partner:'伴侣',elder:'老人',household:'家庭'})" /><Select v-model:value="source" aria-label="来源筛选" :options="[{label:'全部来源',value:'ALL'},...[...new Set(study.evidence.map(r=>r.platform))].map(s=>({label:s,value:s}))]" /><Select v-model:value="status" aria-label="审核筛选" :options="options({ALL:'全部审核状态',pending:'待审',accepted:'接受',rejected:'排除'})" /></div>
        <Table size="small" row-key="id" :data-source="rows" :pagination="{pageSize:10}" :scroll="{x:1000}" :columns="[{title:'原文',key:'text'},{title:'证据类型',dataIndex:'evidenceClass',width:160},{title:'时间',key:'time',width:180},{title:'来源/审核',key:'source',width:170}]">
          <template #bodyCell="{column,record}"><template v-if="column.key === 'text'"><p>{{ record.text }}</p><p class="muted">{{ record.id }}</p></template><template v-else-if="column.dataIndex === 'evidenceClass'">{{ evidenceClasses[record.evidenceClass as keyof typeof evidenceClasses] || record.evidenceClass }}</template><template v-else-if="column.key === 'time'">发布 {{ record.postedAt || '未知' }}<br />采集 {{ record.collectedAt || '未知' }}<br />{{ scopeNames[record.timeScope] || record.timeScope }}</template><template v-else-if="column.key === 'source'"><a :href="record.sourceUrl" target="_blank" rel="noopener noreferrer">{{ record.platform }}</a><p>{{ reviewNames[record.review.status] || record.review.status }}</p><Button v-if="canEdit" @click="edit(record)">审核</Button></template></template>
        </Table>
      </section>
      <details><summary>请求与预算审计</summary><pre>{{ JSON.stringify(report.personaResearch.journal,null,2) }}</pre></details>
    </template>
    <Modal :open="!!selected" title="审核证据" :width="800" :confirm-loading="busy" @ok="saveReview" @cancel="selected = undefined">
      <div v-if="selected" class="editor"><blockquote>{{ selected.text }}</blockquote><label>审核状态<Select v-model:value="editStatus" :options="options({accepted:'接受',rejected:'排除',pending:'待审'})" /></label><label>证据类型<Select v-model:value="editClass" :options="options(evidenceClasses)" /></label>
        <div v-for="(a,key) in assertions" :key="key" class="assertion"><label>{{ key }}<Input v-model:value="a.value" /></label><label>支持该字段的原文引句<Input v-model:value="a.quote" /></label></div>
        <label>审核说明<Input.TextArea v-model:value="note" /></label><Alert v-if="error" :message="error" type="error" />
      </div>
    </Modal>
    <Modal :open="!!finding" title="审核分析" :width="800" :confirm-loading="busy" @ok="saveFinding" @cancel="finding = undefined"><div v-if="finding" class="editor">
      <label>章节<Select v-model:value="finding.section" :options="options(personaSections)" /></label><label>人群<Select v-model:value="finding.groupId" :options="[{label:'跨人群/归属未知',value:'all'},...(study?.plan.groups || []).map(g=>({label:g.label,value:g.id}))]" /></label><label>标题<Input v-model:value="finding.label" /></label><label>结论状态<Select v-model:value="finding.verdict" :options="options({supported:'证据支持',partial:'部分支持',unverified:'待验证',contradicted:'反证'})" /></label><label>证据强度<Select v-model:value="finding.confidence" :options="options({'低':'低','中':'中','高':'高'})" /></label><label>分析<Input.TextArea v-model:value="finding.interpretation" :rows="4" /></label><label>下一步<Input.TextArea v-model:value="finding.suggestion" :rows="2" /></label><label>审核通过的引用<Select v-model:value="finding.evidenceIds" mode="multiple" :options="study?.evidence.filter(r=>r.review.status === 'accepted').map(r=>({value:r.id,label:`${r.text.slice(0,65)} · ${r.id}`}))" /></label><Alert v-if="error" :message="error" type="error" />
    </div></Modal>
  </div>
</template>
<style scoped>
.persona-report { min-width: 0; }
section { padding: 20px 0; border-bottom: 1px solid #e5e7eb; }
h2 { margin-bottom: 14px; font-size: 18px; } h3 { font-size: 15px; }
p, blockquote { overflow-wrap: anywhere; white-space: pre-wrap; }
.muted { color: #61676d; font-size: 12px; }
.actions, .filters { display: flex; flex-wrap: wrap; gap: 10px; margin: 14px 0; }
.filters :deep(.ant-select) { width: 180px; }
.editor, label { display: grid; gap: 8px; } .editor { gap: 14px; }
.assertion { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; }
@media(max-width:600px) { .assertion { grid-template-columns: minmax(0,1fr); } }
@media print { .actions,.filters { display: none; } section { break-inside: avoid; } }
</style>
