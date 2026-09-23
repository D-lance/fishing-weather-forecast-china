# 从 web/assets/logo-512.png 生成安卓各密度启动图标（一次性工具，产物已提交在 app/src/main/res/）。
# 用法：python android/tools/make-icons.py   （需要 Pillow）
#   mipmap-*/ic_launcher.png         老系统方形圆角图标（直接缩放 logo）
#   mipmap-*/ic_launcher_round.png   老系统圆形图标
#   mipmap-*/ic_launcher_foreground.png  Android 8+ 自适应图标前景：白色小鱼，背景色在 colors.xml
import os
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
LOGO = os.path.join(ROOT, 'web', 'assets', 'logo-512.png')
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
DENS = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
BRAND = (15, 118, 110, 255)

logo = Image.open(LOGO).convert('RGBA')

# 前景：只留白色的鱼（眼睛是品牌色，抠成透明后正好露出背景色）
px = logo.load()
fish = Image.new('RGBA', logo.size, (0, 0, 0, 0))
fp = fish.load()
for y in range(logo.height):
    for x in range(logo.width):
        r, g, b, a = px[x, y]
        # 白 → 不透明，青 → 透明，中间的抗锯齿边缘按亮度给透明度
        t = max(0.0, min(1.0, (r - BRAND[0]) / (255 - BRAND[0]))) if a > 0 else 0.0
        if t > 0.02:
            fp[x, y] = (255, 255, 255, int(255 * t * a / 255))
fish = fish.crop(fish.getbbox())

# 自适应图标画布 108dp，安全区是直径 66dp 的圆；鱼宽 58dp 保证整条鱼落在安全区内
for d, k in DENS.items():
    out = os.path.join(RES, 'mipmap-' + d)
    os.makedirs(out, exist_ok=True)
    s = round(48 * k)
    logo.resize((s, s), Image.LANCZOS).save(os.path.join(out, 'ic_launcher.png'))
    # 圆形：品牌色圆底 + 鱼
    big = s * 4
    rnd = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(rnd).ellipse((0, 0, big - 1, big - 1), fill=BRAND)
    fw = int(big * 0.62)
    f = fish.resize((fw, round(fw * fish.height / fish.width)), Image.LANCZOS)
    rnd.alpha_composite(f, ((big - f.width) // 2, (big - f.height) // 2))
    rnd.resize((s, s), Image.LANCZOS).save(os.path.join(out, 'ic_launcher_round.png'))
    # 自适应前景
    c = round(108 * k)
    fg = Image.new('RGBA', (c, c), (0, 0, 0, 0))
    fw = round(58 * k)
    f = fish.resize((fw, round(fw * fish.height / fish.width)), Image.LANCZOS)
    fg.alpha_composite(f, ((c - f.width) // 2, (c - f.height) // 2))
    fg.save(os.path.join(out, 'ic_launcher_foreground.png'))
print('ok')
