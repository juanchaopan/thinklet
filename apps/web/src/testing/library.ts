import type {
  BookCard,
  BookDetail,
  BookFiltersResponse,
  BookListResponse,
  Child,
  GradeRef,
  MeResponse,
  SubjectRef,
} from '@thinklet/contracts';
import { http, HttpResponse, type HttpHandler } from 'msw';
import { ALE_ID, CHILDREN, DOUDOU_ID, XIAOMI_ID, childWithPassword } from './children';
import { worker } from './network';
import { errorBody, LINYUE, LINYUE_FAMILY_ID } from './sample-data';

// The library the design draws, served by a small fake of the api's book
// routes: the 13 grades, the 5 subjects and the 31 sample books of the
// migration, newest first, with the covers of the prototype as solid
// colours, the grade ranges the prototype gives four of them, and what
// 林悦的家 has done with them. The fake keeps what the tests change, so
// acquiring, choosing readers and removing a book read back as the api
// would answer.

/** The grades in their set order: 学前 is `preschool`, the others `grade-<level>`. */
export const GRADES: readonly GradeRef[] = [
  '学前',
  '一年级',
  '二年级',
  '三年级',
  '四年级',
  '五年级',
  '六年级',
  '初一',
  '初二',
  '初三',
  '高一',
  '高二',
  '高三',
].map((name, level) => ({ id: level === 0 ? 'preschool' : `grade-${String(level)}`, name }));

/** The subjects in their set order. */
export const SUBJECTS: readonly SubjectRef[] = Object.entries({
  chinese: '语文',
  math: '数学',
  english: '英语',
  science: '科学',
  coding: '编程',
}).map(([id, name]) => ({ id, name }));

/** The grades of a sample book: one grade's id, or the ids of the lowest and highest. */
type SampleGrades = string | readonly [string, string];

/** One sample book: id, title, grades, subject, cover colour (null without a cover) and intro. */
type SampleBook = readonly [string, string, SampleGrades, string, string | null, string];

const SAMPLE_BOOKS: readonly SampleBook[] = [
  [
    'garden-rhymes',
    '花园里的小儿歌',
    ['preschool', 'grade-1'],
    'chinese',
    '#f6b27a',
    '跟着小兔老师在花园里念儿歌：小草发芽、蝴蝶跳舞、雨点敲门。每首儿歌都配着拍手的节奏，念着念着就记住了常用的字。',
  ],
  [
    'carrot-counting',
    '胡萝卜数数大冒险',
    'grade-1',
    'math',
    '#ffcf5c',
    '小兔要把 20 根胡萝卜分给朋友们。一边帮它分，一边学会数到 100、比较多少，还能认识加号和减号。',
  ],
  [
    'hello-animals',
    'Hello，动物朋友',
    'grade-2',
    'english',
    null,
    '认识 cat、dog、rabbit 等 30 个动物单词，跟着简单的句子说一说它们住在哪里、爱吃什么。',
  ],
  [
    'moon-phases',
    '月亮为什么会变脸',
    'grade-3',
    'science',
    '#7f8fd6',
    '有时圆圆的像盘子，有时弯弯的像小船。我们用一个手电筒和一个皮球，在家里就能做出月亮的样子变化，弄明白月相是怎么回事。最后还有一张月亮观察表，可以连续画一个月。',
  ],
  [
    'robot-maze',
    '让小机器人走出迷宫',
    ['grade-4', 'grade-8'],
    'coding',
    '#5cc2b4',
    '用拖动积木的方式给小机器人下指令：前进、转弯、重复。从一步一步走到学会用循环，一共 12 个关卡。',
  ],
  [
    'seasons-poems',
    '四季里的古诗',
    ['grade-4', 'grade-6'],
    'chinese',
    '#e98a9b',
    '春天读《春晓》，夏天读《小池》，秋天读《山行》，冬天读《江雪》。每首诗都配了一幅画和一个小问题，帮你想一想诗人看到了什么、心里在想什么。',
  ],
  [
    'shape-hide-and-seek',
    '形状捉迷藏',
    'preschool',
    'math',
    '#9ccf6e',
    '圆形藏在钟表里，三角形躲在屋顶上。跟着小兔在家里找一找，认识身边的形状。',
  ],
  [
    'pizza-fractions',
    '分披萨学分数',
    ['grade-6', 'grade-7'],
    'math',
    '#f08a5d',
    '一张披萨分给四个人，每人能吃几块？两张披萨分给三个人呢？从切披萨开始认识分数，再学会分数的比较、加减和约分。书里有 40 道生活里的小题，做完就能自己算清楚怎么分最公平。',
  ],
  [
    'my-school-day',
    'My School Day 我的一天',
    'grade-7',
    'english',
    '#6fa8dc',
    '跟着交换生 Amy 过完学校的一天，学会用英语介绍课程表、时间和喜欢的科目。',
  ],
  [
    'pinyin-train',
    '拼音小火车',
    'grade-1',
    'chinese',
    '#c39bd3',
    '声母是车头，韵母是车厢，拼在一起就开动啦。',
  ],
  [
    'seed-journey',
    '一颗种子的旅行',
    'grade-2',
    'science',
    '#a3c585',
    '种子是怎么跑到远方的？有的乘着风，有的粘在小动物身上，有的被小鸟吃下又带走。观察身边的种子，再亲手种一盆豆芽。',
  ],
  [
    'linear-functions',
    '一次函数的故事',
    'grade-8',
    'math',
    '#4f86c6',
    '从出租车计费、手机套餐讲起，看懂一次函数的图像，学会用它解决生活里的选择题。',
  ],
  [
    'abc-songs',
    'ABC 唱唱书',
    'preschool',
    'english',
    '#ffb3c1',
    '26 个字母，每个都有一首短短的歌和一个好玩的动作。',
  ],
  [
    'times-table-garden',
    '乘法花园',
    'grade-3',
    'math',
    '#8fd19e',
    '九九乘法表种在花园里：每一行是一畦菜，每一格是一棵。数一数，背一背，再玩一玩乘法接龙。',
  ],
  [
    'bunny-counts',
    '小兔数萝卜',
    'grade-1',
    'math',
    '#e0b973',
    '跟着小兔数一数菜园里的萝卜，学会 20 以内的数。',
  ],
  [
    'write-a-diary',
    '一起来写日记',
    'grade-4',
    'chinese',
    '#f4a259',
    '今天发生了什么？从一件小事写起，学会把时间、地点、心情写清楚。',
  ],
  [
    'electricity-at-home',
    '家里的电从哪里来',
    'grade-5',
    'science',
    '#f9d56e',
    '电是怎么从发电站跑进家里的插座的？认识电路、开关和导体，动手做一个会亮的小灯泡，还要记住用电的安全规则。',
  ],
  [
    'argument-writing',
    '把道理说清楚：议论文入门',
    'grade-9',
    'chinese',
    '#9b8ec7',
    '什么是论点、论据和论证？用身边的例子练习把一个想法说清楚、说服别人。',
  ],
  [
    'arrow-cards',
    '箭头卡片编程',
    'grade-1',
    'coding',
    null,
    '不用电脑也能学编程：用箭头卡片给小伙伴下指令，让他走到宝藏那里。',
  ],
  [
    'travel-english',
    '旅行英语小手册',
    'grade-6',
    'english',
    '#56b4d3',
    '问路、点餐、买票，用简单的英语在旅途中照顾好自己。',
  ],
  [
    'reading-clocks',
    '认识钟表和时间',
    'grade-2',
    'math',
    '#f7a8a8',
    '几点起床、几点上学？认识时针和分针，学会看整点、半点和几时几分。',
  ],
  [
    'tiny-cells',
    '细胞：看不见的小世界',
    'grade-7',
    'science',
    '#7cc6a4',
    '用显微镜看洋葱表皮，你会发现一格一格的小房间，那就是细胞。认识细胞的结构，比较植物细胞和动物细胞的不同，再了解细胞怎样分裂、长大。每一章都有一个可以在家完成的小实验。',
  ],
  [
    'mixing-colors',
    '颜色变变变',
    'preschool',
    'science',
    '#ff9f80',
    '红色和黄色在一起会变成什么颜色？用水彩做实验，发现颜色的秘密。',
  ],
  [
    'my-family-tree',
    'My Family 我的家人',
    'grade-3',
    'english',
    '#b5a1e0',
    '用英语介绍爸爸妈妈、爷爷奶奶和兄弟姐妹，画一棵自己的家庭树。',
  ],
  [
    'big-numbers',
    '大数有多大',
    'grade-4',
    'math',
    '#69b3e7',
    '一万粒米有多少？一亿秒有多长？用生活里的例子感受大数，学会读写和比较大数。',
  ],
  [
    'scratch-games',
    '用 Scratch 做小游戏',
    'grade-5',
    'coding',
    '#ffb347',
    '从一只会走路的小猫开始，加上按键控制、计分和关卡，做出属于自己的接水果游戏。',
  ],
  [
    'classical-chinese',
    '文言文不难读',
    'grade-8',
    'chinese',
    '#c9a27e',
    '从《论语》里的短句读起，认识常见的文言词，学会用联系上下文的方法猜词义。',
  ],
  [
    'weather-station',
    '做一个小小气象站',
    'grade-6',
    'science',
    '#87c4e6',
    '用瓶子、吸管和纸杯做出雨量计、风向标和温度记录表，连续记录一周的天气。',
  ],
  [
    'negative-numbers',
    '零下的温度：认识负数',
    'grade-7',
    'math',
    '#a0b4d8',
    '冬天的温度为什么会是零下？从温度计和电梯楼层认识负数，学会在数轴上比较大小。',
  ],
  [
    'reading-strategies',
    '英语阅读有方法',
    'grade-9',
    'english',
    '#e7a977',
    '先看标题猜内容，再找关键词抓主旨。12 篇短文带你练会快速阅读。',
  ],
  [
    'idiom-stories',
    '成语小故事',
    'grade-2',
    'chinese',
    '#d9a5c9',
    '守株待兔、亡羊补牢、画蛇添足……每个成语都是一个小故事，读完还能讲给家人听。',
  ],
];

/** The book that has left the library; 林悦的家 still has it, and 小米 reads it. */
export const RETIRED_BOOK_ID = 'bunny-counts';

/** How many books a batch holds. */
export const BATCH_SIZE = 12;

/** The cover version of a cover that cannot be read. */
const MISSING_COVER = 'missing';

// Two more children who read 形状捉迷藏, so its card shows how the avatars
// overflow into a count as the design draws it. The pages do not list them
// among the family's children.
const XIAOYU = childWithPassword('c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e01', '小雨', 'xiaoyu');
const TIANTIAN = childWithPassword('c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e02', '天天', 'tiantian');

/** The books 林悦的家 has, with the children who read each, as the design draws them. */
const FAMILY_BOOKS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['carrot-counting', [XIAOMI_ID, DOUDOU_ID]],
  ['moon-phases', []],
  ['robot-maze', [ALE_ID]],
  ['seasons-poems', [XIAOMI_ID, ALE_ID]],
  ['shape-hide-and-seek', [XIAOMI_ID, DOUDOU_ID, ALE_ID, XIAOYU.id, TIANTIAN.id]],
  ['seed-journey', [DOUDOU_ID]],
  ['bunny-counts', [XIAOMI_ID]],
  ['write-a-diary', [XIAOMI_ID]],
  ['tiny-cells', []],
];

/**
 * 林悦 as the design draws her on the library: admin of 林悦的家 with one
 * request waiting, and of 爷爷奶奶家 with another, and a member of 外婆家.
 */
export const LINYUE_AS_DRAWN: MeResponse = {
  ...LINYUE,
  families: [
    { id: LINYUE_FAMILY_ID, name: '林悦的家', role: 'admin', pendingRequests: 1 },
    ...LINYUE.families.filter(({ id }) => id !== LINYUE_FAMILY_ID),
    {
      id: '3b5d7f9a-1c2e-4a4b-8d6f-8091a2b3c4d5',
      name: '爷爷奶奶家',
      role: 'admin',
      pendingRequests: 1,
    },
  ],
};

/** The address of 林悦的家's books in the api. */
export const BOOKS_PATH = `/api/families/${LINYUE_FAMILY_ID}/books`;

/** The address of one of 林悦的家's books in the api, with what follows it. */
export function bookPath(bookId: string, suffix = ''): string {
  return `${BOOKS_PATH}/${bookId}${suffix}`;
}

/** An error answer of the api. */
function refused(code: Parameters<typeof errorBody>[0], status: number): Response {
  return HttpResponse.json(errorBody(code), { status });
}

/** The grade with the id. */
function gradeRef(gradeId: string): GradeRef {
  const grade = GRADES.find(({ id }) => id === gradeId);
  if (!grade) {
    throw new Error(`No grade ${gradeId}`);
  }
  return grade;
}

/**
 * The ids asked for that name one of the options. The api leaves a grade
 * or subject that does not exist out of the filter rather than refusing it
 * (interfaces.md), so a filter of only such ids takes in every book.
 */
function knownIds(
  ids: readonly string[],
  options: ReadonlyArray<{ readonly id: string }>,
): string[] {
  return ids.filter((id) => options.some((option) => option.id === id));
}

/** The place in the set order of a grade that exists, which ranges are measured by. */
function gradeLevel(gradeId: string): number {
  return GRADES.indexOf(gradeRef(gradeId));
}

/** Whether any of the grades, all of them known, lies within the book's range, its ends included. */
function coversAnyGrade(book: BookCard, gradeIds: readonly string[]): boolean {
  const lowest = gradeLevel(book.minGrade.id);
  const highest = gradeLevel(book.maxGrade.id);
  return gradeIds.some((gradeId) => {
    const level = gradeLevel(gradeId);
    return level >= lowest && level <= highest;
  });
}

/** A sample book as the fake keeps it. */
interface KeptBook extends Omit<BookCard, 'coverUrl' | 'acquired' | 'readers'> {
  readonly color: string | null;
}

/** The library the api serves, which the tests change and look into. */
export class FakeLibrary {
  /** The books the family has, each with the ids of the children who read it. */
  readonly owned = new Map(FAMILY_BOOKS.map(([id, readers]) => [id, [...readers]]));
  /** The family's children in the order they were added; a test may take one away. */
  children: Child[];
  /**
   * Whether the covers cannot be read: their addresses carry a version of
   * their own, which no earlier test has loaded, and the api answers 404.
   */
  coversMissing = false;

  private readonly books: readonly KeptBook[] = SAMPLE_BOOKS.map(
    ([id, title, grades, subject, color, intro]) => {
      const [lowest, highest] = typeof grades === 'string' ? [grades, grades] : grades;
      return {
        id,
        title,
        intro,
        minGrade: gradeRef(lowest),
        maxGrade: gradeRef(highest),
        subject: SUBJECTS.find((known) => known.id === subject) ?? { id: subject, name: subject },
        status: id === RETIRED_BOOK_ID ? 'inactive' : 'active',
        color,
      };
    },
  );

  constructor(children: readonly Child[]) {
    this.children = [...children];
  }

  /** The book as the list shows it now. */
  card(bookId: string): BookCard {
    const { color, ...shown } = this.kept(bookId) ?? this.missing(bookId);
    const readers = this.owned.get(bookId) ?? [];
    const version = this.coversMissing ? MISSING_COVER : color?.slice(1);
    return {
      ...shown,
      coverUrl: color ? `/api/books/${bookId}/cover?v=${version ?? ''}` : null,
      acquired: this.owned.has(bookId),
      readers: this.readersKnown()
        .filter(({ id }) => readers.includes(id))
        .map(({ id, nickname }) => ({ childId: id, nickname })),
    };
  }

  /**
   * The answer to a list request with these query parameters; the subjects
   * that do not exist are no part of the filter, as `knownIds` says.
   */
  list(search: URLSearchParams): Response {
    const found = this.scoped(search);
    if (!found) {
      return refused('child_not_found', 404);
    }
    const subjects = knownIds(search.getAll('subject'), SUBJECTS);
    const matching = found.filter(
      (book) => subjects.length === 0 || subjects.includes(book.subject.id),
    );
    const start = Number(search.get('cursor') ?? 0);
    const end = start + BATCH_SIZE;
    return HttpResponse.json({
      books: matching.slice(start, end),
      nextCursor: end < matching.length ? String(end) : null,
    } satisfies BookListResponse);
  }

  /** The answer to the filter options with these query parameters. */
  filters(search: URLSearchParams): Response {
    const found = this.scoped(search);
    if (!found) {
      return refused('child_not_found', 404);
    }
    const subjects = SUBJECTS.filter(({ id }) => found.some((book) => book.subject.id === id));
    return HttpResponse.json({ grades: [...GRADES], subjects } satisfies BookFiltersResponse);
  }

  /** The answer to a book's details. */
  detail(bookId: unknown): Response {
    const book = this.kept(bookId);
    if (!book || (book.status === 'inactive' && !this.owned.has(book.id))) {
      return refused('book_not_found', 404);
    }
    return HttpResponse.json(this.detailOf(book.id));
  }

  /** The answer to acquiring a book. */
  acquire(bookId: unknown): Response {
    const book = this.kept(bookId);
    if (!book) {
      return refused('book_not_found', 404);
    }
    if (!this.owned.has(book.id)) {
      if (book.status === 'inactive') {
        return refused('book_inactive', 409);
      }
      this.owned.set(book.id, []);
    }
    return HttpResponse.json(this.detailOf(book.id));
  }

  /** The answer to removing a book from the family's books. */
  remove(bookId: unknown): Response {
    const book = this.kept(bookId);
    if (!book) {
      return refused('book_not_found', 404);
    }
    if ((this.owned.get(book.id) ?? []).length > 0) {
      return refused('book_in_use', 409);
    }
    this.owned.delete(book.id);
    return new HttpResponse(null, { status: 204 });
  }

  /** The answer to setting the children who read a book. */
  setReaders(bookId: unknown, childIds: readonly string[]): Response {
    const book = this.kept(bookId);
    const current = book && this.owned.get(book.id);
    if (!book || !current) {
      return book ? refused('book_not_acquired', 409) : refused('book_not_found', 404);
    }
    const family = this.readersKnown().map(({ id }) => id);
    if (childIds.some((id) => !family.includes(id))) {
      return refused('child_not_found', 404);
    }
    if (book.status === 'inactive' && childIds.some((id) => !current.includes(id))) {
      return refused('book_inactive', 409);
    }
    this.owned.set(
      book.id,
      family.filter((id) => childIds.includes(id)),
    );
    return HttpResponse.json(this.detailOf(book.id));
  }

  /** A cover as the api serves it: a solid colour at 600×800. */
  cover(bookId: unknown, version: string | null): Response {
    const color = this.kept(bookId)?.color;
    if (!color || version === MISSING_COVER) {
      return refused('book_not_found', 404);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="${color}"/></svg>`;
    return new HttpResponse(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
  }

  private kept(bookId: unknown): KeptBook | undefined {
    return this.books.find(({ id }) => id === bookId);
  }

  private missing(bookId: string): never {
    throw new Error(`No sample book ${bookId}`);
  }

  /** The family's children and the two who only read 形状捉迷藏, in the order they were added. */
  private readersKnown(): Child[] {
    return [...this.children, XIAOYU, TIANTIAN];
  }

  private detailOf(bookId: string): BookDetail {
    const replacement =
      bookId === RETIRED_BOOK_ID ? { id: 'carrot-counting', title: '胡萝卜数数大冒险' } : null;
    return { ...this.card(bookId), replacement };
  }

  /**
   * The books of the query's scope and grades, or null for a child who is
   * not the family's. A book is of the grades asked for when any of them
   * lies within its range; the grades that do not exist are no part of the
   * filter, as `knownIds` says.
   */
  private scoped(search: URLSearchParams): BookCard[] | null {
    const scope = search.get('scope') ?? 'library';
    const child = search.get('child');
    if (scope === 'child' && !this.children.some(({ id }) => id === child)) {
      return null;
    }
    const grades = knownIds(search.getAll('grade'), GRADES);
    return this.books
      .map(({ id }) => this.card(id))
      .filter((book) => {
        if (scope === 'family') {
          return book.acquired;
        }
        return scope === 'child'
          ? book.readers.some(({ childId }) => childId === child)
          : book.status === 'active';
      })
      .filter((book) => grades.length === 0 || coversAnyGrade(book, grades));
  }
}

/** The api's book routes, answered by the fake. */
function libraryRoutes(fake: FakeLibrary): HttpHandler[] {
  const book = '/api/families/:familyId/books/:bookId';
  const search = (request: Request) => new URL(request.url).searchParams;
  return [
    http.get('/api/families/:familyId/children', () => HttpResponse.json(fake.children)),
    http.get('/api/families/:familyId/book-filters', ({ request }) =>
      fake.filters(search(request)),
    ),
    http.get('/api/families/:familyId/books', ({ request }) => fake.list(search(request))),
    http.get(book, ({ params }) => fake.detail(params['bookId'])),
    http.put(`${book}/acquisition`, ({ params }) => fake.acquire(params['bookId'])),
    http.delete(`${book}/acquisition`, ({ params }) => fake.remove(params['bookId'])),
    http.put(`${book}/readers`, async ({ params, request }) => {
      const { childIds } = (await request.json()) as { childIds: string[] };
      return fake.setReaders(params['bookId'], childIds);
    }),
    http.get('/api/books/:bookId/cover', ({ params, request }) =>
      fake.cover(params['bookId'], search(request).get('v')),
    ),
  ];
}

/**
 * Serves the library of the design for every family: the children, the
 * filter options, the books in batches of 12, a book's details, acquiring
 * and removing a book, setting its readers and the covers, with the api's
 * error codes. Returns the fake, which keeps what the tests change.
 */
export function stubLibrary(children: readonly Child[] = CHILDREN): FakeLibrary {
  const fake = new FakeLibrary(children);
  worker.use(...libraryRoutes(fake));
  return fake;
}
