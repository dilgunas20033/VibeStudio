"""Write the fake-microphone WAVs used by the browser tests in frontend/e2e.

Playwright starts Edge/Chrome with --use-file-for-fake-audio-capture so these files play
into getUserMedia as if someone hummed or beatboxed into the mic.

    python scripts/make_hum_fixture.py
"""

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from tests.beatbox_synth import BOOM_BAP, beatbox  # noqa: E402
from tests.hum_synth import hum  # noqa: E402

FIXTURES = ROOT / "frontend" / "e2e" / "fixtures"


def write(name: str, y: np.ndarray, sr: int) -> None:
    y = np.concatenate([y, np.zeros(sr * 3, dtype=np.float32)])  # silence after the take
    FIXTURES.mkdir(parents=True, exist_ok=True)
    sf.write(FIXTURES / name, y, sr, subtype="PCM_16")
    print(f"wrote {(FIXTURES / name).relative_to(ROOT)} ({len(y) / sr:.1f}s)")


if __name__ == "__main__":
    write("hum-twinkle.wav", *hum(sr=48_000, bpm=100, lead_in=0.8, seed=21))
    # The two-bar boom-bap groove played twice (four bars) at 90 BPM.
    groove = BOOM_BAP + [(c, b + 8) for c, b in BOOM_BAP]
    write("beatbox-boombap.wav", *beatbox(groove, bpm=90, sr=48_000, lead_in=0.8, seed=7))
