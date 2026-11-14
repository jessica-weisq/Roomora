"""Run MASt3R on one room's photos. Needs a CUDA GPU and the mast3r repo on PYTHONPATH (see ../app.py).

Mirrors what naver/mast3r's own demo does (mast3r/demo.py: get_reconstructed_scene), with its
default settings, but returns raw arrays instead of a .glb so assemble.py can place the room on the plan.
MASt3R and its weights are CC BY-NC-SA 4.0: non-commercial use only.
"""

from __future__ import annotations

import copy
import tempfile
from pathlib import Path

import numpy as np

from .assemble import RoomScan, View

MAX_PHOTOS_PER_ROOM = 12  # every pair of photos is compared, so cost grows with the square


class Mast3rReconstructor:
    def __init__(self, weights: str = "naver/MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric", device: str = "cuda"):
        import mast3r.utils.path_to_dust3r  # noqa: F401  (puts the bundled dust3r on sys.path)
        from mast3r.model import AsymmetricMASt3R

        self.device = device
        self.model = AsymmetricMASt3R.from_pretrained(weights).to(device).eval()

    def __call__(self, image_paths: list[Path]) -> RoomScan:
        import torch
        from dust3r.utils.device import to_numpy
        from dust3r.utils.image import load_images
        from mast3r.cloud_opt.sparse_ga import sparse_global_alignment
        from mast3r.image_pairs import make_pairs

        filelist = [str(p) for p in image_paths[:MAX_PHOTOS_PER_ROOM]]
        imgs = load_images(filelist, size=512, verbose=False)
        single = len(imgs) == 1
        if single:  # same trick as the official demo: pair the photo with itself
            imgs = [imgs[0], copy.deepcopy(imgs[0])]
            imgs[1]["idx"] = 1
            filelist = [filelist[0], filelist[0] + "_2"]

        pairs = make_pairs(imgs, scene_graph="complete", prefilter=None, symmetrize=True)
        with tempfile.TemporaryDirectory() as cache_dir:
            scene = sparse_global_alignment(
                filelist, pairs, cache_dir, self.model,
                lr1=0.07, niter1=300, lr2=0.01, niter2=300,
                device=self.device, opt_depth=True, shared_intrinsics=False, matching_conf_thr=0.0,
            )
            pts3d, _, confs = to_numpy(scene.get_dense_pts3d(clean_depth=True))
            rgb = to_numpy(scene.imgs)
            cam2world = to_numpy(scene.get_im_poses())

        views = []
        for i in range(1 if single else len(rgb)):
            img = np.asarray(rgb[i], dtype=np.float32)
            pts = np.asarray(pts3d[i], dtype=np.float32).reshape(img.shape)
            mask = (np.asarray(confs[i]) > 1.5) & np.isfinite(pts).all(axis=-1)
            views.append(View(pts=pts, rgb=img, mask=mask))

        del scene
        torch.cuda.empty_cache()
        return RoomScan(views=views, cam2world=np.asarray(cam2world[: len(views)], dtype=np.float64))
