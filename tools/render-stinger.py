from pathlib import Path
from math import pow
from subprocess import run
from tempfile import TemporaryDirectory
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
output = root / 'obs' / 'flt5-stinger.webm'
width = 1920
height = 1080
fps = 60
duration = 1.4
count = round(fps * duration)
colors = ['#ed70ae', '#b8a0ff', '#ffd46f', '#f598c9', '#8dd7ff', '#ffb68f']
logo = Image.open(root / 'assets' / 'flt5-logo.png').convert('RGBA')
logo = logo.crop(logo.getbbox())
loops = [Image.open(root / 'assets' / 'loops' / f'{color}.png').convert('RGBA') for color in ['blue', 'pink', 'yellow', 'purple', 'orange']]
output.parent.mkdir(parents=True, exist_ok=True)

def clamp(value):
    return max(0, min(1, value))

def out_quint(value):
    return 1 - pow(1 - clamp(value), 5)

def make_blinds():
    textures = []
    for index in range(12):
        size = (round((width / 12 + 16) * 2), (height + 104) * 2)
        texture = Image.new('RGBA', size, colors[index % len(colors)])
        for row in range(9):
            branding = row % 2 == 0
            asset = logo if branding else loops[(index + row + 2) % len(loops)]
            asset = asset.crop(asset.getbbox())
            item_width = 142 if branding else 110
            item = asset.resize((item_width * 2, round(item_width * 2 * asset.height / asset.width)), Image.Resampling.LANCZOS)
            angle = (5 if branding else 10) * (-1 if (index + row) % 2 else 1)
            item = item.rotate(angle, Image.Resampling.BICUBIC, expand=True)
            item = item.crop(item.getbbox())
            center_y = row * 150 + 40 + (index % 3) * 38
            center_x = size[0] // 2 - 8
            texture.alpha_composite(item, (center_x - item.width // 2, center_y * 2 - item.height // 2))
        mask = Image.new('L', size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=68, fill=255)
        texture.putalpha(mask)
        textures.append(texture)
    return textures

blinds = make_blinds()

def render_frame(time):
    image = Image.new('RGBA', (width * 2, height * 2), (0, 0, 0, 0))
    for index, blind in enumerate(blinds):
        enter = out_quint((time - index * .012) / .34)
        leave = out_quint((time - .84 - (11 - index) * .01) / .34)
        travel = (1 - enter + leave) * (height + 104)
        y = -52 - travel if index % 2 == 0 else -52 + travel
        x = index * width / 12 - 8
        image.alpha_composite(blind, (round(x * 2), round(y * 2)))
    return image.resize((width, height), Image.Resampling.LANCZOS)

def main():
    with TemporaryDirectory(prefix='flt5-stinger-') as temp:
        frames = Path(temp)
        for frame in range(count):
            image = render_frame(frame / fps)
            alpha = image.getchannel('A').getextrema()
            if .5 <= frame / fps <= .8 and alpha != (255, 255):
                raise RuntimeError(f'Incomplete transition coverage at frame {frame}: {alpha}')
            if frame in (0, count - 1) and alpha != (0, 0):
                raise RuntimeError(f'Transition endpoint is not transparent at frame {frame}: {alpha}')
            image.save(frames / f'frame-{frame:04d}.png', compress_level=1)
        run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'warning', '-framerate', str(fps), '-i', str(frames / 'frame-%04d.png'), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-lossless', '1', str(output)], check=True)
        run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'warning', '-c:v', 'libvpx-vp9', '-i', str(output), '-vf', 'select=between(n\\,30\\,48)', '-fps_mode', 'passthrough', str(frames / 'coverage-%02d.png')], check=True)
        for path in frames.glob('coverage-*.png'):
            if Image.open(path).convert('RGBA').getchannel('A').getextrema() != (255, 255):
                raise RuntimeError(f'Encoded transition has a transparent seam: {path.name}')
        print('Verified fully opaque coverage from 500 to 800 ms, including the 700 ms OBS cut point')
        print(output)

if __name__ == '__main__':
    main()
