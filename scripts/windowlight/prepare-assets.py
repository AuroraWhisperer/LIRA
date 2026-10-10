"""Derive four aligned 1080p plates and fixed receiver masks from the v6 master.

  python scripts/windowlight/prepare-assets.py --source tmp/output/windowlight-source/windowlight-master-v6.png

The detailed 1374x1145 generated insert is composed onto a 1920x1080 wall.
Authoring coordinates below use a 1280x720 view of that master.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
WIDTH, HEIGHT = 1920, 1080
Y, X = np.mgrid[0:HEIGHT, 0:WIDTH].astype(np.float32) / 1.5


def blur(array, radius):
    image = Image.fromarray(np.uint8(np.clip(array, 0, 1) * 255))
    return np.asarray(image.filter(ImageFilter.GaussianBlur(radius * 1.5)), dtype=np.float32) / 255


def polygon(points, feather=.7):
    image = Image.new('L', (WIDTH, HEIGHT))
    ImageDraw.Draw(image).polygon([(x * 1.5, y * 1.5) for x, y in points], fill=255)
    return np.asarray(image.filter(ImageFilter.GaussianBlur(feather * 1.5)), dtype=np.float32) / 255


def ellipse(cx, cy, rx, ry):
    return np.exp(-2 * (((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2))


def smoothstep(low, high, value):
    t = np.clip((value - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, mask):
    return a * (1 - mask[..., None]) + b * mask[..., None]


def rgb_image(array):
    return Image.fromarray(np.uint8(np.clip(array, 0, 1) * 255))


def write_light(path, color, alpha):
    rgb = np.broadcast_to(np.asarray(color), (HEIGHT, WIDTH, 3))
    rgba = np.dstack((rgb, np.clip(alpha, 0, 1)))
    Image.fromarray(np.uint8(np.clip(rgba, 0, 1) * 255)).save(path, 'WEBP', lossless=True, method=6, exact=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    source = Image.open(args.source).convert('RGB')
    if source.size != (WIDTH, HEIGHT):
        raise ValueError('These masks require the complete 1920x1080 v6 master.')
    output = ROOT / 'public/img/overlays/backgrounds/windowlight'
    scratch = ROOT / 'tmp/windowlight-v6'
    output.mkdir(parents=True, exist_ok=True)
    scratch.mkdir(parents=True, exist_ok=True)
    painting = np.asarray(source, dtype=np.float32) / 255
    luminance = painting @ np.array([.2126, .7152, .0722], dtype=np.float32)
    red, green, blue = np.moveaxis(painting, 2, 0)
    glass = np.maximum(polygon([(870, 0), (987, 0), (987, 548), (870, 524)], .3),
                       polygon([(1012, 0), (1151, 0), (1151, 577), (1012, 554)], .3))
    curtain_bounds = polygon([(508, 0), (786, 0), (715, 108), (651, 176), (670, 196),
        (656, 249), (662, 386), (668, 485), (674, 509), (690, 601), (678, 612),
        (615, 627), (534, 623), (481, 613), (456, 602), (481, 521), (478, 499),
        (494, 443), (497, 273), (459, 286), (475, 218), (458, 193), (467, 176),
        (502, 147), (493, 131), (507, 106)], .6)
    curtain = curtain_bounds * smoothstep(.02, .12, red - green + .06) * smoothstep(.50, .65, luminance)
    shade = polygon([(1191, 311), (1194, 303), (1226, 294), (1266, 293), (1280, 297),
        (1280, 645), (1236, 642), (1146, 632), (1061, 616), (1068, 605),
        (1111, 512), (1154, 407)], .6)
    base = polygon([(1248, 644), (1280, 644), (1280, 720), (1196, 720), (1243, 680)], .7)
    heads = [(698, 307, 21, 24), (778, 289, 34, 36), (703, 371, 34, 39),
             (815, 373, 28, 32), (848, 438, 35, 33), (902, 386, 18, 24),
             (778, 395, 13, 14), (811, 491, 12, 13),
             (911, 417, 16, 19), (927, 404, 18, 18), (949, 415, 19, 20),
             (971, 401, 20, 20), (975, 443, 15, 18), (960, 456, 15, 19),
             (951, 475, 16, 21), (927, 452, 18, 19), (905, 470, 18, 19),
             (891, 495, 17, 18), (878, 481, 16, 21), (915, 489, 16, 19)]
    flower_area = np.maximum.reduce([smoothstep(.07, .26, ellipse(*head)) for head in heads])
    pink = smoothstep(.03, .085, red - green)
    purple = smoothstep(.012, .055, blue - green) * smoothstep(0, .04, red - green)
    pale = smoothstep(.68, .80, luminance) * (1 - smoothstep(.18, .28, np.max(painting, axis=2) - np.min(painting, axis=2)))
    pale *= 1 - smoothstep(.03, .09, blue - red)
    petals = blur(np.maximum.reduce([pink, purple, pale]) * flower_area, .35)
    stem_image = Image.new('L', (WIDTH, HEIGHT))
    pen = ImageDraw.Draw(stem_image)
    for points in [[(766, 446), (760, 384), (778, 305)], [(766, 446), (731, 391), (705, 374)],
                   [(766, 446), (733, 351), (697, 315)], [(824, 504), (804, 445), (815, 385)],
                   [(824, 504), (838, 478), (848, 448)], [(917, 509), (937, 469), (947, 424)],
                   [(917, 509), (917, 465), (912, 425)], [(917, 509), (958, 455), (973, 415)],
                   [(917, 509), (900, 490), (881, 484)]]:
        pen.line([(x * 1.5, y * 1.5) for x, y in points], fill=255, width=14, joint='curve')
    stem_area = np.asarray(stem_image, dtype=np.float32) / 255
    stems = stem_area * smoothstep(.035, .08, green - blue) * (1 - smoothstep(.46, .65, luminance))
    flowers = np.clip(petals + stems, 0, 1)
    vases = np.maximum.reduce([polygon(points, .45) for points in [
        [(752, 437), (782, 437), (781, 454), (795, 474), (796, 588), (736, 591), (735, 477), (752, 457)],
        [(815, 499), (831, 499), (831, 517), (849, 553), (848, 600), (790, 598), (786, 562), (813, 520)],
        [(837, 568), (882, 568), (881, 605), (834, 603)],
        [(903, 502), (930, 502), (928, 519), (951, 533), (949, 607), (882, 603), (880, 534), (900, 520)],
    ]])
    outdoors = glass * (1 - shade) * (1 - flowers) * (1 - vases)
    indoor = 1 - outdoors
    wall = polygon([(0, 0), (728, 0), (735, 592), (492, 615), (525, 720), (0, 720)])
    wall *= (1 - curtain_bounds) * (1 - flowers) * (1 - vases)
    table = polygon([(493, 613), (734, 592), (1062, 616), (1280, 645), (1280, 720), (528, 720)])
    lamp_desk = ellipse(996, 649, 480, 120)
    lamp_flowers = ellipse(912, 476, 350, 290)
    lamp_curtain = ellipse(665, 523, 235, 250) * curtain
    lamp_room = np.clip(lamp_desk * .95 + lamp_flowers * .82 + lamp_curtain * .65 + ellipse(1240, 455, 185, 380) * .5, 0, 1) * indoor
    lamp_room *= 1 - wall * .95
    warm_paint = np.clip(painting * [1.08, .97, .72] + [.02, .015, 0], 0, 1)
    shade_emission = np.clip((.43 + luminance[..., None] * .55) * [1.05, .92, .69], 0, 1)
    sky = smoothstep(.025, .13, blue - red) * smoothstep(.5, .72, luminance)
    sky = np.maximum(sky, smoothstep(.82, .95, luminance) * (1 - smoothstep(.01, .065, red - blue)))
    sky = blur(sky, .6)
    sky_height = np.clip(Y / 527, 0, 1)

    def recolor_wall(scene, color, contrast):
        tone = np.asarray(color) / 255 + (luminance - .544)[..., None] * contrast
        return mix(scene, np.clip(tone, 0, 1), wall)

    sunny = painting * [.96, .99, 1]
    sunny = mix(sunny, painting * [.82, .86, .90], curtain)
    sunny = recolor_wall(sunny, (127, 151, 147), .48)

    sunset = painting * [.68, .63, .73] + [.025, .014, .015]
    sunset = recolor_wall(sunset, (113, 126, 119), .4)
    sunset_outside = painting * [.89, .56, .52] + [.085, .025, .065]
    sunset_sky = np.empty_like(painting)
    for i, (top, bottom) in enumerate(zip((.72, .46, .63), (1, .77, .44))):
        sunset_sky[..., i] = top + (bottom - top) * sky_height + (luminance - .8) * .1
    sunset = mix(sunset, mix(sunset_outside, sunset_sky, sky * .95), outdoors)
    sunset = mix(sunset, warm_paint, lamp_room * .49)
    sunset = mix(sunset, shade_emission, shade)
    sunset = mix(sunset, warm_paint, base * .7)

    desaturated = painting * .40 + luminance[..., None] * .60
    rainy = desaturated * [.71, .79, .86] + [.025, .025, .03]
    rainy = recolor_wall(rainy, (113, 142, 149), .35)
    rainy_outside = desaturated * [.40, .5, .6] + [.22, .25, .26]
    cloudy_sky = (.69 + (luminance - .8) * .22)[..., None] * [.94, 1, 1.06]
    rainy = mix(rainy, mix(rainy_outside, cloudy_sky, sky * .85), outdoors)
    rainy = mix(rainy, warm_paint, lamp_room * .54)
    rainy = mix(rainy, shade_emission, shade * .92)
    rainy = mix(rainy, warm_paint, base * .65)

    night = luminance[..., None] * [.29, .38, .55] + painting * [.025, .025, .05]
    night = recolor_wall(night, (32, 64, 85), .18)
    night_outside = luminance[..., None] * [.025, .05, .1] + [.018, .042, .085]
    night_sky = np.empty_like(painting)
    for i, (top, bottom) in enumerate(zip((.045, .12, .27), (.06, .18, .37))):
        night_sky[..., i] = top + (bottom - top) * sky_height + (luminance - .8) * .015
    night = mix(night, mix(night_outside, night_sky, sky * .98), outdoors)
    night = mix(night, warm_paint, np.clip(lamp_room * .89 + flowers * .30, 0, .93))
    night = mix(night, shade_emission, shade)
    night = mix(night, warm_paint, base * .83)
    for cx, cy in [(925, 35), (978, 68), (1071, 102), (1135, 51), (1112, 161), (1060, 28)]:
        night += ellipse(cx, cy, 1.3, 1.3)[..., None] * outdoors[..., None] * [.4, .47, .6]
    scenes = {'sunny': sunny, 'sunset': sunset, 'rainy': rainy, 'night': night}
    for name, scene in scenes.items():
        rgb_image(scene).save(output / f'{name}.webp', 'WEBP', quality=98, method=6)

    # Fixed sun shafts are broken up by the live canopy transmission field.
    beam_one = polygon([(231, -30), (337, -30), (75, 458), (-45, 458)], 2.2)
    beam_two = polygon([(464, -35), (550, -35), (296, 570), (196, 570)], 2.5)
    wall_beams = (beam_one * .91 + beam_two * .72) * wall
    curtain_beam = np.exp(-((X + Y * .51 - 756) / 148) ** 2)
    dapple = wall_beams + curtain * curtain_beam * .89
    dapple += table * ellipse(902, 635, 315, 75) * .34
    dapple = np.clip(blur(dapple, .7), 0, .93)
    write_light(output / 'dappled-light.webp', (1, .91, .7), dapple)
    write_light(output / 'window-mask.webp', (1, 1, 1), outdoors)

    rainbow_rgb = np.zeros_like(painting)
    rainbow_alpha = np.zeros((HEIGHT, WIDTH), dtype=np.float32)
    colors = [(1, .56, .48), (1, .83, .52), (1, 1, .83), (.63, 1, .86), (.6, .79, 1)]
    for cx, cy, length, strength in [(277, 230, 27, .65), (365, 386, 37, .58),
        (595, 159, 38, .67), (681, 274, 34, .65), (608, 431, 38, .62),
        (733, 411, 26, .53), (819, 598, 30, .54)]:
        along = (X - cx) * -.52 + (Y - cy) * .854
        across = (X - cx) * .854 + (Y - cy) * .52
        for i, color in enumerate(colors):
            strip = np.exp(-2 * (along / length) ** 2 - 2 * ((across + np.sin(along / 17) - (i - 2) * 2.4) / 2.1) ** 2) * strength
            total = rainbow_alpha + strip
            rainbow_rgb = (rainbow_rgb * rainbow_alpha[..., None] + np.asarray(color) * strip[..., None]) / np.maximum(total[..., None], 1e-6)
            rainbow_alpha = total
    rainbow_alpha = np.clip(rainbow_alpha, 0, .79) * indoor
    write_light(output / 'prismatic-light.webp', rainbow_rgb, rainbow_alpha)

    caustics = np.zeros((HEIGHT, WIDTH), dtype=np.float32)
    for cx, cy, length, width, strength in [(709, 480, 62, 4, .79), (794, 533, 56, 3, .78),
        (890, 573, 55, 4, .8), (939, 621, 84, 3, .91), (814, 648, 61, 3, .76),
        (1198, 400, 66, 5, .80), (1141, 513, 64, 4, .72), (656, 405, 60, 3, .69)]:
        along = (X - cx) * .60 + (Y - cy) * -.80
        across = (X - cx) * .80 + (Y - cy) * .60
        curve = np.sin(along / 23 + cx) * 3 + (along / length) ** 2 * 6
        caustics += np.exp(-2 * (along / length) ** 2 - 2 * ((across - curve) / width) ** 2) * strength
    receivers = np.clip(curtain + flowers + vases + table + shade + wall * ellipse(686, 372, 105, 199) * .55, 0, 1)
    lamp_alpha = np.clip(blur(caustics * receivers * indoor, .65), 0, .9)
    write_light(output / 'lamp-light.webp', (1, .90, .66), lamp_alpha)

    sheet = Image.new('RGB', (1280, 772), '#e9e5dc')
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 18)
    for index, (name, label) in enumerate(zip(scenes, ('晴天', '黄昏', '雨天', '夜晚'))):
        preview = scenes[name].copy()
        if name in ('sunny', 'sunset'):
            tint = np.array([1, .91, .7]) if name == 'sunny' else np.array([1, .67, .35])
            preview += (1 - preview) * tint * dapple[..., None] * .64
            preview += (1 - preview) * rainbow_rgb * rainbow_alpha[..., None] * .5
        if name == 'night':
            preview += (1 - preview) * np.array([1, .90, .66]) * lamp_alpha[..., None] * .6
        x, y = index % 2 * 640, index // 2 * 386
        draw.text((x + 12, y + 3), label, fill='#464f52', font=font)
        sheet.paste(rgb_image(preview).resize((640, 360), Image.Resampling.LANCZOS), (x, y + 26))
    sheet.save(scratch / 'contact-sheet.jpg', quality=97)

    generation = json.loads((ROOT / 'tmp/output/windowlight-source/windowlight-v6-generation.json').read_text(encoding='utf-8'))
    source_hash = hashlib.sha256(args.source.read_bytes()).hexdigest()
    provenance = {**generation, 'sourceLocation': args.source.resolve().relative_to(ROOT).as_posix(),
        'sourceSha256': source_hash, 'sourceSize': [1920, 1080], 'outputSize': [1920, 1080],
        'recipe': ['scripts/windowlight/compose-master.py', 'scripts/windowlight/prepare-assets.py'], 'sceneOrder': list(scenes),
        'transparentLayers': ['dappled-light.webp', 'prismatic-light.webp', 'window-mask.webp', 'lamp-light.webp'],
        'description': 'Original drawn detail insert composed with an extended painted wall. All four scenes derive from this identical 1080p master. Reference screenshots are composition references, never retouched source pixels.',
        'layerAlignment': 'Fixed 1920x1080 receiver maps. The glass matte excludes frames, curtain, lamp, flowers and vases. Live local illumination and refractive water are rendered by the trusted player.'}
    (output / 'provenance.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for asset in output.glob('*.webp'):
        metadata = {'source': provenance['sourceLocation'], 'sourceSha256': source_hash,
                    'requestId': generation['requestId'], 'provenance': 'provenance.json',
                    'outputSize': [WIDTH, HEIGHT], 'description': f'{asset.name}: aligned v6 scene or fixed light receiver.'}
        asset.with_suffix('.webp.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote eight 1920x1080 layers. Master SHA256: {source_hash}')


if __name__ == '__main__':
    main()
