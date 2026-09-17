/**
 * The shape of the help guide's database. Every entry is a node: a question with its answer paragraphs, or a menu
 * whose options lead to other nodes. Nothing here is generated; every answer is written out.
 */

export interface HelpOption {
  label: string;
  to: string;
}

export interface HelpNode {
  id: string;
  title: string;
  answer?: string[];
  options?: HelpOption[];
  link?: { label: string; href: string };
  /** Extra words people might search with. */
  keywords?: string[];
  /** The topic the node belongs to, filled in when the guide is assembled. */
  topic?: string;
}

export interface HelpTopic {
  id: string;
  title: string;
  summary: string;
  nodes: HelpNode[];
}

interface Extra {
  keywords?: string[];
  /** Ids of related answers; their titles become the option labels. */
  see?: string[];
  link?: { label: string; href: string };
}

/** One question and its answer. */
export function qa(id: string, title: string, answer: string[], extra: Extra = {}): HelpNode {
  return {
    id,
    title,
    answer,
    keywords: extra.keywords,
    link: extra.link,
    options: extra.see?.map((to) => ({ label: to, to })),
  };
}
