// Sample books of the prototype, newest first, and what 林悦的家 has done
// with them. Each book's cover is one solid colour; covers.mjs draws the
// files, and a book with no colour has no cover yet.
//
// - `minGrade`, `maxGrade`: the grades the book is for, lowest and highest;
//   the same grade twice for a book of one grade.
// - `acquired`: the family has the book in 我家的书.
// - `assigned`: the children it is assigned to, as indexes into CHILDREN.
//   `extraAssigned` counts assigned children beyond those, to show how the
//   avatar row overflows on a card.
// - `retired`: taken off the library; it stays with the families that have
//   it, and `replacement` names the book that takes its place.

/** Grade options in school order; the library holds books up to 初三 so far. */
export const GRADES = ['学前', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三'];

/** Subject options in the order the filter lists them. */
export const SUBJECTS = ['语文', '数学', '英语', '科学', '编程'];

/** `grades` is one grade, or the lowest and highest of a range. */
const book = (id, title, grades, subject, cover, intro, family = {}) => {
  const [minGrade, maxGrade = minGrade] = [grades].flat();
  return {
    id,
    title,
    minGrade,
    maxGrade,
    subject,
    cover,
    intro,
    acquired: false,
    assigned: [],
    extraAssigned: 0,
    retired: false,
    replacement: null,
    ...family,
  };
};

export const BOOKS = [
  book('garden-rhymes', '花园里的小儿歌', ['学前', '一年级'], '语文', '#f6b27a',
    '跟着小兔老师在花园里念儿歌：小草发芽、蝴蝶跳舞、雨点敲门。每首儿歌都配着拍手的节奏，念着念着就记住了常用的字。'),
  book('carrot-counting', '胡萝卜数数大冒险', '一年级', '数学', '#ffcf5c',
    '小兔要把 20 根胡萝卜分给朋友们。一边帮它分，一边学会数到 100、比较多少，还能认识加号和减号。',
    { acquired: true, assigned: [0, 1] }),
  book('hello-animals', 'Hello，动物朋友', '二年级', '英语', null,
    '认识 cat、dog、rabbit 等 30 个动物单词，跟着简单的句子说一说它们住在哪里、爱吃什么。'),
  book('moon-phases', '月亮为什么会变脸', '三年级', '科学', '#7f8fd6',
    '有时圆圆的像盘子，有时弯弯的像小船。我们用一个手电筒和一个皮球，在家里就能做出月亮的样子变化，弄明白月相是怎么回事。最后还有一张月亮观察表，可以连续画一个月。',
    { acquired: true }),
  book('robot-maze', '让小机器人走出迷宫', ['四年级', '初二'], '编程', '#5cc2b4',
    '用拖动积木的方式给小机器人下指令：前进、转弯、重复。从一步一步走到学会用循环，一共 12 个关卡。',
    { acquired: true, assigned: [2] }),
  book('seasons-poems', '四季里的古诗', ['四年级', '六年级'], '语文', '#e98a9b',
    '春天读《春晓》，夏天读《小池》，秋天读《山行》，冬天读《江雪》。每首诗都配了一幅画和一个小问题，帮你想一想诗人看到了什么、心里在想什么。',
    { acquired: true, assigned: [0, 2] }),
  book('shape-hide-and-seek', '形状捉迷藏', '学前', '数学', '#9ccf6e',
    '圆形藏在钟表里，三角形躲在屋顶上。跟着小兔在家里找一找，认识身边的形状。',
    { acquired: true, assigned: [0, 1, 2], extraAssigned: 2 }),
  book('pizza-fractions', '分披萨学分数', ['六年级', '初一'], '数学', '#f08a5d',
    '一张披萨分给四个人，每人能吃几块？两张披萨分给三个人呢？从切披萨开始认识分数，再学会分数的比较、加减和约分。书里有 40 道生活里的小题，做完就能自己算清楚怎么分最公平。'),
  book('my-school-day', 'My School Day 我的一天', '初一', '英语', '#6fa8dc',
    '跟着交换生 Amy 过完学校的一天，学会用英语介绍课程表、时间和喜欢的科目。'),
  book('pinyin-train', '拼音小火车', '一年级', '语文', '#c39bd3',
    '声母是车头，韵母是车厢，拼在一起就开动啦。'),
  book('seed-journey', '一颗种子的旅行', '二年级', '科学', '#a3c585',
    '种子是怎么跑到远方的？有的乘着风，有的粘在小动物身上，有的被小鸟吃下又带走。观察身边的种子，再亲手种一盆豆芽。',
    { acquired: true, assigned: [1] }),
  book('linear-functions', '一次函数的故事', '初二', '数学', '#4f86c6',
    '从出租车计费、手机套餐讲起，看懂一次函数的图像，学会用它解决生活里的选择题。'),
  book('abc-songs', 'ABC 唱唱书', '学前', '英语', '#ffb3c1',
    '26 个字母，每个都有一首短短的歌和一个好玩的动作。'),
  book('times-table-garden', '乘法花园', '三年级', '数学', '#8fd19e',
    '九九乘法表种在花园里：每一行是一畦菜，每一格是一棵。数一数，背一背，再玩一玩乘法接龙。'),
  book('bunny-counts', '小兔数萝卜', '一年级', '数学', '#e0b973',
    '跟着小兔数一数菜园里的萝卜，学会 20 以内的数。',
    { acquired: true, assigned: [0], retired: true, replacement: 'carrot-counting' }),
  book('write-a-diary', '一起来写日记', '四年级', '语文', '#f4a259',
    '今天发生了什么？从一件小事写起，学会把时间、地点、心情写清楚。',
    { acquired: true, assigned: [0] }),
  book('electricity-at-home', '家里的电从哪里来', '五年级', '科学', '#f9d56e',
    '电是怎么从发电站跑进家里的插座的？认识电路、开关和导体，动手做一个会亮的小灯泡，还要记住用电的安全规则。'),
  book('argument-writing', '把道理说清楚：议论文入门', '初三', '语文', '#9b8ec7',
    '什么是论点、论据和论证？用身边的例子练习把一个想法说清楚、说服别人。'),
  book('arrow-cards', '箭头卡片编程', '一年级', '编程', null,
    '不用电脑也能学编程：用箭头卡片给小伙伴下指令，让他走到宝藏那里。'),
  book('travel-english', '旅行英语小手册', '六年级', '英语', '#56b4d3',
    '问路、点餐、买票，用简单的英语在旅途中照顾好自己。'),
  book('reading-clocks', '认识钟表和时间', '二年级', '数学', '#f7a8a8',
    '几点起床、几点上学？认识时针和分针，学会看整点、半点和几时几分。'),
  book('tiny-cells', '细胞：看不见的小世界', '初一', '科学', '#7cc6a4',
    '用显微镜看洋葱表皮，你会发现一格一格的小房间，那就是细胞。认识细胞的结构，比较植物细胞和动物细胞的不同，再了解细胞怎样分裂、长大。每一章都有一个可以在家完成的小实验。',
    { acquired: true }),
  book('mixing-colors', '颜色变变变', '学前', '科学', '#ff9f80',
    '红色和黄色在一起会变成什么颜色？用水彩做实验，发现颜色的秘密。'),
  book('my-family-tree', 'My Family 我的家人', '三年级', '英语', '#b5a1e0',
    '用英语介绍爸爸妈妈、爷爷奶奶和兄弟姐妹，画一棵自己的家庭树。'),
  book('big-numbers', '大数有多大', '四年级', '数学', '#69b3e7',
    '一万粒米有多少？一亿秒有多长？用生活里的例子感受大数，学会读写和比较大数。'),
  book('scratch-games', '用 Scratch 做小游戏', '五年级', '编程', '#ffb347',
    '从一只会走路的小猫开始，加上按键控制、计分和关卡，做出属于自己的接水果游戏。'),
  book('classical-chinese', '文言文不难读', '初二', '语文', '#c9a27e',
    '从《论语》里的短句读起，认识常见的文言词，学会用联系上下文的方法猜词义。'),
  book('weather-station', '做一个小小气象站', '六年级', '科学', '#87c4e6',
    '用瓶子、吸管和纸杯做出雨量计、风向标和温度记录表，连续记录一周的天气。'),
  book('negative-numbers', '零下的温度：认识负数', '初一', '数学', '#a0b4d8',
    '冬天的温度为什么会是零下？从温度计和电梯楼层认识负数，学会在数轴上比较大小。'),
  book('reading-strategies', '英语阅读有方法', '初三', '英语', '#e7a977',
    '先看标题猜内容，再找关键词抓主旨。12 篇短文带你练会快速阅读。'),
  book('idiom-stories', '成语小故事', '二年级', '语文', '#d9a5c9',
    '守株待兔、亡羊补牢、画蛇添足……每个成语都是一个小故事，读完还能讲给家人听。'),
];

export const bookById = (id) => BOOKS.find((b) => b.id === id);

/** Whether a grade falls in the book's range, the lowest and highest grades included. */
export const coversGrade = (book, grade) => {
  const at = GRADES.indexOf(grade);
  return GRADES.indexOf(book.minGrade) <= at && at <= GRADES.indexOf(book.maxGrade);
};

/** 书库: every book still in the library, newest first. */
export const LIBRARY = BOOKS.filter((b) => !b.retired);

/** 我家的书: every book the family has, retired ones included. */
export const FAMILY_BOOKS = BOOKS.filter((b) => b.acquired);

/** 小米's own shelf, newest assignment first; `isNew` until 小米 opens the book. */
export const XIAOMI_SHELF = [
  { id: 'carrot-counting', isNew: true },
  { id: 'seasons-poems', isNew: true },
  { id: 'write-a-diary', isNew: false },
  { id: 'shape-hide-and-seek', isNew: false },
  { id: 'bunny-counts', isNew: false },
].map(({ id, isNew }) => ({ ...bookById(id), isNew }));
