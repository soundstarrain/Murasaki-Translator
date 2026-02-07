import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 常用日文/繁体 <-> 简体 异体字映射表 (扩充版)
// 格式：每个字符串包含同一字的所有变体
const VARIANT_PAIRS = [
  // 日文新字体 <-> 简体
  "気气",
  "桜樱",
  "国國国",
  "学學学",
  "画畫画",
  "図圖图",
  "発發发",
  "万萬万",
  "旧舊旧",
  "帰歸归",
  "広廣广",
  "医醫医",
  "礼禮礼",
  "処處处",
  "区區区",
  "条條条",
  "独獨独",
  "虫蟲虫",
  "来來来",
  "狭狹狭",
  "厳嚴严",
  "尽盡尽",
  "栄榮荣",
  "亜亞亚",
  "悪惡恶",
  "円圓圆",
  "弾彈弹",
  "遅遲迟",
  "昼晝昼",
  "当當当",
  "乱亂乱",
  "争爭争",
  "辞辭辞",
  "鉄鐵铁",
  "奥奧奥",
  "戦戰战",
  "補補补",
  "収收收",
  "単單单",
  "帯帶带",
  "択擇择",
  "譲讓让",
  "醸釀酿",
  "歯齒齿",
  "楽樂乐",
  "薬藥药",
  "竜龍龙",
  "亀龜龟",
  "門門门",
  "飛飛飞",
  "電電电",
  "変變变",
  "恋戀恋",
  "湾灣湾",
  "実實实",
  "体體体",
  "点點点",
  "辺邊边",
  "声聲声",
  "聴聽听",
  "関關关",
  "係係系",
  "対對对",
  // 常见汉字
  "書书",
  "語语",
  "話话",
  "読读",
  "見见",
  "聞闻",
  "問问",
  "開开",
  "閉闭",
  "時时",
  "間间",
  "長长",
  "門门",
  "車车",
  "馬马",
  "魚鱼",
  "鳥鸟",
  "風风",
  "雲云",
  "雨雨",
  "雪雪",
  "火火",
  "水水",
  "木木",
  "金金",
  "土土",
  "山山",
  "川川",
  "海海",
  "空空",
  "花花",
  "草草",
  "森森",
  "林林",
  "人人",
  "女女",
  "男男",
  "子子",
  "母母",
  "父父",
  "兄兄",
  "弟弟",
  "姉姐",
  "妹妹",
  "家家",
  "屋屋",
  "店店",
  "会會会",
  "社社",
  "校校",
  "病病",
  "院院",
  "駅站",
  "港港",
  // 动词相关
  "売賣卖",
  "買買买",
  "見見见",
  "聞聞闻",
  "言言",
  "食食",
  "飲飲饮",
  "作作",
  "書書书",
  "読読读",
  "走走",
  "歩歩",
  "泳泳",
  "飛飛飞",
  "跳跳",
  "座座",
  // 形容词相关
  "高高",
  "低低",
  "大大",
  "小小",
  "長長长",
  "短短",
  "太太",
  "美美",
  "醜丑",
  "新新",
  "古古",
  "強强",
  "弱弱",
  "多多",
  "少少",
  "暗暗",
  "明明",
  "浅浅",
  // 抽象概念
  "愛愛爱",
  "心心",
  "夢夢梦",
  "霊靈灵",
  "魂魂",
  "神神",
  "鬼鬼",
  "妖妖",
  "術術术",
  "技技",
  "芸藝艺",
  "道道",
  "理理",
  "法法",
  "力力",
  "能能",
  // 战斗/游戏相关
  "剣劍剑",
  "刀刀",
  "槍槍枪",
  "弓弓",
  "矢矢",
  "盾盾",
  "甲甲",
  "兜兜",
  "攻攻",
  "防防",
  "魔魔",
  "武武",
  "戦戰战",
  "闘鬥斗",
  "勝勝胜",
  "負負负",
];

// 构建双向映射表
const VARIANT_MAP = new Map<string, Set<string>>();

VARIANT_PAIRS.forEach((pair) => {
  // 去重：确保每个字符只出现一次
  const chars = [...new Set(pair.split(""))];
  chars.forEach((c1) => {
    if (!VARIANT_MAP.has(c1)) VARIANT_MAP.set(c1, new Set());
    chars.forEach((c2) => {
      if (c1 !== c2) VARIANT_MAP.get(c1)?.add(c2);
    });
  });
});

// 获取某个字符的所有异体字变体
export function getVariants(char: string): Set<string> | undefined {
  return VARIANT_MAP.get(char);
}

// 检查两个 CJK 字符是否匹配（包括异体字）
export function isCJKMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const variants = VARIANT_MAP.get(a);
  return variants ? variants.has(b) : false;
}

// 标准化字符（简化版：直接返回原字符，因为我们用 Set 匹配）
export function normalizeToSimplified(char: string): string {
  // 如果有变体，返回变体集合中的第一个（通常是简体）
  const variants = VARIANT_MAP.get(char);
  if (variants && variants.size > 0) {
    // 返回第一个变体
    return variants.values().next().value || char;
  }
  return char;
}
