"""
文本正规化器 (Text Normalizer)
功能：全角字母/数字转半角，半角假名转全角
"""
import itertools
import unicodedata


class Normalizer:
    # 自定义规则
    CUSTOM_RULE = {}

    # 全角字母数字转半角
    CUSTOM_RULE.update({chr(i): chr(i - 0xFEE0) for i in itertools.chain(
        range(0xFF21, 0xFF3A + 1),   # 全角 A-Z → 半角 A-Z
        range(0xFF41, 0xFF5A + 1),   # 全角 a-z → 半角 a-z
        range(0xFF10, 0xFF19 + 1),   # 全角 0-9 → 半角 0-9
    )})

    # 半角假名转全角
    CUSTOM_RULE.update({
        "ｱ": "ア", "ｲ": "イ", "ｳ": "ウ", "ｴ": "エ", "ｵ": "オ",
        "ｶ": "カ", "ｷ": "キ", "ｸ": "ク", "ｹ": "ケ", "ｺ": "コ",
        "ｻ": "サ", "ｼ": "シ", "ｽ": "ス", "ｾ": "セ", "ｿ": "ソ",
        "ﾀ": "タ", "ﾁ": "チ", "ﾂ": "ツ", "ﾃ": "テ", "ﾄ": "ト",
        "ﾅ": "ナ", "ﾆ": "ニ", "ﾇ": "ヌ", "ﾈ": "ネ", "ﾉ": "ノ",
        "ﾊ": "ハ", "ﾋ": "ヒ", "ﾌ": "フ", "ﾍ": "ヘ", "ﾎ": "ホ",
        "ﾏ": "マ", "ﾐ": "ミ", "ﾑ": "ム", "ﾒ": "メ", "ﾓ": "モ",
        "ﾔ": "ヤ", "ﾕ": "ユ", "ﾖ": "ヨ",
        "ﾗ": "ラ", "ﾘ": "リ", "ﾙ": "ル", "ﾚ": "レ", "ﾛ": "ロ",
        "ﾜ": "ワ", "ｦ": "ヲ", "ﾝ": "ン",
        "ｧ": "ァ", "ｨ": "ィ", "ｩ": "ゥ", "ｪ": "ェ", "ｫ": "ォ",
        "ｬ": "ャ", "ｭ": "ュ", "ｮ": "ョ", "ｯ": "ッ", "ｰ": "ー",
        "ﾞ": "゛", "ﾟ": "゜",
    })

    @classmethod
    def normalize(cls, text: str) -> str:
        """
        正规化文本
        - Unicode NFC 正规化
        - 全角字母数字转半角
        - 半角假名转全角
        """
        if not text:
            return text
        
        # Unicode NFC 正规化
        text = unicodedata.normalize("NFC", text)
        
        # 应用自定义规则
        text = "".join([cls.CUSTOM_RULE.get(char, char) for char in text])
        
        return text
