from PIL import Image, ImageDraw

# Load the tight-cropped lyre
lyre = Image.open("design-handoff/No border lyre - Transparent.png").convert("RGBA")
bbox = lyre.getbbox()
lyre = lyre.crop(bbox)

# Create a 1024x1024 dark rounded square background
size = 1024
bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
mask = Image.new("L", (size, size), 0)
draw = ImageDraw.Draw(mask)
radius = 180
draw.rounded_rectangle([0, 0, size-1, size-1], radius=radius, fill=255)
bg_color = Image.new("RGBA", (size, size), (26, 24, 21, 255))
bg.paste(bg_color, mask=mask)

# Scale lyre to 82% of icon size
lyre_size = int(size * 0.82)
lyre_aspect = lyre.height / lyre.width
lyre_w = lyre_size
lyre_h = int(lyre_w * lyre_aspect)
lyre = lyre.resize((lyre_w, lyre_h), Image.LANCZOS)

# Center the lyre on the background
x = (size - lyre_w) // 2
y = (size - lyre_h) // 2
bg.paste(lyre, (x, y), lyre)

bg.save("src-tauri/icons/icon_source.png")
print(f"Saved {size}x{size} icon with dark background")
