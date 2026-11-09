# 把 PWA 图标转成 .ico，给 Windows 快捷方式用。
from PIL import Image
import pathlib

public = pathlib.Path(__file__).resolve().parent.parent / "console" / "public"
src = public / "icon-512.png"
dst = public / "icon.ico"

img = Image.open(src).convert("RGBA")
img.save(dst, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("written:", dst, dst.stat().st_size, "bytes")
