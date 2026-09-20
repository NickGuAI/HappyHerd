"""Build labelled contact sheets from chat/manifest.json (requires Pillow)."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
root = Path(__file__).resolve().parents[2]
folder = root / 'docs/acceptance/issue-287/panels/chat'
items = json.loads((folder / 'manifest.json').read_text())
scenes = list(dict.fromkeys((item['panelId'], item['state']) for item in items))
font = ImageFont.load_default(size=13)
for start in range(0, len(scenes), 6):
    subset = scenes[start:start+6]
    canvas = Image.new('RGB', (1040, len(subset)*290), '#e2e2e2')
    draw = ImageDraw.Draw(canvas)
    for row, (scene, state) in enumerate(subset):
        entries = [item for item in items if item['panelId'] == scene and item['state'] == state]
        for col, entry in enumerate(entries):
            if col >= 4: break
            x, y = col*260, row*290
            draw.text((x+6,y+4), f"{scene}{' selected' if state == 'selected-answer' else ''}\n{entry['theme']} {entry['viewport']['width']}", fill='#111', font=font)
            preview = Image.open(folder / entry['filename']).convert('RGB')
            preview.thumbnail((252, 248))
            canvas.paste(preview, (x+4+(252-preview.width)//2, y+38))
    canvas.save(folder / f'contact-{start//6+1:02d}.jpg', quality=88)
