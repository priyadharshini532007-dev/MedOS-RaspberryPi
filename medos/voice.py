"""Offline speech recognition (Vosk) from the Pi's USB microphone or an uploaded WAV,
plus a rules-based parser that turns a check-in sentence into form fields.

Vosk is optional: without it, browsers that support the Web Speech API still work.
"""
from __future__ import annotations

import array
import io
import json
import math
import os
import re
import shutil
import subprocess
import threading
import time
import wave
from typing import Any, Callable, Dict, Optional

from . import config

SAMPLE_RATE = 16000


class VoiceError(Exception):
    pass


class Voice:
    def __init__(self):
        self._model = None
        self._whisper = None
        self.whisper_name = None
        self._model_lock = threading.Lock()
        self.mic_lock = threading.Lock()   # mutual exclusion: one recording at a time
        self._stop = threading.Event()      # set by request_stop(): the user pressed Stop
        self.listening = False
        self.transcriptions = 0
        self.model_loaded_at: Optional[float] = None

    # ------------------------------------------------------------ capability
    def vosk_available(self) -> bool:
        try:
            import vosk  # noqa: F401  type: ignore
        except Exception:
            return False
        return config.VOSK_MODEL_PATH.exists()

    def mic_available(self) -> bool:
        return shutil.which("arecord") is not None and self._has_capture_device()

    @staticmethod
    def _has_capture_device() -> bool:
        try:
            out = subprocess.run(["arecord", "-l"], capture_output=True, text=True, timeout=3).stdout
            return "card" in out
        except Exception:
            return False

    def status(self) -> Dict[str, Any]:
        stt = self.vosk_available() or self.whisper_available()
        return {"server_stt": stt, "pi_mic": stt and self.mic_available(),
                "engine": "whisper" if self.whisper_available() else ("vosk" if stt else None),
                "model_loaded": self._model is not None or self._whisper is not None, "model_path": str(config.VOSK_MODEL_PATH),
                "listening": self.listening, "transcriptions": self.transcriptions}

    def _get_model(self):
        with self._model_lock:
            if self._model is None:
                if not self.vosk_available():
                    raise VoiceError("Offline speech model is not installed on this device")
                import vosk  # type: ignore
                vosk.SetLogLevel(-1)
                self._model = vosk.Model(str(config.VOSK_MODEL_PATH))   # lazy: ~60 MB RAM once loaded
                self.model_loaded_at = time.time()
            return self._model

    # ------------------------------------------------------------ Whisper (accurate, preferred)
    def whisper_available(self) -> bool:
        if os.environ.get("MEDOS_WHISPER", "1") == "0":
            return False
        try:
            import faster_whisper  # noqa: F401  type: ignore
            return True
        except Exception:
            return False

    def _get_whisper(self):
        with self._model_lock:
            if self._whisper is None:
                from faster_whisper import WhisperModel  # type: ignore
                on_pi = os.path.exists("/proc/device-tree/model")
                name = os.environ.get("MEDOS_WHISPER_MODEL", "base.en" if on_pi else "small.en")
                self._whisper = WhisperModel(name, device="cpu", compute_type="int8",
                                             download_root=str(config.DATA_DIR / "whisper"))
                self.whisper_name = name
                self.model_loaded_at = time.time()
            return self._whisper

    PROMPT = ("Patient check-in at a hospital in India. My name is Ravi Kumar, I am 45 years old. "
              "Symptoms: fever, headache, stomach pain, vomiting, chest pain, breathing difficulty, fracture.")

    def whisper_pcm(self, pcm16: bytes, rate: int = SAMPLE_RATE) -> str:
        import numpy as np  # installed with faster-whisper
        audio = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
        if rate != SAMPLE_RATE:
            idx = (np.arange(int(len(audio) * SAMPLE_RATE / rate)) * rate / SAMPLE_RATE).astype(int)
            audio = audio[idx]
        segments, _ = self._get_whisper().transcribe(
            audio, language="en", beam_size=5, vad_filter=True, initial_prompt=self.PROMPT,
            condition_on_previous_text=False)
        self.transcriptions += 1
        return " ".join(s.text.strip() for s in segments).strip()

    def unload(self) -> None:
        with self._model_lock:
            self._model = None
            self.model_loaded_at = None

    # ------------------------------------------------------------ recognition
    def request_stop(self) -> None:
        """The user pressed Stop: end the current recording and transcribe it."""
        self._stop.set()

    def listen(self, max_seconds: float = 12, on_partial: Optional[Callable[[str], None]] = None,
               until_stopped: bool = False) -> str:
        """Record from the USB mic and return the text.

        until_stopped: keep recording through pauses until request_stop() (max_seconds is then only a
        safety cap). Otherwise stop by itself ~1.6 s after the speaker goes quiet.
        """
        if not self.mic_lock.acquire(blocking=False):
            raise VoiceError("The microphone is already in use")
        self._stop.clear()
        proc = None
        try:
            if self.whisper_available():
                return self._listen_whisper(max_seconds, on_partial, until_stopped)
            import vosk  # type: ignore
            rec = vosk.KaldiRecognizer(self._get_model(), SAMPLE_RATE)
            proc = subprocess.Popen(["arecord", "-q", "-f", "S16_LE", "-r", str(SAMPLE_RATE), "-c", "1",
                                     "-t", "raw", "-d", str(int(max_seconds) + 1)],
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            self.listening = True
            start = time.time()
            heard_at = None
            last_partial = ""
            parts = []
            while time.time() - start < max_seconds and not self._stop.is_set():
                chunk = proc.stdout.read(3200)          # 0.1 s
                if not chunk:
                    break
                loud = rms(chunk) > 500
                if loud:
                    heard_at = time.time()
                if rec.AcceptWaveform(chunk):
                    text = json.loads(rec.Result()).get("text", "")
                    if text:
                        parts.append(text)
                        if on_partial:
                            on_partial(" ".join(parts))
                else:
                    partial = json.loads(rec.PartialResult()).get("partial", "")
                    if partial and partial != last_partial:
                        last_partial = partial
                        if on_partial:
                            on_partial(" ".join(parts + [partial]))
                if until_stopped:
                    continue
                if heard_at and time.time() - heard_at > 1.6 and (parts or last_partial):
                    break
                if not heard_at and time.time() - start > 6:
                    break
            final = json.loads(rec.FinalResult()).get("text", "")
            if final:
                parts.append(final)
            self.transcriptions += 1
            return " ".join(p for p in parts if p).strip()
        finally:
            self.listening = False
            if proc:
                proc.kill()
            self.mic_lock.release()

    def _listen_whisper(self, max_seconds: float, on_partial, until_stopped: bool = False) -> str:
        proc = subprocess.Popen(["arecord", "-q", "-f", "S16_LE", "-r", str(SAMPLE_RATE), "-c", "1",
                                 "-t", "raw", "-d", str(int(max_seconds) + 1)],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.listening = True
        try:
            start, heard_at, buf, noise = time.time(), None, bytearray(), []
            while time.time() - start < max_seconds and not self._stop.is_set():
                chunk = proc.stdout.read(3200)
                if not chunk:
                    break
                buf += chunk
                level = rms(chunk)
                if len(noise) < 4:
                    noise.append(level)
                    continue
                if level > max(300.0, min(noise) * 2.5):
                    heard_at = time.time()
                    if on_partial:
                        on_partial("Recording. Press Stop when you're done…" if until_stopped else "Hearing you…")
                if until_stopped:
                    continue
                if heard_at and time.time() - heard_at > 2.0:
                    break
                if not heard_at and time.time() - start > 10:
                    break
        finally:
            proc.kill()
            self.listening = False
        if on_partial:
            on_partial("Turning speech into text…")
        return self.whisper_pcm(bytes(buf))

    def transcribe_wav(self, data: bytes) -> str:
        try:
            wf = wave.open(io.BytesIO(data), "rb")
        except (wave.Error, EOFError) as e:
            raise VoiceError("Audio must be a 16-bit mono WAV file (%s)" % e)
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
            raise VoiceError("Audio must be 16-bit mono")
        if self.whisper_available():
            return self.whisper_pcm(wf.readframes(wf.getnframes()), wf.getframerate())
        import vosk  # type: ignore
        rec = vosk.KaldiRecognizer(self._get_model(), wf.getframerate())
        parts = []
        while True:
            chunk = wf.readframes(4000)
            if not chunk:
                break
            if rec.AcceptWaveform(chunk):
                parts.append(json.loads(rec.Result()).get("text", ""))
        parts.append(json.loads(rec.FinalResult()).get("text", ""))
        self.transcriptions += 1
        return " ".join(p for p in parts if p).strip()


def rms(chunk: bytes) -> float:
    a = array.array("h", chunk[: len(chunk) - len(chunk) % 2])
    if not a:
        return 0.0
    return math.sqrt(sum(s * s for s in a) / len(a))


# ---------------------------------------------------------------- text → fields
# The parsing lives in medos/checkin.py (shared with the guided three-question check-in); these names
# stay importable from here for existing callers.
from .checkin import NAME_STOP, TENS, UNITS, parse_checkin, words_to_digits  # noqa: E402,F401


voice = Voice()
