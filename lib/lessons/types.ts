export type Word = {
  ja: string;
  zh: string;
  example: string;
  audio: string;
  termAudio: string;
  quiz: string;
};

export type DialogueLine = {
  role: 'A' | 'B';
  text: string;
  zh: string;
  audio: string;
};

/** 四选一：choices 按显示顺序排列（左上、右上、左下、右下），正确答案位置由数据决定。 */
export type Choice = { value: string; label: string };

export type ChoiceQuestion = {
  eyebrow: string;
  question: string;
  choices: Choice[];
  correct: string;
  success: string;
  hint: string;
};

export type GrammarTest = {
  question: string;
  full: string;
  blank: string;
  choices: string[];
  correct: string;
  explain: string;
  zh: string;
};

export type SentenceCheck = {
  /** 定位句中目标语法的正则源码，例如 "ていただ(き|け|い)" 或 "お[一-龥ぁ-ん]+(し|いた)"。 */
  marker: string;
  /** 常见错误的无空格写法的正则源码，例如 "て頂"（该写假名却写了汉字之类）。 */
  markerNoSpace: string;
  /** 空格检查的提示文字，例如 '写法：〜ていただく 写成假名，不要写成 〜て頂く'。 */
  spacingLabel: string;
  /** 目标语法在提示文字中的显示名，例如 "〜ていただく"。 */
  displayName: string;
  /** 句意完整的检查方向：'after' 检查语法之后的内容，'before' 检查语法之前的内容。 */
  meaningSide: 'after' | 'before';
  meaningLabel: string;
  starters: string[];
  placeholder: string;
};

/**
 * 找错题：拿课文里用到该语法的句子改成不合规的样子，让学习者说出「错在哪」。
 * 目的是考「理解了没有、会不会用」，而不是考能不能从解说里抄答案，所以答题时解说是收起来的。
 * 每课的错法要按这条语法自己的易错点来设计，不要每课都是同一种错。
 */
export type ErrorTest = {
  /** 改错后的句子（展示时标 ✗）。 */
  wrong: string;
  /** 改对之后的句子（答对后展示，标 ✓）。 */
  fixed: string;
  /** 四个「为什么错」的理由，按显示顺序排列。 */
  choices: string[];
  correct: string;
  explain: string;
  zh: string;
};

/** 姊妹课：意思相近或容易混淆的语法所在的课。note 用一句话说明两课的关系（何时用哪个）。 */
export type RelatedLesson = { id: string; note: string };

export type Lesson = {
  id: string;
  /** 课程标签，例如“未排序素材样课”。不显示真实课序号。 */
  badge: string;
  /** 首页课程列表用的短标题。 */
  listTitle: string;
  listSummary: string;
  image: { src: string; alt: string };
  grammar: {
    title: string;
    summary: string;
    example: string;
    note: string;
    /** 列点版解说。有它就优先渲染，比一整段 note 好读。逐课补齐中。 */
    points?: string[];
  };
  dialogue: DialogueLine[];
  feeling: ChoiceQuestion;
  meaning: ChoiceQuestion;
  grammarTests: GrammarTest[];
  grammarTestHint: string;
  lessonWords: Word[];
  bonusWords: Word[];
  sentence: SentenceCheck;
  sentenceTitle: string;
  /** 找错题（可选）。和语法原型题一起构成 4/6 的「无解说作答」环节。逐课补齐中。 */
  errorTests?: ErrorTest[];
  /** 姊妹课列表（可选）。只渲染已注册的课，未生成的课自动隐藏。 */
  related?: RelatedLesson[];
};
