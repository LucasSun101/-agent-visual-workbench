# 生成 PWA 图标：深底 + 三条泳道 + 状态点。内容留在中心安全区内（maskable 也能用）。
from PIL import Image, ImageDraw

BG = (10, 14, 19, 255)
LANE = (22, 35, 47, 255)
DOTS = [(73, 198, 255, 255), (255, 183, 77, 255), (61, 220, 151, 255)]


def make(size: int) -> Image.Image:
    scale = size / 512
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    for i in range(3):
        top = int((150 + i * 82) * scale)
        bottom = int((196 + i * 82) * scale)
        d.rounded_rectangle(
            [int(104 * scale), top, int(408 * scale), bottom],
            radius=int(16 * scale),
            fill=LANE,
        )
        cy = (top + bottom) // 2
        r = int(15 * scale)
        cx = int(136 * scale)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=DOTS[i])
    return img


if __name__ == "__main__":
    import pathlib

    out = pathlib.Path(__file__).resolve().parent.parent / "console" / "public"
    make(512).save(out / "icon-512.png")
    make(192).save(out / "icon-192.png")
    print("written:", out / "icon-512.png", out / "icon-192.png")
