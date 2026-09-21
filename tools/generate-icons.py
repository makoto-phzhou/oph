"""Generate the Chrome toolbar icons without external dependencies."""

from pathlib import Path
import struct
import zlib


ROOT = Path(__file__).resolve().parent.parent / "extension" / "icons"
ROOT.mkdir(parents=True, exist_ok=True)


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def write_png(path, size, active):
    scale = 4
    dim = size * scale
    base = (10, 145, 108) if active else (151, 161, 165)
    pixels = bytearray()

    def inside_round_rect(x, y):
        radius = dim * 0.23
        cx = min(max(x, radius), dim - radius)
        cy = min(max(y, radius), dim - radius)
        return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2

    def sample(x, y):
        if not inside_round_rect(x, y):
            return (0, 0, 0, 0)
        # Four sensor dots form a distinctive pixel mark at toolbar size.
        for cx, cy, radius in ((0.36, 0.36, 0.105), (0.64, 0.36, 0.105),
                               (0.36, 0.64, 0.105), (0.64, 0.64, 0.105)):
            if (x / dim - cx) ** 2 + (y / dim - cy) ** 2 <= radius ** 2:
                return (255, 255, 255, 255)
        return (*base, 255)

    for py in range(size):
        pixels.append(0)
        for px in range(size):
            samples = [sample(px * scale + sx + 0.5, py * scale + sy + 0.5)
                       for sy in range(scale) for sx in range(scale)]
            alpha = sum(p[3] for p in samples) // (scale * scale)
            if alpha:
                color = [sum(p[i] * p[3] for p in samples) // sum(p[3] for p in samples)
                         for i in range(3)]
            else:
                color = [0, 0, 0]
            pixels.extend((*color, alpha))

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
                     + chunk(b"IDAT", zlib.compress(bytes(pixels), 9)) + chunk(b"IEND", b""))


for state in ("active", "inactive"):
    for size in (16, 32, 48, 128) if state == "active" else (16, 32):
        write_png(ROOT / f"{state}-{size}.png", size, state == "active")
