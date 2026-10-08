# Draws the plugin's listing icon, .claude-plugin/icon.png: columns of green code
# rain with white-hot heads, and a terminal prompt glowing in the middle.
# Run: python tools/make_icon.py  (needs Pillow; uses Windows' MS Gothic and Consolas)
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

SIZE = 1024
CELL = 40
KATAKANA = 'ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ0123456789Z:.=*+-<>'
TRAIL = ['#f0fff0', '#a8ffb8', '#00ff41', '#00e03a', '#00b82e', '#008f11', '#006b0d', '#004a09', '#002e05']
FONTS = 'C:/Windows/Fonts'

random.seed(1999)
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
glyphs = ImageFont.truetype(f'{FONTS}/msgothic.ttc', CELL - 4)
prompt = ImageFont.truetype(f'{FONTS}/consolab.ttf', 300)

rain = Image.new('RGB', (SIZE, SIZE), '#000000')
draw = ImageDraw.Draw(rain)
for column in range(SIZE // CELL):
    if random.random() > 0.85:
        continue
    head = random.randrange(6, SIZE // CELL + 8)
    trail = random.randrange(10, 24)
    for k in range(trail):
        row = head - k
        if row < 0 or row * CELL >= SIZE:
            continue
        shade = 0 if k == 0 else min(len(TRAIL) - 1, 1 + (k * (len(TRAIL) - 2)) // trail)
        draw.text((column * CELL + 6, row * CELL), random.choice(KATAKANA), font=glyphs, fill=TRAIL[shade])

# Dim the rain behind the prompt so the prompt reads at small sizes.
shade = Image.new('L', (SIZE, SIZE), 0)
ImageDraw.Draw(shade).rounded_rectangle((170, 330, 854, 694), radius=60, fill=200)
shade = shade.filter(ImageFilter.GaussianBlur(40))
icon = Image.composite(Image.new('RGB', (SIZE, SIZE), '#000000'), rain, shade)

# The prompt, with a soft phosphor glow.
glow = Image.new('RGB', (SIZE, SIZE), '#000000')
ImageDraw.Draw(glow).text((SIZE // 2, SIZE // 2), '>_', font=prompt, fill='#00ff41', anchor='mm')
icon = Image.composite(glow.filter(ImageFilter.GaussianBlur(22)), icon, glow.convert('L').filter(ImageFilter.GaussianBlur(22)).point(lambda v: min(255, v * 3)))
ImageDraw.Draw(icon).text((SIZE // 2, SIZE // 2), '>_', font=prompt, fill='#c8ffd2', anchor='mm')

icon.save(os.path.join(root, '.claude-plugin', 'icon.png'), optimize=True)
print('wrote .claude-plugin/icon.png')
