"""Build native static TTFs from the issue #287 self-hosted WOFF2 sources.

Requires fonttools[woff]. Run from any directory; see README.md for provenance.
"""
from pathlib import Path
from tempfile import TemporaryDirectory

from fontTools.merge import Merger
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).parent


def instance(filename, family, style, weight):
    font = instantiateVariableFont(TTFont(ROOT / filename), {"wght": weight}, inplace=True)
    font.flavor = None
    font.recalcTimestamp = False
    names = font["name"]
    # Static faces need distinct native PostScript names after instancing.
    for name_id, value in {
        1: family, 2: style, 3: f"{family}-{style}", 4: f"{family} {style}",
        6: f"{family.replace(' ', '')}-{style}", 16: family, 17: style,
    }.items():
        for record in list(names.names):
            if record.nameID == name_id:
                names.setName(value, name_id, record.platformID, record.platEncID, record.langID)
        names.setName(value, name_id, 3, 1, 0x409)
    return font


for weight, style in [(400, "Regular"), (500, "Medium"), (600, "SemiBold")]:
    instance("space-grotesk-latin.woff2", "Space Grotesk", style, weight).save(
        ROOT / f"SpaceGrotesk-{style}.ttf"
    )

for weight, style in [(400, "Regular"), (600, "SemiBold")]:
    with TemporaryDirectory() as temporary:
        paths = []
        for subset in ["latin", "greek"]:
            path = Path(temporary) / f"{subset}.ttf"
            instance(f"jetbrains-mono-{subset}.woff2", "JetBrains Mono", style, weight).save(path)
            paths.append(str(path))
        font = Merger().merge(paths)
        font.recalcTimestamp = False
        source = TTFont(ROOT / "jetbrains-mono-latin.woff2")
        font["head"].created = source["head"].created
        font["head"].modified = source["head"].modified
        font.save(ROOT / f"JetBrainsMono-{style}.ttf")
        assert 0x03BB in font.getBestCmap(), "Retain the supplied Greek glyph coverage"
