import { ref } from 'vue';

interface SuggestionResponse {
  configured?: boolean;
  keywords?: string[];
  message?: string;
}

type Suggest = (input: { description: string; taskName: string }) => Promise<SuggestionResponse>;

export function useConceptSeedSuggestions(suggest: Suggest) {
  const busy = ref(false);
  const notice = ref('');
  const noticeType = ref<'error' | 'success' | 'warning'>('warning');
  const needsConfiguration = ref(false);
  let revision = 0;

  function reset() {
    revision += 1;
    busy.value = false;
    notice.value = '';
    needsConfiguration.value = false;
  }

  async function generate(taskName: string, description: string) {
    if (busy.value) return null;
    const current = ++revision;
    busy.value = true;
    notice.value = '';
    needsConfiguration.value = false;
    try {
      const result = await suggest({ taskName: taskName.trim(), description: description.trim() });
      if (current !== revision) return null;
      if (result.configured === false) {
        needsConfiguration.value = true;
        noticeType.value = 'warning';
        notice.value = '尚未配置概念种子词模型，暂时无法生成 AI 建议。请在 AI 配置中填写接口地址、模型名称和 Key，保存后返回点击「生成 AI 建议」；也可手动填写种子关键词。';
        return null;
      }
      const keywords = [...new Set((result.keywords || [])
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim()).filter(Boolean))];
      if (keywords.length === 0) throw new Error(result.message || 'AI 未返回有效种子关键词，请重新生成或手动填写。');
      noticeType.value = 'success';
      notice.value = `AI 已生成 ${keywords.length} 个种子关键词，可编辑后继续。`;
      return keywords;
    } catch (error) {
      if (current !== revision) return null;
      noticeType.value = 'error';
      notice.value = error instanceof Error ? error.message : 'AI 建议生成失败，请重新生成或手动填写。';
      return null;
    } finally {
      if (current === revision) busy.value = false;
    }
  }

  return { busy, generate, needsConfiguration, notice, noticeType, reset };
}
