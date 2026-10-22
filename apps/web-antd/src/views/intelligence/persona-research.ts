export interface PersonaGroup { id?: string; label: string; minAge: number; maxAge: number; lifeStage: string; familyRole: string; localContext: string }
export interface PersonaPlan { title: string; market: string; startDate: string; endDate: string; researchQuestion: string; groups: PersonaGroup[]; sources: string[]; budget: { requests: number; credits: number; commentVideos: number; perQuery: number } }
export interface PersonaEvidence { id: string; text: string; sourceUrl: string; platform: string; kind: string; timeScope: string; postedAt: null | string; collectedAt: null | string; evidenceClass: string; memberships: { groupId: string; role: string; topic: string; query: string }[]; assertions: Record<string, { value: string; quote: string }>; review: { status: string; note?: string } }
export interface PersonaFinding { section: string; label: string; interpretation: string; suggestion: string; verdict: string; evidenceIds: string[]; confidence: string; groupId: string }
export interface PersonaStudy { id: string; status: string; revision: number; plan: PersonaPlan; evidence: PersonaEvidence[]; findings: PersonaFinding[] }
export const personaSections = { needs: '需求洞察', consumption: '消费品类与渠道', habits: '生活习惯', trust: '信息与信任', decision: '购买决策', family: '本人及家庭关联', hypotheses: '商业假设', comparison: '人群对比' };
export const evidenceClasses = { unknown: '未知', explicit_self_report: '明确自述', purchase_usage_report: '购买/使用自述', brand_positioning: '品牌定位', research_inference: '研究推断' };
export function defaultPersonaPlan(): PersonaPlan {
  return { title: '越南28-45岁两组宝妈定位研究', market: 'VN', startDate: '2026-07-22', endDate: '2026-10-22', researchQuestion: '比较自身痛点、家庭需求、消费选择、生活习惯与购买决策；验证主产品+高频赠品、本人+家人需求组合。', groups: [
    { label: 'A 新晋与核心宝妈', minAge: 28, maxAge: 35, lifeStage: '新晋/核心育儿阶段，须独立确认', familyRole: '母亲/家庭购买参与者，须独立确认', localContext: 'mẹ chăm con nhỏ' },
    { label: 'B 中坚轻熟与大童宝妈', minAge: 36, maxAge: 45, lifeStage: '轻熟/大童照护阶段，须独立确认', familyRole: '母亲/家庭购买参与者，须独立确认', localContext: 'mẹ có con đi học' },
  ], sources: ['content', 'comments'], budget: { requests: 0, credits: 0, commentVideos: 2, perQuery: 10 } };
}
export function downloadPersona(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
