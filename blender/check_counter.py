"""Fast geometric regression check, without rendering or baking.

blender -b --python-exit-code 1 --python blender/check_counter.py
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build

bpy.ops.wm.read_factory_settings(use_empty=True)
build.counter_interior(build.M())
bpy.context.view_layer.update()
cookies = [bpy.data.objects[f"plate_cookie_{i}"] for i in range(3)]
plate = bpy.data.objects["plate"]
surface = plate.location.z + plate.dimensions.z / 2
for cookie in cookies:
    bottom = cookie.location.z - cookie.dimensions.z / 2
    assert abs(bottom - surface) < 0.004, f"{cookie.name} floats {bottom - surface:.3f}m above the plate"
    distance = math.hypot(cookie.location.x - plate.location.x, cookie.location.y - plate.location.y)
    assert distance + cookie.dimensions.x / 2 < 0.12, f"{cookie.name} extends into the plate rim"
for i, cookie in enumerate(cookies):
    for other in cookies[i + 1:]:
        distance = math.hypot(cookie.location.x - other.location.x, cookie.location.y - other.location.y)
        assert distance >= (cookie.dimensions.x + other.dimensions.x) / 2, "Cookies overlap instead of lying flat"
print("PASS: three separate cookies rest flat inside the plate rim")
