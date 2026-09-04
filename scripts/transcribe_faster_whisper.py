#!/usr/bin/env python3
"""Transcribe audio with faster-whisper and emit SRT/text outputs."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio_path")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model-size", default=os.getenv("FW_MODEL_SIZE", "small"))
    parser.add_argument("--device", default=os.getenv("FW_DEVICE", "auto"), choices=("auto", "cpu", "cuda"))
    parser.add_argument("--compute-type", default=os.getenv("FW_COMPUTE_TYPE") or None)
    parser.add_argument("--language", default=None)
    return parser.parse_args()


def seconds_to_srt(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def resolve_device(requested: str, ctranslate2) -> str:
    if requested in {"cpu", "cuda"}:
        return requested
    return "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"


def resolve_compute_type(device: str, requested: str | None, ctranslate2) -> str:
    supported = set(ctranslate2.get_supported_compute_types(device))
    if requested and requested in supported:
        return requested
    order = ["float16", "int8_float16", "int8", "float32"] if device == "cuda" else ["int8", "int8_float32", "int16", "float32"]
    return next((item for item in order if item in supported), sorted(supported)[0])


def main() -> int:
    args = parse_args()
    audio_path = Path(args.audio_path).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    if not audio_path.exists():
        print(f"ERROR: audio file not found: {audio_path}", file=sys.stderr)
        return 1

    try:
        import ctranslate2  # type: ignore
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError as exc:
        print(f"ERROR: missing faster-whisper dependency: {exc}", file=sys.stderr)
        return 1

    device = resolve_device(args.device, ctranslate2)
    compute_type = resolve_compute_type(device, args.compute_type, ctranslate2)
    model = WhisperModel(args.model_size, device=device, compute_type=compute_type)
    segments_iter, info = model.transcribe(
        str(audio_path),
        beam_size=5,
        vad_filter=True,
        language=args.language,
    )
    segments = list(segments_iter)

    output_dir.mkdir(parents=True, exist_ok=True)
    srt_path = output_dir / "subtitle.srt"
    text_path = output_dir / "text.txt"
    srt_lines = []
    text_parts = []
    for index, segment in enumerate(segments, start=1):
        text = " ".join(segment.text.split())
        if not text:
            continue
        srt_lines.append(f"{index}\n{seconds_to_srt(segment.start)} --> {seconds_to_srt(segment.end)}\n{text}\n")
        text_parts.append(text)

    srt_path.write_text("\n".join(srt_lines), encoding="utf-8")
    text_path.write_text((" ".join(text_parts) + "\n") if text_parts else "", encoding="utf-8")
    print(json.dumps({
        "language": getattr(info, "language", None),
        "segment_count": len(segments),
        "text_path": str(text_path),
        "srt_path": str(srt_path),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
