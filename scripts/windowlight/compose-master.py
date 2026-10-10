"""Compose the oblique window painting and the detailed wall curtain at 1080p.

Both inputs are original generated detail paintings, not reference screenshots.
The detail insert occupies 1296x1080; the empty wall is extended to the left.
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

WIDTH, HEIGHT = 1920, 1080


def align(source, before, after):
    painting = np.asarray(source.resize((1296, HEIGHT), Image.Resampling.LANCZOS), dtype=np.float32)
    rows = np.interp(np.arange(HEIGHT), np.array(after) * HEIGHT, np.array(before) * HEIGHT)
    lower = np.floor(rows).astype(int)
    upper = np.minimum(lower + 1, HEIGHT - 1)
    fraction = rows - lower
    return painting[lower] * (1 - fraction[:, None, None]) + painting[upper] * fraction[:, None, None]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--detail', type=Path, required=True)
    parser.add_argument('--curtain', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    detail = align(Image.open(args.detail).convert('RGB'),
                   [0, .3, .6, .75, .85, 1], [0, .4, .73, .845, .88, 1])
    edge = np.median(detail[:, :20], axis=1)
    full = np.broadcast_to(edge[:, None], (HEIGHT, WIDTH, 3)).copy()
    full[:, :624] += np.random.default_rng(7529).normal(0, .35, (HEIGHT, 624, 1))
    full[:, 624:] = detail
    master = Image.fromarray(np.uint8(np.clip(full, 0, 255)))
    cloth = align(Image.open(args.curtain).convert('RGB'),
                  [0, .22, .66, .80, .825, 1], [0, .24, .715, .85, .87, 1])
    curtain = np.zeros((HEIGHT, WIDTH, 3), dtype=np.float32)
    curtain[:, 624:] = cloth
    mask = Image.new('L', (WIDTH, HEIGHT))
    points = [(508, 0), (786, 0), (715, 108), (651, 176), (670, 196), (656, 249),
              (662, 386), (668, 485), (674, 509), (690, 601), (678, 612), (615, 627),
              (534, 623), (481, 613), (456, 602), (481, 521), (478, 499), (494, 443),
              (497, 273), (459, 286), (475, 218), (458, 193), (467, 176), (502, 147),
              (493, 131), (507, 106)]
    ImageDraw.Draw(mask).polygon([(x * 1.5, y * 1.5) for x, y in points], fill=255)
    luminance = curtain @ np.array([.2126, .7152, .0722]) / 255
    matte = np.asarray(mask, dtype=np.float32) / 255 * np.clip((luminance - .50) / .12, 0, 1)
    mask = Image.fromarray(np.uint8(matte * 255)).filter(ImageFilter.GaussianBlur(.45))
    master.paste(Image.fromarray(np.uint8(np.clip(curtain, 0, 255))), (0, 0), mask)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    master.save(args.output)
    print(f'Composed {WIDTH}x{HEIGHT} oblique window master: {args.output}')


if __name__ == '__main__':
    main()
