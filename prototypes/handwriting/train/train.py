"""Train the small CNN used by the handwriting prototype and export int8 weights.

Usage: python train.py <dataset dir> <output weights.json>

Classes are digits 0-9, the letters A-G (note names), I and V (Roman numerals).
Each answer field masks the classes it accepts, so one model serves every field.
Training images are normalised the same way the browser renders strokes:
the ink's bounding box is scaled to fit 20x20 (aspect kept) and centred in 28x28.
"""

import base64
import json
import sys

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from torchvision import datasets

CLASSES = list("0123456789") + list("ABCDEFG") + ["I", "V"]
# EMNIST "letters" labels are 1..26 for a..z, upper and lower case merged.
LETTER_LABELS = {c: ord(c) - ord("A") + 1 for c in "ABCDEFGIV"}


def normalise(img: np.ndarray) -> np.ndarray:
    ys, xs = np.nonzero(img > 30)
    if len(xs) == 0:
        return np.zeros((28, 28), np.float32)
    crop = img[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    h, w = crop.shape
    s = 20.0 / max(h, w)
    nh, nw = max(1, round(h * s)), max(1, round(w * s))
    small = np.asarray(Image.fromarray(crop).resize((nw, nh), Image.BILINEAR), np.float32)
    out = np.zeros((28, 28), np.float32)
    top, left = (28 - nh) // 2, (28 - nw) // 2
    out[top : top + nh, left : left + nw] = small
    return out / 255.0


def load(root: str, train: bool):
    images, labels = [], []
    mnist = datasets.MNIST(root, train=train, download=True)
    for img, y in zip(mnist.data.numpy(), mnist.targets.numpy()):
        images.append(normalise(img))
        labels.append(int(y))
    emnist = datasets.EMNIST(root, split="letters", train=train, download=True)
    wanted = {v: CLASSES.index(k) for k, v in LETTER_LABELS.items()}
    for img, y in zip(emnist.data.numpy(), emnist.targets.numpy()):
        if int(y) in wanted:
            images.append(normalise(img.T))
            labels.append(wanted[int(y)])
    return torch.tensor(np.stack(images)).unsqueeze(1), torch.tensor(labels)


class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.c1 = nn.Conv2d(1, 16, 3, padding=1)
        self.c2 = nn.Conv2d(16, 32, 3, padding=1)
        self.f1 = nn.Linear(32 * 7 * 7, 64)
        self.f2 = nn.Linear(64, len(CLASSES))

    def forward(self, x):
        x = F.max_pool2d(F.relu(self.c1(x)), 2)
        x = F.max_pool2d(F.relu(self.c2(x)), 2)
        x = F.relu(self.f1(x.flatten(1)))
        return self.f2(x)


def augment(x: torch.Tensor) -> torch.Tensor:
    n = x.shape[0]
    dev = x.device
    angle = (torch.rand(n, device=dev) - 0.5) * 2 * 0.2
    scale = 0.85 + torch.rand(n, device=dev) * 0.3
    shear = (torch.rand(n, device=dev) - 0.5) * 0.4
    tx = (torch.rand(n, device=dev) - 0.5) * 0.15
    ty = (torch.rand(n, device=dev) - 0.5) * 0.15
    cos, sin = torch.cos(angle) / scale, torch.sin(angle) / scale
    theta = torch.stack(
        [torch.stack([cos, -sin + shear, tx], 1), torch.stack([sin, cos, ty], 1)], 1
    )
    grid = F.affine_grid(theta, x.shape, align_corners=False)
    x = F.grid_sample(x, grid, align_corners=False)
    r = torch.rand(n, 1, 1, 1, device=dev)
    thick = F.max_pool2d(x, 3, 1, 1)
    thin = -F.max_pool2d(-x, 3, 1, 1)
    return torch.where(r < 0.25, thick, torch.where(r > 0.85, thin, x))


def masked_accuracy(model, x, y, allowed):
    with torch.no_grad():
        logits = model(x)
    mask = torch.full((len(CLASSES),), float("-inf"), device=x.device)
    mask[allowed] = 0
    keep = torch.isin(y, torch.tensor(allowed, device=x.device))
    pred = (logits + mask).argmax(1)
    return (pred[keep] == y[keep]).float().mean().item(), int(keep.sum())


def quantise(t: torch.Tensor):
    a = t.detach().cpu().numpy().astype(np.float32)
    scale = float(np.abs(a).max() / 127.0) or 1.0
    q = np.clip(np.round(a / scale), -127, 127).astype(np.int8)
    return {"shape": list(a.shape), "scale": scale, "q": base64.b64encode(q.tobytes()).decode()}


def main():
    root, out = sys.argv[1], sys.argv[2]
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    xtr, ytr = load(root, True)
    xte, yte = load(root, False)
    xtr, ytr, xte, yte = xtr.to(dev), ytr.to(dev), xte.to(dev), yte.to(dev)
    torch.manual_seed(0)
    model = Net().to(dev)
    opt = torch.optim.Adam(model.parameters(), 2e-3)
    epochs = 12
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=epochs * (len(xtr) // 256 + 1))
    for epoch in range(epochs):
        model.train()
        perm = torch.randperm(len(xtr), device=dev)
        for i in range(0, len(xtr), 256):
            idx = perm[i : i + 256]
            loss = F.cross_entropy(model(augment(xtr[idx])), ytr[idx])
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
        model.eval()
        acc, _ = masked_accuracy(model, xte, yte, list(range(len(CLASSES))))
        print(f"epoch {epoch + 1}: all-class test accuracy {acc:.4f}", flush=True)

    digits = list(range(10))
    roman = [CLASSES.index("1"), CLASSES.index("I"), CLASSES.index("V")]
    notes = [CLASSES.index(c) for c in "ABCDEFG"]
    report = {}
    for name, allowed in (("digits", digits), ("roman", roman), ("notes", notes)):
        acc, n = masked_accuracy(model, xte, yte, allowed)
        report[name] = {"accuracy": round(acc, 4), "samples": n}
        print(f"{name}: {acc:.4f} on {n} test images", flush=True)

    model.cpu()
    with torch.no_grad():
        probe = xte[:8].cpu()
        probe_logits = model(probe).numpy().round(4).tolist()
    weights = {
        "classes": CLASSES,
        "layers": {
            name: {"w": quantise(getattr(model, name).weight), "b": getattr(model, name).bias.detach().numpy().round(6).tolist()}
            for name in ("c1", "c2", "f1", "f2")
        },
        "testAccuracy": report,
        "probe": {"inputs": probe.squeeze(1).numpy().round(4).tolist(), "logits": probe_logits},
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(weights, f)


if __name__ == "__main__":
    main()
