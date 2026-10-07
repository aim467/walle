/**
 * 知识库文档构建（P5.2 提炼二期）：walle 自管的 Markdown 文档（知识卡片 / 总结文档），
 * 落盘 <walle home>/knowledge/，frontmatter 携带类型与来源溯源信息。
 * 纯函数，serve 的 /api/knowledge 调用，测试直接覆盖。
 */

export interface KnowledgeSource {
  tool?: string;
  assetId?: number;
  subId?: string;
  sessionTitle?: string;
}

export type KnowledgeDocType = 'card' | 'summary';

export interface KnowledgeDocInput {
  title: string;
  tags?: string[];
  text: string;
  type?: KnowledgeDocType;
  /** 总结文档所属项目路径（可选） */
  project?: string | null;
  source?: KnowledgeSource;
}

export interface KnowledgeDoc {
  file: string;
  content: string;
}

export function buildKnowledgeDoc(input: KnowledgeDocInput): KnowledgeDoc {
  const t = String(input.title ?? '').trim();
  const content = String(input.text ?? '').trim();
  const type: KnowledgeDocType = input.type === 'summary' ? 'summary' : 'card';
  const date = new Date().toISOString();
  const slug = t.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'note';
  const file = `${date.slice(0, 10)}-${Date.now() % 100000}-${slug}.md`;
  const fm = [
    '---',
    `title: ${t}`,
    `type: ${type}`,
    input.project ? `project: ${input.project}` : null,
    input.tags?.length ? `tags: [${input.tags.map((x) => String(x).replace(/[\]\[\s,]/g, '')).filter(Boolean).join(', ')}]` : null,
    input.source?.tool ? `source_tool: ${input.source.tool}` : null,
    input.source?.assetId ? `source_asset: ${input.source.assetId}` : null,
    input.source?.subId ? `source_sub: ${input.source.subId}` : null,
    input.source?.sessionTitle ? `source_title: ${String(input.source.sessionTitle).replace(/\n/g, ' ').slice(0, 120)}` : null,
    `created: ${date}`,
    '---',
    '',
  ].filter((l) => l !== null).join('\n');
  return { file, content: fm + content + '\n' };
}
