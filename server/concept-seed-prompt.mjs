export const CONCEPT_SEED_OUTPUT_SPEC = '种子关键词仅输出英文成分名称、常见别名及用户自然使用的简称，保持简短。不要拼接剂型、剂量、口服途径或功效描述，不要扩写成完整搜索句';

export function conceptSeedMessages(taskName, description = '') {
  return [
    {
      role: 'system',
      content: '你是成分研究的种子关键词助手。任务名称是必须遵循的研究主题，方向描述仅用于补充或收窄该主题。即使方向描述为空或只重复输出规范，也必须围绕任务名称生成，不能把输出规范当成研究主题。仅选择与任务主题直接相关的成分；任务名称已明确具体成分时，优先生成该成分的英文名称、常见别名和自然简称，不扩展到其他无关成分。不为凑数量加入无关词，不编造别名。严格遵守固定输出规范。只返回JSON，不要Markdown和解释，格式必须是 {"keywords":["..."]}，最多12个，每个不超过80个字符，避免品牌词和重复词。',
    },
    {
      role: 'user',
      content: [
        `任务名称（研究主题）：${taskName}`,
        ...(description ? [`方向描述（可选）：${description}`] : []),
        `输出规范（固定）：${CONCEPT_SEED_OUTPUT_SPEC}`,
      ].join('\n\n'),
    },
  ];
}
